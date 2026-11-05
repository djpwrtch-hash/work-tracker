import { Router, Request, Response } from 'express';
import path from 'path';
import db from '../../db/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { createBackup, listBackups } from '../../lib/backup.js';
import securityRoutes from '../security/security.routes.js';

const router = Router();

router.use(authenticate);

// Read-only DB overview. Director + HR.
const ALLOWED_TABLES = new Set([
  'users', 'departments', 'attendance', 'tasks', 'task_assignments',
  'task_comments', 'task_approvals', 'leaves', 'notifications',
  'activity_logs', 'holidays', 'holiday_assignees', 'work_plans',
  'work_reports', 'team_members', 'schema_migrations', 'token_blacklist',
  'refresh_tokens', 'password_reset_tokens', 'app_settings', 'rate_limits',
  'api_cache', 'password_policies', 'password_history', 'api_audit_log',
]);

router.get('/db', requireRole('director', 'hr'), async (_req: Request, res: Response, next) => {
  try {
    const tables = (await db.prepare("SELECT TABLE_NAME as name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME").all() as any[]).map((r) => r.name);
    const tableCounts: any[] = [];
    for (const t of tables) {
      if (ALLOWED_TABLES.has(t)) {
        const row = await db.prepare(`SELECT COUNT(*) c FROM \`${t}\``).get() as any;
        tableCounts.push({ table: t, rows: row.c });
      }
    }
    const version = (await db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as any)?.version ?? 0;
    res.json({
      journalMode: 'MySQL',
      migrationVersion: version,
      tables: tableCounts,
    });
  } catch (err) { next(err); }
});

// Create an on-demand, WAL-safe backup. Director only.
router.post('/backup', requireRole('director'), async (req: Request, res: Response, next) => {
  try {
    const backupPath = await createBackup();
    res.status(201).json({ message: 'Backup created', path: path.basename(backupPath) });
  } catch (err) { next(err); }
});

// List available backups. Director only.
router.get('/backups', requireRole('director'), (_req: Request, res: Response, next) => {
  try {
    res.json({ backups: listBackups() });
  } catch (err) { next(err); }
});

// ── Security Admin API ──
// Mounted at both /api/v1/system/security and /api/v1/security (see app.ts).
router.use('/security', securityRoutes);

export default router;
