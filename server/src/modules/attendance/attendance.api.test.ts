import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader } from '../../test/helpers.js';

const LOC = {
  latitude: 20.2961,
  longitude: 85.8245,
  accuracy: 25,
  locationCapturedAt: new Date().toISOString(),
};

describe('POST /api/v1/attendance/check-in', () => {
  it('checks in with location and persists it', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');

    const res = await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({
      status: 'present',
      ...LOC,
    });
    expect(res.status).toBe(201);

    const today = await request(app).get('/api/v1/attendance/today').set(authHeader(token));
    expect(today.status).toBe(200);
    expect(Number(today.body.latitude)).toBeCloseTo(LOC.latitude, 4);
    expect(Number(today.body.longitude)).toBeCloseTo(LOC.longitude, 4);
  });

  it('rejects a second check-in on the same day with 409', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const first = await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({ status: 'present' });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({ status: 'present' });
    expect(second.status).toBe(409);
  });

  it('rejects invalid latitude with 400', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app)
      .post('/api/v1/attendance/check-in')
      .set(authHeader(token))
      .send({ status: 'present', latitude: 999, longitude: 10 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/attendance/check-out', () => {
  it('checks out with location and merges it into today', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({ status: 'present' });

    const out = await request(app).post('/api/v1/attendance/check-out').set(authHeader(token)).send({ ...LOC });
    expect(out.status).toBe(200);

    const today = await request(app).get('/api/v1/attendance/today').set(authHeader(token));
    expect(Number(today.body.latitude)).toBeCloseTo(LOC.latitude, 4);
    expect(today.body.logout_time ?? today.body.logoutTime ?? null).not.toBeNull();
  });

  it('rejects check-out without a check-in', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app).post('/api/v1/attendance/check-out').set(authHeader(token)).send({});
    expect([400, 404, 409]).toContain(res.status);
  });
});
