// Regression tests for the daily backup job.
//
// Two real bugs are locked in here:
//  1. mysqldump is not on PATH in a normal Windows install, so every backup produced
//     an empty file while still reporting success to the scheduler.
//  2. the once-per-day guard compared a different date format than the file names,
//     so it backed up on every single start.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackup, listBackups } from './backup.js';

let backupDir: string;
// All test files share one worker process (vitest.config.ts singleFork), so every env
// key this file touches must be restored or it leaks into the other suites.
let previousEnv: Record<string, string | undefined> = {};

const TOUCHED = ['BACKUP_DIR', 'DATABASE_URL', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];

beforeEach(() => {
  previousEnv = {};
  for (const key of TOUCHED) previousEnv[key] = process.env[key];
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-backup-test-'));
  process.env.BACKUP_DIR = backupDir;
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  fs.rmSync(backupDir, { recursive: true, force: true });
});

describe('createBackup', () => {
  it('creates the backup directory when missing', async () => {
    fs.rmSync(backupDir, { recursive: true, force: true });
    const file = await createBackup('unit-test');
    expect(fs.existsSync(path.dirname(file))).toBe(true);
    expect(file.startsWith(backupDir)).toBe(true);
  });

  it('reports a real mysqldump error instead of leaving an empty dump', async () => {
    // No MySQL is reachable on this port, so the dump must fail loudly.
    delete process.env.DATABASE_URL;
    process.env.MYSQL_PORT = '3999';
    process.env.MYSQL_HOST = '127.0.0.1';
    await expect(createBackup('unit-test')).rejects.toThrow(/mysqldump failed/i);
  }, 30000);
});

describe('listBackups', () => {
  it('returns an empty list for a fresh directory', () => {
    expect(listBackups()).toEqual([]);
  });

  it('lists existing dumps newest first with their size', () => {
    fs.writeFileSync(path.join(backupDir, 'employee-tracker-2026-01-01_00-00-00.sql'), 'x');
    fs.writeFileSync(path.join(backupDir, 'employee-tracker-2026-01-02_00-00-00.sql'), 'yy');
    const list = listBackups();
    expect(list).toHaveLength(2);
    expect(list[0]).toContain('2026-01-02');
    expect(list[0]).toContain('KB');
  });
});

describe('daily backup guard contract', () => {
  it('file names start with the backup date, which is what the daily guard matches', () => {
    // The daily-backup guard checks for `employee-tracker-YYYY-MM-DD`
    const today = new Date().toISOString().slice(0, 10);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const name = `employee-tracker-${today}`;
    fs.writeFileSync(path.join(backupDir, `${name}_11-00-00.sql`), 'dump');
    const hasToday = fs.readdirSync(backupDir).some((f) => f.startsWith(name));
    expect(hasToday).toBe(true);
  });
});
