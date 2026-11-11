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

describe('POST /api/v1/attendance/pause-start and /pause-end', () => {
  it('pauses and resumes with location without server errors', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({ status: 'present' });

    const paused = await request(app).post('/api/v1/attendance/pause-start').set(authHeader(token)).send({ ...LOC });
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe('on_break');
    expect(paused.body.pause_start_time ?? paused.body.pauseStartTime).toBeTruthy();
    expect(paused.body.pause_end_time ?? paused.body.pauseEndTime ?? null).toBeNull();

    const today = await request(app).get('/api/v1/attendance/today').set(authHeader(token));
    expect(today.body.status).toBe('on_break');

    const resumed = await request(app).post('/api/v1/attendance/pause-end').set(authHeader(token)).send({ ...LOC });
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe('present');
    expect(Number(resumed.body.pause_minutes)).toBeGreaterThanOrEqual(0);

    const after = await request(app).get('/api/v1/attendance/today').set(authHeader(token));
    expect(after.body.status).toBe('present');
  });

  it('rejects pause without checking in first', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app).post('/api/v1/attendance/pause-start').set(authHeader(token)).send({ ...LOC });
    expect(res.status).toBe(404);
  });

  it('resuming without an active pause is a no-op', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({ status: 'present' });

    const res = await request(app).post('/api/v1/attendance/pause-end').set(authHeader(token)).send({ ...LOC });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('present');
  });
});
