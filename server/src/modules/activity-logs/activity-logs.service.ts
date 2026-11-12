import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';

function parseJson(raw: string | null): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export class ActivityLogsService {
  static async create(userId: string | null, action: string, entityType?: string, entityId?: string, details?: Record<string, any>, ipAddress?: string) {
    const id = uuid();
    let actorEmail: string | null = null;
    if (userId) {
      try {
        const u = await db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as any;
        actorEmail = u?.email ?? null;
      } catch {
        actorEmail = null;
      }
    }
    await db.prepare('INSERT INTO activity_logs (id, actor_id, actor_email, action, entity_type, entity_id, new_values, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, actorEmail, action, entityType ?? null, entityId ?? null, details ? JSON.stringify(details) : null, ipAddress ?? null);
    return await this.getById(id);
  }

  static async list(input: any) {
    const { page = 1, limit = 20, actorId, actorEmail, entityType, entityId } = input;
    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: any[] = [];
    if (actorId) { conds.push('al.actor_id = ?'); params.push(actorId); }
    if (actorEmail) { conds.push("COALESCE(al.actor_email, u.email) LIKE ?"); params.push(`%${actorEmail}%`); }
    if (entityType) { conds.push('al.entity_type = ?'); params.push(entityType); }
    if (entityId) { conds.push('al.entity_id = ?'); params.push(entityId); }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT count(*) as c FROM activity_logs al LEFT JOIN users u ON al.actor_id = u.id ${where}`).get(...params) as any).c;
    const logs = await db.prepare(`SELECT al.*, COALESCE(al.actor_email, u.email) AS actor_email, u.first_name, u.last_name, u.employee_id FROM activity_logs al LEFT JOIN users u ON al.actor_id = u.id ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { logs: logs.map((l: any) => ({
      id: l.id, actorId: l.actor_id, action: l.action, entityType: l.entity_type,
      entityId: l.entity_id, oldValues: parseJson(l.old_values),
      newValues: parseJson(l.new_values), ipAddress: l.ip_address,
      userAgent: l.user_agent, createdAt: l.created_at,
      firstName: l.first_name, lastName: l.last_name, email: l.actor_email ?? null, employeeId: l.employee_id,
    })), total: count, page, limit };
  }

  static async getById(id: string) {
    const log = await db.prepare('SELECT * FROM activity_logs WHERE id = ?').get(id) as any;
    if (!log) throw new AppError(404, 'Log not found');
    return {
      id: log.id, actorId: log.actor_id, action: log.action, entityType: log.entity_type,
      entityId: log.entity_id, oldValues: parseJson(log.old_values),
      newValues: parseJson(log.new_values), ipAddress: log.ip_address,
      userAgent: log.user_agent, createdAt: log.created_at,
    };
  }

  static async deleteById(id: string) {
    const result = await db.prepare('DELETE FROM activity_logs WHERE id = ?').run(id);
    if (result.changes === 0) throw new AppError(404, 'Log not found');
    return { message: 'Log deleted' };
  }

  static async deleteOlderThan(days: number) {
    if (!Number.isFinite(days) || days < 1) throw new AppError(400, 'olderThanDays must be a positive number');
    const result = await db.prepare('DELETE FROM activity_logs WHERE created_at < NOW() - INTERVAL ? DAY').run(Math.floor(days));
    return { message: 'Old logs deleted', deleted: result.changes };
  }

  static async deleteAll() {
    const result = await db.prepare('DELETE FROM activity_logs').run();
    return { message: 'All logs deleted', deleted: result.changes };
  }
}
