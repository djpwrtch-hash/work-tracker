import { describe, expect, it } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  signPendingAuthToken,
  verifyPendingAuthToken,
} from '../lib/jwt.js';

describe('access tokens', () => {
  it('signs and verifies a token with sub, email and role', () => {
    const token = signAccessToken('user-1', 'a@example.com', 'employee');
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('a@example.com');
    expect(payload.role).toBe('employee');
  });

  it('rejects a tampered token', () => {
    const token = signAccessToken('user-1', 'a@example.com', 'employee');
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('rejects a 2FA pending token as an access token', () => {
    const pending = signPendingAuthToken('user-1', 'a@example.com');
    expect(() => verifyAccessToken(pending)).toThrow();
  });
});

describe('refresh tokens', () => {
  it('signs and verifies with token id', () => {
    const token = signRefreshToken('user-1', 'token-id-1');
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('user-1');
  });

  it('rejects an access token as a refresh token', () => {
    const access = signAccessToken('user-1', 'a@example.com', 'employee');
    expect(() => verifyRefreshToken(access)).toThrow();
  });
});

describe('2FA pending tokens', () => {
  it('verifies a pending token and requires the 2fa step claim', () => {
    const pending = signPendingAuthToken('user-9', 'b@example.com');
    const payload = verifyPendingAuthToken(pending);
    expect(payload.sub).toBe('user-9');
  });

  it('rejects a normal access token as pending', () => {
    const access = signAccessToken('user-9', 'b@example.com', 'employee');
    expect(() => verifyPendingAuthToken(access)).toThrow();
  });
});
