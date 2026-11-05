import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';
import { cache } from '../../lib/cache.js';

function mapPlan(p: any) {
  return {
    id: p.id, userId: p.user_id, date: p.date, plannedWork: p.planned_work,
    priority: p.priority, estimatedHours: p.estimated_hours, status: p.status,
    reviewComment: p.review_comment, reviewedById: p.reviewed_by_id, reviewedAt: p.reviewed_at,
    createdAt: p.created_at, updatedAt: p.updated_at,
    firstName: p.first_name, lastName: p.last_name, employeeId: p.employee_id,
  };
}

export class PlansService {
  static async create(userId: string, input: any) {
    if (!input.date) throw new AppError(400, 'Date is required');
    const date = input.date.split('T')[0]!;
    const existing = await db.prepare('SELECT id FROM work_plans WHERE user_id = ? AND date = ?').get(userId, date);
    if (existing) throw new AppError(409, 'Plan already exists for this date');
    const id = uuid();
    try {
      await db.prepare('INSERT INTO work_plans (id, user_id, date, planned_work, priority, estimated_hours, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, userId, date, input.plannedWork, input.priority ?? 'medium', input.estimatedHours ?? null, 'draft');
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint') || err?.message?.includes('Duplicate entry') || err?.message?.includes('ER_DUP_ENTRY')) throw new AppError(409, 'Plan already exists for this date');
      throw err;
    }
    await cache.delContaining('/api/v1/plans');
    return mapPlan(await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id));
  }

  static async list(input: any, userId: string, role: string) {
    const { page = 1, limit = 20, status, startDate, endDate, userId: filterUserId } = input;
    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: any[] = [];

    if (role === 'employee') { conds.push('wp.user_id = ?'); params.push(userId); }
    else if (filterUserId) { conds.push('wp.user_id = ?'); params.push(filterUserId); }
    if (status) { conds.push('wp.status = ?'); params.push(status); }
    if (startDate) { conds.push('wp.date >= ?'); params.push(startDate); }
    if (endDate) { conds.push('wp.date <= ?'); params.push(endDate); }

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT count(*) as c FROM work_plans wp ${where}`).get(...params) as any).c;
    const plans = await db.prepare(`SELECT wp.*, u.first_name, u.last_name, u.employee_id FROM work_plans wp JOIN users u ON wp.user_id = u.id ${where} ORDER BY wp.date DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { plans: plans.map(mapPlan), total: count, page, limit };
  }

  static async getById(id: string, userId: string, role: string) {
    const p = await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id) as any;
    if (!p) throw new AppError(404, 'Plan not found');
    if (role === 'employee' && p.user_id !== userId) throw new AppError(403, 'Forbidden');
    return mapPlan(p);
  }

  static async update(id: string, userId: string, input: any, role?: string) {
    const plan = await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id) as any;
    if (!plan) throw new AppError(404, 'Plan not found');
    if (role !== 'director' && role !== 'hr' && plan.user_id !== userId) throw new AppError(403, 'Cannot update others plan');
    if (plan.status !== 'draft') throw new AppError(409, 'Only draft plans can be updated');
    await db.prepare("UPDATE work_plans SET planned_work = ?, priority = ?, estimated_hours = ?, updated_at = NOW() WHERE id = ?")
      .run(input.plannedWork ?? plan.planned_work, input.priority ?? plan.priority, input.estimatedHours ?? plan.estimated_hours, id);
    await cache.delContaining('/api/v1/plans');
    return mapPlan(await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id));
  }

  static async submit(id: string, userId: string) {
    const result = await db.transaction(async () => {
      const plan = await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id) as any;
      if (!plan) throw new AppError(404, 'Plan not found');
      if (plan.user_id !== userId) throw new AppError(403, 'Cannot submit others plan');
      if (plan.status !== 'draft') throw new AppError(409, 'Only draft plans can be submitted');
      await db.prepare("UPDATE work_plans SET status = 'submitted', updated_at = NOW() WHERE id = ?").run(id);
      const admins = await db.prepare("SELECT id FROM users WHERE role IN ('director', 'hr')").all() as any[];
      const insertNotif = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const a of admins) {
        await insertNotif.run(uuid(), a.id, userId, 'Plan Submitted', `Work plan for ${plan.date} is pending your review`, 'approval', `/plans/${id}`);
      }
      return mapPlan(await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id));
    })();
    await cache.delContaining('/api/v1/plans');
    return result;
  }

  static async review(id: string, reviewedById: string, status: string, comments?: string) {
    const result = await db.transaction(async () => {
      const plan = await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id) as any;
      if (!plan) throw new AppError(404, 'Plan not found');
      if (plan.status !== 'submitted') throw new AppError(409, 'Plan not in reviewable state');
      if (plan.user_id === reviewedById) throw new AppError(403, 'Cannot review your own plan');
      const upd = await db.prepare("UPDATE work_plans SET status = ?, review_comment = ?, reviewed_by_id = ?, reviewed_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'submitted'")
        .run(status, comments ?? null, reviewedById, id);
      if (upd.changes === 0) throw new AppError(409, 'Already reviewed');
      await db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), plan.user_id, reviewedById, `Plan ${status}`, `Your work plan has been ${status}`, status === 'approved' ? 'success' : 'warning', `/plans/${id}`);
      return mapPlan(await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id));
    })();
    await cache.delContaining('/api/v1/plans');
    return result;
  }

  static async delete(id: string, userId: string, role: string) {
    const plan = await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id) as any;
    if (!plan) throw new AppError(404, 'Plan not found');
    if (role === 'employee') {
      if (plan.user_id !== userId) throw new AppError(403, 'Cannot delete others plan');
      if (plan.status !== 'draft') throw new AppError(409, 'Only draft plans can be deleted');
    }
    await db.prepare('DELETE FROM work_plans WHERE id = ?').run(id);
    await cache.delContaining('/api/v1/plans');
    return { message: 'Plan deleted' };
  }

  static async getEmployeeSlots() {
    const rows = await db.prepare(`
      SELECT u.id as user_id, u.first_name, u.last_name, u.employee_id,
        COUNT(wp.id) as total_plans,
        MAX(wp.date) as latest_date,
        MAX(CASE WHEN wp.date = sub.max_date THEN wp.status END) as latest_status
      FROM users u
      LEFT JOIN work_plans wp ON wp.user_id = u.id
      LEFT JOIN (
        SELECT user_id, MAX(date) as max_date FROM work_plans GROUP BY user_id
      ) sub ON sub.user_id = u.id
      WHERE u.status = 'active'
      GROUP BY u.id
      ORDER BY u.first_name
    `).all() as any[];
    return rows.map((r: any) => ({
      userId: r.user_id, firstName: r.first_name, lastName: r.last_name, employeeId: r.employee_id,
      totalPlans: r.total_plans, latestDate: r.latest_date, latestStatus: r.latest_status,
    }));
  }

  static async exportByUser(userId?: string, startDate?: string, endDate?: string) {
    const conds: string[] = []; const params: any[] = [];
    if (userId) { conds.push('wp.user_id = ?'); params.push(userId); }
    if (startDate) { conds.push('wp.date >= ?'); params.push(startDate); }
    if (endDate) { conds.push('wp.date <= ?'); params.push(endDate); }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    return (await db.prepare(`SELECT wp.*, u.first_name, u.last_name, u.employee_id FROM work_plans wp JOIN users u ON wp.user_id = u.id ${where} ORDER BY wp.date DESC`).all(...params)).map(mapPlan);
  }
}
