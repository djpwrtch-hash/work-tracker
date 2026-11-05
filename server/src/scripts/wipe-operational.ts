import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import db from '../db/index.js';

// Wipe operational data but keep admin credentials & stable config
// Keep: schema_migrations, password_policies, file_retention_policies, departments(Engineering), users(director/hr), app_settings
// Wipe: attendance, tasks, leaves, notifications, etc. + uploads/ folder

const KEEP_DEPT = 'Engineering';

async function wipe() {
  // Production guard: require explicit --force flag (prevents accidental prod wipe)
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('[Wipe] ABORT: refusing to run in production without --force flag.');
    console.error('[Wipe] Re-run as: npm run wipe:operational -- --force (after npm run backup)');
    process.exit(1);
  }
  console.log('[Wipe] Starting — keeping admin & stable config...');

  // 1. Verify admin exists before wipe
  const admins = (await db.prepare('SELECT id, email, role FROM users WHERE role IN (?, ?)').all('director', 'hr')) as any[];
  if (admins.length === 0) {
    console.error('[Wipe] ABORT: No director/hr found — would lock out. Create admin first.');
    process.exit(1);
  }
  console.log(`[Wipe] Keeping ${admins.length} admin(s):`, admins.map((a) => `${a.email} (${a.role})`).join(', '));

  const tables: string[] = [
    // Level 1 children
    'holiday_assignees',
    'scheduled_report_results',
    'task_assignments',
    'task_comments',
    'task_attachments',
    'task_approvals',
    'attendance_events',
    // Level 2 parents
    'attendance',
    'tasks',
    'holidays',
    'scheduled_reports',
    'report_templates',
    // Level 3 operational
    'work_plans',
    'work_reports',
    'leaves',
    'leave_carryforwards',
    'monthly_overtime',
    'notifications',
    'activity_logs',
    'api_audit_log',
    'email_logs',
    'document_requests',
    'file_uploads',
    'team_members',
    'refresh_tokens',
    'password_reset_tokens',
    'password_history',
  ];

  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) continue;
    try {
      const result = await db.prepare(`DELETE FROM ${table}`).run();
      console.log(`[Wipe] DELETE FROM ${table} (${result.changes} rows)`);
    } catch (e: any) {
      if (e.message?.includes('no such table')) {
        console.log(`[Wipe] Skip (not exists): DELETE FROM ${table}`);
      } else {
        console.error(`[Wipe] Failed: DELETE FROM ${table}`, e.message);
      }
    }
  }

  // Level 4 filtered — keep director/hr and Engineering
  const delUsers = await db.prepare("DELETE FROM users WHERE role = 'employee'").run();
  console.log(`[Wipe] Deleted ${delUsers.changes ?? 0} employee user(s)`);

  const delDepts = await db.prepare('DELETE FROM departments WHERE name != ?').run(KEEP_DEPT);
  console.log(`[Wipe] Deleted ${delDepts.changes ?? 0} department(s) (kept ${KEEP_DEPT})`);

  // Level 5 ephemeral
  for (const table of ['token_blacklist', 'rate_limits', 'api_cache']) {
    try {
      await db.prepare(`DELETE FROM ${table}`).run();
      console.log(`[Wipe] DELETE FROM ${table}`);
    } catch (e: any) {
      console.log(`[Wipe] Skip: DELETE FROM ${table}`, e.message);
    }
  }

  // Disk: uploads/
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  const absUpload = path.resolve(uploadDir);
  try {
    if (fs.existsSync(absUpload)) {
      const before = fs.readdirSync(absUpload).length;
      fs.rmSync(absUpload, { recursive: true, force: true });
      fs.mkdirSync(absUpload, { recursive: true });
      console.log(`[Wipe] Cleared uploads/ (${before} entries) at ${absUpload}`);
    } else {
      console.log(`[Wipe] No uploads folder at ${absUpload}`);
    }
  } catch (e: any) {
    console.error('[Wipe] Uploads cleanup failed:', e.message);
  }

  // Verify
  const migrations = (await db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get()) as any;
  const policies = (await db.prepare('SELECT COUNT(*) as c FROM password_policies').get()) as any;
  const retention = (await db.prepare('SELECT COUNT(*) as c FROM file_retention_policies').get()) as any;
  const remainingUsers = (await db.prepare('SELECT role, COUNT(*) as c FROM users GROUP BY role').all()) as any;
  console.log(`[Wipe] Verify — schema_migrations: ${migrations.c}, password_policies: ${policies.c}, file_retention_policies: ${retention.c}`);
  console.log('[Wipe] Remaining users:', remainingUsers);

  console.log('[Wipe] Done — admin login preserved, operational data cleared. 50GB Hostinger: run npm run backup before wipe for safety.');
  process.exit(0);
}

wipe().catch((e) => {
  console.error('[Wipe] Fatal:', e);
  process.exit(1);
});
