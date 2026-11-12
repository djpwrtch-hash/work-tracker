import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';
import { cache } from '../../lib/cache.js';

const URGENCY_ORDER = { low: 0, medium: 1, high: 2, urgent: 3 } as const;
type Priority = 'low' | 'medium' | 'high' | 'urgent';

function maxPriority(priorities: string[]): Priority {
  let best: Priority = 'low';
  for (const p of priorities) {
    const w = URGENCY_ORDER[(p as Priority)] ?? 0;
    if (URGENCY_ORDER[best] < w) best = p as Priority;
  }
  return best;
}

function mapPlan(p: any, items: any[] = []) {
  return {
    id: p.id, userId: p.user_id, date: p.date, plannedWork: p.planned_work,
    priority: p.priority, estimatedHours: p.estimated_hours, status: p.status,
    reviewComment: p.review_comment, reviewedById: p.reviewed_by_id, reviewedAt: p.reviewed_at,
    createdAt: p.created_at, updatedAt: p.updated_at,
    firstName: p.first_name, lastName: p.last_name, employeeId: p.employee_id,
    items: (items ?? []).map((it: any) => ({
      pointNumber: it.point_number,
      text: it.item_text,
      priority: it.priority,
      estimatedDays: it.estimated_days != null ? Number(it.estimated_days) : null,
    })),
  };
}

async function loadPlanItems(planId: string) {
  return await db.prepare('SELECT * FROM work_plan_items WHERE plan_id = ? ORDER BY point_number ASC').all(planId) as any[];
}

async function loadPlanItemsForIds(planIds: string[]) {
  if (planIds.length === 0) return {};
  const placeholders = planIds.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT * FROM work_plan_items WHERE plan_id IN (${placeholders}) ORDER BY point_number ASC`).all(...planIds) as any[];
  const grouped: Record<string, any[]> = {};
  for (const r of rows) (grouped[r.plan_id] ??= []).push(r);
  return grouped;
}

async function loadPlan(planId: string) {
  const row = await db.prepare('SELECT p.*, u.first_name, u.last_name, u.employee_id FROM work_plans p JOIN users u ON p.user_id = u.id WHERE p.id = ?').get(planId) as any;
  if (!row) throw new AppError(404, 'Plan not found');
  const items = await loadPlanItems(planId);
  return mapPlan(row, items);
}

export class PlansService {
  static async create(userId: string, input: any) {
    if (!input.date) throw new AppError(400, 'Date is required');
    const date = input.date.split('T')[0]!;
    const existing = await db.prepare('SELECT id FROM work_plans WHERE user_id = ? AND date = ?').get(userId, date);
    if (existing) throw new AppError(409, 'Plan already exists for this date');
    const id = uuid();

    let items: { text: string; priority: Priority; estimatedDays?: number | null }[];
    if (Array.isArray(input.items) && input.items.length > 0) {
      items = input.items
        .map((it: any) => ({
          text: String(it?.text ?? '').trim(),
          priority: (it?.priority ?? 'medium') as Priority,
          estimatedDays: it?.estimatedDays ?? null,
        }))
        .filter((it: any) => it.text.length > 0);
    } else {
      items = String(input.plannedWork ?? '')
        .split(/\r?\n/)
        .map((l: string) => l.trim())
        .filter(Boolean)
        .map((text: string) => ({ text, priority: (input.priority ?? 'medium') as Priority, estimatedDays: null }));
    }
    if (items.length === 0) throw new AppError(400, 'At least one point is required');
    if (items.length > 50) throw new AppError(400, 'Too many points (max 50)');
    const plannedWork = items.map((it) => it.text).join('\n');
    const topPriority = maxPriority(items.map((it) => it.priority));

    try {
      await db.transaction(async () => {
        await db.prepare('INSERT INTO work_plans (id, user_id, date, planned_work, priority, estimated_hours, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, userId, date, plannedWork, topPriority, input.estimatedHours ?? null, 'submitted');
        for (let i = 0; i < items.length; i++) {
          const it = items[i]!;
          await db.prepare('INSERT INTO work_plan_items (id, plan_id, point_number, item_text, priority, estimated_days) VALUES (?, ?, ?, ?, ?, ?)')
            .run(uuid(), id, i + 1, it.text, it.priority, it.estimatedDays ?? null);
        }

        const admins = await db.prepare("SELECT u.id FROM users u JOIN roles r ON r.name = u.role WHERE r.access_level IN ('director', 'hr')").all() as any[];
        const insertNotif = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const urgentCount = items.filter((it: any) => it.priority === 'urgent').length;
        for (const a of admins) {
          await insertNotif.run(uuid(), a.id, userId,
            urgentCount > 0 ? '[URGENT] Plan Submitted' : 'Plan Submitted',
            `Work plan for ${date} is pending your review${urgentCount > 0 ? ` (${urgentCount} urgent point${urgentCount > 1 ? 's' : ''})` : ''}`,
            'approval', `/plans/${id}`);
        }
      })();
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint') || err?.message?.includes('Duplicate entry') || err?.message?.includes('ER_DUP_ENTRY')) throw new AppError(409, 'Plan already exists for this date');
      throw err;
    }
    await cache.delContaining('/api/v1/plans');
    return await loadPlan(id);
  }

  static async list(input: any, userId: string, role: string) {
    const { page = 1, limit = 20, status, startDate, endDate, userId: filterUserId, priority } = input;
    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: any[] = [];

    if (role === 'employee') {
      conds.push('wp.user_id = ?');
      params.push(userId);
    } else {
      if (filterUserId) { conds.push('wp.user_id = ?'); params.push(filterUserId); }
      if (!status) { conds.push("wp.status != 'draft'"); }
    }
    if (status) { conds.push('wp.status = ?'); params.push(status); }
    if (priority) { conds.push('wp.priority = ?'); params.push(priority); }
    if (startDate) { conds.push('wp.date >= ?'); params.push(startDate); }
    if (endDate) { conds.push('wp.date <= ?'); params.push(endDate); }

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT count(*) as c FROM work_plans wp ${where}`).get(...params) as any).c;
    const plans = await db.prepare(`SELECT wp.*, u.first_name, u.last_name, u.employee_id FROM work_plans wp JOIN users u ON wp.user_id = u.id ${where} ORDER BY FIELD(wp.priority, 'urgent', 'high', 'medium', 'low'), wp.date DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const grouped = await loadPlanItemsForIds(plans.map((p: any) => p.id));
    return { plans: plans.map((p: any) => mapPlan(p, grouped[p.id] ?? [])), total: count, page, limit };
  }

  static async getById(id: string, userId: string, role: string) {
    const p = await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id) as any;
    if (!p) throw new AppError(404, 'Plan not found');
    if (role === 'employee' && p.user_id !== userId) throw new AppError(403, 'Forbidden');
    return await loadPlan(id);
  }

  static async update(id: string, userId: string, input: any, role?: string) {
    const plan = await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id) as any;
    if (!plan) throw new AppError(404, 'Plan not found');
    if (role !== 'director' && role !== 'hr' && plan.user_id !== userId) throw new AppError(403, 'Cannot update others plan');
    if (plan.status !== 'draft' && plan.status !== 'submitted') throw new AppError(409, 'Only draft or submitted plans can be updated');

    // Normalise items if provided (re-sync)
    let items: { text: string; priority: Priority; estimatedDays?: number | null }[] | null = null;
    if (Array.isArray(input.items)) {
      items = input.items
        .map((it: any) => ({
          text: String(it?.text ?? '').trim(),
          priority: (it?.priority ?? 'medium') as Priority,
          estimatedDays: it?.estimatedDays ?? null,
        }))
        .filter((it: any) => it.text.length > 0);
      if (items.length > 50) throw new AppError(400, 'Too many points (max 50)');
    }

    const plannedWork = items
      ? items.map((it) => it.text).join('\n')
      : (input.plannedWork ?? plan.planned_work);
    const topPriority = items
      ? maxPriority(items.map((it) => it.priority))
      : (input.priority ?? plan.priority);

    await db.transaction(async () => {
      await db.prepare("UPDATE work_plans SET planned_work = ?, priority = ?, estimated_hours = ?, updated_at = NOW() WHERE id = ?")
        .run(plannedWork, topPriority, input.estimatedHours ?? plan.estimated_hours, id);
      if (items) {
        await db.prepare('DELETE FROM work_plan_items WHERE plan_id = ?').run(id);
        for (let i = 0; i < items.length; i++) {
          const it = items[i]!;
          await db.prepare('INSERT INTO work_plan_items (id, plan_id, point_number, item_text, priority, estimated_days) VALUES (?, ?, ?, ?, ?, ?)')
            .run(uuid(), id, i + 1, it.text, it.priority, it.estimatedDays ?? null);
        }
      }
    })();
    await cache.delContaining('/api/v1/plans');
    return await loadPlan(id);
  }

  static async submit(id: string, userId: string) {
    const result = await db.transaction(async () => {
      const plan = await db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id) as any;
      if (!plan) throw new AppError(404, 'Plan not found');
      if (plan.user_id !== userId) throw new AppError(403, 'Cannot submit others plan');
      if (plan.status !== 'draft') throw new AppError(409, 'Only draft plans can be submitted');
      await db.prepare("UPDATE work_plans SET status = 'submitted', updated_at = NOW() WHERE id = ?").run(id);
      const admins = await db.prepare("SELECT u.id FROM users u JOIN roles r ON r.name = u.role WHERE r.access_level IN ('director', 'hr')").all() as any[];
      const insertNotif = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const a of admins) {
        await insertNotif.run(uuid(), a.id, userId, 'Plan Submitted', `Work plan for ${plan.date} is pending your review`, 'approval', `/plans/${id}`);
      }
      return await loadPlan(id);
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
      return await loadPlan(id);
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
    const rows = await db.prepare(`SELECT wp.*, u.first_name, u.last_name, u.employee_id FROM work_plans wp JOIN users u ON wp.user_id = u.id ${where} ORDER BY wp.date DESC`).all(...params) as any[];
    const grouped = await loadPlanItemsForIds(rows.map((r) => r.id));
    return rows.map((r) => mapPlan(r, grouped[r.id] ?? []));
  }
}
