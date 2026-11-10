import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader } from '../../test/helpers.js';
import db from '../../db/index.js';

function createRole(token: string, body: { name: string; description?: string; accessLevel?: string }) {
  return request(app).post('/api/v1/roles').set(authHeader(token)).send(body);
}

describe('roles master', () => {
  it('rejects employees from viewing or managing roles', async () => {
    const employee = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(employee.email, 'Password123!');

    await request(app).get('/api/v1/roles').set(authHeader(token)).expect(403);
    await createRole(token, { name: 'Should Fail' }).expect(403);
  });

  it('lets HR create employee-level roles but not elevated ones', async () => {
    const hr = await createUser({ role: 'hr', password: 'Password123!' });
    const { token } = await loginAs(hr.email, 'Password123!');

    const created = await createRole(token, { name: `Staff ${Date.now()}`, accessLevel: 'employee' });
    expect(created.status).toBe(201);
    expect(created.body.accessLevel).toBe('employee');

    const elevated = await createRole(token, { name: `Boss ${Date.now()}`, accessLevel: 'director' });
    expect(elevated.status).toBe(403);
  });

  it('lets directors create elevated roles and rejects duplicate names', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');

    const name = `Manager ${Date.now()}`;
    const created = await createRole(token, { name, accessLevel: 'hr' });
    expect(created.status).toBe(201);
    expect(created.body.accessLevel).toBe('hr');

    const duplicate = await createRole(token, { name, accessLevel: 'employee' });
    expect(duplicate.status).toBe(409);
  });

  it('protects system roles from rename and delete', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');

    const roles = await request(app).get('/api/v1/roles').set(authHeader(token));
    const employeeRole = roles.body.find((r: any) => r.name === 'employee');
    expect(employeeRole.isSystem).toBe(true);

    await request(app).patch(`/api/v1/roles/${employeeRole.id}`).set(authHeader(token)).send({ name: 'staff' }).expect(400);
    await request(app).delete(`/api/v1/roles/${employeeRole.id}`).set(authHeader(token)).expect(400);
  });

  it('refuses to delete a role that is assigned to users', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');

    const name = `Assigned ${Date.now()}`;
    const created = await createRole(token, { name, accessLevel: 'employee' });
    expect(created.status).toBe(201);

    await createUser({ role: name, password: 'Password123!' });
    await request(app).delete(`/api/v1/roles/${created.body.id}`).set(authHeader(token)).expect(409);
  });

  it('renames a custom role and cascades the new name to users', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');

    const name = `Temp ${Date.now()}`;
    const created = await createRole(token, { name, accessLevel: 'employee' });
    const user = await createUser({ role: name, password: 'Password123!' });

    const newName = `${name} Renamed`;
    const updated = await request(app).patch(`/api/v1/roles/${created.body.id}`).set(authHeader(token)).send({ name: newName });
    expect(updated.status).toBe(200);

    const row = await db.prepare('SELECT role FROM users WHERE id = ?').get(user.id) as any;
    expect(row.role).toBe(newName);
  });
});
