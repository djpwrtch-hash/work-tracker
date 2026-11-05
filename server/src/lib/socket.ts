import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import db from '../db/index.js';
import { verifyAccessToken, type AccessTokenPayload } from './jwt.js';
import { isTokenRevoked } from './blacklist.js';
import { config } from './config.js';

let io: Server | null = null;

const connectionCounts = new Map<string, number>();
const userSocketCounts = new Map<string, number>();
const reconnectTracker = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();

const MAX_CONNECTIONS_PER_USER = 5;
const MAX_CONNECTIONS_PER_IP = 20;
const HEARTBEAT_INTERVAL = 25000;
// 15s was too tight: a backgrounded browser tab, a Windows sleep/resume or a slow moment
// (for example while the daily backup runs) missed the pong and the socket was dropped
// with "ping timeout" while the client was still perfectly healthy.
const HEARTBEAT_TIMEOUT = 45000;
const SUSPICIOUS_RECONNECT_THRESHOLD = 10;
const SUSPICIOUS_WINDOW_MS = 5 * 60 * 1000;

const reconnectCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of reconnectTracker) {
    if (now - entry.lastSeen > SUSPICIOUS_WINDOW_MS) reconnectTracker.delete(key);
  }
}, 60_000);

function getClientIp(socket: Socket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return socket.handshake.address;
}

function trackReconnect(userId: string) {
  const now = Date.now();
  const existing = reconnectTracker.get(userId);
  if (!existing || (now - existing.firstSeen) > SUSPICIOUS_WINDOW_MS) {
    reconnectTracker.set(userId, { count: 1, firstSeen: now, lastSeen: now });
  } else {
    existing.count++;
    existing.lastSeen = now;
    if (existing.count >= SUSPICIOUS_RECONNECT_THRESHOLD) {
      console.warn(`[Socket] Suspicious reconnect pattern for user ${userId}: ${existing.count} reconnects in ${Math.round((now - existing.firstSeen) / 1000)}s`);
    }
  }
}

export function initializeSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: HEARTBEAT_INTERVAL,
    pingTimeout: HEARTBEAT_TIMEOUT,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyAccessToken(token);
      if (await isTokenRevoked(payload.sub, payload.iat)) return next(new Error('Token revoked'));
      const user = await db.prepare('SELECT status FROM users WHERE id = ?').get(payload.sub) as any;
      if (!user || user.status !== 'active') return next(new Error('Account is inactive'));

      const ip = getClientIp(socket);
      const ipCount = connectionCounts.get(ip) ?? 0;
      if (ipCount >= MAX_CONNECTIONS_PER_IP) {
        return next(new Error('Too many connections from this IP'));
      }

      const userCount = userSocketCounts.get(payload.sub) ?? 0;
      if (userCount >= MAX_CONNECTIONS_PER_USER) {
        return next(new Error('Too many connections for this user'));
      }

      (socket as any).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user as AccessTokenPayload;
    const ip = getClientIp(socket);

    const prevUserCount = userSocketCounts.get(user.sub) ?? 0;
    userSocketCounts.set(user.sub, prevUserCount + 1);

    const prevIpCount = connectionCounts.get(ip) ?? 0;
    connectionCounts.set(ip, prevIpCount + 1);

    trackReconnect(user.sub);

    console.log(`[Socket] User ${user.sub} connected (total: ${prevUserCount + 1})`);
    socket.join(`user:${user.sub}`);

    socket.on('join-user', (userId: string) => {
      if (userId === user.sub) {
        socket.join(`user:${userId}`);
      }
    });

    socket.on('join-team', async (teamName: string) => {
      try {
        const membership = await db.prepare('SELECT 1 FROM team_members WHERE team_name = ? AND user_id = ?').get(teamName, user.sub);
        if (membership) {
          socket.join(`team:${teamName}`);
        }
      } catch (e) {
        console.error('[Socket] join-team error:', e);
      }
    });

    socket.on('leave-team', (teamName: string) => {
      socket.leave(`team:${teamName}`);
    });

    socket.on('auth:refresh', async (data: { token: string }) => {
      if (!data?.token) {
        socket.emit('socket:error', { message: 'Token required' });
        return;
      }
      try {
        const payload = verifyAccessToken(data.token);
        // Only allow refreshing to the same user (prevents impersonation)
        if (payload.sub !== user.sub) {
          socket.emit('socket:error', { message: 'Token belongs to different user' });
          return;
        }
        if (await isTokenRevoked(payload.sub, payload.iat)) {
          socket.emit('socket:error', { message: 'Token revoked' });
          return;
        }
        const existingUser = await db.prepare('SELECT status FROM users WHERE id = ?').get(payload.sub) as any;
        if (!existingUser || existingUser.status !== 'active') {
          socket.emit('socket:error', { message: 'Account is inactive' });
          return;
        }
        (socket as any).user = payload;
        socket.emit('auth:refreshed', { userId: payload.sub });
      } catch {
        socket.emit('socket:error', { message: 'Invalid token' });
      }
    });

    socket.on('disconnect', (reason) => {
      const currentUserCount = (userSocketCounts.get(user.sub) ?? 1) - 1;
      if (currentUserCount <= 0) {
        userSocketCounts.delete(user.sub);
      } else {
        userSocketCounts.set(user.sub, currentUserCount);
      }

      const currentIpCount = (connectionCounts.get(ip) ?? 1) - 1;
      if (currentIpCount <= 0) {
        connectionCounts.delete(ip);
      } else {
        connectionCounts.set(ip, currentIpCount);
      }

      console.log(`[Socket] User ${user.sub} disconnected (reason: ${reason}, remaining: ${currentUserCount})`);
    });

    socket.on('error', (err) => {
      console.error(`[Socket] Error for user ${user.sub}:`, err.message);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    // No HTTP server in tests/CLI (hr_test) — return no-op mock instead of throwing
    if (process.env.NODE_ENV !== 'production') {
      return { to: () => ({ emit: () => {} }), emit: () => {} } as any;
    }
    throw new Error('Socket.IO not initialized');
  }
  return io;
}

export function closeSocket(): void {
  clearInterval(reconnectCleanupInterval);
  if (io) {
    io.close();
    io = null;
  }
  connectionCounts.clear();
  userSocketCounts.clear();
  reconnectTracker.clear();
}
