import { Request, Response, NextFunction } from 'express';
import { cache } from '../lib/cache.js';

interface ApiCacheOptions {
  ttl: number;
  key?: (req: Request) => string;
  condition?: (req: Request) => boolean;
}

export function apiCache(options: ApiCacheOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (options.condition && !options.condition(req)) return next();
      if (req.headers['cache-control']?.includes('no-cache') || req.headers['cache-control']?.includes('no-store')) return next();

      const user = (req as any).user;
      const cacheKey = options.key?.(req) || `${user?.sub || 'anon'}:${user?.role || 'none'}:${req.originalUrl}`;
      const cached = await cache.get(cacheKey);

      // Never let the browser cache these per-user payloads: a stale 304 here
      // hides state changes (pause/resume, check-in) until a manual refresh.
      if (cached !== undefined) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Cache-Control', 'no-store');
        res.json(cached);
        return;
      }

      res.setHeader('X-Cache', 'MISS');
      res.setHeader('Cache-Control', 'no-store');
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (res.statusCode < 400) {
          cache.set(cacheKey, body, options.ttl).catch(() => {});
        }
        return originalJson(body);
      };

      next();
    } catch {
      next();
    }
  };
}
