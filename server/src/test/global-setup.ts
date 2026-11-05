import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';
import { resolveTestDbConfig } from './test-db.js';

// Recreate the test database from scratch before every run.
//
// Truncating tables but keeping schema_migrations used to leak migration rows
// from other branches/schemas (e.g. versions 20-29 from the multi-tenant
// variant), which made migrations.test.ts fail locally even though CI (fresh
// DB) passed. Dropping and recreating guarantees the exact schema this code
// version expects: schema.sql + migrations 1-19.
export async function resetTestDatabase(): Promise<{ database: string; tables: number }> {
  const cfg = resolveTestDbConfig();
  const connection = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${cfg.database}\``);
    await connection.query(
      `CREATE DATABASE \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    return { database: cfg.database, tables: 0 };
  } finally {
    await connection.end();
  }
}

// Runs once before all test files (separate process).
// Creates the test database and clears leftovers from previous runs.
export default async function globalSetup() {
  try {
    const result = await resetTestDatabase();
    console.log(`[TestSetup] ${result.database} recreated`);
  } catch (e: any) {
    // Fail loudly: a silently skipped setup shows up much later as a confusing
    // connection error, or (worse) as tests silently running against another DB.
    throw new Error(`[TestSetup] Could not prepare the test database: ${e.message}`);
  }
}
