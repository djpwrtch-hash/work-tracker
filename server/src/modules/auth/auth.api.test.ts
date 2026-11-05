import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader } from '../../test/helpers.js';

describe('POST /api/v1/auth/login', () => {
  it('logs in with valid credentials and returns an access token', async () => {
    const user = await createUser({ password: 'Password123!' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.email).toBe(user.email);
  });

  it('rejects wrong password with 401 and a generic message', async () => {
    const user = await createUser({ password: 'Password123!' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'WrongPassword123!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('rejects unknown email with the same generic message (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `nobody-${Date.now()}@example.com`, password: 'Password123!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('sends rate-limit headers on the login route', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'y' });
    expect(res.headers['ratelimit-limit']).toBeDefined();
    // login limiter: 15 minute window, max 50 outside production (auth.routes.ts:34-35)
    expect(res.headers['ratelimit-limit']).toBe('50');
    expect(Number(res.headers['ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
  });

  it('throttles brute-force logins with 429', async () => {
    const email = `brute-${Date.now()}@example.com`;
    let lastStatus = 0;
    for (let i = 0; i < 55; i++) {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'WrongPassword123!' });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  }, 60000);
});

describe('auth token refresh', () => {
  it('rotates refresh tokens via cookie', async () => {
    const user = await createUser({ password: 'Password123!' });
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Password123!' });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(Array.isArray(cookies)).toBe(true);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
  });

  it('rejects refresh without a cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(400);
  });
});

describe('protected routes', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/leaves');
    expect(res.status).toBe(401);
  });

  it('accepts a valid Bearer token', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app).get('/api/v1/leaves').set(authHeader(token));
    expect(res.status).toBe(200);
  });
});
