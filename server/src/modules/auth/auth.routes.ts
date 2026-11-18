import { Router, Request, Response } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import rateLimit from 'express-rate-limit';
import { RateLimitStore } from '../../lib/rate-limit-store.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { loginSchema, registerSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema, twoFactorVerifySchema, twoFactorDisableSchema } from './auth.schema.js';
import { AuthService } from './auth.service.js';
import { config } from '../../lib/config.js';
import { createTOTPSecret, buildTOTPUri } from '../../lib/totp.js';

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: config.cookieSameSite,
  secure: config.cookieSecure,
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const ACCESS_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: config.cookieSameSite,
  secure: config.cookieSecure,
  path: '/',
  maxAge: 15 * 60 * 1000,
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.nodeEnv === 'production' ? 20 : 50,
  keyGenerator: (req) => String(req.body?.email ?? '').trim().toLowerCase() || req.ip || 'unknown',
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts for this account. Try again later.' },
  store: new RateLimitStore('login'),
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.nodeEnv === 'production' ? 60 : 200,
  keyGenerator: (req) => req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts. Try again later.' },
  store: new RateLimitStore('refresh'),
});

router.post('/login', validate(loginSchema), loginLimiter, async (req: Request, res: Response, next) => {
  try {
    const result = await AuthService.login(req.body, req.headers['user-agent'], req.ip);
    if ('twoFactorRequired' in result) {
      try { await ActivityLogsService.create(result.user.id, 'login_2fa_pending', 'auth', result.user.id, { email: req.body.email }, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
      return res.json({ twoFactorRequired: true, pendingAuthToken: result.pendingAuthToken, user: result.user });
    }
    try { await ActivityLogsService.create(result.user.id, 'login', 'auth', result.user.id, { email: req.body.email }, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.cookie('accessToken', result.accessToken, ACCESS_COOKIE_OPTS);
    res.cookie('refreshToken', result.refreshToken, COOKIE_OPTS);
    res.json({ user: result.user, accessToken: result.accessToken, passwordExpired: result.passwordExpired });
  } catch (err) { next(err); }
});

router.post('/register', authenticate, requireRole('director'), validate(registerSchema), async (req: Request, res: Response, next) => {
  try {
    const user = await AuthService.register(req.body);
    try { await ActivityLogsService.create(req.user!.sub, 'register', 'auth', user.id, { email: req.body.email, role: user.role }, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.status(201).json(user);
  } catch (err) { next(err); }
});

router.post('/refresh', refreshLimiter, async (req: Request, res: Response, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token is required' });
    const result = await AuthService.refreshToken(refreshToken);
    res.cookie('accessToken', result.accessToken, ACCESS_COOKIE_OPTS);
    res.cookie('refreshToken', result.refreshToken, COOKIE_OPTS);
    res.json({ accessToken: result.accessToken });
  } catch (err) {
    res.clearCookie('refreshToken', { path: '/api/v1/auth', httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
    res.clearCookie('accessToken', { path: '/', httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
    next(err);
  }
});

router.post('/logout', async (req: Request, res: Response, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      try { await AuthService.logout(refreshToken); } catch (e) { /* token already invalid, still clear cookies */ }
    }
    res.clearCookie('refreshToken', { path: '/api/v1/auth', httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
    res.clearCookie('accessToken', { path: '/', httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
    res.json({ message: 'Logged out' });
  } catch (err) { next(err); }
});

router.post('/change-password', authenticate, validate(changePasswordSchema), async (req: Request, res: Response, next) => {
  try {
    await AuthService.changePassword(req.user!.sub, req.body);
    try { await ActivityLogsService.create(req.user!.sub, 'change_password', 'auth', req.user!.sub, undefined, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    const rt = req.cookies?.refreshToken;
    if (rt) await AuthService.logout(rt);
    res.clearCookie('refreshToken', { path: '/api/v1/auth', httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
    res.clearCookie('accessToken', { path: '/', httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
    res.json({ message: 'Password changed' });
  } catch (err) { next(err); }
});

router.get('/me', authenticate, async (req: Request, res: Response, next) => {
  try {
    const user = await AuthService.getMe(req.user!.sub);
    res.json(user);
  } catch (err) { next(err); }
});

// 2FA setup: return a fresh secret + otpauth URI for the authenticator app
router.post('/2fa/setup', authenticate, async (req: Request, res: Response, next) => {
  try {
    const setup = await AuthService.setupTwoFactor(req.user!.sub);
    const secret = setup.secret ?? createTOTPSecret();
    const uri = buildTOTPUri('WorkTracker', setup.email, secret);
    res.json({ secret, uri, qrCodeUrl: uri });
  } catch (err) { next(err); }
});

// 2FA enable: verify an OTP against the provided secret, then store + enable
router.post('/2fa/verify-enable', authenticate, validate(twoFactorVerifySchema), async (req: Request, res: Response, next) => {
  try {
    const result = await AuthService.verifyAndEnableTwoFactor(req.user!.sub, req.body);
    try { await ActivityLogsService.create(req.user!.sub, 'enable_2fa', 'auth', req.user!.sub, undefined, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

// 2FA disable: requires the user's current password
router.post('/2fa/disable', authenticate, validate(twoFactorDisableSchema), async (req: Request, res: Response, next) => {
  try {
    const result = await AuthService.disableTwoFactor(req.user!.sub, req.body.currentPassword);
    try { await ActivityLogsService.create(req.user!.sub, 'disable_2fa', 'auth', req.user!.sub, undefined, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => String(req.body?.email ?? '').trim().toLowerCase() || req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests for this email. Try again later.' },
  store: new RateLimitStore('forgot-password'),
});

router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), async (req: Request, res: Response, next) => {
  try {
    const result = await AuthService.forgotPassword(req.body.email);
    try { await ActivityLogsService.create(null, 'forgot_password', 'auth', undefined, { email: req.body.email }, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Try again later.' },
  store: new RateLimitStore('reset-password'),
});

router.post('/reset-password', resetPasswordLimiter, validate(resetPasswordSchema), async (req: Request, res: Response, next) => {
  try {
    await AuthService.resetPassword(req.body.token, req.body.newPassword);
    res.json({ message: 'Password reset successfully' });
  } catch (err) { next(err); }
});

export default router;
