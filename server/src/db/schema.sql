-- MySQL schema for HR Management System

CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  manager_id VARCHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone_number VARCHAR(20),
  profile_picture_url TEXT,
  password_hash VARCHAR(255) NOT NULL,
  designation VARCHAR(100),
  joining_date DATE,
  dob DATE,
  gender ENUM('male','female','other'),
  father_name VARCHAR(100),
  nationality VARCHAR(56),
  qualification VARCHAR(100),
  address_street VARCHAR(200),
  address_city VARCHAR(100),
  address_state VARCHAR(100),
  address_pincode VARCHAR(6),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  role VARCHAR(20) NOT NULL DEFAULT 'employee',
  department_id VARCHAR(36),
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME,
  last_login_at DATETIME,
  two_factor_enabled TINYINT NOT NULL DEFAULT 0,
  two_factor_secret VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  user_id VARCHAR(36) NOT NULL,
  team_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, team_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  user_agent TEXT,
  ip_address VARCHAR(45),
  revoked_at DATETIME,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  status VARCHAR(20) NOT NULL,
  login_time DATETIME,
  logout_time DATETIME,
  working_hours DECIMAL(5,2),
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  pause_start_time DATETIME,
  pause_end_time DATETIME,
  pause_minutes DECIMAL(5,2) DEFAULT 0,
  notes TEXT,
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  location_accuracy DECIMAL(10,2),
  location_captured_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance_events (
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
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  progress_percent INT NOT NULL DEFAULT 0,
  due_date DATETIME,
  started_at DATETIME,
  completed_at DATETIME,
  created_by_id VARCHAR(36) NOT NULL,
  department_id VARCHAR(36),
  estimated_hours DECIMAL(5,2),
  actual_hours DECIMAL(5,2),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_assignments (
  task_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_comments (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  author_id VARCHAR(36) NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  uploaded_by_id VARCHAR(36) NOT NULL,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_approvals (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  requested_by_id VARCHAR(36) NOT NULL,
  reviewed_by_id VARCHAR(36),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  request_comment TEXT,
  comment TEXT,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS work_plans (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  planned_work TEXT NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  estimated_hours DECIMAL(5,2),
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  review_comment TEXT,
  reviewed_by_id VARCHAR(36),
  reviewed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS work_reports (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  work_completed_today TEXT NOT NULL,
  current_progress INT NOT NULL DEFAULT 0,
  pending_work TEXT,
  blockers TEXT,
  tomorrow_plan TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  feedback TEXT,
  reviewed_by_id VARCHAR(36),
  reviewed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS leaves (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  deducted_from VARCHAR(20),
  reviewed_by_id VARCHAR(36),
  review_comment TEXT,
  reviewed_at DATETIME,
  extra INT NOT NULL DEFAULT 0,
  leave_year INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  recipient_id VARCHAR(36) NOT NULL,
  sender_id VARCHAR(36),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'info',
  link VARCHAR(255),
  read_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id VARCHAR(36) PRIMARY KEY,
  actor_id VARCHAR(36),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36),
  old_values TEXT,
  new_values TEXT,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS holidays (
  id VARCHAR(36) PRIMARY KEY,
  date DATE NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'public',
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_holidays_date (date),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS holiday_assignees (
  holiday_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (holiday_id, user_id),
  FOREIGN KEY (holiday_id) REFERENCES holidays(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS token_blacklist (
  user_id VARCHAR(36) PRIMARY KEY,
  revoked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  `key` VARCHAR(255) PRIMARY KEY,
  `value` TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
  `key` VARCHAR(255) PRIMARY KEY,
  hits INT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key VARCHAR(255) PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
