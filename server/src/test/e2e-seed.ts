import dotenv from 'dotenv';
dotenv.config();

// Seeds a known director for Playwright E2E runs (hr_test only).
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { resolveTestDbConfig } from './test-db.js';

// Safe by design: the test resolver refuses anything but a test database, so this can
// never seed the development/production database even when DATABASE_URL is unset.
const cfg = resolveTestDbConfig();
if (!/test/i.test(cfg.database)) {
  console.error(`[E2ESeed] Refusing to seed non-test database: "${cfg.database}".`);
  process.exit(1);
}

const EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e-director@example.com';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'E2ePassword123!';

const dbModule = await import('../db/index.js');
const db = dbModule.default as any;
const pool = dbModule.pool as any;

const existing = (await db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL)) as any;
if (!existing) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  await db.prepare(
    'INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(randomUUID(), 'E2E-0001', 'E2E', 'Director', EMAIL, hash, 'director', 'active');
  console.log('[E2ESeed] Director seeded:', EMAIL);
} else {
  console.log('[E2ESeed] Director already exists:', EMAIL);
}
await pool.end();
process.exit(0);