import dotenv from 'dotenv';
dotenv.config();
import { ensureAdminBootstrap } from './bootstrap.js';

async function setup() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail) {
    console.error('[SETUP] Missing required environment variable: ADMIN_EMAIL');
    process.exit(1);
  }
  if (!adminPassword) {
    console.error('[SETUP] Missing required environment variable: ADMIN_PASSWORD');
    process.exit(1);
  }

  if (adminPassword.length < 12) {
    console.error('[SETUP] ADMIN_PASSWORD must be at least 12 characters');
    process.exit(1);
  }

  await ensureAdminBootstrap();
  console.log('[SETUP] Done');
  // Close pool to allow process to exit (tsx watch keeps pool alive)
  const { pool } = await import('./index.js');
  await pool.end();
  process.exit(0);
}

setup().catch(async (e) => {
  console.error('[SETUP] Failed:', e);
  try { const { pool } = await import('./index.js'); await pool.end(); } catch {}
  process.exit(1);
});