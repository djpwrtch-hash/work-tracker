import db, { uuid, getSetting, setSetting } from '../db/index.js';
import { getISTDate, isISTPast, isSundayIST } from './time.js';
import { cache } from './cache.js';

const CHECK_INTERVAL_MS = 300_000;
const ABSENT_MARK_HOUR = 18;
const ABSENT_MARK_MINUTE = 30;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0]!;
}

async function acquireLock(): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - CHECK_INTERVAL_MS;
  // Atomic: update only if expired, return affected rows
  const result = await db.prepare(
    "UPDATE app_settings SET value = ? WHERE `key` = 'auto_absent_lock' AND (value = '' OR CAST(value AS UNSIGNED) < ?)"
  ).run(String(now), cutoff) as any;
  if (result.changes > 0) return true;
  // First run — insert if not exists
  const existing = await getSetting('auto_absent_lock');
  if (!existing) {
    await setSetting('auto_absent_lock', String(now));
    return true;
  }
  return false;
}

async function releaseLock(): Promise<void> {
  await setSetting('auto_absent_lock', '');
}

async function invalidateAnalyticsCache() {
  try {
    await cache.delContaining('/api/v1/analytics/');
  } catch (e) {
    console.error('[Auto-Absent] Analytics cache invalidation failed:', e);
  }
}

async function skipUsersForHoliday(date: string): Promise<string[]> {
  const holidays = await db.prepare('SELECT id FROM holidays WHERE date = ?').all(date) as any[];
  if (holidays.length === 0) return [];

  const holidayIds = holidays.map((h: any) => h.id);
  const placeholders = holidayIds.map(() => '?').join(',');
  const assignees = await db.prepare(`SELECT user_id FROM holiday_assignees WHERE holiday_id IN (${placeholders})`).all(...holidayIds) as any[];

  let hasCompanyWide = false;
  for (const h of holidays) {
    const cnt = (await db.prepare('SELECT COUNT(*) as c FROM holiday_assignees WHERE holiday_id = ?').get(h.id) as any).c;
    if (cnt === 0) { hasCompanyWide = true; break; }
  }

  if (hasCompanyWide) {
    const allActive = await db.prepare("SELECT id FROM users WHERE status = 'active'").all() as any[];
    return allActive.map((u: any) => u.id);
  }

  return assignees.map((r: any) => r.user_id);
}

async function isCompanyWideHoliday(date: string): Promise<boolean> {
  const holidays = await db.prepare('SELECT id FROM holidays WHERE date = ?').all(date) as any[];
  if (holidays.length === 0) return false;
  for (const h of holidays) {
    const assigneeCount = (await db.prepare('SELECT COUNT(*) as c FROM holiday_assignees WHERE holiday_id = ?').get(h.id) as any).c;
    if (assigneeCount > 0) return false;
  }
  return true;
}

async function markAbsentForDay(date: string, skipUserIds: string[]) {
  let params: any[] = [];
  let skipClause = '';
  if (skipUserIds.length > 0) {
    skipClause = ` AND u.id NOT IN (${skipUserIds.map(() => '?').join(',')})`;
    params.push(...skipUserIds);
  }

  const existingIds = new Set(
    (await db.prepare(`SELECT user_id FROM attendance WHERE date = ?`).all(date) as any[]).map((r: any) => r.user_id)
  );

  const activeUsers = await db.prepare(`SELECT id, joining_date FROM users WHERE status = 'active'${skipClause}`).all(...params) as any[];
  const toInsert = activeUsers.filter((u: any) => {
    if (existingIds.has(u.id)) return false;
    if (u.joining_date && u.joining_date > date) return false;
    return true;
  });

  if (toInsert.length === 0) return;

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const CHUNK = 500;
  const insertBatch = db.transaction(async () => {
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const user of chunk) {
        params.push(uuid(), user.id, date, 'absent', null, now, now);
      }
      await db.prepare(`INSERT IGNORE INTO attendance (id, user_id, date, status, notes, created_at, updated_at) VALUES ${placeholders}`).run(...params);
    }
  });
  await insertBatch();
  await invalidateAnalyticsCache();
}

async function processDay(date: string) {
    if (isSundayIST(date)) return;
    if (await isCompanyWideHoliday(date)) return;
    const holidayUserIds = await skipUsersForHoliday(date);
    await markAbsentForDay(date, holidayUserIds);
}

// Backfills any missed working days since the last processed date (unlimited).
// Runs on startup and on each interval tick. Idempotent: advances
// auto_absent_last_date as it goes, and never overwrites existing rows.
// A single-instance lease lock prevents two server processes from both running.
async function backfillAbsentDates() {
  if (!(await acquireLock())) return;
  try {
    const today = getISTDate();
    // Only mark *today* once the daily threshold has passed; all earlier dates are fair game.
    const throughToday = isISTPast(ABSENT_MARK_HOUR, ABSENT_MARK_MINUTE);
    const lastProcessed = await getSetting('auto_absent_last_date');
    // Anchor to yesterday when the cursor is missing so a fresh start never
    // backfills months of history from Jan 1.
    const start = lastProcessed ? addDays(lastProcessed, 1) : addDays(today, -1);
    let cursor = start;
    const cutoff = throughToday ? today : addDays(today, -1);

    if (cursor > cutoff) return;

    const runDay = db.transaction(async (date: string) => {
      await processDay(date);
      await setSetting('auto_absent_last_date', date);
    });

    let safety = 0;
    while (cursor <= cutoff && safety < 370) {
      await runDay(cursor);
      cursor = addDays(cursor, 1);
      safety += 1;
    }
  } finally {
    await releaseLock();
  }
}

let autoAbsentInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoAbsentScheduler() {
  try {
    backfillAbsentDates().catch(err => console.error('[Auto-Absent] Initial backfill error:', err));
    console.log(`[Auto-Absent] Scheduler started (interval: ${CHECK_INTERVAL_MS / 1000}s)`);
  } catch (err) {
    console.error('[Auto-Absent] Initial backfill error:', err);
  }
  autoAbsentInterval = setInterval(() => {
    backfillAbsentDates().catch(err => console.error('[Auto-Absent] Error:', err));
  }, CHECK_INTERVAL_MS);
}

export function stopAutoAbsentScheduler() {
  if (autoAbsentInterval) {
    clearInterval(autoAbsentInterval);
    autoAbsentInterval = null;
  }
}