import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader } from '../../test/helpers.js';

describe('teams API', () => {
  it('lets only a director remove a team member', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const hr = await createUser({ role: 'hr', password: 'Password123!' });
    const leader = await createUser({ password: 'Password123!' });
    const member = await createUser({ password: 'Password123!' });
    const { token: directorToken } = await loginAs(director.email, 'Password123!');
    const { token: hrToken } = await loginAs(hr.email, 'Password123!');
    const teamName = `Removal Team ${Date.now()}`;

    const created = await request(app)
      .post('/api/v1/teams')
      .set(authHeader(directorToken))
      .send({ teamName, memberIds: [leader.id, member.id], leaderId: leader.id });
    expect(created.status).toBe(201);

    const hrAttempt = await request(app)
      .delete(`/api/v1/teams/${encodeURIComponent(teamName)}/members`)
      .set(authHeader(hrToken))
      .send({ userIds: [member.id] });
    expect(hrAttempt.status).toBe(403);

    const removed = await request(app)
      .delete(`/api/v1/teams/${encodeURIComponent(teamName)}/members`)
      .set(authHeader(directorToken))
      .send({ userIds: [member.id] });
    expect(removed.status).toBe(200);
    expect(removed.body.members.map((m: any) => m.userId)).toEqual([leader.id]);
  });

  it('isolates tasks by team even when a member belongs to both teams', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const shared = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');
    const teamA = `Isolation A ${Date.now()}`;
    const teamB = `Isolation B ${Date.now()}`;

    await request(app).post('/api/v1/teams').set(authHeader(token)).send({ teamName: teamA, memberIds: [shared.id] });
    await request(app).post('/api/v1/teams').set(authHeader(token)).send({ teamName: teamB, memberIds: [shared.id] });

    const task = await request(app)
      .post('/api/v1/tasks')
      .set(authHeader(token))
      .send({ title: 'Team A only', assigneeIds: [shared.id], teamName: teamA });
    expect(task.status).toBe(201);
    expect(task.body.teamName).toBe(teamA);

    const listA = await request(app).get('/api/v1/tasks').query({ teamName: teamA }).set(authHeader(token));
    const listB = await request(app).get('/api/v1/tasks').query({ teamName: teamB }).set(authHeader(token));
    expect(listA.body.tasks.map((t: any) => t.id)).toContain(task.body.id);
    expect(listB.body.tasks.map((t: any) => t.id)).not.toContain(task.body.id);
  });

  it('shows ALL team tasks to every member, isolated per team, with assignee + assigned-by names', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const member1 = await createUser({ password: 'Password123!' });
    const member2 = await createUser({ password: 'Password123!' });
    const outsider = await createUser({ password: 'Password123!' });
    const { token: dirToken } = await loginAs(director.email, 'Password123!');
    const { token: member2Token } = await loginAs(member2.email, 'Password123!');
    const { token: outsiderToken } = await loginAs(outsider.email, 'Password123!');
    const teamName = `TeamDash ${Date.now()}`;

    await request(app).post('/api/v1/teams').set(authHeader(dirToken)).send({ teamName, memberIds: [member1.id, member2.id] });

    // Task assigned to member1 only; member2 should still see it on the team dashboard.
    const task = await request(app).post('/api/v1/tasks').set(authHeader(dirToken))
      .send({ title: 'Shared task', assigneeIds: [member1.id], teamName });
    expect(task.status).toBe(201);

    // Team-scoped list for a member NOT personally assigned still returns it.
    const member2List = await request(app).get('/api/v1/tasks').query({ teamName, limit: 100 }).set(authHeader(member2Token));
    expect(member2List.status).toBe(200);
    const row = member2List.body.tasks.find((t: any) => t.id === task.body.id);
    expect(row).toBeTruthy();
    expect(row.assignees.map((a: any) => `${a.firstName} ${a.lastName}`)).toContain(`${member1.firstName} ${member1.lastName}`);
    expect(row.createdByName).toBe(`${director.firstName} ${director.lastName}`);

    // Outsider employee (not a member) sees nothing for this team.
    const outsiderList = await request(app).get('/api/v1/tasks').query({ teamName, limit: 100 }).set(authHeader(outsiderToken));
    expect(outsiderList.status).toBe(200);
    expect(outsiderList.body.tasks).toHaveLength(0);
  });

  it('lets only a director rename a team, preserving members + re-tagging tasks', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const hr = await createUser({ role: 'hr', password: 'Password123!' });
    const member = await createUser({ password: 'Password123!' });
    const { token: dirToken } = await loginAs(director.email, 'Password123!');
    const { token: hrToken } = await loginAs(hr.email, 'Password123!');
    const oldName = `Rename ${Date.now()}`;
    const newName = `Renamed ${Date.now()}`;

    await request(app).post('/api/v1/teams').set(authHeader(dirToken)).send({ teamName: oldName, memberIds: [member.id], leaderId: member.id });
    const task = await request(app).post('/api/v1/tasks').set(authHeader(dirToken)).send({ title: 'T', assigneeIds: [member.id], teamName: oldName });
    expect(task.status).toBe(201);

    // non-director cannot rename
    const hrAttempt = await request(app).put(`/api/v1/teams/${encodeURIComponent(oldName)}`).set(authHeader(hrToken)).send({ teamName: newName });
    expect(hrAttempt.status).toBe(403);

    // director renames
    const renamed = await request(app).put(`/api/v1/teams/${encodeURIComponent(oldName)}`).set(authHeader(dirToken)).send({ teamName: newName });
    expect(renamed.status).toBe(200);
    expect(renamed.body.teamName).toBe(newName);
    expect(renamed.body.members.map((m: any) => m.userId)).toContain(member.id);
    expect(renamed.body.members.find((m: any) => m.userId === member.id)?.memberRole).toBe('leader');

    // old name is gone
    const old = await request(app).get(`/api/v1/teams/${encodeURIComponent(oldName)}`).set(authHeader(dirToken));
    expect(old.status).toBe(404);

    // tasks re-tagged under the new name
    const list = await request(app).get('/api/v1/tasks').query({ teamName: newName, limit: 100 }).set(authHeader(dirToken));
    expect(list.body.tasks.map((t: any) => t.id)).toContain(task.body.id);
    const oldTasks = await request(app).get('/api/v1/tasks').query({ teamName: oldName, limit: 100 }).set(authHeader(dirToken));
    expect(oldTasks.body.tasks.map((t: any) => t.id)).not.toContain(task.body.id);
  });

  it('rejects renaming to an existing team name with 409', async () => {
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const a = await createUser({ password: 'Password123!' });
    const b = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(director.email, 'Password123!');
    const t1 = `Conflict A ${Date.now()}`;
    const t2 = `Conflict B ${Date.now()}`;
    await request(app).post('/api/v1/teams').set(authHeader(token)).send({ teamName: t1, memberIds: [a.id] });
    await request(app).post('/api/v1/teams').set(authHeader(token)).send({ teamName: t2, memberIds: [b.id] });

    const res = await request(app).put(`/api/v1/teams/${encodeURIComponent(t1)}`).set(authHeader(token)).send({ teamName: t2 });
    expect(res.status).toBe(409);
  });
});
