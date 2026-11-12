import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { compressMiddleware } from './middleware/compress.js';
import { requestTimeout } from './lib/timeout.js';
import { requestShutdown } from './lib/shutdown.js';
import { concurrencyLimiter } from './lib/concurrency-limiter.js';
import { auditLog } from './middleware/audit-log.js';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './lib/config.js';
import { RateLimitStore } from './lib/rate-limit-store.js';
import db from './db/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { swaggerSpec } from './swagger.js';
import swaggerUi from 'swagger-ui-express';

import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import departmentsRoutes from './modules/departments/departments.routes.js';
import rolesRoutes from './modules/roles/roles.routes.js';
import teamsRoutes from './modules/teams/teams.routes.js';
import attendanceRoutes from './modules/attendance/attendance.routes.js';
import tasksRoutes from './modules/tasks/tasks.routes.js';
import plansRoutes from './modules/plans/plans.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import leavesRoutes from './modules/leaves/leaves.routes.js';
import documentsRoutes from './modules/documents/documents.routes.js';
import notificationsRoutes from './modules/notifications/notifications.routes.js';
import activityLogsRoutes from './modules/activity-logs/activity-logs.routes.js';
import holidaysRoutes from './modules/holidays/holidays.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import systemRoutes from './modules/system/system.routes.js';
import filesRoutes from './modules/files/files.routes.js';
import securityRoutes from './modules/security/security.routes.js';

const swaggerCsp = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", 'blob:'],
      frameAncestors: ["'none'"],
    },
  },
});

function basicAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="API Docs"');
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const user = colonIdx >= 0 ? decoded.slice(0, colonIdx) : decoded;
  const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
  const userMatch = user === 'admin';
  const passBuf = Buffer.from(pass || '');
  const expectedBuf = Buffer.from(config.adminPassword);
  const passMatch = passBuf.length === expectedBuf.length && crypto.timingSafeEqual(passBuf, expectedBuf);
  if (userMatch && passMatch) {
    next();
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
}

// Clean up expired rate limit entries on startup
RateLimitStore.resetExpired().catch(() => {});

export function createApp() {
  const app = express();

  // Trust proxy hops when behind a reverse proxy (TRUST_PROXY env, e.g. "1" or "loopback")
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy === 'true') app.set('trust proxy', 1);
  else if (trustProxy && trustProxy !== 'false') app.set('trust proxy', Number(trustProxy) || trustProxy);

  // Request ID
  app.use((req, _res, next) => {
    (req as any).id = randomUUID();
    next();
  });

  // Timeout & concurrency protection
  app.use(requestTimeout());
  app.use(concurrencyLimiter());

  // Security
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
  }));

  // Permissions-Policy header — geolocation=(self) required for check-in
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), interest-cohort=()');
    next();
  });

  // API responses are per-user and time-sensitive (attendance, leaves, ...).
  // Disable Express ETag so conditional requests cannot return 304, and forbid
  // browser caching so state changes (pause/check-in/role changes) are visible immediately.
  app.set('etag', false);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(compressMiddleware());
  app.use(cors({
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.nodeEnv === 'production' ? 500 : 10000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    store: new RateLimitStore('global'),
  });
  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.nodeEnv === 'production' ? 200 : 5000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many write requests, please slow down.' },
    store: new RateLimitStore('write'),
  });

  // Health check (before rate limiter, no DB required for Hostinger post-build probe)
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.nodeEnv,
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  // Graceful local stop, used by STOP.bat on Windows dev machines. Disabled unless
  // STOP_TOKEN is set (a local launcher writes a random token per run). Cloud
  // deployments never set it, so this route stays off.
  const stopToken = process.env.STOP_TOKEN;
  if (stopToken) {
    app.post('/internal/stop', (req: express.Request, res: express.Response) => {
      const provided = req.get('x-stop-token') || (req.body && req.body.token);
      if (provided !== stopToken) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      res.json({ status: 'stopping' });
      // Reuse the graceful shutdown path in server.ts; the unref'd timer is a safety net.
      // Skipped under test so a pending timer can't kill a shared worker mid-suite.
      if (config.nodeEnv !== 'test') {
        const safety = setTimeout(() => process.exit(0), 8000);
        safety.unref();
      }
      setTimeout(() => { void requestShutdown('stop endpoint'); }, 100);
    });
  }

  // Readiness probe - the process is only useful once the schema and all
  // migrations are in place, not merely when MySQL accepts a connection.
  app.get('/ready', async (_req, res) => {
    const timestamp = new Date().toISOString();
    try {
      await db.prepare('SELECT 1').get();
      const migration = await db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as any;
      const tables = await db.prepare(
        "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users','departments','roles','attendance','leaves','tasks','holidays','attendance_correction_requests','attendance_extra_work','work_plan_items')"
      ).get() as any;
      const version = Number(migration?.version ?? 0);
      const tableCount = Number(tables?.count ?? 0);
      if (version < 27 || tableCount < 10) {
        res.status(503).json({
          status: 'not ready',
          timestamp,
          checks: {
            database: 'ok',
            schema: version >= 27 ? 'ok' : `migration ${version}/27`,
            coreTables: `${tableCount}/10`,
          },
        });
        return;
      }
      res.json({
        status: 'ready',
        timestamp,
        checks: { database: 'ok', schema: 'ok', coreTables: 'ok' },
      });
    } catch {
      res.status(503).json({
        status: 'not ready',
        timestamp,
        error: 'Service dependencies not ready',
      });
    }
  });

  app.use(globalLimiter);
  // Parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Logging
  morgan.token('req-id', (req: any) => req.id?.slice(0, 8) || '-');
  app.use(morgan(config.nodeEnv === 'production' ? ':req-id :method :url :status :response-time ms' : 'dev'));

  // Write limiter for state-changing methods
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      return writeLimiter(req, res, next);
    }
    next();
  });

  // API routes
  const api = '/api/v1';

  // Audit logging (applied to ALL API routes including auth)
  app.use(`${api}`, auditLog());
  app.use(`${api}/auth`, authRoutes);
  app.use(`${api}/users`, usersRoutes);
  app.use(`${api}/departments`, departmentsRoutes);
  app.use(`${api}/roles`, rolesRoutes);
  app.use(`${api}/teams`, teamsRoutes);
  app.use(`${api}/attendance`, attendanceRoutes);
  app.use(`${api}/tasks`, tasksRoutes);
  app.use(`${api}/plans`, plansRoutes);
  app.use(`${api}/reports`, reportsRoutes);
  app.use(`${api}/leaves`, leavesRoutes);
  app.use(`${api}/documents`, documentsRoutes);
  app.use(`${api}/notifications`, notificationsRoutes);
  app.use(`${api}/activity-logs`, activityLogsRoutes);
  app.use(`${api}/holidays`, holidaysRoutes);
  app.use(`${api}/analytics`, analyticsRoutes);
  app.use(`${api}/system`, systemRoutes);
  app.use(`${api}/files`, filesRoutes);
  app.use(`${api}/security`, securityRoutes);

  // API docs are opt-in in production and always protected by HTTP Basic auth.
  const docsEnabled = process.env.ENABLE_API_DOCS != null
    ? process.env.ENABLE_API_DOCS === 'true'
    : config.nodeEnv !== 'production';
  if (docsEnabled) {
    app.use('/api-docs', swaggerCsp, basicAuth, swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }

  // Single-origin: serve web static export via Express (Hostinger legacy, Docker Tunnel, or any production)
  if (process.env.HOSTINGER === 'true' || process.env.SERVE_STATIC === 'true' || config.nodeEnv === 'production') {
    try {
      const webOutCandidates = [
        path.resolve(process.cwd(), 'web', 'dist'),
        path.resolve(process.cwd(), 'web', 'out'),
        path.resolve(process.cwd(), '..', 'web', 'dist'),
        path.resolve(process.cwd(), '..', 'web', 'out'),
        path.resolve(process.cwd(), 'dist', 'web', 'dist'),
        path.resolve(process.cwd(), 'dist', 'web', 'out'),
        path.resolve(process.cwd(), 'release', 'web', 'dist'),
        path.resolve(process.cwd(), 'release', 'web', 'out'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/out'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/dist'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/out'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/out'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web/dist'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../release/web/dist'),
      ];
      const webOut = webOutCandidates.find((candidate) => fs.existsSync(candidate));
      if (webOut) {
        app.use(express.static(webOut, {
          etag: true,
          setHeaders(res, filePath) {
            if (/\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ico|map)$/i.test(filePath)) {
              // Content-hashed build artifacts — safe to cache forever.
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else if (filePath.toLowerCase().endsWith('index.html')) {
              // The shell must always be revalidated so clients pick up new hashed chunks.
              res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            } else {
              res.setHeader('Cache-Control', 'no-cache');
            }
          },
        }));
        app.get('*', (req, res, next) => {
          if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/health') || req.path.startsWith('/ready') || req.path.startsWith('/api-docs')) return next();
          const indexPath = path.join(webOut, 'index.html');
          if (fs.existsSync(indexPath)) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            return res.sendFile(indexPath);
          }
          next();
        });
      }
    } catch {}
  }

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use(errorHandler);

  return app;
}
