import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import db from '../db/index.js';
import { isTokenRevoked } from '../lib/blacklist.js';

const userCache = new Map<string, { status: string; role: string; expiresAt: number }>();
const USER_CACHE_TTL_MS = 30_000;

const userCacheCleanupInterval: ReturnType<typeof setInterval> = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of userCache) {
    if (entry.expiresAt <= now) userCache.delete(key);
  }
}, 60_000);

export function stopUserCacheCleanup(): void {
  clearInterval(userCacheCleanupInterval);
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.accessToken;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    try {
      if (await isTokenRevoked(req.user.sub, req.user.iat)) {
        res.status(401).json({ error: 'Token revoked' });
        return;
      }
    } catch (err) {
      console.error('[AUTH] Token revocation check failed, rejecting request:', err);
      res.status(503).json({ error: 'Service temporarily unavailable' });
      return;
    }

    const now = Date.now();
    const cached = userCache.get(req.user.sub);
    if (cached && cached.expiresAt > now) {
      if (cached.status !== 'active') {
        res.status(401).json({ error: 'Account is inactive or suspended' });
        return;
      }
      req.user.role = cached.role;
      next();
      return;
    }

    const user = await db.prepare('SELECT status, role FROM users WHERE id = ?').get(req.user.sub) as any;
    if (!user || user.status !== 'active') {
      userCache.set(req.user.sub, { status: 'inactive', role: '', expiresAt: now + USER_CACHE_TTL_MS });
      res.status(401).json({ error: 'Account is inactive or suspended' });
      return;
    }

    userCache.set(req.user.sub, { status: user.status, role: user.role, expiresAt: now + USER_CACHE_TTL_MS });
    req.user.role = user.role;
    next();
  } catch (err: any) {
    // JWT verification errors are 401; actual server errors are 503
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      res.status(401).json({ error: 'Invalid or expired token' });
    } else {
      console.error('[AUTH] Unexpected error:', err);
      res.status(503).json({ error: 'Authentication service unavailable' });
    }
  }
}

export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}
