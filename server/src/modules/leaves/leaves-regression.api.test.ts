// Regression tests for the leave-module 500s caused by MySQL DATE columns arriving as
// JS Date objects:
//   * "date IN ()"            -> SQL syntax error when the date list came out empty
//   * "year = NaN"            -> Unknown column error from yearOf(<invalid date>)
// The helpers now normalise Date | string input, so both paths are covered here.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader, futureDate } from '../../test/helpers.js';

async function applyLeave(token: string, startOffset: number, endOffset: number) {
  const res = await request(app)
    .post('/api/v1/leaves')
    .set(authHeader(token))
    .send({ type: 'casual', startDate: futureDate(startOffset), endDate: futureDate(endOffset), reason: 'regression' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('leave date handling (regression)', () => {
  it('rejects an inverted date range instead of writing broken rows', async () => {
    const user = await createUser();
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app)
      .post('/api/v1/leaves')
      .set(authHeader(token))
      .send({ type: 'casual', startDate: futureDate(20), endDate: futureDate(10), reason: 'inverted' });
    expect(res.status).toBe(400);
  });

  it('rejects a past start date', async () => {
    const user = await createUser();
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app)
      .post('/api/v1/leaves')
      .set(authHeader(token))
      .send({ type: 'casual', startDate: futureDate(-10), endDate: futureDate(-5), reason: 'past' });
    expect(res.status).toBe(400);
  });

  it('cancels a pending leave (exercises the IN (...) date update)', async () => {
    const user = await createUser();
    const { token } = await loginAs(user.email, 'Password123!');
    const id = await applyLeave(token, 30, 32);

    // This is the request that used to 500 with "syntax error near ')'".
    const cancelled = await request(app).post(`/api/v1/leaves/${id}/cancel`).set(authHeader(token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('cancels a single-day leave', async () => {
    const user = await createUser();
    const { token } = await loginAs(user.email, 'Password123!');
    const id = await applyLeave(token, 40, 40);
    const cancelled = await request(app).post(`/api/v1/leaves/${id}/cancel`).set(authHeader(token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('approves a leave without a NaN year (leave_year is stored as a number)', async () => {
    const director = await createUser({ role: 'director' });
    const employee = await createUser();
    const directorToken = (await loginAs(director.email, 'Password123!')).token;
    const employeeToken = (await loginAs(employee.email, 'Password123!')).token;

    const id = await applyLeave(employeeToken, 50, 52);

    // This is the request that used to 500 with "Unknown column 'NaN' in 'where clause'".
    const approved = await request(app)
      .post(`/api/v1/leaves/${id}/review`)
      .set(authHeader(directorToken))
      .send({ status: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');

    const balance = await request(app).get('/api/v1/leaves/balance').set(authHeader(employeeToken));
    expect(balance.status).toBe(200);
    // The balance is derived from the leave year, so a broken year would surface here.
    expect(Number(balance.body.totalUsed)).toBeGreaterThan(0);
    expect(Number(balance.body.casual?.used ?? balance.body.balances?.casual?.used ?? 0)).toBeGreaterThan(0);
  });

  it('rejects cancelling an already cancelled leave', async () => {
    const user = await createUser();
    const { token } = await loginAs(user.email, 'Password123!');
    const id = await applyLeave(token, 60, 61);
    expect((await request(app).post(`/api/v1/leaves/${id}/cancel`).set(authHeader(token))).status).toBe(200);
    const again = await request(app).post(`/api/v1/leaves/${id}/cancel`).set(authHeader(token));
    expect(again.status).toBe(409);
  });

  it('prevents an employee from cancelling someone else’s leave', async () => {
    const owner = await createUser();
    const other = await createUser();
    const ownerToken = (await loginAs(owner.email, 'Password123!')).token;
    const otherToken = (await loginAs(other.email, 'Password123!')).token;
    const id = await applyLeave(ownerToken, 70, 71);

    const res = await request(app).post(`/api/v1/leaves/${id}/cancel`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });
});
