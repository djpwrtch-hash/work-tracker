import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';
import { cache } from '../../lib/cache.js';

function mapReport(r: any) {
  return {
    id: r.id, userId: r.user_id, date: r.date, workCompletedToday: r.work_completed_today,
    currentProgress: r.current_progress, pendingWork: r.pending_work, blockers: r.blockers,
    tomorrowPlan: r.tomorrow_plan, status: r.status, feedback: r.feedback,
    reviewedById: r.reviewed_by_id, reviewedAt: r.reviewed_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
    firstName: r.first_name, lastName: r.last_name, employeeId: r.employee_id,
  };
}

export class ReportsService {
  static async create(userId: string, input: any) {
    if (!input.date) throw new AppError(400, 'Date is required');
    const date = input.date.split('T')[0]!;
    const existing = await db.prepare('SELECT id FROM work_reports WHERE user_id = ? AND date = ?').get(userId, date);
    if (existing) throw new AppError(409, 'Report already exists for this date');
    const id = uuid();
    try {
      await db.prepare('INSERT INTO work_reports (id, user_id, date, work_completed_today, current_progress, pending_work, blockers, tomorrow_plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, userId, date, input.workCompletedToday, input.currentProgress ?? 0, input.pendingWork ?? null, input.blockers ?? null, input.tomorrowPlan ?? null, 'draft');
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint') || err?.message?.includes('Duplicate entry') || err?.message?.includes('ER_DUP_ENTRY')) throw new AppError(409, 'Report already exists for this date');
      throw err;
    }
    await cache.delContaining('/api/v1/reports');
    return mapReport(await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id));
  }

  static async list(input: any, userId: string, role: string) {
    const { page = 1, limit = 20, status, startDate, endDate, userId: filterUserId } = input;
    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: any[] = [];

    if (role === 'employee') { conds.push('wr.user_id = ?'); params.push(userId); }
    else if (filterUserId) { conds.push('wr.user_id = ?'); params.push(filterUserId); }
    if (status) { conds.push('wr.status = ?'); params.push(status); }
    if (startDate) { conds.push('wr.date >= ?'); params.push(startDate); }
    if (endDate) { conds.push('wr.date <= ?'); params.push(endDate); }

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT count(*) as c FROM work_reports wr ${where}`).get(...params) as any).c;
    const reports = await db.prepare(`SELECT wr.*, u.first_name, u.last_name, u.employee_id FROM work_reports wr JOIN users u ON wr.user_id = u.id ${where} ORDER BY wr.date DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { reports: reports.map(mapReport), total: count, page, limit };
  }

  static async getById(id: string, userId: string, role: string) {
    const r = await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id) as any;
    if (!r) throw new AppError(404, 'Report not found');
    if (role === 'employee' && r.user_id !== userId) throw new AppError(403, 'Forbidden');
    return mapReport(r);
  }

  static async update(id: string, userId: string, input: any, role?: string) {
    const report = await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id) as any;
    if (!report) throw new AppError(404, 'Report not found');
    if (role !== 'director' && role !== 'hr' && report.user_id !== userId) throw new AppError(403, 'Cannot update others report');
    if (report.status !== 'draft') throw new AppError(409, 'Only draft reports can be updated');
    const sets = ["updated_at = NOW()"]; const params: any[] = [];
    if (input.workCompletedToday !== undefined) { sets.push('work_completed_today = ?'); params.push(input.workCompletedToday); }
    if (input.currentProgress !== undefined) { sets.push('current_progress = ?'); params.push(input.currentProgress); }
    if (input.pendingWork !== undefined) { sets.push('pending_work = ?'); params.push(input.pendingWork); }
    if (input.blockers !== undefined) { sets.push('blockers = ?'); params.push(input.blockers); }
    if (input.tomorrowPlan !== undefined) { sets.push('tomorrow_plan = ?'); params.push(input.tomorrowPlan); }
    params.push(id);
    await db.prepare(`UPDATE work_reports SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    await cache.delContaining('/api/v1/reports');
    return mapReport(await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id));
  }

  static async submit(id: string, userId: string) {
    const result = await db.transaction(async () => {
      const report = await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id) as any;
      if (!report) throw new AppError(404, 'Report not found');
      if (report.user_id !== userId) throw new AppError(403, 'Cannot submit others report');
      if (report.status !== 'draft') throw new AppError(409, 'Only draft reports can be submitted');
      await db.prepare("UPDATE work_reports SET status = 'submitted', updated_at = NOW() WHERE id = ?").run(id);
      const admins = await db.prepare("SELECT id FROM users WHERE role IN ('director', 'hr')").all() as any[];
      const insertNotif = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const a of admins) {
        await insertNotif.run(uuid(), a.id, userId, 'Report Submitted', `Daily report for ${report.date} is pending your review`, 'approval', `/reports/${id}`);
      }
      return mapReport(await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id));
    })();
    await cache.delContaining('/api/v1/reports');
    return result;
  }

  static async review(id: string, reviewedById: string, status: string, comments?: string) {
    const result = await db.transaction(async () => {
      const report = await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id) as any;
      if (!report) throw new AppError(404, 'Report not found');
      if (report.status !== 'submitted') throw new AppError(409, 'Report not in reviewable state');
      if (report.user_id === reviewedById) throw new AppError(403, 'Cannot review your own report');
      const upd = await db.prepare("UPDATE work_reports SET status = ?, feedback = ?, reviewed_by_id = ?, reviewed_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'submitted'")
        .run(status, comments ?? null, reviewedById, id);
      if (upd.changes === 0) throw new AppError(409, 'Already reviewed');
      await db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), report.user_id, reviewedById, `Report ${status}`, `Your daily report has been ${status}`, status === 'approved' ? 'success' : 'warning', `/reports/${id}`);
      return mapReport(await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id));
    })();
    await cache.delContaining('/api/v1/reports');
    return result;
  }

  static async delete(id: string, userId: string, role?: string) {
    const report = await db.prepare('SELECT * FROM work_reports WHERE id = ?').get(id) as any;
    if (!report) throw new AppError(404, 'Report not found');
    if (role === 'director' || role === 'hr') {
      // directors and HR can delete any report
    } else {
      if (report.user_id !== userId) throw new AppError(403, 'Cannot delete others report');
      if (report.status !== 'draft') throw new AppError(409, 'Only draft reports can be deleted');
    }
    await db.prepare('DELETE FROM work_reports WHERE id = ?').run(id);
    await cache.delContaining('/api/v1/reports');
    return { message: 'Report deleted' };
  }

  static async getEmployeeSlots() {
    const rows = await db.prepare(`
      SELECT u.id as user_id, u.first_name, u.last_name, u.employee_id,
        COUNT(wr.id) as total_reports,
        MAX(wr.date) as latest_date,
        MAX(CASE WHEN wr.date = sub.max_date THEN wr.status END) as latest_status,
        ROUND(AVG(CASE WHEN wr.date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN wr.current_progress END), 0) as avg_progress_30d
      FROM users u
      LEFT JOIN work_reports wr ON wr.user_id = u.id
      LEFT JOIN (
        SELECT user_id, MAX(date) as max_date FROM work_reports GROUP BY user_id
      ) sub ON sub.user_id = u.id
      WHERE u.status = 'active'
      GROUP BY u.id
      ORDER BY u.first_name
    `).all() as any[];
    return rows.map((r: any) => ({
      userId: r.user_id, firstName: r.first_name, lastName: r.last_name, employeeId: r.employee_id,
      totalReports: r.total_reports, latestDate: r.latest_date, latestStatus: r.latest_status,
      avgProgress30d: r.avg_progress_30d ?? 0,
    }));
  }

  static async exportByUser(userId?: string, startDate?: string, endDate?: string) {
    const conds: string[] = []; const params: any[] = [];
    if (userId) { conds.push('wr.user_id = ?'); params.push(userId); }
    if (startDate) { conds.push('wr.date >= ?'); params.push(startDate); }
    if (endDate) { conds.push('wr.date <= ?'); params.push(endDate); }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    return (await db.prepare(`SELECT wr.*, u.first_name, u.last_name, u.employee_id FROM work_reports wr JOIN users u ON wr.user_id = u.id ${where} ORDER BY wr.date DESC`).all(...params)).map(mapReport);
  }
}
