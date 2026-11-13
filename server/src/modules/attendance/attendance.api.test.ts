import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, createUser, loginAs, authHeader } from '../../test/helpers.js';
import db from '../../db/index.js';
import { getISTNow } from '../../lib/time.js';

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

describe('extra work flow', () => {
  it('accepts single-digit-hour times and computes hours correctly', async () => {
    const emp = await createUser({ role: 'employee', password: 'Password123!' });
    const empToken = (await loginAs(emp.email, 'Password123!')).token;
    const created = await request(app).post('/api/v1/attendance/extra-work').set(authHeader(empToken)).send({
      date: getISTNow().toISOString().split('T')[0]!,
      startTime: '9:00',
      endTime: '10:30',
      notes: 'morning slot',
    });
    expect(created.status).toBe(201);
    expect(Number(created.body.hours)).toBeCloseTo(1.5, 2);
  });

  it('rejects end time before start time', async () => {
    const emp = await createUser({ role: 'employee', password: 'Password123!' });
    const empToken = (await loginAs(emp.email, 'Password123!')).token;
    const res = await request(app).post('/api/v1/attendance/extra-work').set(authHeader(empToken)).send({
      date: getISTNow().toISOString().split('T')[0]!,
      startTime: '9:30',
      endTime: '9:00',
    });
    expect(res.status).toBe(400);
  });

  it('employee logs extra work, HR reviews and accepts it', async () => {
    const emp = await createUser({ role: 'employee', password: 'Password123!' });
    const dir = await createUser({ role: 'director', password: 'Password123!' });
    const empToken = (await loginAs(emp.email, 'Password123!')).token;
    const dirToken = (await loginAs(dir.email, 'Password123!')).token;

    const created = await request(app).post('/api/v1/attendance/extra-work').set(authHeader(empToken)).send({
      date: getISTNow().toISOString().split('T')[0]!,
      startTime: '14:00',
      endTime: '17:30',
      notes: 'release work',
    });
    expect(created.status).toBe(201);
    expect(Number(created.body.hours)).toBeCloseTo(3.5, 1);
    expect(created.body.accepted).toBe(false);

    // employee sees own entry; director sees all
    const mine = await request(app).get('/api/v1/attendance/extra-work').set(authHeader(empToken));
    expect(mine.body.entries.length).toBeGreaterThanOrEqual(1);
    expect(mine.body.totalHours).toBeGreaterThanOrEqual(3.5);

    const entryId = created.body.id;
    const accepted = await request(app).patch(`/api/v1/attendance/extra-work/${entryId}/accept`).set(authHeader(dirToken));
    expect(accepted.status).toBe(200);

    // employee cannot delete an accepted entry
    await request(app).delete(`/api/v1/attendance/extra-work/${entryId}`).set(authHeader(empToken)).expect(409);

    // monthly summary includes the hours
    const summary = await request(app).get('/api/v1/attendance/monthly?month=' + (new Date().getMonth() + 1) + '&year=' + new Date().getFullYear()).set(authHeader(empToken));
    expect(Number(summary.body.totalExtraWorkHours)).toBeGreaterThanOrEqual(3.5);

    // director can delete even after acceptance
    await request(app).delete(`/api/v1/attendance/extra-work/${entryId}`).set(authHeader(dirToken)).expect(200);
  });

  it('rejects invalid extra-work payloads', async () => {
    const emp = await createUser({ role: 'employee', password: 'Password123!' });
    const empToken = (await loginAs(emp.email, 'Password123!')).token;

    await request(app).post('/api/v1/attendance/extra-work').set(authHeader(empToken)).send({
      date: getISTNow().toISOString().split('T')[0]!,
      startTime: '17:00',
      endTime: '14:00',
    }).expect(400);

    await request(app).post('/api/v1/attendance/extra-work').set(authHeader(empToken)).send({
      date: '2999-12-31',
      startTime: '10:00',
      endTime: '12:00',
    }).expect(400);
  });
});

describe('missed check-out correction flow', () => {
  it('closes a missed check-out even when today already has a checked-out row', async () => {
    const emp = await createUser({ role: 'employee', password: 'Password123!' });
    const dir = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(emp.email, 'Password123!');

    const istNow = getISTNow();
    istNow.setUTCDate(istNow.getUTCDate() - 1);
    const yesterdayStr = istNow.toISOString().split('T')[0]!;
    const todayStr = getISTNow().toISOString().split('T')[0]!;

    // missed check-out from yesterday, still open
    const staleId = randomUUID();
    await db.prepare(
      'INSERT INTO attendance (id, user_id, date, status, login_time, pause_minutes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(staleId, emp.id, yesterdayStr, 'present', `${yesterdayStr} 09:00:00`, 0);

    // today already exists and is already checked out
    const todayId = randomUUID();
    await db.prepare(
      'INSERT INTO attendance (id, user_id, date, status, login_time, logout_time, pause_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(todayId, emp.id, todayStr, 'work_end', `${todayStr} 08:00:00`, `${todayStr} 17:00:00`, 0);

    // closing must succeed and close the stale (yesterday) record, not hit today's row
    const checkout = await request(app).post('/api/v1/attendance/check-out').set(authHeader(token)).send({});
    expect(checkout.status).toBe(200);

    const stale = await db.prepare('SELECT logout_time FROM attendance WHERE id = ?').get(staleId) as any;
    expect(stale.logout_time).not.toBeNull();

    const mine = await request(app).get('/api/v1/attendance/correction-requests/mine').set(authHeader(token));
    expect(mine.body.status).toBe('pending');
    expect(mine.body.staleRecord).toBeNull();
  });

  it('blocks check-in with STALE_ATTENDANCE, auto-sends a permission request on check-out, HR approves, check-in succeeds', async () => {
    const emp = await createUser({ role: 'employee', password: 'Password123!' });
    const dir = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(emp.email, 'Password123!');
    const { token: dirToken } = await loginAs(dir.email, 'Password123!');

    // employee checked in yesterday and never checked out
    const istNow = getISTNow();
    istNow.setUTCDate(istNow.getUTCDate() - 1);
    const yesterdayStr = istNow.toISOString().split('T')[0]!;
    const staleId = randomUUID();
    await db.prepare(
      'INSERT INTO attendance (id, user_id, date, status, login_time, pause_minutes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(staleId, emp.id, yesterdayStr, 'present', `${yesterdayStr} 09:00:00`, 0);

    const blocked = await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('STALE_ATTENDANCE');

    const checkout = await request(app).post('/api/v1/attendance/check-out').set(authHeader(token)).send({});
    expect(checkout.status).toBe(200);

    const mine = await request(app).get('/api/v1/attendance/correction-requests/mine').set(authHeader(token));
    expect(mine.body.status).toBe('pending');
    expect(mine.body.staleRecord).toBeNull();

    // check-in is still blocked while approval is pending
    const stillBlocked = await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({});
    expect(stillBlocked.status).toBe(409);
    expect(stillBlocked.body.error).toBe('PENDING_APPROVAL');

    const list = await request(app).get('/api/v1/attendance/correction-requests?status=pending').set(authHeader(dirToken));
    const req = list.body.requests.find((r: any) => r.userId === emp.id);
    expect(req).toBeDefined();

    const approved = await request(app).patch(`/api/v1/attendance/correction-requests/${req.id}`).set(authHeader(dirToken)).send({ status: 'approved' });
    expect(approved.status).toBe(200);

    const checkedIn = await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({});
    expect(checkedIn.status).toBe(201);
  });

  it('rejects correction-requests endpoints for employees', async () => {
    const emp = await createUser({ role: 'employee', password: 'Password123!' });
    const { token } = await loginAs(emp.email, 'Password123!');

    await request(app).get('/api/v1/attendance/correction-requests').set(authHeader(token)).expect(403);
    const fakeId = randomUUID();
    await request(app).patch(`/api/v1/attendance/correction-requests/${fakeId}`).set(authHeader(token)).send({ status: 'approved' }).expect(403);
  });

  it('blocks self-review of a forgot-checkout request and lets another admin approve', async () => {
    const dirA = await createUser({ role: 'director', password: 'Password123!' });
    const dirB = await createUser({ role: 'director', password: 'Password123!' });
    const { token: tokenA } = await loginAs(dirA.email, 'Password123!');
    const { token: tokenB } = await loginAs(dirB.email, 'Password123!');

    const istNow = getISTNow();
    istNow.setUTCDate(istNow.getUTCDate() - 1);
    const yesterdayStr = istNow.toISOString().split('T')[0]!;
    const staleId = randomUUID();
    await db.prepare(
      'INSERT INTO attendance (id, user_id, date, status, login_time, pause_minutes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(staleId, dirA.id, yesterdayStr, 'present', `${yesterdayStr} 09:00:00`, 0);

    const checkout = await request(app).post('/api/v1/attendance/check-out').set(authHeader(tokenA)).send({});
    expect(checkout.status).toBe(200);

    const mine = await request(app).get('/api/v1/attendance/correction-requests/mine').set(authHeader(tokenA));
    expect(mine.body.status).toBe('pending'); // another admin exists, so it is not auto-approved

    const list = await request(app).get('/api/v1/attendance/correction-requests?status=pending').set(authHeader(tokenB));
    const req = list.body.requests.find((r: any) => r.userId === dirA.id);
    expect(req).toBeDefined();

    // forgetter cannot approve their own request
    await request(app).patch(`/api/v1/attendance/correction-requests/${req.id}`).set(authHeader(tokenA)).send({ status: 'approved' }).expect(403);

    // a different director can approve
    const approved = await request(app).patch(`/api/v1/attendance/correction-requests/${req.id}`).set(authHeader(tokenB)).send({ status: 'approved' });
    expect(approved.status).toBe(200);

    const checkedIn = await request(app).post('/api/v1/attendance/check-in').set(authHeader(tokenA)).send({});
    expect(checkedIn.status).toBe(201);
  });

  it('auto-approves the forgot-checkout of the last remaining admin', async () => {
    const dir = await createUser({ role: 'hr', password: 'Password123!' });
    const { token } = await loginAs(dir.email, 'Password123!');

    const istNow = getISTNow();
    istNow.setUTCDate(istNow.getUTCDate() - 1);
    const yesterdayStr = istNow.toISOString().split('T')[0]!;
    const staleId = randomUUID();
    await db.prepare(
      'INSERT INTO attendance (id, user_id, date, status, login_time, pause_minutes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(staleId, dir.id, yesterdayStr, 'present', `${yesterdayStr} 09:00:00`, 0);

    const checkout = await request(app).post('/api/v1/attendance/check-out').set(authHeader(token)).send({});
    expect(checkout.status).toBe(200);

    const others = (await db.prepare(
      "SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.name = u.role WHERE r.access_level IN ('director', 'hr') AND u.status = 'active' AND u.id != ?"
    ).get(dir.id)) as any;
    const mine = await request(app).get('/api/v1/attendance/correction-requests/mine').set(authHeader(token));

    if (Number(others?.c ?? 0) === 0) {
      // no other active admin exists, so the request is auto-approved
      expect(mine.body.status).toBe('approved');
      const checkedIn = await request(app).post('/api/v1/attendance/check-in').set(authHeader(token)).send({});
      expect(checkedIn.status).toBe(201);
    } else {
      // other admins exist, so this stays pending and needs an outside reviewer
      expect(mine.body.status).toBe('pending');
    }
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
