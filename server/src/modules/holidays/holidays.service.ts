import db, { uuid } from '../../db/index.js';
import { getIO } from '../../lib/socket.js';
import { cache } from '../../lib/cache.js';
import { AppError } from '../../lib/app-error.js';

const PROTECTED_STATUSES = "('present','work_end','on_break','half_day','leave','remote')";

async function notifyUsers(userIds: string[], senderId: string, title: string, message: string, link?: string) {
  if (!userIds || userIds.length === 0) return;
  const insert = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertMany = await db.transaction(async (chunk: string[]) => {
    for (const uid of chunk) await insert.run(uuid(), uid, senderId, title, message, 'holiday', link ?? '/holidays');
  });
  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    await insertMany(userIds.slice(i, i + CHUNK));
  }
  try {
    for (const uid of userIds) getIO().to(`user:${uid}`).emit('notification:new', { title, message, type: 'holiday', link: link ?? '/holidays' });
  } catch (e) { console.error('[Holidays] Notification socket emit failed:', e); }
}

function invalidateAnalyticsCache() {
  try {
    cache.delContaining('/api/v1/analytics/');
  } catch (e) {
    console.error('[Holidays] Analytics cache invalidation failed:', e);
  }
}

export class HolidaysService {
  static async create(userId: string, input: { date: string; name: string; type?: string; userIds?: string[] }) {
    const hasSpecificUsers = input.userIds && input.userIds.length > 0;
    const affectedUsers = hasSpecificUsers
      ? input.userIds as string[]
      : (await db.prepare("SELECT id FROM users WHERE status = 'active'").all() as any[]).map((u: any) => u.id);

    const result = await (await db.transaction(async () => {
      // Check for existing holiday inside transaction to prevent race condition
      const existing = await db.prepare('SELECT id, name FROM holidays WHERE date = ?').get(input.date) as { id: string; name: string } | undefined;
      if (existing) throw new AppError(409, `A holiday already exists for ${input.date} (${existing.name})`);

      const id = uuid();
      await db.prepare('INSERT INTO holidays (id, date, name, type, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(id, input.date, input.name, input.type ?? 'public', userId);

      if (hasSpecificUsers) {
        const ph = input.userIds!.map(() => '(?, ?)').join(', ');
        const p: any[] = [];
        for (const uid of input.userIds!) { p.push(id, uid); }
        await db.prepare(`INSERT INTO holiday_assignees (holiday_id, user_id) VALUES ${ph} ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`).run(...p);
      }

      const CHUNK = 500;
      for (let i = 0; i < affectedUsers.length; i += CHUNK) {
        const chunk = affectedUsers.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, NOW(), NOW())').join(', ');
        const params: any[] = [];
        for (const uid of chunk) { params.push(uuid(), uid, input.date, 'holiday', input.name); }
        params.push(input.name);
        await db.prepare(`INSERT INTO attendance (id, user_id, date, status, notes, created_at, updated_at)
           VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE status = CASE WHEN attendance.status IN ${PROTECTED_STATUSES} THEN attendance.status ELSE 'holiday' END, notes = CASE WHEN attendance.status IN ${PROTECTED_STATUSES} THEN attendance.notes ELSE ? END, updated_at = NOW()`).run(...params);
      }

      return await this.getById(id);
    }))();
    invalidateAnalyticsCache();

    try {
      await notifyUsers(affectedUsers, userId, 'Holiday Declared', `${input.name} is a holiday on ${input.date}.`, `/holidays`);
      const admins = await db.prepare("SELECT id FROM users WHERE role IN ('director', 'hr')").all() as any[];
      for (const a of admins) getIO().to(`user:${a.id}`).emit('holiday:created', result);
      for (const uid of affectedUsers) getIO().to(`user:${uid}`).emit('holiday:created', result);
    } catch (e) { console.error('[Holidays] Socket emit failed:', e); }
    return result;
  }

  static async list(input: { year?: number; month?: number; page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = input;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: any[] = [];
    const conds: string[] = [];

    if (input.year && input.month) {
      const start = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
      const lastDay = new Date(input.year, input.month, 0).getDate();
      const end = `${input.year}-${String(input.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      conds.push('h.date >= ? AND h.date <= ?');
      params.push(start, end);
    }

    if (conds.length > 0) whereClause = ' WHERE ' + conds.join(' AND ');

    const count = (await db.prepare(`SELECT count(*) as c FROM holidays h${whereClause}`).get(...params) as any).c;
    const holidays = await db.prepare(`SELECT h.*, u.first_name, u.last_name FROM holidays h JOIN users u ON h.created_by = u.id${whereClause} ORDER BY h.date DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];

    const result = [];
    if (holidays.length > 0) {
      const holidayIds = holidays.map((h: any) => h.id);
      const placeholders = holidayIds.map(() => '?').join(',');
      const allAssignees = await db.prepare(`SELECT ha.holiday_id, u.id, u.first_name, u.last_name FROM holiday_assignees ha JOIN users u ON ha.user_id = u.id WHERE ha.holiday_id IN (${placeholders})`).all(...holidayIds) as any[];

      for (const h of holidays) {
        const assignees = allAssignees.filter((a: any) => a.holiday_id === h.id);
        result.push({
          id: h.id, date: h.date, name: h.name, type: h.type,
          createdBy: { id: h.created_by, firstName: h.first_name, lastName: h.last_name },
          assignees: assignees.length > 0 ? assignees.map((a: any) => ({ id: a.id, firstName: a.first_name, lastName: a.last_name })) : null,
          createdAt: h.created_at,
        });
      }
    }

    return { holidays: result, total: count, page, limit };
  }

  static async getById(id: string) {
    const h = await db.prepare('SELECT id, name, date, type, created_by, created_at, updated_at FROM holidays WHERE id = ?').get(id) as any;
    if (!h) throw new AppError(404, 'Holiday not found');
    const assignees = await db.prepare('SELECT u.id, u.first_name, u.last_name FROM holiday_assignees ha JOIN users u ON ha.user_id = u.id WHERE ha.holiday_id = ?').all(h.id);
    return { ...h, assignees: assignees.length > 0 ? assignees : null };
  }

  static async delete(id: string, input: any, userId: string) {
    if (input.confirm !== 'DELETE') throw new AppError(400, 'Deleting a holiday requires confirm=DELETE in the request body');
    const h = await db.prepare('SELECT id, name, date, type, created_by, created_at, updated_at FROM holidays WHERE id = ?').get(id) as any;
    if (!h) throw new AppError(404, 'Holiday not found');

    const affectedUsers = await db.prepare('SELECT user_id FROM holiday_assignees WHERE holiday_id = ?').all(id) as any[];
    const userIds = affectedUsers.length > 0
      ? affectedUsers.map((a: any) => a.user_id)
      : (await db.prepare("SELECT id FROM users WHERE status = 'active'").all() as any[]).map((u: any) => u.id);

    await db.transaction(async () => {
      const targetUserIds = userIds.length > 0
        ? userIds
        : (await db.prepare("SELECT id FROM users WHERE status = 'active'").all() as any[]).map((u: any) => u.id);

      if (targetUserIds.length > 0) {
        const ph = targetUserIds.map(() => '?').join(',');
        const leavesForDate = await db.prepare(`SELECT user_id, id as leave_id FROM leaves WHERE status = 'approved' AND start_date <= ? AND end_date >= ? AND user_id IN (${ph})`).all(h.date, h.date, ...targetUserIds) as any[];
        const leaveMap = new Map<string, string>();
        for (const l of leavesForDate) leaveMap.set(l.user_id, l.leave_id);

        for (const uid of targetUserIds) {
          const leaveId = leaveMap.get(uid);
          if (leaveId) {
            await db.prepare("UPDATE attendance SET status = 'leave', notes = ?, updated_at = NOW() WHERE date = ? AND status = 'holiday' AND user_id = ?").run(`Approved leave (${leaveId})`, h.date, uid);
          } else {
            // Restore to 'present' if they had checked in, otherwise 'absent'
            const hadCheckedIn = await db.prepare("SELECT 1 FROM attendance WHERE user_id = ? AND date = ? AND login_time IS NOT NULL AND status = 'holiday'").get(uid, h.date);
            if (hadCheckedIn) {
              await db.prepare("UPDATE attendance SET status = 'present', notes = NULL, updated_at = NOW() WHERE date = ? AND status = 'holiday' AND user_id = ?").run(h.date, uid);
            } else {
              await db.prepare("UPDATE attendance SET status = 'absent', notes = NULL, updated_at = NOW() WHERE date = ? AND status = 'holiday' AND user_id = ?").run(h.date, uid);
            }
          }
        }
      } else {
        // Company-wide holiday deletion: check each user individually
        const allActive = await db.prepare("SELECT id FROM users WHERE status = 'active'").all() as any[];
        for (const u of allActive) {
          const hadCheckedIn = await db.prepare("SELECT 1 FROM attendance WHERE user_id = ? AND date = ? AND login_time IS NOT NULL AND status = 'holiday'").get(u.id, h.date);
          if (hadCheckedIn) {
            await db.prepare("UPDATE attendance SET status = 'present', notes = NULL, updated_at = NOW() WHERE date = ? AND status = 'holiday' AND user_id = ?").run(h.date, u.id);
          } else {
            await db.prepare("UPDATE attendance SET status = 'absent', notes = NULL, updated_at = NOW() WHERE date = ? AND status = 'holiday' AND user_id = ?").run(h.date, u.id);
          }
        }
      }
      await db.prepare('DELETE FROM holiday_assignees WHERE holiday_id = ?').run(id);
      await db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
      await db.prepare("INSERT INTO activity_logs (id, actor_id, action, entity_type, entity_id, old_values, new_values, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(uuid(), userId, 'delete_holiday', 'holiday', id, JSON.stringify({ date: h.date, name: h.name }), JSON.stringify({ status: 'deleted' }), null);
    })();
    invalidateAnalyticsCache();

    try {
      const admins = await db.prepare("SELECT id FROM users WHERE role IN ('director', 'hr')").all() as any[];
      for (const a of admins) getIO().to(`user:${a.id}`).emit('holiday:deleted', { id, date: h.date });
      for (const uid of userIds) getIO().to(`user:${uid}`).emit('holiday:deleted', { id, date: h.date });
    } catch (e) { console.error('[Holidays] Socket emit failed:', e); }
    return { message: 'Holiday deleted' };
  }
}
