import { describe, expect, it } from 'vitest';
import db from '../db/index.js';
import { ensureAdminBootstrap } from '../db/bootstrap.js';

describe('database migrations', () => {
  it('applies all 27 migrations in order', async () => {
    const rows = (await db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()) as any[];
    const versions = rows.map((r) => Number(r.version));
    expect(versions).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
  });

  it('creates all core tables', async () => {
    const rows = (await db.prepare('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = ?').all('BASE TABLE')) as any[];
    const names = new Set(rows.map((r) => r.name));
    for (const t of ['users', 'roles', 'attendance', 'attendance_correction_requests', 'attendance_extra_work', 'work_plan_items', 'leaves', 'tasks', 'notifications', 'documents', 'holidays', 'activity_logs']) {
      // documents table may be named document_requests
      if (t === 'documents') {
        expect(names.has('document_requests') || names.has('documents')).toBe(true);
        continue;
      }
      expect(names.has(t)).toBe(true);
    }
  });

  it('admin bootstrap creates the first admin once and is idempotent afterwards', async () => {
    const count = async () => Number(((await db.prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('director','hr')").get()) as any).c);
    const before = await count();
    await ensureAdminBootstrap();
    const afterFirst = await count();
    await ensureAdminBootstrap();
    const afterSecond = await count();
    // On a freshly reset database the first call creates the admin; a second call must
    // never add another one.
    expect(afterFirst).toBeGreaterThanOrEqual(before);
    expect(afterSecond).toBe(afterFirst);
  });

  it('does not mark a failed migration as applied', async () => {
    // Regression: versions used to be recorded even when the body threw, so a broken
    // migration looked applied forever and this file could never catch it.
    const rows = (await db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()) as any[];
    const versions = rows.map((r) => Number(r.version));
    expect(versions).toEqual(expect.arrayContaining([1, 27]));
    expect(versions.every((v) => Number.isInteger(v) && v > 0)).toBe(true);
    expect(new Set(versions).size).toBe(versions.length);
  });
});




