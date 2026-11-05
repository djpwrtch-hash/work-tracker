import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader, futureDate } from '../../test/helpers.js';

describe('leaves cancel matrix', () => {
  it('employee cancels own pending leave', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const created = await request(app)
      .post('/api/v1/leaves')
      .set(authHeader(token))
      .send({ type: 'casual', startDate: futureDate(30), endDate: futureDate(32), reason: 'test' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');

    const cancelled = await request(app).post(`/api/v1/leaves/${created.body.id}/cancel`).set(authHeader(token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('employee cannot cancel an approved leave (409)', async () => {
    const user = await createUser({ password: 'Password123!' });
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const { token: dirToken } = await loginAs(director.email, 'Password123!');

    const created = await request(app)
      .post('/api/v1/leaves')
      .set(authHeader(token))
      .send({ type: 'casual', startDate: futureDate(40), endDate: futureDate(42), reason: 'test' });
    expect(created.status).toBe(201);

    const reviewed = await request(app)
      .post(`/api/v1/leaves/${created.body.id}/review`)
      .set(authHeader(dirToken))
      .send({ status: 'approved' });
    expect(reviewed.status).toBe(200);

    const cancelled = await request(app).post(`/api/v1/leaves/${created.body.id}/cancel`).set(authHeader(token));
    expect(cancelled.status).toBe(409);
  });

  it('director can self-cancel own approved leave (63cfc52b regression)', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');

    const created = await request(app)
      .post('/api/v1/leaves')
      .set(authHeader(token))
      .send({ type: 'casual', startDate: futureDate(50), endDate: futureDate(52), reason: 'director trip' });
    expect(created.status).toBe(201);

    const cancelled = await request(app).post(`/api/v1/leaves/${created.body.id}/cancel`).set(authHeader(token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('non-owner cannot cancel another user leave (403)', async () => {
    const userA = await createUser({ password: 'Password123!' });
    const userB = await createUser({ password: 'Password123!' });
    const { token: tokenA } = await loginAs(userA.email, 'Password123!');
    const { token: tokenB } = await loginAs(userB.email, 'Password123!');

    const created = await request(app)
      .post('/api/v1/leaves')
      .set(authHeader(tokenA))
      .send({ type: 'casual', startDate: futureDate(60), endDate: futureDate(61), reason: 'test' });
    expect(created.status).toBe(201);

    const res = await request(app).post(`/api/v1/leaves/${created.body.id}/cancel`).set(authHeader(tokenB));
    expect(res.status).toBe(403);
  });

  it('forgot-password returns a generic message for unknown email', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: `ghost-${Date.now()}@example.com` });
    expect([200, 201]).toContain(res.status);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('not found');
  });
});
