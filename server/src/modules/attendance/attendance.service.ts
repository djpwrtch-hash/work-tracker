import db, { uuid } from '../../db/index.js';
import { getISTDate, getISTNow, parseUTC } from '../../lib/time.js';
import { getIO } from '../../lib/socket.js';
import { cache } from '../../lib/cache.js';
import { AppError } from '../../lib/app-error.js';

const HALF_DAY_THRESHOLD = 4;

async function invalidateAttendanceCache(): Promise<void> {
  try {
    await cache.delContaining('/api/v1/attendance/');
    await cache.delContaining('/api/v1/analytics/');
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

async function notifyAdmins(userId: string, senderId: string, title: string, message: string, type: string, link: string, excludeUserId?: string) {
  try {
    const admins = await db.prepare(
      "SELECT u.id FROM users u JOIN roles r ON r.name = u.role WHERE r.access_level IN ('director', 'hr') AND u.status = 'active'"
    ).all() as any[];
    const insertNotif = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const a of admins) {
      if (excludeUserId && a.id === excludeUserId) continue;
      await insertNotif.run(uuid(), a.id, senderId, title, message, type, link);
    }
  } catch (e) {
    console.error('[Attendance] Notify admins failed:', e);
  }
}

async function getAccessLevel(userId: string): Promise<string> {
  try {
    const r = await db.prepare('SELECT r.access_level FROM users u JOIN roles r ON r.name = u.role WHERE u.id = ?').get(userId) as any;
    return r?.access_level ?? 'employee';
  } catch {
    return 'employee';
  }
}

async function countOtherActiveAdmins(userId: string): Promise<number> {
  try {
    const r = await db.prepare(
      "SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.name = u.role WHERE r.access_level IN ('director', 'hr') AND u.status = 'active' AND u.id != ?"
    ).get(userId) as any;
    return Number(r?.c ?? 0);
  } catch {
    return 0;
  }
}

function mapExtraWork(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date ? String(r.date).slice(0, 10) : r.date,
    startTime: r.start_time ? String(r.start_time).slice(0, 5) : null,
    endTime: r.end_time ? String(r.end_time).slice(0, 5) : null,
    hours: Number(r.hours),
    notes: r.notes,
    accepted: !!r.accepted,
    firstName: r.first_name,
    lastName: r.last_name,
    employeeId: r.employee_id,
    createdAt: r.created_at,
  };
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

    // Respect the user's "Grant location" permission — silently drop any location
    // data that may have been sent anyway.
    const priv = await db.prepare('SELECT location_enabled FROM users WHERE id = ?').get(userId) as any;
    if (priv && Number(priv.location_enabled) === 0) {
      (input as any).latitude = undefined;
      (input as any).longitude = undefined;
      (input as any).accuracy = undefined;
      (input as any).locationCapturedAt = undefined;
    }
    // A pending correction request (created after closing a missed check-out) blocks check-in until HR/director approves.
    const pending = await db.prepare("SELECT id FROM attendance_correction_requests WHERE user_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1").get(userId) as any;
    if (pending) throw new AppError(409, 'PENDING_APPROVAL');

    // Missed check-out from a previous day blocks check-in until it is closed and approved.
    const stale = await db.prepare(
      "SELECT id, date, login_time FROM attendance WHERE user_id = ? AND date < ? AND login_time IS NOT NULL AND logout_time IS NULL ORDER BY date DESC LIMIT 1"
    ).get(userId, today) as any;
    if (stale) throw new AppError(409, 'STALE_ATTENDANCE');

    const id = uuid();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const hasLocation = input.latitude !== undefined && input.longitude !== undefined;
    if (!hasLocation) {
      console.warn(`[Attendance] Check-in without location for user ${userId}`);
    }

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
        await invalidateAttendanceCache();
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
    await invalidateAttendanceCache();
    emitAttendanceUpdated(userId, rec);
    return rec;
  }

  static async startPause(userId: string) {
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
    // Pause does not capture location.
    await db.prepare("UPDATE attendance SET pause_start_time = ?, pause_end_time = NULL, status = 'on_break', updated_at = ? WHERE id = ?").run(now, now, rec.id);
    logEvent(rec.id, userId, 'pause_start', {}, now);
    const updated = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(rec.id);
    await invalidateAttendanceCache();
    emitAttendanceUpdated(userId, updated);
    return updated;
  }

  static async endPause(userId: string) {
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
    // Resume does not capture location.
    await db.prepare(`UPDATE attendance SET pause_end_time = ?, pause_minutes = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(nowIso, totalPause, restoreStatus, nowIso, rec.id);
    logEvent(rec.id, userId, 'pause_end', {}, nowIso);
    const updated = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(rec.id);
    await invalidateAttendanceCache();
    emitAttendanceUpdated(userId, updated);
    return updated;
  }

  static async checkOut(userId: string, input?: { latitude?: number; longitude?: number; accuracy?: number; locationCapturedAt?: string }) {
    const realToday = getISTDate();
    let today = getISTDate();

    // Respect the user's "Grant location" permission — ignore location if disabled.
    const priv = await db.prepare('SELECT location_enabled FROM users WHERE id = ?').get(userId) as any;
    if (priv && Number(priv.location_enabled) === 0 && input) {
      (input as any).latitude = undefined;
      (input as any).longitude = undefined;
      (input as any).accuracy = undefined;
      (input as any).locationCapturedAt = undefined;
    }
    // A stale missed check-out (previous day, login_time set, logout_time absent)
    // takes priority: closing it must not be blocked by a today row that already
    // exists (absent/leave/holiday, or a fresh check-in).
    let rec = await db.prepare(
      "SELECT * FROM attendance WHERE user_id = ? AND date < ? AND login_time IS NOT NULL AND logout_time IS NULL ORDER BY date DESC LIMIT 1"
    ).get(userId, realToday) as any;
    if (rec) {
      today = rec.date;
    } else {
      rec = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, realToday) as any;
    }
    if (!rec) throw new AppError(404, 'No check-in found');
    if (!rec.login_time) throw new AppError(400, 'No check-in found');
    if (rec.logout_time) throw new AppError(409, 'Already checked out today');
    if (!input?.latitude && !input?.longitude) {
      console.warn(`[Attendance] Check-out without location for user ${userId}`);
    }

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
    // Closing a missed (yesterday) check-out automatically requests permission to check in today.
    if (today !== realToday) {
      const accessLevel = await getAccessLevel(userId);
      const isAdmin = accessLevel === 'director' || accessLevel === 'hr';
      const otherAdmins = isAdmin ? await countOtherActiveAdmins(userId) : 0;

      if (isAdmin && otherAdmins === 0) {
        // Sole admin: auto-approve so they aren't stuck with no one available to review.
        await db.prepare(
          `INSERT INTO attendance_correction_requests (id, user_id, attendance_id, reason, status, requested_at, reviewed_by_id, reviewed_at, review_comment)
           VALUES (?, ?, ?, 'Auto-approved: no other reviewer available', 'approved', NOW(), ?, NOW(), 'Auto-approved: no other reviewer available')`
        ).run(uuid(), userId, rec.id, userId);
      } else if (isAdmin) {
        await db.prepare(
          `INSERT INTO attendance_correction_requests (id, user_id, attendance_id, reason, status, requested_at)
           VALUES (?, ?, ?, 'Missed check-out — permission requested to check in today', 'pending', NOW())`
        ).run(uuid(), userId, rec.id);
        await notifyAdmins(userId, userId, 'Permission needed to check in',
          `An HR/Director forgot to check out on ${rec.date ?? today}. Please review the request to check in today.`,
          'approval', '/attendance', userId);
      } else {
        await db.prepare(
          `INSERT INTO attendance_correction_requests (id, user_id, attendance_id, reason, status, requested_at)
           VALUES (?, ?, ?, 'Missed check-out — permission requested to check in today', 'pending', NOW())`
        ).run(uuid(), userId, rec.id);
        await notifyAdmins(userId, userId, 'Permission needed to check in',
          `An employee forgot to check out on ${rec.date ?? today}. Please review the request to check in today.`,
          'approval', '/attendance');
      }
    }
    await invalidateAttendanceCache();
    emitAttendanceUpdated(userId, updated);
    return updated;
  }

  /** Employee's own latest check-in permission request status (for today) + any missed check-out from a previous day. */
  static async getMyCorrectionRequest(userId: string) {
    const row = await db.prepare(
      `SELECT id, status, reason, review_comment, requested_at, reviewed_at
       FROM attendance_correction_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1`
    ).get(userId) as any;

    const today = getISTDate();
    const stale = await db.prepare(
      `SELECT id, date, login_time, pause_minutes, pause_start_time FROM attendance
       WHERE user_id = ? AND date < ? AND login_time IS NOT NULL AND logout_time IS NULL ORDER BY date DESC LIMIT 1`
    ).get(userId, today) as any;

    let staleInfo: any = null;
    if (stale) {
      const loginTime = stale.login_time ? parseUTC(stale.login_time) : new Date();
      let pauseMinutes = Number(stale.pause_minutes ?? 0) || 0;
      if (stale.pause_start_time) {
        pauseMinutes += Math.round((Date.now() - parseUTC(stale.pause_start_time).getTime()) / 60000);
      }
      const hoursWorked = Math.max(0, Math.round(((Date.now() - loginTime.getTime()) / 3600000 - pauseMinutes / 60) * 100) / 100);
      staleInfo = { id: stale.id, date: stale.date, loginTime: stale.login_time, hoursWorked };
    }

    return { status: row?.status ?? 'none', ...(row ? { reason: row.reason, reviewComment: row.review_comment } : {}), staleRecord: staleInfo };
  }

  /** HR/director: list correction requests (oldest first so pending are reviewed in order). */
  static async listCorrectionRequests(status?: string) {
    const conds: string[] = [];
    const params: any[] = [];
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      conds.push('acr.status = ?');
      params.push(status);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await db.prepare(
      `SELECT acr.id, acr.user_id, acr.attendance_id, acr.reason, acr.status, acr.requested_at, acr.reviewed_at, acr.review_comment,
              u.first_name, u.last_name, u.employee_id, u.email,
              a.date AS attendance_date, a.login_time, a.logout_time
       FROM attendance_correction_requests acr
       JOIN users u ON u.id = acr.user_id
       LEFT JOIN attendance a ON a.id = acr.attendance_id
       ${where}
       ORDER BY acr.status = 'pending' DESC, acr.requested_at ASC`
    ).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      attendanceId: r.attendance_id,
      reason: r.reason,
      status: r.status,
      requestedAt: r.requested_at,
      reviewedAt: r.reviewed_at,
      reviewComment: r.review_comment,
      firstName: r.first_name,
      lastName: r.last_name,
      employeeId: r.employee_id,
      email: r.email,
      attendanceDate: r.attendance_date,
      loginTime: r.login_time,
      logoutTime: r.logout_time,
    }));
  }

  /** HR/director: approve or reject a check-in permission request. */
  static async reviewCorrectionRequest(id: string, status: 'approved' | 'rejected', reviewerId: string, comment?: string) {
    const request = await db.prepare('SELECT * FROM attendance_correction_requests WHERE id = ?').get(id) as any;
    if (!request) throw new AppError(404, 'Correction request not found');
    if (request.user_id === reviewerId) throw new AppError(403, 'Cannot review your own correction request');
    if (request.status !== 'pending') throw new AppError(409, 'Request already reviewed');

    await db.transaction(async () => {
      const upd = await db.prepare(
        `UPDATE attendance_correction_requests SET status = ?, reviewed_by_id = ?, reviewed_at = NOW(), review_comment = ? WHERE id = ? AND status = 'pending'`
      ).run(status, reviewerId, comment ?? null, id);
      if (upd.changes === 0) throw new AppError(409, 'Request already reviewed');

      await db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), request.user_id, reviewerId,
          status === 'approved' ? 'Check-in approved' : 'Check-in request rejected',
          status === 'approved'
            ? 'Your request to check in today has been approved. You can now check in.'
            : `Your request to check in today was rejected${comment ? `: ${comment}` : ''}.`,
          status === 'approved' ? 'success' : 'warning', '/attendance');
    })();

    await invalidateAttendanceCache();
    return { message: `Correction request ${status}` };
  }

  static async createExtraWork(userId: string, input: { date: string; startTime: string; endTime: string; notes?: string }) {
    const today = getISTDate();
    if (input.date > today) throw new AppError(400, 'Future dates are not allowed');
    const [sH0, sM0] = input.startTime.split(':');
    const [eH0, eM0] = input.endTime.split(':');
    const [sH, sM] = [Number(sH0 ?? 0), Number(sM0 ?? 0)];
    const [eH, eM] = [Number(eH0 ?? 0), Number(eM0 ?? 0)];
    if ([sH, sM, eH, eM].some((n) => Number.isNaN(n) || n < 0 || n > 59)) throw new AppError(400, 'Invalid time format');
    if (sH > 23 || eH > 23) throw new AppError(400, 'Invalid time format');
    const startMinutes = sH * 60 + sM;
    const endMinutes = eH * 60 + eM;
    if (endMinutes <= startMinutes) throw new AppError(400, 'End time must be after start time');
    const hours = Math.round(((endMinutes - startMinutes) / 60) * 100) / 100;
    if (hours > 24) throw new AppError(400, 'Extra work cannot exceed 24 hours');
    const id = uuid();
    await db.prepare(
      'INSERT INTO attendance_extra_work (id, user_id, date, start_time, end_time, hours, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, input.date, `${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:00`, `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}:00`, hours, input.notes ?? null);
    await notifyAdmins(userId, userId, 'Extra work logged', `Extra work of ${hours}h on ${input.date} needs review`, 'approval', '/attendance');
    await invalidateAttendanceCache();
    return this.getExtraWorkById(id);
  }

  static async getExtraWorkById(id: string) {
    const row = await db.prepare(
      `SELECT xw.*, u.first_name, u.last_name, u.employee_id
       FROM attendance_extra_work xw JOIN users u ON u.id = xw.user_id WHERE xw.id = ?`
    ).get(id) as any;
    if (!row) throw new AppError(404, 'Extra work entry not found');
    return mapExtraWork(row);
  }

  static async listExtraWork(input: { userId?: string; startDate?: string; endDate?: string; accepted?: boolean; requesterId: string; requesterAccessLevel: string }) {
    const conds: string[] = [];
    const params: any[] = [];
    if (input.requesterAccessLevel === 'employee') {
      conds.push('xw.user_id = ?');
      params.push(input.requesterId);
    } else if (input.userId) {
      conds.push('xw.user_id = ?');
      params.push(input.userId);
    }
    if (input.startDate) { conds.push('xw.date >= ?'); params.push(input.startDate); }
    if (input.endDate) { conds.push('xw.date <= ?'); params.push(input.endDate); }
    if (input.accepted !== undefined) { conds.push('xw.accepted = ?'); params.push(input.accepted ? 1 : 0); }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await db.prepare(
      `SELECT xw.*, u.first_name, u.last_name, u.employee_id FROM attendance_extra_work xw JOIN users u ON u.id = xw.user_id ${where} ORDER BY xw.date DESC`
    ).all(...params) as any[];
    const totalHours = rows.reduce((sum, r) => sum + Number(r.hours), 0);
    return { entries: rows.map(mapExtraWork), totalHours: Math.round(totalHours * 100) / 100 };
  }

  static async acceptExtraWork(id: string, reviewerId: string) {
    const row = await db.prepare('SELECT * FROM attendance_extra_work WHERE id = ?').get(id) as any;
    if (!row) throw new AppError(404, 'Extra work entry not found');
    if (row.accepted) throw new AppError(409, 'Already accepted');
    await db.prepare('UPDATE attendance_extra_work SET accepted = 1, updated_at = NOW() WHERE id = ? AND accepted = 0').run(id);
    await db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuid(), row.user_id, reviewerId, 'Extra work accepted', `Your extra work of ${row.hours}h on ${row.date} was accepted`, 'success', '/attendance');
    await invalidateAttendanceCache();
    return { message: 'Extra work accepted' };
  }

  static async deleteExtraWork(id: string, userId: string, accessLevel: string) {
    const row = await db.prepare('SELECT * FROM attendance_extra_work WHERE id = ?').get(id) as any;
    if (!row) throw new AppError(404, 'Extra work entry not found');
    if (accessLevel === 'employee') {
      if (row.user_id !== userId) throw new AppError(403, 'Forbidden');
      if (row.accepted) throw new AppError(409, 'Accepted entries cannot be deleted');
    }
    await db.prepare('DELETE FROM attendance_extra_work WHERE id = ?').run(id);
    await invalidateAttendanceCache();
    return { message: 'Extra work entry deleted' };
  }

  static async list(input: any) {
    const { page = 1, limit = 20, userId, userIds, startDate, endDate, status, statuses, includeHolidays } = input;
    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: any[] = [];
    const hasExplicitStatusFilter = (!!status && status.length > 0) || (Array.isArray(statuses) && statuses.length > 0);
    if (!includeHolidays && !hasExplicitStatusFilter) { conds.push("a.status != 'holiday'"); }
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
    const rows = await db.prepare(`SELECT a.*, u.first_name, u.last_name, u.employee_id, d.name as department_name, COALESCE((SELECT SUM(hours) FROM attendance_extra_work xw WHERE xw.user_id = a.user_id AND xw.date = a.date), 0) AS extra_work_hours FROM attendance a JOIN users u ON a.user_id = u.id LEFT JOIN departments d ON u.department_id = d.id ${where} ORDER BY a.date DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
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

  static async getUserHistory(userId: string, year: number, month: number, startDate?: string, endDate?: string, includeHolidays = false) {
    const start = startDate || `${year}-${String(month).padStart(2, '0')}-01`;
    const end = endDate || (() => {
      const lastDay = new Date(year, month, 0).getDate();
      return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    })();

    const holidayClause = includeHolidays ? '' : "AND status != 'holiday'";

    const records = await db.prepare(`
      SELECT id, user_id, date, status, login_time, logout_time, working_hours, overtime_hours, pause_start_time, pause_end_time, pause_minutes, latitude, longitude, location_accuracy, location_captured_at, notes, created_at, updated_at FROM attendance WHERE user_id = ? AND date >= ? AND date <= ? ${holidayClause} ORDER BY date DESC
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
    await invalidateAttendanceCache();
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

    const extraWorkRow = await db.prepare('SELECT COALESCE(SUM(hours), 0) as total FROM attendance_extra_work WHERE user_id = ? AND date >= ? AND date <= ?').get(userId, start, end) as any;
    const totalExtraWorkHours = Number(extraWorkRow?.total ?? 0);

    const totalWorkingHours = agg.total_working_hours;
    const totalPauseMinutes = agg.total_pause_minutes;

    const overtimeRow = await db.prepare('SELECT standard_hours, actual_hours, overtime_hours FROM monthly_overtime WHERE user_id = ? AND year = ? AND month = ?').get(userId, year, month) as any;
    const totalOvertimeHours = overtimeRow?.overtime_hours ?? 0;
    const standardHours = overtimeRow?.standard_hours ?? 0;

    return { year, month, summary, totalWorkingHours, totalOvertimeHours, standardHours, regularHours: totalWorkingHours - totalOvertimeHours, totalPauseMinutes, totalExtraWorkHours };
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
