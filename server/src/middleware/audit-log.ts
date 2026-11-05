import { Request, Response, NextFunction } from 'express';
import db, { uuid } from '../db/index.js';

export function auditLog() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const originalEnd = res.end.bind(res);

    (res as any).end = function (...args: any[]) {
      const responseTimeMs = Date.now() - start;
      const userId = (req as any).user?.sub ?? null;
      const requestSize = parseInt(req.get('content-length') || '0', 10) || 0;
      const errorMessage = res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null;

      // Strip query string to avoid logging sensitive params (tokens, passwords, PII)
      const pathOnly = (req.originalUrl || req.url).split('?')[0] || '/';

      db.prepare(
        `INSERT INTO api_audit_log (id, user_id, method, path, status_code, ip_address, user_agent, request_size, response_time_ms, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uuid(),
        userId,
        req.method,
        pathOnly,
        res.statusCode,
        req.ip || req.socket.remoteAddress || null,
        req.get('user-agent') || null,
        requestSize,
        responseTimeMs,
        errorMessage
      ).catch((err: any) => { console.error('[Audit] Failed to write audit log:', err.message); });

      return originalEnd.apply(res, args as any);
    };

    next();
  };
}
