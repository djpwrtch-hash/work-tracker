import { Router, Request, Response } from 'express';
import db from '../../db/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { getPasswordPolicy, updatePasswordPolicy } from '../../lib/password-policy.js';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';

const router = Router();

router.use(authenticate);

const updatePolicySchema = z.object({
  minLength: z.number().int().min(12).max(128).optional(),
  requireUppercase: z.boolean().optional(),
  requireLowercase: z.boolean().optional(),
  requireNumber: z.boolean().optional(),
  requireSpecial: z.boolean().optional(),
  maxAgeDays: z.number().int().min(0).max(365).optional(),
  historyCount: z.number().int().min(0).max(24).optional(),
});

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).optional(),
  userId: z.string().optional(),
  path: z.string().max(200).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const sessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  userId: z.string().optional(),
});

// GET /security/policy — get current password policy (admin only)
router.get('/policy', requireRole('director', 'hr'), async (_req: Request, res: Response, next) => {
  try {
    const policy = await getPasswordPolicy();
    res.json(policy);
  } catch (err) { next(err); }
});

// PUT /security/policy — update password policy (admin only)
router.put('/policy', requireRole('director'), validate(updatePolicySchema), async (req: Request, res: Response, next) => {
  try {
    const updates: Record<string, any> = {};
    if (req.body.minLength !== undefined) updates.minLength = req.body.minLength;
    if (req.body.requireUppercase !== undefined) updates.requireUppercase = req.body.requireUppercase;
    if (req.body.requireLowercase !== undefined) updates.requireLowercase = req.body.requireLowercase;
    if (req.body.requireNumber !== undefined) updates.requireNumber = req.body.requireNumber;
    if (req.body.requireSpecial !== undefined) updates.requireSpecial = req.body.requireSpecial;
    if (req.body.maxAgeDays !== undefined) updates.maxAgeDays = req.body.maxAgeDays;
    if (req.body.historyCount !== undefined) updates.historyCount = req.body.historyCount;
    const policy = await updatePasswordPolicy(updates);
    res.json(policy);
  } catch (err) { next(err); }
});

// GET /security/audit — get audit logs (admin only)
router.get('/audit', requireRole('director', 'hr'), validate(auditQuerySchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const { page, limit, offset, userId, path: reqPath, from, to } = req.query as any;
    const effectiveOffset = offset !== undefined ? offset : (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    if (reqPath) {
      conditions.push('path LIKE ?');
      params.push(`%${reqPath}%`);
    }
    if (from) {
      conditions.push('created_at >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('created_at <= ?');
      params.push(to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM api_audit_log ${whereClause}`).get(...params) as any;
    const total = countRow?.total ?? 0;

    const logs = await db.prepare(
      `SELECT id, user_id, method, path, status_code, ip_address, user_agent, request_size, response_time_ms, error_message, created_at
       FROM api_audit_log ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, effectiveOffset);

    res.json({ logs, total, page, limit });
  } catch (err) { next(err); }
});

// GET /security/sessions — get active sessions from refresh_tokens table (admin only)
router.get('/sessions', requireRole('director', 'hr'), validate(sessionsQuerySchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const { page, limit, userId } = req.query as any;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['rt.revoked_at IS NULL', "rt.expires_at > NOW()"];
    const params: any[] = [];

    if (userId) {
      conditions.push('rt.user_id = ?');
      params.push(userId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM refresh_tokens rt ${whereClause}`).get(...params) as any;
    const total = countRow?.total ?? 0;

    const sessions = await db.prepare(
      `SELECT rt.id, rt.user_id, u.email, u.first_name, u.last_name, rt.user_agent, rt.ip_address, rt.created_at, rt.expires_at
       FROM refresh_tokens rt
       LEFT JOIN users u ON u.id = rt.user_id
       ${whereClause}
       ORDER BY rt.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ sessions, total, page, limit });
  } catch (err) { next(err); }
});

export default router;