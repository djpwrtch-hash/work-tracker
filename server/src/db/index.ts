import path from 'path';
import fs from 'fs';
import { db, uuid } from './pool.js';
export * from './pool.js';

// ---- Schema load ----
function findSchema(): string | null {
  const candidates = [
    path.join(process.cwd(), 'src', 'db', 'schema.sql'),
    path.join(process.cwd(), 'server', 'src', 'db', 'schema.sql'),
    path.join(process.cwd(), 'dist', 'src', 'db', 'schema.sql'),
    path.join(process.cwd(), 'dist', 'schema.sql'),
    path.join(process.cwd(), 'release', 'src', 'db', 'schema.sql'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

const schemaPath = findSchema();
if (schemaPath) {
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  try {
    await db.exec(schema);
  } catch (e: any) {
    console.error('[DB] Schema load failed:', e.message);
    if (process.env.NODE_ENV === 'production') throw e;
  }
} else {
  const message = '[DB] schema.sql not found — base tables cannot be created';
  console.warn(message);
  if (process.env.NODE_ENV === 'production') throw new Error(message);
}

async function getAppliedVersions(): Promise<Set<number>> {
  try {
    const rows = (await db.prepare('SELECT version FROM schema_migrations').all()) as any[];
    return new Set(rows.map((r: any) => r.version));
  } catch {
    return new Set();
  }
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(column)) {
    throw new Error(`Invalid table or column name: ${table}.${column}`);
  }
  const rows = (await db.prepare(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`).all(table)) as any[];
  return rows.some((r: any) => r.COLUMN_NAME === column);
}

async function hasIndex(table: string, index: string): Promise<boolean> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(index)) {
    throw new Error(`Invalid table or index name: ${table}.${index}`);
  }
  const rows = (await db.prepare(`SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`).all(table, index)) as any[];
  return rows.length > 0;
}

async function addColumnIfMissing(table: string, column: string, ddl: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(column)) {
    throw new Error(`Invalid table or column name: ${table}.${column}`);
  }
  if (await hasColumn(table, column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

const migrations: Array<{ version: number; name: string; up: () => Promise<void> }> = [
  {
    version: 1,
    name: 'legacy-baseline',
    up: async () => {
      await addColumnIfMissing('attendance', 'pause_start_time', 'pause_start_time DATETIME');
      await addColumnIfMissing('attendance', 'pause_end_time', 'pause_end_time DATETIME');
      await addColumnIfMissing('attendance', 'pause_minutes', 'pause_minutes DECIMAL(5,2) DEFAULT 0');
      await db.exec(`CREATE TABLE IF NOT EXISTS holidays (id VARCHAR(36) PRIMARY KEY, date DATE NOT NULL, name VARCHAR(255) NOT NULL, type VARCHAR(20) NOT NULL DEFAULT 'public', created_by VARCHAR(36) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS holiday_assignees (holiday_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, PRIMARY KEY (holiday_id, user_id), FOREIGN KEY (holiday_id) REFERENCES holidays(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS password_reset_tokens (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, token_hash VARCHAR(255) NOT NULL, expires_at DATETIME NOT NULL, used_at DATETIME, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
      await db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_leaves_dates ON leaves(start_date, end_date)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at)');
      await addColumnIfMissing('task_approvals', 'request_comment', 'request_comment TEXT');
      await db.exec('DROP TABLE IF EXISTS time_entries');
      await db.exec('DROP TABLE IF EXISTS chat_messages');
      await db.exec(`CREATE TABLE IF NOT EXISTS token_blacklist (user_id VARCHAR(36) PRIMARY KEY, revoked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL)`);
      await db.exec("CREATE TABLE IF NOT EXISTS app_settings (`key` VARCHAR(255) PRIMARY KEY, `value` TEXT NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");
      await db.exec("CREATE TABLE IF NOT EXISTS rate_limits (`key` VARCHAR(255) PRIMARY KEY, hits INT NOT NULL DEFAULT 0, expires_at DATETIME NOT NULL)");
      await db.exec('CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at)');
      await addColumnIfMissing('team_members', 'role', "role VARCHAR(20) NOT NULL DEFAULT 'member'");
      await db.exec("UPDATE users SET role = 'director' WHERE role = 'admin'");
      await db.exec("UPDATE activity_logs SET entity_type = 'director' WHERE entity_type = 'admin'");
      await db.exec('CREATE INDEX IF NOT EXISTS idx_work_plans_user ON work_plans(user_id)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_work_plans_user_date ON work_plans(user_id, date)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_work_reports_user ON work_reports(user_id)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_work_reports_user_date ON work_reports(user_id, date)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department_id)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_task_approvals_task ON task_approvals(task_id)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_team_members_team_name ON team_members(team_name)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash)');
      await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id)');
      await db.exec(`CREATE TABLE IF NOT EXISTS api_cache (cache_key VARCHAR(255) PRIMARY KEY, data TEXT NOT NULL, expires_at DATETIME NOT NULL)`);
      await db.exec('CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at)');
      await addColumnIfMissing('leaves', 'deducted_from', 'deducted_from VARCHAR(20)');
      await addColumnIfMissing('attendance', 'latitude', 'latitude DECIMAL(10,7)');
      await addColumnIfMissing('attendance', 'longitude', 'longitude DECIMAL(10,7)');
      await addColumnIfMissing('attendance', 'location_accuracy', 'location_accuracy DECIMAL(10,2)');
      await addColumnIfMissing('attendance', 'location_captured_at', 'location_captured_at DATETIME');
    },
  },
  {
    version: 2,
    name: 'attendance-working-hours-recompute',
    up: async () => {
      await db.exec(`
        UPDATE attendance SET
          working_hours = GREATEST(0, ROUND((TIMESTAMPDIFF(MINUTE, login_time, logout_time)/60.0 - COALESCE(pause_minutes, 0) / 60.0), 2)),
          overtime_hours = GREATEST(0, ROUND(GREATEST(0, ROUND((TIMESTAMPDIFF(MINUTE, login_time, logout_time)/60.0 - COALESCE(pause_minutes, 0) / 60.0), 2)) - 8, 2))
        WHERE logout_time IS NOT NULL AND login_time IS NOT NULL
      `);
    },
  },
  {
    version: 3,
    name: 'composite-indexes',
    up: async () => {
      await db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_user_date_status ON attendance(user_id, date, status)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_date_status ON attendance(date, status)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_created ON activity_logs(actor_id, created_at)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_leaves_user_dates ON leaves(user_id, start_date, end_date)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_holidays_date_id ON holidays(date, id)');
    },
  },
  {
    version: 4,
    name: 'performance-indexes',
    up: async () => {
      await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by_id)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_holidays_created_by ON holidays(created_by)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_leaves_status_dates ON leaves(status, start_date, end_date)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications(recipient_id, created_at DESC)');
    },
  },
  {
    version: 5,
    name: 'holidays-updated-at',
    up: async () => {
      await addColumnIfMissing('holidays', 'updated_at', "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    },
  },
  {
    version: 6,
    name: 'leave-extra-carryover-and-attendance-events',
    up: async () => {
      await addColumnIfMissing('leaves', 'extra', 'extra INT NOT NULL DEFAULT 0');
      await addColumnIfMissing('leaves', 'leave_year', 'leave_year INT');
      await db.exec(`CREATE TABLE IF NOT EXISTS attendance_events (
        id VARCHAR(36) PRIMARY KEY,
        attendance_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        event_type VARCHAR(20) NOT NULL,
        occurred_at DATETIME NOT NULL,
        latitude DECIMAL(10,7),
        longitude DECIMAL(10,7),
        location_accuracy DECIMAL(10,2),
        location_captured_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (attendance_id) REFERENCES attendance(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
      await db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_events_att ON attendance_events(attendance_id, occurred_at)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_events_user ON attendance_events(user_id, occurred_at)');
      await db.exec(`UPDATE leaves SET leave_year = YEAR(start_date) WHERE leave_year IS NULL`);
    },
  },
  {
    version: 7,
    name: 'rename-paid-to-proposal-16',
    up: async () => {
      await db.exec(`UPDATE leaves SET type = 'proposal' WHERE type = 'paid'`);
      await db.exec(`UPDATE leaves SET deducted_from = 'proposal' WHERE deducted_from = 'paid'`);
      try { await db.exec(`UPDATE attendance SET notes = REPLACE(notes, 'paid leave', 'proposal leave') WHERE notes LIKE '%paid leave%'`); } catch (e) { console.error('[DB] Migration error:', e); }
    },
  },
  {
    version: 8,
    name: 'extended-user-profile-dob-gender-address',
    up: async () => {
      await addColumnIfMissing('users', 'dob', 'dob DATE');
      await addColumnIfMissing('users', 'gender', 'gender VARCHAR(10)');
      await addColumnIfMissing('users', 'father_name', 'father_name VARCHAR(100)');
      await addColumnIfMissing('users', 'nationality', 'nationality VARCHAR(56)');
      await addColumnIfMissing('users', 'qualification', 'qualification VARCHAR(100)');
      await addColumnIfMissing('users', 'address_street', 'address_street VARCHAR(200)');
      await addColumnIfMissing('users', 'address_city', 'address_city VARCHAR(100)');
      await addColumnIfMissing('users', 'address_state', 'address_state VARCHAR(100)');
      await addColumnIfMissing('users', 'address_pincode', 'address_pincode VARCHAR(6)');
    },
  },
  {
    version: 9,
    name: 'document-requests',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS document_requests (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          requested_by_id VARCHAR(36) NOT NULL,
          doc_type VARCHAR(50) NOT NULL,
          note TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          reject_reason TEXT,
          fields TEXT,
          doc_number VARCHAR(255) UNIQUE,
          issued_by_id VARCHAR(36),
          issued_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (requested_by_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (issued_by_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_document_requests_user ON document_requests(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_document_requests_status ON document_requests(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_document_requests_type ON document_requests(doc_type);
      `);
    },
  },
  {
    version: 10,
    name: 'report-templates-and-scheduled-reports',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS report_templates (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          type VARCHAR(20) NOT NULL DEFAULT 'daily',
          fields TEXT,
          is_default TINYINT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_report_templates_user ON report_templates(user_id);

        CREATE TABLE IF NOT EXISTS scheduled_reports (
          id VARCHAR(36) PRIMARY KEY,
          template_id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          recipients TEXT,
          schedule_cron VARCHAR(100) NOT NULL,
          format VARCHAR(10) NOT NULL DEFAULT 'pdf',
          is_active TINYINT NOT NULL DEFAULT 1,
          last_run_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (template_id) REFERENCES report_templates(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_reports_user ON scheduled_reports(user_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_reports_template ON scheduled_reports(template_id);

        CREATE TABLE IF NOT EXISTS scheduled_report_results (
          id VARCHAR(36) PRIMARY KEY,
          schedule_id VARCHAR(36) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          file_path VARCHAR(255),
          error_message TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (schedule_id) REFERENCES scheduled_reports(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_report_results_schedule ON scheduled_report_results(schedule_id);
      `);
    },
  },
  {
    version: 11,
    name: 'email-logs-and-notification-channels',
    up: async () => {
      await addColumnIfMissing('notifications', 'channel', "channel VARCHAR(20) NOT NULL DEFAULT 'in_app'");
      await db.exec(`
        CREATE TABLE IF NOT EXISTS email_logs (
          id VARCHAR(36) PRIMARY KEY,
          recipient_id VARCHAR(36),
          recipient_email VARCHAR(255) NOT NULL,
          subject VARCHAR(255) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'sent',
          error_message TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_id);
        CREATE INDEX IF NOT EXISTS idx_email_logs_created ON email_logs(created_at DESC);
      `);
    },
  },
  {
    version: 12,
    name: 'file-uploads',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS file_uploads (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          original_name VARCHAR(255) NOT NULL,
          storage_key VARCHAR(255) NOT NULL,
          mime_type VARCHAR(100) NOT NULL,
          size_bytes INT NOT NULL,
          url VARCHAR(512) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS file_retention_policies (
          id VARCHAR(36) PRIMARY KEY,
          mime_pattern VARCHAR(100) NOT NULL,
          retention_days INT NOT NULL DEFAULT 365,
          max_size_bytes INT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_file_uploads_user ON file_uploads(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_file_uploads_mime ON file_uploads(mime_type);
      `);
      await db.prepare(
        "INSERT INTO file_retention_policies (id, mime_pattern, retention_days) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)"
      ).run('1', 'image/*', 365, '2', 'application/pdf', 730, '3', 'text/*', 365, '4', '*', 180);
    },
  },
  {
    version: 13,
    name: 'security-hardening',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS password_policies (
          id VARCHAR(36) PRIMARY KEY,
          min_length INT NOT NULL DEFAULT 12,
          require_uppercase TINYINT NOT NULL DEFAULT 1,
          require_lowercase TINYINT NOT NULL DEFAULT 1,
          require_number TINYINT NOT NULL DEFAULT 1,
          require_special TINYINT NOT NULL DEFAULT 1,
          max_age_days INT NOT NULL DEFAULT 90,
          history_count INT NOT NULL DEFAULT 5,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS password_history (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS api_audit_log (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36),
          method VARCHAR(10) NOT NULL,
          path VARCHAR(255) NOT NULL,
          status_code INT,
          ip_address VARCHAR(45),
          user_agent VARCHAR(255),
          request_size INT,
          response_time_ms INT,
          error_message TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_api_audit_log_user ON api_audit_log(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_api_audit_log_path ON api_audit_log(path, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_api_audit_log_created ON api_audit_log(created_at);
      `);
      const existing = await db.prepare('SELECT id FROM password_policies LIMIT 1').get() as any;
      if (!existing) {
        const id = uuid();
        await db.prepare(
          "INSERT INTO password_policies (id, min_length, require_uppercase, require_lowercase, require_number, require_special, max_age_days, history_count) VALUES (?, 12, 1, 1, 1, 1, 90, 5)"
        ).run(id);
      }
    },
  },
  {
    version: 14,
    name: 'task-assignments-user-index',
    up: async () => {
      await db.exec('CREATE INDEX IF NOT EXISTS idx_task_assignments_user ON task_assignments(user_id)');
    },
  },
  {
    version: 15,
    name: 'scheduled-report-results-result-data',
    up: async () => {
      await addColumnIfMissing('scheduled_report_results', 'result_data', "result_data TEXT");
    },
  },
  {
    version: 16,
    name: 'leave-carryforwards-table',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS leave_carryforwards (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          year INT NOT NULL,
          prev_year INT NOT NULL,
          proposal_carryforward INT NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_user_year (user_id, year)
        );
        CREATE INDEX IF NOT EXISTS idx_leave_carryforwards_user ON leave_carryforwards(user_id, year);
      `);
    },
  },
  {
    version: 17,
    name: 'monthly-overtime-table',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS monthly_overtime (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          year INT NOT NULL,
          month INT NOT NULL,
          standard_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
          actual_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
          overtime_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_user_month (user_id, year, month)
        );
        CREATE INDEX IF NOT EXISTS idx_monthly_overtime_user ON monthly_overtime(user_id, year, month);
      `);
    },
  },
  {
    version: 18,
    name: 'holidays-unique-date-constraint',
    up: async () => {
      if (await hasIndex('holidays', 'uk_holidays_date')) return;
      const duplicate = await db.prepare('SELECT date, COUNT(*) AS count FROM holidays GROUP BY date HAVING count > 1 LIMIT 1').get() as any;
      if (duplicate) {
        throw new Error(`Cannot add unique holiday date constraint: duplicate holiday date ${duplicate.date}`);
      }
      await db.exec('ALTER TABLE holidays ADD UNIQUE KEY uk_holidays_date (date)');
    },
  },
  {
    version: 19,
    name: 'audit-log-preserve-deleted-users',
    up: async () => {
      const fk = await db.prepare(
        `SELECT CONSTRAINT_NAME AS name
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'api_audit_log'
           AND COLUMN_NAME = 'user_id'
           AND REFERENCED_TABLE_NAME = 'users'
         LIMIT 1`
      ).get() as any;
      if (!fk?.name) return;
      if (!/^[A-Za-z0-9_]+$/.test(fk.name)) {
        throw new Error(`Unsafe audit log foreign key name: ${fk.name}`);
      }
      await db.exec(`ALTER TABLE api_audit_log DROP FOREIGN KEY \`${fk.name}\``);
    },
  },
  {
    version: 20,
    name: 'roles-master',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS roles (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(50) UNIQUE NOT NULL,
          description VARCHAR(255),
          access_level ENUM('director','hr','employee') NOT NULL DEFAULT 'employee',
          is_system TINYINT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      const systemRoles = [
        { name: 'director', description: 'Full administrative access', accessLevel: 'director' },
        { name: 'hr', description: 'Human resources access', accessLevel: 'hr' },
        { name: 'employee', description: 'Standard employee access', accessLevel: 'employee' },
      ];
      for (const role of systemRoles) {
        await db.prepare(
          `INSERT INTO roles (id, name, description, access_level, is_system)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE access_level = VALUES(access_level), is_system = 1`
        ).run(uuid(), role.name, role.description, role.accessLevel);
      }

      // Normalise legacy role values so the foreign key below cannot fail on dirty data.
      await db.exec("UPDATE users SET role = 'employee' WHERE role IS NULL OR role = ''");
      await db.exec('UPDATE users SET role = TRIM(role)');

      // Backfill any legacy/custom role names already present on users so the FK below can be added.
      const legacyRoles = await db.prepare('SELECT DISTINCT role FROM users WHERE role IS NOT NULL AND role <> \'\'').all() as any[];
      for (const row of legacyRoles) {
        const name = String(row.role);
        const accessLevel = name === 'director' ? 'director' : name === 'hr' ? 'hr' : 'employee';
        await db.prepare(
          `INSERT INTO roles (id, name, description, access_level, is_system)
           VALUES (?, ?, NULL, ?, 0)
           ON DUPLICATE KEY UPDATE name = VALUES(name)`
        ).run(uuid(), name, accessLevel);
      }

      await db.exec("ALTER TABLE users MODIFY role VARCHAR(50) NOT NULL DEFAULT 'employee'");

      if (!(await hasIndex('users', 'idx_users_role'))) {
        await db.exec('CREATE INDEX idx_users_role ON users(role)');
      }

      const fk = await db.prepare(
        `SELECT CONSTRAINT_NAME AS name
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'users'
           AND COLUMN_NAME = 'role'
           AND REFERENCED_TABLE_NAME = 'roles'
         LIMIT 1`
      ).get() as any;
      if (!fk?.name) {
        await db.exec('ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles(name) ON UPDATE CASCADE ON DELETE RESTRICT');
      }
    },
  },
  {
    version: 21,
    name: 'must-change-password',
    up: async () => {
      await addColumnIfMissing('users', 'must_change_password', 'must_change_password TINYINT NOT NULL DEFAULT 0');
    },
  },
  {
    version: 22,
    name: 'correction-requests',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS attendance_correction_requests (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          attendance_id VARCHAR(36),
          reason VARCHAR(500),
          status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
          requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_by_id VARCHAR(36),
          reviewed_at DATETIME,
          review_comment VARCHAR(500),
          INDEX idx_acr_user_status (user_id, status),
          INDEX idx_acr_status (status)
        )
      `);
    },
  },
  {
    version: 23,
    name: 'extra-work',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS attendance_extra_work (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          date DATE NOT NULL,
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          hours DECIMAL(10,2) NOT NULL DEFAULT 0,
          notes VARCHAR(500),
          accepted TINYINT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_aew_user_date (user_id, date)
        )
      `);
    },
  },
  {
    version: 24,
    name: 'work-plan-items',
    up: async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS work_plan_items (
          id VARCHAR(36) PRIMARY KEY,
          plan_id VARCHAR(36) NOT NULL,
          point_number INT NOT NULL,
          item_text TEXT NOT NULL,
          priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
          estimated_days DECIMAL(5,1),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_wpi_plan_point (plan_id, point_number),
          FOREIGN KEY (plan_id) REFERENCES work_plans(id) ON DELETE CASCADE
        )
      `);

      // Backfill items from the existing planned_work text so legacy plans keep their content.
      const plans = await db.prepare('SELECT id, planned_work, priority FROM work_plans').all() as any[];
      for (const p of plans) {
        const text = String(p.planned_work ?? '').trim();
        if (!text) continue;
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          await db.prepare(
            'INSERT INTO work_plan_items (id, plan_id, point_number, item_text, priority, estimated_days) VALUES (?, ?, ?, ?, ?, NULL)'
          ).run(uuid(), p.id, i + 1, lines[i]!, p.priority ?? 'medium');
        }
      }
    },
  },
  {
    version: 25,
    name: 'work-plan-items-hours',
    up: async () => {
      await addColumnIfMissing('work_plan_items', 'estimated_hours', 'estimated_hours DECIMAL(5,2) NULL AFTER estimated_days');
    },
  },
  {
    version: 26,
    name: 'auto-submit-legacy-drafts',
    up: async () => {
      // Legacy plans/reports created before auto-submit-on-create are 'draft' and
      // are hidden from HR/director by default. Flip them to 'submitted' so they surface.
      await db.exec("UPDATE work_plans SET status = 'submitted', updated_at = NOW() WHERE status = 'draft'");
      await db.exec("UPDATE work_reports SET status = 'submitted', updated_at = NOW() WHERE status = 'draft'");
    },
  },
];

await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const appliedVersions = await getAppliedVersions();
for (const m of migrations) {
  if (appliedVersions.has(m.version)) continue;
  try {
    await m.up();
    await db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    console.log(`[DB] Applied migration ${m.version}: ${m.name}`);
  } catch (e: any) {
    // A failed migration is deliberately NOT recorded, so it is retried (and stays
    // visible as failing) on the next start instead of being silently marked done.
    console.error(`[DB] Migration ${m.version} (${m.name}) FAILED:`, e.message);
    if (process.env.NODE_ENV === 'production') throw e;
  }
}

export default db;
