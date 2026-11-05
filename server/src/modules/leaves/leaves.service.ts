import db, { uuid } from '../../db/index.js';
import { getIO } from '../../lib/socket.js';
import { getISTDate, getISTYear, isSundayIST, parseUTC } from '../../lib/time.js';
import { cache } from '../../lib/cache.js';
import { AppError } from '../../lib/app-error.js';
import { sendLeaveNotification, isEmailConfigured } from '../../lib/email.js';

const LEAVE_BALANCES: Record<'casual' | 'sick' | 'proposal', number> = { casual: 8, sick: 8, proposal: 16 };
const ANNUAL_LEAVE_ALLOWANCE = LEAVE_BALANCES.casual + LEAVE_BALANCES.sick + LEAVE_BALANCES.proposal; // 32 days per year
const QUARTERLY_ACCRUAL: Record<'casual' | 'sick' | 'proposal', number> = { casual: 2, sick: 2, proposal: 4 }; // per 3 months

async function entitlementForYear(userId: string, year: number): Promise<{ sick: number; casual: number; proposal: number; total: number }> {
  const user = await db.prepare('SELECT joining_date FROM users WHERE id = ?').get(userId) as any;
  const joiningDate = user?.joining_date;
  if (!joiningDate) return { ...LEAVE_BALANCES, total: ANNUAL_LEAVE_ALLOWANCE };
  const join = parseUTC(joiningDate);
  if (isNaN(join.getTime())) return { ...LEAVE_BALANCES, total: ANNUAL_LEAVE_ALLOWANCE };
  const joinYear = join.getUTCFullYear();
  if (joinYear < year) return { ...LEAVE_BALANCES, total: ANNUAL_LEAVE_ALLOWANCE };
  if (joinYear > year) return { sick: 0, casual: 0, proposal: 0, total: 0 };
  const joinMonth = join.getUTCMonth() + 1;
  const joinQuarter = Math.ceil(joinMonth / 3);
  const remainingQuarters = 5 - joinQuarter; // Q1->4, Q2->3, Q3->2, Q4->1
  return {
    sick: remainingQuarters * QUARTERLY_ACCRUAL.sick,
    casual: remainingQuarters * QUARTERLY_ACCRUAL.casual,
    proposal: remainingQuarters * QUARTERLY_ACCRUAL.proposal,
    total: remainingQuarters * (QUARTERLY_ACCRUAL.sick + QUARTERLY_ACCRUAL.casual + QUARTERLY_ACCRUAL.proposal),
  };
}

function invalidateAnalyticsCache() {
  try {
    cache.delContaining('/api/v1/analytics/');
  } catch (e) {
    console.error('[Leaves] Analytics cache invalidation failed:', e);
  }
}

const PROTECTED_STATUSES = "('present','work_end','on_break','half_day','holiday','remote')";

function mapLeave(l: any) {
  return {
    id: l.id, userId: l.user_id, type: l.type, startDate: l.start_date, endDate: l.end_date,
    reason: l.reason, status: l.status, reviewComment: l.review_comment,
    reviewedById: l.reviewed_by_id, reviewedAt: l.reviewed_at,
    createdAt: l.created_at, updatedAt: l.updated_at,
    firstName: l.first_name, lastName: l.last_name, employeeId: l.employee_id,
    deductedFrom: l.deducted_from, extra: l.extra ?? 0, leaveYear: l.leave_year,
  };
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  return String(value ?? '').slice(0, 10);
}

function iterDates(start: string | Date, end: string | Date): string[] {
  const dates: string[] = [];
  const startIso = dateOnly(start);
  const endIso = dateOnly(end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso)) return dates;
  const cur = new Date(`${startIso}T00:00:00Z`);
  const endD = new Date(`${endIso}T00:00:00Z`);
  while (cur <= endD) {
    dates.push(cur.toISOString().split('T')[0]!);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function getExcludedDates(userId: string, start: string, end: string, holidayCache?: Map<string, any[]>): Promise<Set<string>> {
  const excluded = new Set<string>();

  const holidays = holidayCache?.get(`${start}:${end}`) ?? await db.prepare('SELECT id, date FROM holidays WHERE date BETWEEN ? AND ?').all(start, end) as any[];
  if (holidayCache) holidayCache.set(`${start}:${end}`, holidays);

  const holidayIds = holidays.map((h: any) => h.id);
  const userAssignees = new Set<string>();
  const allAssigneeHolidays = new Set<string>();
  if (holidayIds.length > 0) {
    const ph = holidayIds.map(() => '?').join(',');
    const assignees = await db.prepare(`SELECT holiday_id, user_id FROM holiday_assignees WHERE holiday_id IN (${ph})`).all(...holidayIds) as any[];
    for (const a of assignees) {
      allAssigneeHolidays.add(a.holiday_id);
      if (a.user_id === userId) userAssignees.add(a.holiday_id);
    }
  }

  for (const h of holidays) {
    if (userAssignees.has(h.id)) { excluded.add(h.date); continue; }
    if (!allAssigneeHolidays.has(h.id)) excluded.add(h.date);
  }
  return excluded;
}

async function countWorkingDays(userId: string, start: string, end: string, holidayCache?: Map<string, any[]>): Promise<number> {
  const excluded = await getExcludedDates(userId, start, end, holidayCache);
  const cur = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  let count = 0;
  while (cur <= endD) {
    const iso = cur.toISOString().split('T')[0]!;
    if (isSundayIST(iso)) { cur.setUTCDate(cur.getUTCDate() + 1); continue; }
    if (!excluded.has(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

async function workingDates(userId: string, start: string, end: string): Promise<string[]> {
  const excluded = await getExcludedDates(userId, start, end);
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  while (cur <= endD) {
    const iso = cur.toISOString().split('T')[0]!;
    if (!isSundayIST(iso) && !excluded.has(iso)) dates.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function yearOf(date: string | Date): number {
  const iso = dateOnly(date);
  const year = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`).getUTCFullYear() : NaN;
  return Number.isNaN(year) ? getISTYear() : year;
}

async function daysWithinYear(userId: string, start: string, end: string, year: number, holidayCache?: Map<string, any[]>): Promise<number> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const clampStart = start < yearStart ? yearStart : start;
  const clampEnd = end > yearEnd ? yearEnd : end;
  if (clampStart > clampEnd) return 0;
  const excluded = await getExcludedDates(userId, clampStart, clampEnd, holidayCache);
  const cur = new Date(`${clampStart}T00:00:00Z`);
  const endD = new Date(`${clampEnd}T00:00:00Z`);
  let count = 0;
  while (cur <= endD) {
    const iso = cur.toISOString().split('T')[0]!;
    if (isSundayIST(iso)) { cur.setUTCDate(cur.getUTCDate() + 1); continue; }
    if (!excluded.has(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

interface LeaveUsage {
  used: number;      // days drawn from this year's 28-day annual allowance
  extraUsed: number; // days taken beyond the 28-day allowance (extra leave)
}

async function computeUsage(userId: string, year: number): Promise<LeaveUsage> {
  const requests = await db.prepare(
    "SELECT id, start_date, end_date, status, leave_year FROM leaves WHERE user_id = ? AND status = 'approved'"
  ).all(userId) as any[];

  // Collect all (clampedStart, clampedEnd) ranges so we can batch the holiday query.
  interface YearRange { year: number; start: string; end: string; }
  const ranges: YearRange[] = [];
  for (const r of requests) {
    const ry = r.leave_year ?? yearOf(r.start_date);
    const yearStart = `${ry}-01-01`;
    const yearEnd = `${ry}-12-31`;
    const clampStart = r.start_date < yearStart ? yearStart : r.start_date;
    const clampEnd = r.end_date > yearEnd ? yearEnd : r.end_date;
    if (clampStart <= clampEnd) ranges.push({ year: ry, start: clampStart, end: clampEnd });
  }

  // Batch fetch all holidays for the entire span once.
  const allDates = ranges.flatMap(r => [r.start, r.end]);
  const globalStart = allDates.length > 0 ? allDates.reduce((a, b) => a < b ? a : b) : `${year}-01-01`;
  const globalEnd = allDates.length > 0 ? allDates.reduce((a, b) => a > b ? a : b) : `${year}-12-31`;
  const allHolidays = await db.prepare('SELECT id, date FROM holidays WHERE date BETWEEN ? AND ?').all(globalStart, globalEnd) as any[];
  const holidayCache = new Map<string, any[]>();
  holidayCache.set(`${globalStart}:${globalEnd}`, allHolidays);

  const byYear = new Map<number, number>();
  for (const r of requests) {
    const ry = r.leave_year ?? yearOf(r.start_date);
    byYear.set(ry, (byYear.get(ry) ?? 0) + await daysWithinYear(userId, r.start_date, r.end_date, ry, holidayCache));
  }

  // Each year uses pro-rated entitlement (based on joining date). Days beyond it are extra leave.
  const entitlement = await entitlementForYear(userId, year);
  const available = entitlement.total;
  const totalUsed = byYear.get(year) ?? 0;
  const nonExtraUsed = Math.min(available, totalUsed);
  const extraUsed = totalUsed - nonExtraUsed;

  return { used: nonExtraUsed, extraUsed };
}

async function computeRequestExtra(userId: string, year: number, requestedDays: number): Promise<number> {
  const usage = await computeUsage(userId, year);
  const usedSoFar = usage.used + usage.extraUsed;
  const entitlement = await entitlementForYear(userId, year);
  const carryRow = await db.prepare('SELECT proposal_carryforward FROM leave_carryforwards WHERE user_id = ? AND year = ?').get(userId, year) as any;
  const carryover = carryRow?.proposal_carryforward ?? 0;
  const available = Math.max(0, entitlement.total + carryover - usedSoFar);
  return Math.max(0, requestedDays - available);
}

export class LeavesService {
  static async create(userId: string, input: any, role?: string) {
    const startDate = input.startDate.split('T')[0]!;
    const endDate = input.endDate.split('T')[0]!;
    const today = getISTDate();
    if (startDate < today) throw new AppError(400, 'Cannot apply for leave in the past');
    if (endDate < startDate) throw new AppError(400, 'End date must be on or after start date');

    const deductedFrom = this.pickDeductionType(input.type);

    const isAutoApprove = role === 'director';
    const status = isAutoApprove ? 'approved' : 'pending';
    const leaveYear = yearOf(startDate);

    const leaveRecord = await (await db.transaction(async () => {
      // Overlap check inside transaction for atomicity
      const overlap = await db.prepare("SELECT id FROM leaves WHERE user_id = ? AND status IN ('pending', 'approved') AND NOT (end_date < ? OR start_date > ?)").get(userId, startDate, endDate);
      if (overlap) throw new AppError(409, 'Leave request overlaps with existing leave');
      const id = uuid();
      let extra = 0;
      let workingDays: string[] = [];
      if (isAutoApprove) {
        workingDays = await workingDates(userId, startDate, endDate);
        extra = await computeRequestExtra(userId, leaveYear, workingDays.length);
      }

      await db.prepare('INSERT INTO leaves (id, user_id, type, start_date, end_date, reason, status, deducted_from, leave_year, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, userId, input.type, startDate, endDate, input.reason ?? null, status, deductedFrom, leaveYear, extra);

      if (isAutoApprove) {
        const dates = workingDays.length > 0 ? workingDays : await workingDates(userId, startDate, endDate);
        const notes = `${input.type} leave - ${input.reason ?? ''}`;
        const CHUNK = 500;
        for (let i = 0; i < dates.length; i += CHUNK) {
          const chunk = dates.slice(i, i + CHUNK);
          const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
          const params: any[] = [];
          for (const d of chunk) { params.push(uuid(), userId, d, 'leave', notes); }
          params.push(notes);
          await db.prepare(`INSERT INTO attendance (id, user_id, date, status, notes)
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE status = CASE WHEN attendance.status IN ${PROTECTED_STATUSES} THEN attendance.status ELSE 'leave' END, notes = CASE WHEN attendance.status IN ${PROTECTED_STATUSES} THEN attendance.notes ELSE ? END, updated_at = NOW()`).run(...params);
        }
        invalidateAnalyticsCache();

        const hrUsers = await db.prepare("SELECT id FROM users WHERE role = 'hr'").all() as any[];
        const insertNotif = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const a of hrUsers) {
          await insertNotif.run(uuid(), a.id, userId, 'Leave Auto-Approved', `${input.type} leave taken by director`, 'info', `/leaves/${id}`);
        }
        await insertNotif.run(uuid(), userId, userId, 'Leave Auto-Approved', `Your ${input.type} leave has been auto-approved`, 'success', `/leaves/${id}`);
      } else {
        const admins = await db.prepare("SELECT id, email, first_name, last_name FROM users WHERE role IN ('director', 'hr')").all() as any[];
        const insertNotif = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const a of admins) {
          await insertNotif.run(uuid(), a.id, userId, 'Leave Requested', `${input.type} leave request pending review`, 'approval', `/leaves/${id}`);
        }
      }
      return mapLeave(await db.prepare('SELECT l.*, u.first_name, u.last_name, u.employee_id FROM leaves l JOIN users u ON l.user_id = u.id WHERE l.id = ?').get(id));
    }))();
    if (!isAutoApprove && isEmailConfigured()) {
      // Emails AFTER commit: gated by isEmailConfigured() — notifications are
      // the primary channel; email is optional (no SMTP = silently skipped).
      const notifyAdmins = (await db.prepare("SELECT id, email, first_name, last_name FROM users WHERE role IN ('director', 'hr')").all()) as any[];
      for (const a of notifyAdmins) {
        try { await sendLeaveNotification({ id: leaveRecord.id, type: input.type, startDate, endDate, reason: input.reason ?? undefined }, 'submitted', { id: a.id, email: a.email, firstName: a.first_name, lastName: a.last_name }); } catch (e: any) { console.error('[Email] Failed:', e.message); }
      }
    }

    if (isAutoApprove) await cache.delByPrefix(`${userId}:/api/v1/leaves/balance`);

    try {
      if (isAutoApprove) {
        getIO().to(`user:${userId}`).emit('leave:reviewed', leaveRecord);
        const hrUsers = await db.prepare("SELECT id FROM users WHERE role = 'hr'").all() as any[];
        for (const a of hrUsers) getIO().to(`user:${a.id}`).emit('leave:applied', leaveRecord);
      } else {
        const admins = await db.prepare("SELECT id FROM users WHERE role IN ('director', 'hr')").all() as any[];
        for (const a of admins) getIO().to(`user:${a.id}`).emit('leave:applied', leaveRecord);
      }
    } catch (e) { console.error('[Leaves] Socket emit failed:', e); }
    return leaveRecord;
  }

  static async list(input: any, userId: string, role: string) {
    const { page = 1, limit = 20, status, statuses, type, startDate, endDate, userId: filterUserId } = input;
    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: any[] = [];

    if (role === 'employee') { conds.push('l.user_id = ?'); params.push(userId); }
    else if (filterUserId) { conds.push('l.user_id = ?'); params.push(filterUserId); }
    if (status) { conds.push('l.status = ?'); params.push(status); }
    if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(',');
      conds.push(`l.status IN (${placeholders})`);
      params.push(...statuses);
    }
    if (type) { conds.push('l.type = ?'); params.push(type); }
    if (startDate) { conds.push('l.end_date >= ?'); params.push(startDate); }
    if (endDate) { conds.push('l.start_date <= ?'); params.push(endDate); }

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT count(*) as c FROM leaves l ${where}`).get(...params) as any).c;
    const leaves = await db.prepare(`SELECT l.*, u.first_name, u.last_name, u.employee_id FROM leaves l JOIN users u ON l.user_id = u.id ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { leaves: leaves.map(mapLeave), total: count, page, limit };
  }

  static async getById(id: string, userId: string, role: string) {
    const l = await db.prepare('SELECT id, user_id, type, start_date, end_date, reason, status, review_comment, reviewed_by_id, reviewed_at, deducted_from, extra, leave_year, created_at, updated_at FROM leaves WHERE id = ?').get(id) as any;
    if (!l) throw new AppError(404, 'Leave not found');
    if (role === 'employee' && l.user_id !== userId) throw new AppError(403, 'Forbidden');
    return mapLeave(l);
  }

  static async getBalance(userId: string, year?: number) {
    const currentYear = year ?? parseInt(getISTDate().slice(0, 4), 10);
    const start = `${currentYear}-01-01`;
    const end = `${currentYear}-12-31`;

    const usage = await computeUsage(userId, currentYear);

    const rows = await db.prepare(`SELECT type, start_date, end_date FROM leaves WHERE user_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ? ORDER BY created_at ASC`).all(userId, end, start) as any[];

    const entitlement = await entitlementForYear(userId, currentYear);
    const carryRow = await db.prepare('SELECT proposal_carryforward FROM leave_carryforwards WHERE user_id = ? AND year = ?').get(userId, currentYear) as any;
    const carryover = carryRow?.proposal_carryforward ?? 0;

    const pools: Record<string, number> = { casual: entitlement.casual, sick: entitlement.sick, proposal: entitlement.proposal + carryover };
    const spillOrder = ['casual', 'sick', 'proposal'] as const;
    const allHolidays = await db.prepare('SELECT id, date FROM holidays WHERE date BETWEEN ? AND ?').all(start, end) as any[];
    const holidayCache = new Map<string, any[]>();
    holidayCache.set(`${start}:${end}`, allHolidays);

    for (const r of rows) {
      const clampStart = r.start_date > start ? r.start_date : start;
      const clampEnd = r.end_date < end ? r.end_date : end;
      const days = await countWorkingDays(userId, clampStart, clampEnd, holidayCache);
      if (days <= 0) continue;

      let spill = days;
      const own = r.type as string;
      if (own in pools) {
        const take = Math.min(pools[own] ?? 0, spill);
        pools[own] = (pools[own] ?? 0) - take;
        spill -= take;
      }
      for (const o of spillOrder) {
        if (spill <= 0) break;
        if (o === own) continue;
        const take = Math.min(pools[o] ?? 0, spill);
        pools[o] = (pools[o] ?? 0) - take;
        spill -= take;
      }
    }

    const remainingOf = (t: 'casual' | 'sick' | 'proposal') => Math.max(0, pools[t] ?? 0);
    const balances: Record<string, { total: number; used: number; remaining: number }> = {
      casual: { total: entitlement.casual, used: entitlement.casual - remainingOf('casual'), remaining: remainingOf('casual') },
      sick: { total: entitlement.sick, used: entitlement.sick - remainingOf('sick'), remaining: remainingOf('sick') },
      proposal: { total: entitlement.proposal + carryover, used: entitlement.proposal + carryover - remainingOf('proposal'), remaining: remainingOf('proposal') },
    };

    const totalBalance = entitlement.total;
    const totalAvailable = totalBalance + carryover;
    const totalRemaining = Math.max(0, totalAvailable - usage.used - usage.extraUsed);

    return {
      balances,
      totalUsed: usage.used,
      totalBalance: totalBalance,
      totalAvailable,
      totalRemaining,
      carryover,
      extraUsed: usage.extraUsed,
      totalBreakdown: {
        used: usage.used,
        extraUsed: usage.extraUsed,
      },
      year: currentYear,
    };
  }

  private static pickDeductionType(requestedType: string): string {
    return requestedType;
  }

  static async review(id: string, reviewedById: string, status: string, comments?: string, _role?: string) {
    const leave = await db.prepare('SELECT id, user_id, type, start_date, end_date, reason, status FROM leaves WHERE id = ?').get(id) as any;
    if (!leave) throw new AppError(404, 'Leave not found');
    if (leave.user_id === reviewedById) throw new AppError(403, 'Cannot review your own leave request');

    await db.transaction(async () => {
      // Re-read status inside transaction to prevent race condition
      const current = await db.prepare('SELECT status FROM leaves WHERE id = ?').get(id) as any;
      if (!current || current.status !== 'pending') throw new AppError(409, 'Leave not in reviewable state');

      let extra = 0;
      let leaveYear: number | null = null;
      if (status === 'approved') {
        const dates = await workingDates(leave.user_id, leave.start_date, leave.end_date);
        leaveYear = yearOf(leave.start_date);
        extra = await computeRequestExtra(leave.user_id, leaveYear, dates.length);
      }
      await db.prepare("UPDATE leaves SET status = ?, review_comment = ?, reviewed_by_id = ?, reviewed_at = NOW(), leave_year = COALESCE(?, leave_year), extra = CASE WHEN ? = 'approved' THEN ? ELSE extra END, updated_at = NOW() WHERE id = ?")
        .run(status, comments ?? null, reviewedById, leaveYear, status, extra, id);

      // When approved, create attendance records for each working date
      if (status === 'approved') {
        const dates = await workingDates(leave.user_id, leave.start_date, leave.end_date);
        const notes = `${leave.type} leave - ${leave.reason ?? ''}`;
        const CHUNK = 500;
        for (let i = 0; i < dates.length; i += CHUNK) {
          const chunk = dates.slice(i, i + CHUNK);
          const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
          const params: any[] = [];
          for (const d of chunk) { params.push(uuid(), leave.user_id, d, 'leave', notes); }
          params.push(notes);
          await db.prepare(`INSERT INTO attendance (id, user_id, date, status, notes)
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE status = CASE WHEN attendance.status IN ${PROTECTED_STATUSES} THEN attendance.status ELSE 'leave' END, notes = CASE WHEN attendance.status IN ${PROTECTED_STATUSES} THEN attendance.notes ELSE ? END, updated_at = NOW()`).run(...params);
        }
        invalidateAnalyticsCache();
      }

      await db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), leave.user_id, reviewedById, `Leave ${status}`, `Your ${leave.type} leave has been ${status}`, status === 'approved' ? 'success' : 'warning', `/leaves/${id}`);
    })();
    // Email AFTER commit — optional: skipped when SMTP not configured; notifications are primary.
    if (isEmailConfigured()) {
      const employee = await db.prepare('SELECT id, email, first_name, last_name FROM users WHERE id = ?').get(leave.user_id) as any;
      if (employee) {
        try { await sendLeaveNotification({ id: leave.id, type: leave.type, startDate: leave.start_date, endDate: leave.end_date, reason: leave.reason ?? undefined }, status as 'approved' | 'rejected', { id: employee.id, email: employee.email, firstName: employee.first_name, lastName: employee.last_name }); } catch (e: any) { console.error('[Email] Failed:', e.message); }
      }
    }
    await cache.delByPrefix(`${leave.user_id}:/api/v1/leaves/balance`);
    const updated = mapLeave(await db.prepare('SELECT l.*, u.first_name, u.last_name, u.employee_id FROM leaves l JOIN users u ON l.user_id = u.id WHERE l.id = ?').get(id));
    try { getIO().to(`user:${leave.user_id}`).emit('leave:reviewed', updated); } catch (e) { console.error('[Leaves] Socket emit failed:', e); }
    return updated;
  }

  static async cancel(id: string, userId: string, role: string) {
    const leave = await db.prepare('SELECT id, user_id, type, start_date, end_date, status FROM leaves WHERE id = ?').get(id) as any;
    if (!leave) throw new AppError(404, 'Leave not found');

    const isOwner = leave.user_id === userId;
    const isAdmin = role === 'director' || role === 'hr';

    // Allow self-cancel for owner (pending for employee, any for director/hr); admin can cancel other's approved
    if (!isAdmin && !isOwner) throw new AppError(403, 'Access denied');
    if (!isAdmin && isOwner && leave.status !== 'pending') throw new AppError(409, 'Employees can only cancel pending leaves');
    if (isAdmin && !isOwner && leave.status !== 'approved') throw new AppError(409, 'Only approved leaves can be cancelled by admin');
    // directors/hr can cancel own leaves (pending or approved) — no peer required for cancel
    if (leave.status === 'cancelled') throw new AppError(409, 'Leave already cancelled');

    const today = getISTDate();
    if (today >= leave.start_date && today <= leave.end_date) {
      const workedToday = await db.prepare("SELECT 1 FROM attendance WHERE user_id = ? AND date = ? AND status IN ('present','work_end','on_break','half_day')").get(leave.user_id, today);
      if (workedToday && role !== 'director') throw new AppError(409, 'Cannot cancel leave: the user has already worked today');
    }

    const result = await db.transaction(async () => {
      await db.prepare("UPDATE leaves SET status = 'cancelled', updated_at = NOW() WHERE id = ?").run(id);
      const dates = iterDates(leave.start_date, leave.end_date);
      if (dates.length > 0) {
        const placeholders = dates.map(() => '?').join(',');
        await db.prepare(`UPDATE attendance SET status = 'absent', notes = NULL, updated_at = NOW() WHERE user_id = ? AND status = 'leave' AND date IN (${placeholders})`).run(leave.user_id, ...dates);
      }
      invalidateAnalyticsCache();
      await db.prepare("INSERT INTO activity_logs (id, actor_id, action, entity_type, entity_id, old_values, new_values, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(uuid(), userId, 'cancel_leave', 'leave', id, JSON.stringify({ status: leave.status }), JSON.stringify({ status: 'cancelled' }), null);
      return mapLeave(await db.prepare('SELECT l.id, l.user_id, l.type, l.start_date, l.end_date, l.reason, l.status, l.review_comment, l.reviewed_by_id, l.reviewed_at, l.deducted_from, l.extra, l.leave_year, l.created_at, l.updated_at, u.first_name, u.last_name, u.employee_id FROM leaves l JOIN users u ON l.user_id = u.id WHERE l.id = ?').get(id));
    })();
    await cache.delByPrefix(`${leave.user_id}:/api/v1/leaves/balance`);
    return result;
  }
}
