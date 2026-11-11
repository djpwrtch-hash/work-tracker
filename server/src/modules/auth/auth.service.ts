import bcrypt from 'bcrypt';
import crypto from 'crypto';
import db, { uuid } from '../../db/index.js';
import { config } from '../../lib/config.js';
import { signAccessToken, signRefreshToken, signPendingAuthToken, verifyPendingAuthToken, verifyRefreshToken } from '../../lib/jwt.js';
import type { RegisterInput } from './auth.schema.js';
import { hashToken, verifyTokenHash } from '../../lib/crypto.js';
import { revokeUserTokens } from '../../lib/blacklist.js';
import { parseUTC } from '../../lib/time.js';
import { nextEmployeeId } from '../users/users.service.js';
import { AppError } from '../../lib/app-error.js';
import { bcryptBreaker } from '../../lib/circuit-breaker.js';
import { sendPasswordResetEmail, isEmailConfigured, sendSecurityAlertEmail } from '../../lib/email.js';
import { verifyTOTP } from '../../lib/totp.js';
import { getPasswordPolicy, validatePassword, checkPasswordHistory, recordPassword, isPasswordExpired } from '../../lib/password-policy.js';
import { RateLimitStore } from '../../lib/rate-limit-store.js';
import { getRoleAccessLevel } from '../../lib/roles.js';

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = config.maxLoginAttempts;
const LOCKOUT_MINUTES = config.lockoutMinutes;
const IP_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const PROGRESSIVE_DELAY_THRESHOLD = 3;
const PROGRESSIVE_DELAY_MS = 1000;
const SECURITY_ALERT_THRESHOLD = 3;

// DB-backed so login throttling survives restarts and is shared across replicas.
const ipLimiter = new RateLimitStore('login:ip');
const emailLimiter = new RateLimitStore('login:email');
ipLimiter.init({ windowMs: IP_WINDOW_MS });
emailLimiter.init({ windowMs: EMAIL_WINDOW_MS });

export class AuthService {
  static async login(input: { email: string; password: string; pendingAuthToken?: string; twoFactorCode?: string }, userAgent?: string, ip?: string) {
    const email = input.email.toLowerCase().trim();

    // Rate limit by IP (fixed 15-minute window, stored in MySQL)
    const ipKey = ip ?? 'unknown';
    const ipResult = await ipLimiter.increment(ipKey);
    if (ipResult.totalHits > MAX_LOGIN_ATTEMPTS) {
      const retryAfterMs = Math.max(0, (ipResult.resetTime?.getTime() ?? Date.now()) - Date.now());
      throw new AppError(429, `Too many login attempts from this IP. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds`);
    }

    // Rate limit by email (fixed 15-minute window, stored in MySQL)
    const emailKey = email;
    const emailResult = await emailLimiter.increment(emailKey);
    if (emailResult.totalHits > MAX_LOGIN_ATTEMPTS) {
      const retryAfterMs = Math.max(0, (emailResult.resetTime?.getTime() ?? Date.now()) - Date.now());
      throw new AppError(429, `Too many login attempts for this account. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds`);
    }

    // Progressive delay after threshold
    if (emailResult.totalHits > PROGRESSIVE_DELAY_THRESHOLD) {
      const delayMs = (emailResult.totalHits - PROGRESSIVE_DELAY_THRESHOLD) * PROGRESSIVE_DELAY_MS;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const user = await db.prepare('SELECT id, email, password_hash, role, status, employee_id, first_name, last_name, designation, department_id, phone_number, joining_date, profile_picture_url, failed_login_attempts, locked_until, two_factor_enabled, two_factor_secret FROM users WHERE email = ?').get(email) as any;
    if (!user) throw new AppError(401, 'Invalid credentials');
    if (user.status !== 'active') throw new AppError(401, 'Invalid credentials');
    user.access_level = await getRoleAccessLevel(user.role);
    if (user.locked_until && parseUTC(user.locked_until) > new Date()) {
      // Uniform response to avoid revealing that the account exists / is locked.
      throw new AppError(401, 'Invalid credentials');
    }

    if (user.two_factor_enabled) {
      return AuthService.handleTwoFactorLogin(user, input, userAgent, ip);
    }

    const passwordValid = await bcryptBreaker.call(() => bcrypt.compare(input.password, user.password_hash));
    if (!passwordValid) {
      await AuthService.recordFailedAttempt(user, email, ip);
      throw new AppError(401, 'Invalid credentials');
    }

    // Reset rate limiters on success
    await emailLimiter.resetKey(emailKey);
    await ipLimiter.resetKey(ipKey);

    return AuthService.issueSession(user, userAgent, ip);
  }

  private static async handleTwoFactorLogin(user: any, input: { email: string; password: string; pendingAuthToken?: string; twoFactorCode?: string }, userAgent?: string, ip?: string) {
    const code = input.twoFactorCode?.trim();
    const pendingToken = input.pendingAuthToken;

    if (code && pendingToken) {
      let payload;
      try { payload = verifyPendingAuthToken(pendingToken); } catch { throw new AppError(401, 'Invalid or expired 2FA session'); }
      if (payload.sub !== user.id) throw new AppError(401, 'Invalid 2FA session');

      const valid = await verifyTOTP({ secret: user.two_factor_secret, token: code });
      if (!valid) {
        await AuthService.recordFailedAttempt(user, input.email, ip);
        throw new AppError(401, 'Invalid two-factor code');
      }

      const emailKey = input.email.toLowerCase().trim();
      await emailLimiter.resetKey(emailKey);
      const ipKey = ip || 'unknown';
      await ipLimiter.resetKey(ipKey);

      return AuthService.issueSession(user, userAgent, ip);
    }

    const passwordValid = await bcryptBreaker.call(() => bcrypt.compare(input.password, user.password_hash));
    if (!passwordValid) {
      await AuthService.recordFailedAttempt(user, input.email, ip);
      throw new AppError(401, 'Invalid credentials');
    }

    return {
      twoFactorRequired: true,
      pendingAuthToken: signPendingAuthToken(user.id, user.email),
      user: AuthService.publicUser(user),
    };
  }

  private static async recordFailedAttempt(user: any, email: string, ip?: string) {
    // Send security alert after threshold
    if (user.failed_login_attempts + 1 >= SECURITY_ALERT_THRESHOLD) {
      const emailAttempts = await emailLimiter.getHits(email.toLowerCase().trim());
      if (emailAttempts >= SECURITY_ALERT_THRESHOLD) {
        sendSecurityAlertEmail((user.email as string) ?? email, ip).catch(e => console.error('[AUTH] Security alert email failed:', e));
      }
    }

    // Atomic increment to avoid TOCTOU race condition
    if (user.failed_login_attempts + 1 >= MAX_LOGIN_ATTEMPTS) {
      await db.prepare("UPDATE users SET failed_login_attempts = failed_login_attempts + 1, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?")
        .run(LOCKOUT_MINUTES, user.id);
    } else {
      await db.prepare('UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = ?').run(user.id);
    }
  }

  private static publicUser(user: any) {
    return {
      id: user.id, employeeId: user.employee_id, firstName: user.first_name, lastName: user.last_name,
      email: user.email, role: user.role, accessLevel: user.access_level ?? 'employee',
      departmentId: user.department_id, designation: user.designation,
      status: user.status, phoneNumber: user.phone_number, joiningDate: user.joining_date,
      profilePictureUrl: user.profile_picture_url, twoFactorEnabled: !!user.two_factor_enabled,
    };
  }

  private static async issueSession(user: any, userAgent?: string, ip?: string) {
    return await db.transaction(async () => {
      await db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?").run(user.id);

      const tokenId = uuid();
      const rawRefresh = signRefreshToken(user.id, tokenId);
      const tokenHash = hashToken(rawRefresh);
      await db.prepare(`INSERT INTO refresh_tokens (id, user_id, token_hash, user_agent, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`)
        .run(tokenId, user.id, tokenHash, userAgent ?? null, ip ?? null, config.jwtRefreshTtlDays);

      const accessToken = signAccessToken(user.id, user.email, user.role);

      const passwordExpired = await isPasswordExpired(user.id);

      return {
        user: AuthService.publicUser(user),
        accessToken,
        refreshToken: rawRefresh,
        passwordExpired,
      };
    })();
  }

  static async setupTwoFactor(userId: string) {
    const user = await db.prepare('SELECT id, email, two_factor_enabled, two_factor_secret FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new AppError(404, 'User not found');
    if (user.two_factor_enabled) throw new AppError(409, 'Two-factor authentication is already enabled');

    return { secret: user.two_factor_secret ?? null, email: user.email };
  }

  static async verifyAndEnableTwoFactor(userId: string, input: { secret: string; code: string }) {
    const user = await db.prepare('SELECT id, two_factor_enabled FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new AppError(404, 'User not found');
    if (user.two_factor_enabled) throw new AppError(409, 'Two-factor authentication is already enabled');

    const valid = await verifyTOTP({ secret: input.secret, token: input.code?.trim() });
    if (!valid) throw new AppError(400, 'Invalid verification code');

    await db.prepare('UPDATE users SET two_factor_enabled = 1, two_factor_secret = ? WHERE id = ?').run(input.secret, userId);
    await revokeUserTokens(userId);
    return { enabled: true };
  }

  static async disableTwoFactor(userId: string, currentPassword: string) {
    const user = await db.prepare('SELECT id, password_hash, two_factor_enabled FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new AppError(404, 'User not found');
    if (!user.two_factor_enabled) throw new AppError(409, 'Two-factor authentication is not enabled');

    if (!await bcryptBreaker.call(() => bcrypt.compare(currentPassword, user.password_hash))) {
      throw new AppError(401, 'Current password is incorrect');
    }

    await db.prepare("UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, updated_at = NOW() WHERE id = ?").run(userId);
    return { enabled: false };
  }

  static async register(input: RegisterInput) {
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(input.email);
    if (existing) throw new AppError(409, 'Email already registered');

    const policy = await getPasswordPolicy();
    const { valid, errors } = await validatePassword(input.password, policy);
    if (!valid) {
      throw new AppError(400, `Password does not meet policy: ${errors.join('; ')}`);
    }

    const id = uuid();
    const passwordHash = await bcryptBreaker.call(() => bcrypt.hash(input.password, SALT_ROUNDS));

    const employeeId = await db.transaction(async () => {
      const empId = await nextEmployeeId();
      await db.prepare(`INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash, phone_number, department_id, designation, joining_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, empId, input.firstName, input.lastName, input.email, passwordHash, input.phoneNumber ?? null, input.departmentId ?? null, input.designation ?? null, input.joiningDate ?? null);
      return empId;
    })();

    await recordPassword(id, passwordHash);

    return { id, employeeId, firstName: input.firstName, lastName: input.lastName, email: input.email, role: 'employee', accessLevel: 'employee' };
  }

  static async refreshToken(rawToken: string) {
    let payload;
    try { payload = verifyRefreshToken(rawToken); } catch { throw new AppError(401, 'Invalid refresh token'); }

    const stored = await db.prepare('SELECT * FROM refresh_tokens WHERE user_id = ? AND id = ?').get(payload.sub, payload.tokenId) as any;
    if (!stored) throw new AppError(401, 'Refresh token revoked');
    if (stored.revoked_at && parseUTC(stored.revoked_at) <= new Date()) {
      // Replay of an already-revoked token: revoke every session for this user.
      await db.transaction(async () => {
        await revokeUserTokens(payload.sub);
await db.prepare("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ?").run(payload.sub);
      })();
      throw new AppError(401, 'Refresh token revoked');
    }
    if (parseUTC(stored.expires_at) < new Date()) throw new AppError(401, 'Refresh token expired');
    if (!verifyTokenHash(rawToken, stored.token_hash)) throw new AppError(401, 'Token mismatch');

    return await db.transaction(async () => {
      // Atomically check and revoke inside transaction to prevent TOCTOU race
      const current = await db.prepare('SELECT revoked_at FROM refresh_tokens WHERE id = ? FOR UPDATE').get(stored.id) as any;
      if (current?.revoked_at) throw new AppError(401, 'Refresh token already used');

      await db.prepare("UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?").run(stored.id);

      const newTokenId = uuid();
      const newRawRefresh = signRefreshToken(payload.sub, newTokenId);
      const newHash = hashToken(newRawRefresh);
      await db.prepare(`INSERT INTO refresh_tokens (id, user_id, token_hash, user_agent, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`)
        .run(newTokenId, payload.sub, newHash, stored.user_agent, stored.ip_address, config.jwtRefreshTtlDays);

      const user = await db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').get(payload.sub) as any;
      if (!user) throw new AppError(401, 'User not found');
      if (user.status !== 'active') throw new AppError(403, 'Account is not active');

      return { accessToken: signAccessToken(user.id, user.email, user.role), refreshToken: newRawRefresh };
    })();
  }

  static async logout(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    await revokeUserTokens(payload.sub);
    await db.prepare("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ?").run(payload.sub);
  }

  static async changePassword(userId: string, input: { currentPassword: string; newPassword: string }) {
    const user = await db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new AppError(404, 'User not found');
    if (!await bcryptBreaker.call(() => bcrypt.compare(input.currentPassword, user.password_hash))) throw new AppError(400, 'Current password is incorrect');

    const policy = await getPasswordPolicy();
    const { valid, errors } = await validatePassword(input.newPassword, policy);
    if (!valid) {
      throw new AppError(400, `Password does not meet policy: ${errors.join('; ')}`);
    }

    const newHash = await bcryptBreaker.call(() => bcrypt.hash(input.newPassword, SALT_ROUNDS));

    const historyValid = await checkPasswordHistory(userId, input.newPassword, policy);
    if (!historyValid) {
      throw new AppError(400, `New password cannot be one of your last ${policy.historyCount} passwords`);
    }

    await db.transaction(async () => {
      await db.prepare("UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = ?").run(newHash, userId);
      await recordPassword(userId, newHash);
      await revokeUserTokens(userId);
      await db.prepare("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ?").run(userId);
    })();
  }

  static async getMe(userId: string) {
    const user = await db.prepare('SELECT id, employee_id, first_name, last_name, email, role, department_id, designation, joining_date, status, phone_number, profile_picture_url, two_factor_enabled FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new AppError(404, 'User not found');
    return {
      id: user.id, employeeId: user.employee_id, firstName: user.first_name, lastName: user.last_name,
      email: user.email, role: user.role, accessLevel: await getRoleAccessLevel(user.role),
      departmentId: user.department_id, designation: user.designation,
      joiningDate: user.joining_date, status: user.status, phoneNumber: user.phone_number, profilePictureUrl: user.profile_picture_url,
      twoFactorEnabled: !!user.two_factor_enabled,
    };
  }

  static async forgotPassword(email: string) {
    const user = await db.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as any;
    if (!user) return { message: 'If the email exists, a reset token has been generated.' };

    const mailEnabled = isEmailConfigured();

    // Fail-safe: in production, never create a reset token we cannot deliver.
    // Return a generic message and warn operators so the gap is visible.
    if (!mailEnabled) {
      if (config.nodeEnv === 'production') {
        console.warn('[RESET] Password reset requested but SMTP is not configured. No reset token was issued.');
        return { message: 'If the email exists, a reset token has been generated.' };
      }
      // In development, fall through and log the reset link to the console.
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const id = uuid();

    await db.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`)
      .run(id, user.id, tokenHash);

    const sent = await sendPasswordResetEmail(user.email, rawToken);
    if (!sent) {
      if (config.nodeEnv !== 'production') {
        const base = process.env.APP_URL ?? 'http://localhost:42780';
        console.log(`[RESET] Dev-only password reset link for ${user.email}: ${base}/reset-password?token=${rawToken}`);
      } else {
        await db.prepare('DELETE FROM password_reset_tokens WHERE id = ?').run(id);
      }
    }

    return { message: 'If the email exists, a reset token has been generated.' };
  }

  static async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()").get(tokenHash) as any;
    if (!row) throw new AppError(400, 'Invalid or expired reset token');

    const policy = await getPasswordPolicy();
    const { valid, errors } = await validatePassword(newPassword, policy);
    if (!valid) {
      throw new AppError(400, `Password does not meet policy: ${errors.join('; ')}`);
    }

    const passwordHash = await bcryptBreaker.call(() => bcrypt.hash(newPassword, 12));

    const historyValid = await checkPasswordHistory(row.user_id, newPassword, policy);
    if (!historyValid) {
      throw new AppError(400, `New password cannot be one of your last ${policy.historyCount} passwords`);
    }

    await db.transaction(async () => {
      await db.prepare("UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = ?").run(passwordHash, row.user_id);
      await recordPassword(row.user_id, passwordHash);
      await db.prepare("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?").run(row.id);
      await db.prepare("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ?").run(row.user_id);
      await revokeUserTokens(row.user_id);
    })();
  }
}
