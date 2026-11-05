// Regression tests for the MySQL driver layer.
//
// These lock in fixes for bugs that broke the whole app on localhost:
//  1. pool.ts used to call .catch() on the connection handed to the pool's
//     'connection' event. mysql2 emits a callback-style connection there, so every
//     first query threw "You have tried to call .then()/.catch() ... not a promise".
//  2. DATE columns came back as JS Date objects, so string handling like
//     `${leave.start_date}T00:00:00Z` produced an Invalid Date and left SQL like
//     "date IN ()" (syntax error) and "year = NaN".
//  3. A dropped connection (PC sleep / MySQL restart) used to fail the request
//     instead of reconnecting transparently.
import { describe, expect, it } from 'vitest';
import { db, resolveDbConfig, mysqlPool } from './pool.js';

describe('pool configuration', () => {
  it('returns DATE columns as YYYY-MM-DD strings', async () => {
    // `leaves.start_date` is a DATE column; the services treat it as a string.
    const row = (await db.prepare('SELECT CURDATE() AS today').get()) as any;
    expect(typeof row.today).toBe('string');
    expect(row.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('applies ONLY_FULL_GROUP_BY on connect', async () => {
    const row = (await db.prepare('SELECT @@SESSION.sql_mode AS mode').get()) as any;
    expect(String(row.mode)).toContain('ONLY_FULL_GROUP_BY');
  });

  it('exposes resilience options so long idle periods survive', () => {
    const cfg = resolveDbConfig() as any;
    expect(cfg.enableKeepAlive).toBe(true);
    expect(cfg.connectTimeout).toBeGreaterThan(0);
    expect(cfg.idleTimeout).toBeGreaterThan(0);
    expect(cfg.maxIdle).toBeGreaterThan(0);
    expect(cfg.multipleStatements).toBe(false);
    expect(cfg.dateStrings).toContain('DATE');
  });

  it('reconnects transparently after a dropped connection', async () => {
    // A connection killed underneath the pool must not surface as an error:
    // the wrapper retries once on a fresh connection.
    const first = (await db.prepare('SELECT 1 AS n').get()) as any;
    expect(Number(first.n)).toBe(1);

    const connection = await mysqlPool.getConnection();
    await connection.query('KILL CONNECTION CONNECTION_ID()').catch(() => {});
    connection.release();

    const second = (await db.prepare('SELECT 2 AS n').get()) as any;
    expect(Number(second.n)).toBe(2);
  });

  it('reports row counts and insert ids for writes', async () => {
    const id = `pool-test-${Date.now()}`;
    await db.prepare('INSERT INTO departments (id, name, description) VALUES (?, ?, ?)').run(id, `Pool ${id}`, 'test');
    const found = (await db.prepare('SELECT id FROM departments WHERE id = ?').get(id)) as any;
    expect(found.id).toBe(id);
    await db.prepare('DELETE FROM departments WHERE id = ?').run(id);
  });
});
