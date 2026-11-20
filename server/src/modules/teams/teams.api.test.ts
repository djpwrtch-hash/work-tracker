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
});
