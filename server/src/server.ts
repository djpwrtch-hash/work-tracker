import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { registerShutdown } from './lib/shutdown.js';

async function startRealApp(): Promise<express.Express> {
  const { createApp } = await import('./app.js');
  return createApp();
}

async function databaseReachable(): Promise<void> {
  const { mysqlPool } = await import('./db/pool.js');
  await mysqlPool.query('SELECT 1');
}

function minimalApp(): express.Express {
  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }));
  app.get('/ready', async (_req, res) => res.status(503).json({ status: 'not ready', error: 'DB not connected' }));
  app.use((_req, res) => res.status(503).json({ error: 'Service starting — DB not ready' }));
  return app;
}

async function main() {
  // Validate production-critical env (JWT/admin) before binding the port. A bad
  // deployment should fail loudly instead of serving a minimal 503 forever.
  try {
    await import('./lib/config.js');
  } catch (e: any) {
    console.error('[STARTUP] Invalid configuration:', e?.message ?? e);
    process.exit(1);
  }

  let app: express.Express = minimalApp();
  try {
    // Wait for MySQL before importing app/db/index, which runs schema + migrations.
    // Importing a module that throws during evaluation is cached by Node, so a
    // failed import cannot be retried reliably.
    await databaseReachable();
    app = await startRealApp();
  } catch (e: any) {
    console.error('[STARTUP] App not ready, using minimal health-only:', e?.message ?? e);
    const retryRealApp = async (attempt: number) => {
      try {
        await databaseReachable();
      } catch (dbError: any) {
        console.error(`[STARTUP] DB not ready (attempt ${attempt}/30):`, dbError?.message ?? dbError);
        if (attempt < 30) setTimeout(() => { void retryRealApp(attempt + 1); }, 10000);
        return;
      }
      try {
        const real = await startRealApp();
        (app as any)._router = (real as any)._router;
        console.log(`[STARTUP] Real app hot-swapped after attempt ${attempt}`);
      } catch (retryError: any) {
        // The DB is reachable but app/schema/migration setup failed. Retrying the
        // cached import will not help; fail the readiness probe and keep logs clear.
        console.error('[STARTUP] createApp failed after DB connected:', retryError?.message ?? retryError);
      }
    };
    setTimeout(() => { void retryRealApp(1); }, 10000);
  }

  const enableHttps = process.env.ENABLE_HTTPS === 'true';
  let server: http.Server | https.Server;
  if (enableHttps) {
    const certDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'certs');
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app);
    } else {
      server = http.createServer(app);
    }
  } else {
    server = http.createServer(app);
  }

  const port = Number(process.env.API_PORT || process.env.PORT || 42780);
  // Production (including Railway) must listen on all interfaces; local dev stays
  // loopback-only unless HOST is set explicitly.
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[SERVER] Port ${port} is already in use — another WorkTracker instance is probably running.`);
      process.exit(1);
    }
  });
  server.listen(port, host, () => {
    console.log(`[SERVER] Listening on http://${host}:${port}`);
    console.log(`[ENV] ${process.env.NODE_ENV || 'development'}`);
  });

  // Graceful shutdown: stop accepting connections, release the pool, then exit.
  // Without this the process dies on the signal and cuts in-flight requests.
  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SERVER] Shutdown requested (${reason}) — closing gracefully ...`);
    const force = setTimeout(() => { console.error('[SERVER] Forced exit after 5s'); process.exit(1); }, 5000);
    force.unref();
    try {
      const { getIO } = await import('./lib/socket.js');
      (getIO() as { close?: () => void } | null)?.close?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } catch {}
    try {
      const { pool } = await import('./db/pool.js');
      await pool.end();
    } catch {}
    clearTimeout(force);
    console.log('[SERVER] Shutdown complete');
    process.exit(0);
  };
  registerShutdown(shutdown);
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  // Graceful startup: fire-and-forget background jobs, never block the port.
  (async () => {
    try {
      const { ensureAdminBootstrap } = await import('./db/bootstrap.js');
      try { await ensureAdminBootstrap(); } catch (e: any) {
        console.warn('[SETUP] Admin bootstrap skipped:', e?.message ?? e);
      }
    } catch {}
    try {
      const { cleanupExpiredBlacklistEntries } = await import('./lib/blacklist.js');
      cleanupExpiredBlacklistEntries().catch(() => {});
    } catch {}
    try {
      const { runAnnualLeaveReset } = await import('./lib/leave-reset.js');
      runAnnualLeaveReset().catch((e: any) => console.error('[Leave-Reset] Startup error:', e));
    } catch {}
    try {
      const { startAutoAbsentScheduler } = await import('./lib/auto-absent.js');
      startAutoAbsentScheduler();
      // Keep pooled connections warm: after sleep/hibernate a stale socket otherwise
      // makes the first user request fail.
      const keepaliveMs = Number(process.env.DB_KEEPALIVE_MS || 5 * 60 * 1000);
      setInterval(async () => {
        try { await (await import('./db/index.js')).default.prepare('SELECT 1').get(); } catch {}
      }, keepaliveMs);
      setInterval(async () => {
        try { await (await import('./db/index.js')).default.prepare("DELETE FROM token_blacklist WHERE expires_at <= NOW()").run(); } catch {}
        try { await (await import('./db/index.js')).default.prepare("DELETE FROM rate_limits WHERE expires_at <= NOW()").run(); } catch {}
        try { await (await import('./db/index.js')).default.prepare("DELETE FROM refresh_tokens WHERE expires_at <= NOW()").run(); } catch {}
        try { await (await import('./db/index.js')).default.prepare("DELETE FROM api_cache WHERE expires_at <= NOW()").run(); } catch {}
      }, 60 * 60 * 1000);
      setInterval(async () => {
        try {
          const { default: db } = await import('./db/index.js');
          const { AttendanceService } = await import('./modules/attendance/attendance.service.js');
          const now = new Date();
          const year = now.getFullYear();
          const month = now.getMonth() + 1;
          const lastDay = new Date(year, month, 0).getDate();
          const isLastDay = now.getDate() === lastDay;
          const isNearMidnight = now.getHours() === 23 && now.getMinutes() >= 55;
          if (isLastDay && isNearMidnight) {
            const lastCalc = await db.prepare("SELECT value FROM app_settings WHERE `key` = 'monthly_overtime_last_calc'").get() as any;
            const calcKey = `${year}-${month}`;
            if (lastCalc?.value !== calcKey) {
              await AttendanceService.recalculateAllOvertime(year, month);
              await db.prepare("INSERT INTO app_settings (`key`, value, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()").run('monthly_overtime_last_calc', calcKey);
            }
          }
        } catch {}
      }, 60 * 1000);
      // keep timers alive for long-running Docker/Tunnel (do not clear after 30m)
    } catch {}
    try {
      const { initializeSocket } = await import('./lib/socket.js');
      initializeSocket(server);
    } catch {}
  })().catch(() => {});
}

process.on('uncaughtException', (error) => {
  console.error('[ERROR] Uncaught Exception:', error);
  console.error('[ERROR] Keeping process alive for health checks...');
  setTimeout(() => { console.error('[ERROR] Forced exit after uncaught exception'); process.exit(1); }, 30000);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

main().catch((e) => {
  console.error('[STARTUP] Fatal:', e?.message ?? e);
});