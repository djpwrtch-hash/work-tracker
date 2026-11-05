// Tests for the test-harness configuration.
//
// Regression: setup-env.ts used to hardcode
//   process.env.DATABASE_URL = 'mysql://root:@localhost:3306/hr_test'
// (empty password). Locally that accidentally worked because pool.ts falls back to
// MYSQL_PASSWORD, but in CI there is no .env, so the server job connected with an empty
// password and could not run at all. global-setup.ts also preferred the ambient
// DATABASE_URL, so it created the development database instead of the test one.
import { describe, expect, it, afterEach } from 'vitest';
import { resolveTestDbConfig, applyTestDbEnv } from './test-db.js';

const KEYS = [
  'DATABASE_URL', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE',
  'TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_USER', 'TEST_DB_PASSWORD', 'TEST_DB_NAME',
];
const saved: Record<string, string | undefined> = {};
for (const key of KEYS) saved[key] = process.env[key];

function resetEnv() {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

afterEach(() => { resetEnv(); });

describe('resolveTestDbConfig', () => {
  it('always uses the test database, never the development one', () => {
    resetEnv();
    delete process.env.TEST_DB_NAME;
    delete process.env.DATABASE_URL;
    process.env.MYSQL_DATABASE = 'hr';            // dev database in .env
    expect(resolveTestDbConfig().database).toBe('hr_test');
  });

  it('falls back to the MYSQL_* credentials so it works locally and in CI', () => {
    resetEnv();
    delete process.env.TEST_DB_PASSWORD;
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_PORT = '3306';
    process.env.MYSQL_USER = 'root';
    process.env.MYSQL_PASSWORD = 'root';
    const cfg = resolveTestDbConfig();
    expect(cfg.password).toBe('root');
    expect(cfg.url).toBe('mysql://root:root@127.0.0.1:3306/hr_test');
  });

  it('honours TEST_DB_* overrides (what CI can set)', () => {
    resetEnv();
    process.env.TEST_DB_NAME = 'hr_ci';
    process.env.TEST_DB_PASSWORD = 'secret';
    const cfg = resolveTestDbConfig();
    expect(cfg.database).toBe('hr_ci');
    expect(cfg.url).toContain(':secret@');
  });

  it('refuses to target a protected database', () => {
    resetEnv();
    for (const name of ['hr', 'mysql', 'information_schema']) {
      process.env.TEST_DB_NAME = name;
      expect(() => resolveTestDbConfig()).toThrow(/Refusing to run tests/);
    }
  });

  it('rejects an invalid database name', () => {
    resetEnv();
    process.env.TEST_DB_NAME = 'hr_test; DROP DATABASE hr';
    expect(() => resolveTestDbConfig()).toThrow(/Invalid test database name/);
  });

  it('escapes credentials with special characters in the URL', () => {
    resetEnv();
    process.env.TEST_DB_PASSWORD = 'p@ss:word/1';
    expect(resolveTestDbConfig().url).toContain('p%40ss%3Aword%2F1');
  });
});

describe('applyTestDbEnv', () => {
  it('points the application at the test database', () => {
    resetEnv();
    process.env.TEST_DB_NAME = 'hr_test';
    process.env.TEST_DB_PASSWORD = '0000';
    delete process.env.DATABASE_URL;
    applyTestDbEnv();
    expect(process.env.DATABASE_URL).toContain(':0000@');
    expect(process.env.DATABASE_URL).toMatch(/\/hr_test$/);
    expect(process.env.MYSQL_DATABASE).toBe('hr_test');
    expect(process.env.NODE_ENV).toBe('test');
  });
});
