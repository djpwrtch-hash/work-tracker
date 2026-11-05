// Single source of truth for the TEST database connection.
//
// Every suite (Vitest API tests, Playwright E2E, Artillery load tests) resolves the
// database through here so they can never fall back to the development database:
//   TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD / TEST_DB_NAME
// fall back to the MYSQL_* values from server/.env, which in turn fall back to
// localhost:3306 root/<empty> hr_test.
// CI sets TEST_DB_PASSWORD (or MYSQL_ROOT_PASSWORD) so it works there too.

export interface TestDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  url: string;
}

export function resolveTestDbConfig(): TestDbConfig {
  const host = process.env.TEST_DB_HOST || process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.TEST_DB_PORT || process.env.MYSQL_PORT || 3306);
  const user = process.env.TEST_DB_USER || process.env.MYSQL_USER || 'root';
  const password = process.env.TEST_DB_PASSWORD ?? process.env.MYSQL_PASSWORD ?? '';
  const database = process.env.TEST_DB_NAME || 'hr_test';

  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`[TestSetup] Invalid test database name: ${database}`);
  }
  if (database === 'hr' || database === 'mysql' || database === 'information_schema') {
    throw new Error(`[TestSetup] Refusing to run tests against the protected database "${database}"`);
  }

  return {
    host,
    port,
    user,
    password,
    database,
    url: `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
  };
}

/** Applies the test database to process.env so application modules pick it up. */
export function applyTestDbEnv(): TestDbConfig {
  const cfg = resolveTestDbConfig();
  process.env.DATABASE_URL = cfg.url;
  process.env.MYSQL_HOST = cfg.host;
  process.env.MYSQL_PORT = String(cfg.port);
  process.env.MYSQL_USER = cfg.user;
  process.env.MYSQL_PASSWORD = cfg.password;
  process.env.MYSQL_DATABASE = cfg.database;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  return cfg;
}
