import dotenv from 'dotenv';
dotenv.config();

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${name}`);
  return v;
}

export function parseCorsOrigins(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return ['http://localhost:42780'];
  return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export type CookieSameSite = 'strict' | 'lax' | 'none';

export function parseCookieSameSite(value: string): CookieSameSite {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'lax' || normalized === 'none' || normalized === 'strict') {
    return normalized;
  }
  return 'strict';
}

const cookieSecure =
  env('COOKIE_SECURE', (process.env.NODE_ENV === 'production').toString()) === 'true';
const cookieSameSite = parseCookieSameSite(env('COOKIE_SAME_SITE', 'strict'));

export const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  port: Number(env('API_PORT', env('PORT', '42780'))),
  corsOrigin: parseCorsOrigins(env('CORS_ORIGIN', 'http://localhost:42780')),
  jwtAccessSecret: env('JWT_ACCESS_SECRET', 'dev-access-secret-change-in-production'),
  jwtRefreshSecret: env('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-production'),
  jwtAccessTtl: env('JWT_ACCESS_TTL', '15m'),
  jwtRefreshTtlDays: Number(env('JWT_REFRESH_TTL_DAYS', '30')),
  maxLoginAttempts: Number(env('MAX_LOGIN_ATTEMPTS', '50')),
  lockoutMinutes: Number(env('LOCKOUT_MINUTES', '15')),
  uploadDir: env('UPLOAD_DIR', 'uploads'),
  // MySQL database configuration
  db: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'hr',
  },
  cookieSecure,
  cookieSameSite,
  // Business timezone used for "today", attendance dates and cron windows.
  timezone: env('APP_TIMEZONE', 'Asia/Kolkata'),
  adminPassword: env('ADMIN_PASSWORD', 'Admin@123456'),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || '587'),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@hr-app.com',
  },
  // Explicit opt-out: EMAIL_ENABLED=false forces no email even if SMTP is set.
  // Default: auto-detect — email only when SMTP host+user are present.
  emailEnabled: process.env.EMAIL_ENABLED != null
    ? process.env.EMAIL_ENABLED === 'true'
    : Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
};

if (config.nodeEnv === 'production') {
  const blockedSecrets = [
    'dev-access-secret-change-in-production',
    'dev-refresh-secret-change-in-production',
    'change_me_access',
    'change_me_refresh',
    'change_me_access_32_chars_min__________________',
    'change_me_refresh_32_chars_min_________________',
    'local-dev-access-secret-32chars-min-abc123XYZ',
    'local-dev-refresh-secret-32chars-min-xyz789ABC',
  ];
  const weakPattern = /change_me|example|32_chars/i;
  const hasWeak = blockedSecrets.includes(config.jwtAccessSecret) || blockedSecrets.includes(config.jwtRefreshSecret) || weakPattern.test(config.jwtAccessSecret) || weakPattern.test(config.jwtRefreshSecret);
  const tooShort = config.jwtAccessSecret.length < 32 || config.jwtRefreshSecret.length < 32;
  if (hasWeak || tooShort) {
    throw new Error('[CONFIG] FATAL: JWT secrets must be unique, at least 32 characters, and not default/example values. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET env vars.');
  }
  if (config.adminPassword === 'Admin@123456' || /change_me/i.test(config.adminPassword)) {
    throw new Error('[CONFIG] FATAL: Admin password must not be the default. Set ADMIN_PASSWORD env var.');
  }
  if (config.adminPassword.length < 12) {
    throw new Error('[CONFIG] FATAL: ADMIN_PASSWORD must be at least 12 characters.');
  }
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim();
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error('[CONFIG] FATAL: ADMIN_EMAIL must be set to a valid email address.');
  }
  if (config.cookieSameSite === 'none' && !config.cookieSecure) {
    throw new Error('[CONFIG] FATAL: COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.');
  }
}

// Fail fast on a bad timezone instead of throwing from a request handler later.
try {
  new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone });
} catch {
  throw new Error(`[CONFIG] FATAL: Invalid APP_TIMEZONE "${config.timezone}". Use an IANA name such as Asia/Kolkata or UTC.`);
}