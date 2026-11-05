import bcrypt from 'bcrypt';
import db, { uuid } from './index.js';
import { generateEmployeeId } from '../lib/employee-id.js';

export async function ensureAdminBootstrap() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  const userCount = (await db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
  if (userCount > 0) {
    return;
  }

  if (!adminEmail || !adminPassword) {
    console.warn('[SETUP] No users found and ADMIN_EMAIL/ADMIN_PASSWORD not set. Set them to auto-create the initial admin on first run.');
    return;
  }

  if (adminPassword.length < 12) {
    console.warn('[SETUP] ADMIN_PASSWORD must be at least 12 characters. Skipping admin creation.');
    return;
  }

  console.log('[SETUP] Creating initial admin account...');

  await db.transaction(async () => {
    const deptId = uuid();
    await db.prepare('INSERT IGNORE INTO departments (id, name, description) VALUES (?, ?, ?)').run(deptId, 'Engineering', 'Software engineering team');

    // Get the department ID (either newly created or existing)
    const dept = await db.prepare('SELECT id FROM departments WHERE name = ?').get('Engineering') as any;
    const finalDeptId = dept?.id ?? deptId;

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await db.prepare(`INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash, role, designation, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), generateEmployeeId(), 'Admin', 'User', adminEmail, passwordHash, 'director', 'System Administrator', finalDeptId);
  })();

  console.log('[SETUP] Admin account created successfully');
  console.log(`[SETUP] Email: ${adminEmail}`);
  console.log('[SETUP] You can now log in and create additional users from the dashboard');
}