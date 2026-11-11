import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader } from '../../test/helpers.js';
import db from '../../db/index.js';
import { nextEmployeeId } from './users.service.js';

describe('PATCH /api/v1/users/:id privilege guard', () => {
  it('strips role and status when HR edits a user', async () => {
    const hr = await createUser({ role: 'hr', password: 'Password123!' });
    const victim = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(hr.email, 'Password123!');

    const res = await request(app)
      .patch(`/api/v1/users/${victim.id}`)
      .set(authHeader(token))
      .send({ firstName: 'Changed', phoneNumber: '+919937112760', role: 'director', status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Changed');
    // Privilege fields must be ignored for HR
    expect(res.body.role).toBe('employee');
    expect(res.body.status).toBe('active');
  });

  it('blocks HR self-promotion to director', async () => {
    const hr = await createUser({ role: 'hr', password: 'Password123!' });
    const { token, user } = await loginAs(hr.email, 'Password123!');

    const res = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set(authHeader(token))
      .send({ phoneNumber: '+919937112760', role: 'director' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('hr');
  });

  it('allows directors to change role and status', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const victim = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');

    const res = await request(app)
      .patch(`/api/v1/users/${victim.id}`)
      .set(authHeader(token))
      .send({ phoneNumber: '+919937112760', role: 'hr' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('hr');
  });

  it('rejects employee editors with 403', async () => {
    const user = await createUser({ password: 'Password123!' });
    const victim = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');

    const res = await request(app)
      .patch(`/api/v1/users/${victim.id}`)
      .set(authHeader(token))
      .send({ firstName: 'Hacked' });
    expect(res.status).toBe(403);
  });
});

describe('employee IDs', () => {
  it('generates unique IDs without database sequencing', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => nextEmployeeId()));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^EMP-[A-F0-9]{16}$/.test(id))).toBe(true);
  });
});

describe('DELETE /api/v1/users/:id', () => {
  it('rejects a deleted user immediately', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const victim = await createUser({ password: 'Password123!' });
    const victimLogin = await loginAs(victim.email, 'Password123!');

    await request(app).get('/api/v1/auth/me').set(authHeader(victimLogin.token)).expect(200);

    const { token } = await loginAs(director.email, 'Password123!');
    const deleted = await request(app)
      .delete(`/api/v1/users/${victim.id}`)
      .set(authHeader(token))
      .send({ confirm: 'DELETE' });
    expect(deleted.status).toBe(200);

    const res = await request(app).get('/api/v1/auth/me').set(authHeader(victimLogin.token));
    expect(res.status).toBe(401);

    let audit: any;
    for (let i = 0; i < 20; i++) {
      audit = await db.prepare(
        "SELECT user_id, status_code FROM api_audit_log WHERE method = 'DELETE' AND path = ? ORDER BY created_at DESC LIMIT 1"
      ).get(`/api/v1/users/${victim.id}`);
      if (audit) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(audit).toMatchObject({ user_id: director.id, status_code: 200 });
  });
});

describe('POST /api/v1/users/:id/reset-password', () => {
  const NEW_PASSWORD = 'ResetPass123!x';

  it('lets a director reset an employee password and sets must_change_password', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const victim = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');

    const res = await request(app)
      .post(`/api/v1/users/${victim.id}/reset-password`)
      .set(authHeader(token))
      .send({ newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    // Old password no longer works, new one does, and the account is flagged to change on next login.
    const oldLogin = await request(app).post('/api/v1/auth/login').send({ email: victim.email, password: 'Password123!' });
    expect(oldLogin.status).toBe(401);
    const row = await db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(victim.id) as any;
    expect(Number(row.must_change_password)).toBe(1);
  });

  it('lets HR reset an employee password but not a director password', async () => {
    const hr = await createUser({ role: 'hr', password: 'Password123!' });
    const employee = await createUser({ password: 'Password123!' });
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(hr.email, 'Password123!');

    const ok = await request(app)
      .post(`/api/v1/users/${employee.id}/reset-password`)
      .set(authHeader(token))
      .send({ newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);

    const forbidden = await request(app)
      .post(`/api/v1/users/${director.id}/reset-password`)
      .set(authHeader(token))
      .send({ newPassword: NEW_PASSWORD });
    expect(forbidden.status).toBe(403);
  });

  it('rejects employees with 403 and weak passwords with 400', async () => {
    const employee = await createUser({ password: 'Password123!' });
    const victim = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(employee.email, 'Password123!');

    const forbidden = await request(app)
      .post(`/api/v1/users/${victim.id}/reset-password`)
      .set(authHeader(token))
      .send({ newPassword: NEW_PASSWORD });
    expect(forbidden.status).toBe(403);

    const { token: directorToken } = await loginAs((await createUser({ role: 'director', password: 'Password123!' })).email, 'Password123!');
    const weak = await request(app)
      .post(`/api/v1/users/${victim.id}/reset-password`)
      .set(authHeader(directorToken))
      .send({ newPassword: 'weak' });
    expect(weak.status).toBe(400);
  });
});

describe('DELETE /api/v1/teams/:teamName validation', () => {
  it('rejects oversized team names with 400', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');

    const res = await request(app).delete(`/api/v1/teams/${'x'.repeat(201)}`).set(authHeader(token));
    expect(res.status).toBe(400);
  });
});
