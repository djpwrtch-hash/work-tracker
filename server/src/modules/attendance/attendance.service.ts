import db, { uuid } from '../../db/index.js';
import { getISTDate, getISTNow, parseUTC } from '../../lib/time.js';
import { getIO } from '../../lib/socket.js';
import { cache } from '../../lib/cache.js';
import { AppError } from '../../lib/app-error.js';

const HALF_DAY_THRESHOLD = 4;

function invalidateAttendanceCache() {
  try {
    cache.delContaining('/api/v1/attendance/');
    cache.delContaining('/api/v1/analytics/');
  } catch (e) {
    console.error('[Attendance] Cache invalidation failed:', e);
  }
}

function emitAttendanceUpdated(userId: string, record: any) {
  try {
    getIO().to(`user:${userId}`).emit('attendance:updated', record);
  } catch (e) {
    console.error('[Attendance] Socket emit failed:', e);
  }
}

async function logEvent(attendanceId: string, userId: string, eventType: string, loc?: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string }, occurredAt?: string) {
  try {
    await db.prepare(
      "INSERT INTO attendance_events (id, attendance_id, user_id, event_type, occurred_at, latitude, longitude, location_accuracy, location_captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      uuid(), attendanceId, userId, eventType,
      occurredAt ?? new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
      loc?.latitude ?? null, loc?.longitude ?? null, loc?.accuracy ?? null, loc?.locationCapturedAt ?? null
    );
  } catch (e) {
    console.error('[Attendance] Event log failed:', e);
  }
}

export async function getAttendanceEvents(attendanceId: string): Promise<any[]> {
  return await db.prepare(
    "SELECT id, event_type, occurred_at, latitude, longitude, location_accuracy, location_captured_at FROM attendance_events WHERE attendance_id = ? ORDER BY occurred_at ASC"
  ).all(attendanceId);
}

export async function getAttendanceEventsForUser(userId: string, attendanceId: string): Promise<any[]> {
  return await db.prepare(
    "SELECT id, event_type, occurred_at, latitude, longitude, location_accuracy, location_captured_at FROM attendance_events WHERE attendance_id = ? AND user_id = ? ORDER BY occurred_at ASC"
  ).all(attendanceId, userId);
}

export async function getPauseLog(startDate?: string, endDate?: string): Promise<any[]> {
  const conds: string[] = ["ae.event_type IN ('pause_start', 'pause_end')"];
  const params: any[] = [];
  if (startDate) { conds.push('a.date >= ?'); params.push(startDate); }
  if (endDate) { conds.push('a.date <= ?'); params.push(endDate); }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  return await db.prepare(`
    SELECT ae.event_type, ae.occurred_at, a.id as attendance_id, a.date,
           a.user_id, u.first_name, u.last_name, u.employee_id, d.name as department_name
    FROM attendance_events ae
    JOIN attendance a ON ae.attendance_id = a.id
    JOIN users u ON a.user_id = u.id
    LEFT JOIN departments d ON u.department_id = d.id
    ${where}
    ORDER BY a.date DESC, a.user_id, ae.occurred_at ASC
  `).all(...params);
}

export class AttendanceService {
  static async checkIn(userId: string, input: { status?: string; notes?: string; latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string }) {
    const today = getISTDate();
    const id = uuid();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const hasLocation = input.latitude !== undefined && input.longitude !== undefined;

    // Check if record exists (e.g., from approved leave or holiday)
    const existing = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today) as any;
    if (existing) {
      if (existing.logout_time) throw new AppError(409, 'Already checked out today');
      if (existing.status === 'holiday') throw new AppError(403, 'Cannot check in on a holiday');
      if (existing.status === 'leave') throw new AppError(403, 'Cannot check in — approved leave for today');
      if (existing.status === 'absent') {
        if (hasLocation) {
          await db.prepare("UPDATE attendance SET status = 'present', login_time = ?, notes = ?, latitude = ?, longitude = ?, location_accuracy = ?, location_captured_at = ?, updated_at = ? WHERE id = ?")
            .run(now, input.notes ?? null, input.latitude, input.longitude, input.accuracy ?? null, input.locationCapturedAt ?? now, now, existing.id);
        } else {
          await db.prepare("UPDATE attendance SET status = 'present', login_time = ?, notes = ?, updated_at = ? WHERE id = ?")
            .run(now, input.notes ?? null, now, existing.id);
        }
        const rec = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(existing.id);
        logEvent(existing.id, userId, 'check_in', { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy, locationCapturedAt: input.locationCapturedAt }, now);
        invalidateAttendanceCache();
        emitAttendanceUpdated(userId, rec);
        return rec;
      }
      if (existing.login_time) throw new AppError(409, 'Already checked in today');
    }

    try {
      if (hasLocation) {
        await db.prepare("INSERT INTO attendance (id, user_id, date, status, login_time, notes, latitude, longitude, location_accuracy, location_captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, userId, today, input.status ?? 'present', now, input.notes ?? null, input.latitude, input.longitude, input.accuracy ?? null, input.locationCapturedAt ?? now);
      } else {
        await db.prepare("INSERT INTO attendance (id, user_id, date, status, login_time, notes) VALUES (?, ?, ?, ?, ?, ?)")
          .run(id, userId, today, input.status ?? 'present', now, input.notes ?? null);
      }
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint') || err.message?.includes('Duplicate entry') || err.message?.includes('ER_DUP_ENTRY')) throw new AppError(409, 'Already checked in today');
      throw err;
    }
    const rec = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
    logEvent(id, userId, 'check_in', { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy, locationCapturedAt: input.locationCapturedAt }, now);
    invalidateAttendanceCache();
    emitAttendanceUpdated(userId, rec);
    return rec;
  }

  static async startPause(userId: string, input?: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string }) {
    const today = getISTDate();
    const rec = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today) as any;
    if (!rec) throw new AppError(404, 'No check-in found for today');
    if (!rec.login_time) throw new AppError(400, 'No check-in found for today');
    if (rec.logout_time) throw new AppError(409, 'Already checked out today');
    if (rec.pause_start_time && !rec.pause_end_time) {
      // Ensure status is on_break even if previous update failed
      if (rec.status !== 'on_break') {
        const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        await db.prepare("UPDATE attendance SET status = 'on_break', updated_at = ? WHERE id = ?").run(now, rec.id);
        rec.status = 'on_break';
      }
      return rec;
    }

    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const hasLocation = input?.latitude !== undefined && input?.longitude !== undefined;
    if (hasLocation) {
      await db.prepare("UPDATE attendance SET pause_start_time = ?, pause_end_time = NULL, status = 'on_break', latitude = ?, longitude = ?, location_accuracy = ?, location_captured_at = ?, updated_at = ? WHERE id = ?").run(now, now, input!.latitude, input!.longitude, input!.accuracy ?? null, input!.locationCapturedAt ?? now, now, rec.id);
    } else {
      await db.prepare("UPDATE attendance SET pause_start_time = ?, pause_end_time = NULL, status = 'on_break', updated_at = ? WHERE id = ?").run(now, now, rec.id);
    }
    logEvent(rec.id, userId, 'pause_start', input, now);
    const updated = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(rec.id);
    invalidateAttendanceCache();
    emitAttendanceUpdated(userId, updated);
    return updated;
  }

  static async endPause(userId: string, input?: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string }) {
    let today = getISTDate();
    let rec = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today) as any;
    if (!rec) {
      const istNow = getISTNow();
      istNow.setUTCDate(istNow.getUTCDate() - 1);
      const yesterdayStr = istNow.toISOString().split('T')[0]!;
      rec = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, yesterdayStr) as any;
      if (rec) today = yesterdayStr;
    }
    if (!rec) throw new AppError(404, 'No check-in found');
    if (!rec.pause_start_time || rec.pause_end_time) return rec;

    const now = new Date();
    const pauseStart = parseUTC(rec.pause_start_time);
    const prevMinutes = Number(rec.pause_minutes ?? 0) || 0;
    const pauseDuration = Math.round((now.getTime() - pauseStart.getTime()) / 600) / 100;
    const totalPause = Math.round((prevMinutes + pauseDuration) * 100) / 100;
    const nowIso = now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    const restoreStatus = rec.status === 'remote' ? 'remote' : 'present';
    const hasLocationEnd = input?.latitude !== undefined && input?.longitude !== undefined;
    if (hasLocationEnd) {
      await db.prepare(`UPDATE attendance SET pause_end_time = ?, pause_minutes = ?, status = ?, latitude = ?, longitude = ?, location_accuracy = ?, location_captured_at = ?, updated_at = ? WHERE id = ?`)
        .run(nowIso, totalPause, restoreStatus, input!.latitude, input!.longitude, input!.accuracy ?? null, input!.locationCapturedAt ?? nowIso, nowIso, rec.id);
    } else {
      await db.prepare(`UPDATE attendance SET pause_end_time = ?, pause_minutes = ?, status = ?, updated_at = ? WHERE id = ?`)
        .run(nowIso, totalPause, restoreStatus, nowIso, rec.id);
    }
    logEvent(rec.id, userId, 'pause_end', input, nowIso);
    const updated = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(rec.id);
    invalidateAttendanceCache();
    emitAttendanceUpdated(userId, updated);
    return updated;
  }

  static async checkOut(userId: string, input?: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string }) {
    let today = getISTDate();
    let rec = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today) as any;
    if (!rec) {
      const istNow = getISTNow();
      istNow.setUTCDate(istNow.getUTCDate() - 1);
      const yesterdayStr = istNow.toISOString().split('T')[0]!;
      rec = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, yesterdayStr) as any;
      if (rec) today = yesterdayStr;
    }
    if (!rec) throw new AppError(404, 'No check-in found');
    if (!rec.login_time) throw new AppError(400, 'No check-in found');
    if (rec.logout_time) throw new AppError(409, 'Already checked out today');

    const now = new Date();
    const nowIso = now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const loginTime = rec.login_time ? parseUTC(rec.login_time) : now;

    let pauseMinutes = Number(rec.pause_minutes ?? 0) || 0;
    if (rec.pause_start_time && !rec.pause_end_time) {
      const pauseStart = parseUTC(rec.pause_start_time);
      pauseMinutes += Math.round((now.getTime() - pauseStart.getTime()) / 600) / 100;
      logEvent(rec.id, userId, 'pause_end', {}, nowIso);
    }

    const totalMs = now.getTime() - loginTime.getTime();
    const rawHours = Math.round((totalMs / 3600000) * 100) / 100;
    const pauseHours = Math.round((pauseMinutes / 60) * 100) / 100;
    const workingHours = Math.max(0, Math.round((rawHours - pauseHours) * 100) / 100);
    const status = rec.status === 'remote' ? 'remote' : (workingHours < HALF_DAY_THRESHOLD ? 'half_day' : 'work_end');

    const DAY_MS = 8 * 3600000;
    const overtimeMs = Math.max(0, totalMs - pauseMinutes * 60000 - DAY_MS);
    const overtimeHours = Math.round((overtimeMs / 3600000) * 100) / 100;

    await db.prepare(`UPDATE attendance SET
      logout_time = ?, working_hours = ?, overtime_hours = ?,
      pause_minutes = ?, pause_end_time = COALESCE(pause_end_time, ?),
      latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
      location_accuracy = COALESCE(?, location_accuracy), location_captured_at = COALESCE(?, location_captured_at),
      status = ?, updated_at = ? WHERE id = ?`)
      .run(nowIso, workingHours, overtimeHours, pauseMinutes, rec.pause_start_time ? nowIso : null, input?.latitude ?? null, input?.longitude ?? null, input?.accuracy ?? null, input?.locationCapturedAt ?? null, status, nowIso, rec.id);

    const updated = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(rec.id);
    logEvent(rec.id, userId, 'check_out', input, nowIso);
    invalidateAttendanceCache();
    emitAttendanceUpdated(userId, updated);
    return updated;
  }

  static async list(input: any) {
    const { page = 1, limit = 20, userId, userIds, startDate, endDate, status, statuses } = input;
    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: any[] = [];
    if (userId) { conds.push('a.user_id = ?'); params.push(userId); }
    if (userIds && userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      conds.push(`a.user_id IN (${placeholders})`);
      params.push(...userIds);
    }
    if (status) { conds.push('a.status = ?'); params.push(status); }
    if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(',');
      conds.push(`a.status IN (${placeholders})`);
      params.push(...statuses);
    }
    if (startDate) { conds.push('a.date >= ?'); params.push(startDate); }
    if (endDate) { conds.push('a.date <= ?'); params.push(endDate); }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT count(*) as c FROM attendance a ${where}`).get(...params) as any).c;
    const rows = await db.prepare(`SELECT a.*, u.first_name, u.last_name, u.employee_id, d.name as department_name FROM attendance a JOIN users u ON a.user_id = u.id LEFT JOIN departments d ON u.department_id = d.id ${where} ORDER BY a.date DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { records: rows, total: count, page, limit };
  }

  static async getTodayStatus(userId: string) {
    const today = getISTDate();
    return await db.prepare('SELECT id, user_id, date, status, login_time, logout_time, working_hours, overtime_hours, pause_start_time, pause_end_time, pause_minutes, latitude, longitude, location_accuracy, location_captured_at, notes, created_at, updated_at FROM attendance WHERE user_id = ? AND date = ?').get(userId, today) ?? null;
  }

  static async getTodayAll() {
    const today = getISTDate();
    const rows = await db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.employee_id, u.role,
             a.status as today_status, a.login_time, a.logout_time, a.working_hours, a.overtime_hours, a.pause_minutes,
             a.latitude, a.longitude, a.location_accuracy, a.location_captured_at
      FROM users u
      LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
      WHERE u.status = 'active'
      ORDER BY u.first_name, u.last_name
    `).all(today);
    return rows;
  }

  static async getUserHistory(userId: string, year: number, month: number, startDate?: string, endDate?: string) {
    const start = startDate || `${year}-${String(month).padStart(2, '0')}-01`;
    const end = endDate || (() => {
      const lastDay = new Date(year, month, 0).getDate();
      return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    })();

    const records = await db.prepare(`
      SELECT id, user_id, date, status, login_time, logout_time, working_hours, overtime_hours, pause_start_time, pause_end_time, pause_minutes, latitude, longitude, location_accuracy, location_captured_at, notes, created_at, updated_at FROM attendance WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date DESC
    `).all(userId, start, end);

    const agg = await db.prepare(`SELECT
      COALESCE(SUM(working_hours), 0) as total_working_hours,
      COALESCE(SUM(overtime_hours), 0) as total_overtime_hours,
      COALESCE(SUM(pause_minutes), 0) as total_pause_minutes
      FROM attendance WHERE user_id = ? AND date >= ? AND date <= ? AND logout_time IS NOT NULL`).get(userId, start, end) as any;

    return {
      year, month,
      records,
      summary: (records as any[]).reduce((acc: Record<string, number>, r: any) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {} as Record<string, number>),
      totalWorkingHours: agg.total_working_hours,
      totalOvertimeHours: agg.total_overtime_hours,
      overtimeDays: Math.floor(agg.total_overtime_hours / 8),
      totalPauseMinutes: agg.total_pause_minutes,
    };
  }

  static async bulkDelete(input: any) {
    const normalizedDate = input.date ? input.date : null;
    const startDate = input.startDate ?? (normalizedDate ? normalizedDate : undefined);
    const endDate = input.endDate ?? (normalizedDate ? normalizedDate : undefined);

    const conds: string[] = []; const params: any[] = [];
    if (input.userId) { conds.push('user_id = ?'); params.push(input.userId); }
    if (input.userIds && input.userIds.length > 0) {
      const placeholders = input.userIds.map(() => '?').join(',');
      conds.push(`user_id IN (${placeholders})`);
      params.push(...input.userIds);
    }
    if (input.status) { conds.push('status = ?'); params.push(input.status); }
    if (input.statuses && input.statuses.length > 0) {
      const placeholders = input.statuses.map(() => '?').join(',');
      conds.push(`status IN (${placeholders})`);
      params.push(...input.statuses);
    }
    if (startDate) { conds.push('date >= ?'); params.push(startDate); }
    if (endDate) { conds.push('date <= ?'); params.push(endDate); }

    const hasAnyFilter = !!(input.userId || (input.userIds && input.userIds.length > 0) || input.status || (input.statuses && input.statuses.length > 0) || startDate || endDate);
    if (!hasAnyFilter) {
      throw new AppError(400, 'Deleting attendance requires at least one filter dimension (dates, statuses, or users). Refusing to delete the whole table.');
    }
    if (input.confirm !== 'DELETE') {
      throw new AppError(400, 'Deleting attendance requires confirm=DELETE');
    }

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT COUNT(*) as c FROM attendance ${where}`).get(...params) as any).c;

    let deleted = 0;
    if (count > 0) {
      const result = await db.transaction(async () => {
        return await db.prepare(`DELETE FROM attendance ${where}`).run(...params);
      })();
      deleted = result.changes;
    }
    const result = { deleted, scope: { userId: input.userId ?? null, userIds: input.userIds ?? null, status: input.status ?? null, startDate: startDate ?? null, endDate: endDate ?? null, date: normalizedDate } };
    invalidateAttendanceCache();
    return result;
  }

  static async update(id: string, input: any) {
    if (!await db.prepare('SELECT id FROM attendance WHERE id = ?').get(id)) throw new AppError(404, 'Record not found');
    const sets: string[] = ["updated_at = NOW()"]; const params: any[] = [];
    if (input.status) { sets.push('status = ?'); params.push(input.status); }
    if (input.loginTime) { sets.push('login_time = ?'); params.push(input.loginTime); }
    if (input.logoutTime) { sets.push('logout_time = ?'); params.push(input.logoutTime); }
    if (input.workingHours !== undefined) {
      if (input.workingHours < 0 || input.workingHours > 24) throw new AppError(400, 'Working hours must be between 0 and 24');
      sets.push('working_hours = ?'); params.push(input.workingHours);
    }
    if (input.overtimeHours !== undefined) {
      if (input.overtimeHours < 0 || input.overtimeHours > 24) throw new AppError(400, 'Overtime hours must be between 0 and 24');
      sets.push('overtime_hours = ?'); params.push(input.overtimeHours);
    }
    if (input.pauseStartTime !== undefined) { sets.push('pause_start_time = ?'); params.push(input.pauseStartTime); }
    if (input.pauseEndTime !== undefined) { sets.push('pause_end_time = ?'); params.push(input.pauseEndTime); }
    if (input.pauseMinutes !== undefined) {
      if (input.pauseMinutes < 0 || input.pauseMinutes > 480) throw new AppError(400, 'Pause minutes must be between 0 and 480');
      sets.push('pause_minutes = ?'); params.push(input.pauseMinutes);
    }
    if (input.notes !== undefined) { sets.push('notes = ?'); params.push(input.notes); }
    if (input.latitude !== undefined) { sets.push('latitude = ?'); params.push(input.latitude); }
    if (input.longitude !== undefined) { sets.push('longitude = ?'); params.push(input.longitude); }
    if (input.accuracy !== undefined) { sets.push('location_accuracy = ?'); params.push(input.accuracy); }
    if (input.locationCapturedAt !== undefined) { sets.push('location_captured_at = ?'); params.push(input.locationCapturedAt); }
    params.push(id);
    await db.prepare(`UPDATE attendance SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return await db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  }

  static async getMonthlySummary(userId: string, year: number, month: number) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const statusRows = await db.prepare('SELECT status, count(*) as count FROM attendance WHERE user_id = ? AND date >= ? AND date <= ? GROUP BY status').all(userId, start, end) as any[];
    const summary: Record<string, number> = {};
    for (const r of statusRows) summary[r.status] = r.count;

    const agg = await db.prepare(`SELECT
      COALESCE(SUM(working_hours), 0) as total_working_hours,
      COALESCE(SUM(overtime_hours), 0) as total_overtime_hours,
      COALESCE(SUM(pause_minutes), 0) as total_pause_minutes
      FROM attendance WHERE user_id = ? AND date >= ? AND date <= ? AND logout_time IS NOT NULL`).get(userId, start, end) as any;

    const totalWorkingHours = agg.total_working_hours;
    const totalPauseMinutes = agg.total_pause_minutes;

    const overtimeRow = await db.prepare('SELECT standard_hours, actual_hours, overtime_hours FROM monthly_overtime WHERE user_id = ? AND year = ? AND month = ?').get(userId, year, month) as any;
    const totalOvertimeHours = overtimeRow?.overtime_hours ?? 0;
    const standardHours = overtimeRow?.standard_hours ?? 0;

    return { year, month, summary, totalWorkingHours, totalOvertimeHours, standardHours, regularHours: totalWorkingHours - totalOvertimeHours, totalPauseMinutes };
  }

  static async calculateMonthlyOvertime(userId: string, year: number, month: number): Promise<void> {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const agg = await db.prepare(`SELECT
      COALESCE(SUM(working_hours), 0) as total_working_hours
      FROM attendance WHERE user_id = ? AND date >= ? AND date <= ? AND logout_time IS NOT NULL`).get(userId, start, end) as any;
    const actualHours = agg.total_working_hours;

    const totalDays = lastDay;
    let sundays = 0;
    for (let d = 1; d <= totalDays; d++) {
      const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
      if (dow === 0) sundays++;
    }

    const allHolidays = await db.prepare('SELECT id, date FROM holidays WHERE date >= ? AND date <= ?').all(start, end) as any[];
    const holidayAssignees = await db.prepare(`
      SELECT ha.holiday_id, ha.user_id
      FROM holiday_assignees ha
      JOIN holidays h ON h.id = ha.holiday_id
      WHERE h.date >= ? AND h.date <= ?
    `).all(start, end) as any[];
    const assigneesByHoliday = new Map<string, string[]>();
    for (const row of holidayAssignees) {
      const list = assigneesByHoliday.get(row.holiday_id) ?? [];
      list.push(row.user_id);
      assigneesByHoliday.set(row.holiday_id, list);
    }
    let userHolidayCount = 0;
    for (const h of allHolidays) {
      const dow = new Date(h.date + 'T00:00:00Z').getUTCDay();
      if (dow === 0) continue;
      const assignees = assigneesByHoliday.get(h.id) ?? [];
      if (assignees.length === 0 || assignees.includes(userId)) {
        userHolidayCount++;
      }
    }
    const workingDays = totalDays - sundays - userHolidayCount;
    const standardHours = workingDays * 8;
    const overtimeHours = Math.max(0, Math.round((actualHours - standardHours) * 100) / 100);

    const id = uuid();
    await db.prepare(
      "INSERT INTO monthly_overtime (id, user_id, year, month, standard_hours, actual_hours, overtime_hours, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE standard_hours = VALUES(standard_hours), actual_hours = VALUES(actual_hours), overtime_hours = VALUES(overtime_hours), updated_at = NOW()"
    ).run(id, userId, year, month, standardHours, actualHours, overtimeHours);
  }

  static async getMonthlyOvertime(userId: string, year: number, month: number) {
    await this.calculateMonthlyOvertime(userId, year, month);
    return await db.prepare('SELECT * FROM monthly_overtime WHERE user_id = ? AND year = ? AND month = ?').get(userId, year, month);
  }

  static async getMonthlyOvertimeAll(year: number, month: number) {
    return await db.prepare(`
      SELECT mo.*, u.first_name, u.last_name, u.employee_id, d.name as department_name
      FROM monthly_overtime mo
      JOIN users u ON mo.user_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE mo.year = ? AND mo.month = ?
      ORDER BY u.first_name, u.last_name
    `).all(year, month);
  }

  static async recalculateAllOvertime(year: number, month: number): Promise<void> {
    const users = await db.prepare("SELECT id FROM users WHERE status = 'active'").all() as any[];
    for (const user of users) {
      try {
        await this.calculateMonthlyOvertime(user.id, year, month);
      } catch (e: any) {
        console.error(`[Attendance] Overtime calc failed for ${user.id}:`, e.message);
      }
    }
  }
}
