import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader } from '../../test/helpers.js';

describe('document request and issue flow', () => {
  it('employee requests, director issues with gender-prefilled fields', async () => {
    const user = await createUser({ firstName: 'Subhasmita', lastName: 'Bhukta', password: 'Password123!' });
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const { token: dirToken } = await loginAs(director.email, 'Password123!');

    const req = await request(app)
      .post('/api/v1/documents')
      .set(authHeader(token))
      .send({ docType: 'experience_certificate', note: 'for new job' });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('pending');
    const docId = req.body.id;

    const issued = await request(app)
      .post(`/api/v1/documents/${docId}/issue`)
      .set(authHeader(dirToken))
      .send({
        fields: {
          employeeName: 'Subhasmita Priyadarsani Bhukta',
          gender: 'female',
          designation: 'Marketing Executive',
          employmentFrom: '2021-11-23',
          employmentTo: '2022-01-16',
        },
      });
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe('issued');
    // By design, experience certificates carry no reference number
    expect(issued.body.docNumber).toBeNull();

    const fetched = await request(app).get(`/api/v1/documents/${docId}`).set(authHeader(dirToken));
    expect(fetched.status).toBe(200);
    expect((fetched.body.fields as any)?.gender).toBe('female');
  });

  it('auto-fills gender from employee profile when reviewer leaves it blank', async () => {
    const user = await createUser({ firstName: 'Subhasmita', lastName: 'Bhukta', gender: 'female', password: 'Password123!' });
    const director = await createUser({ role: 'director', password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const { token: dirToken } = await loginAs(director.email, 'Password123!');

    const req = await request(app)
      .post('/api/v1/documents')
      .set(authHeader(token))
      .send({ docType: 'experience_certificate' });
    expect(req.status).toBe(201);

    const issued = await request(app)
      .post(`/api/v1/documents/${req.body.id}/issue`)
      .set(authHeader(dirToken))
      .send({
        fields: {
          employeeName: 'Subhasmita Priyadarsani Bhukta',
          designation: 'Marketing Executive',
          employmentFrom: '2021-11-23',
          employmentTo: '2022-01-16',
        },
      });
    expect(issued.status).toBe(200);

    const fetched = await request(app).get(`/api/v1/documents/${req.body.id}`).set(authHeader(dirToken));
    expect((fetched.body.fields as any)?.gender).toBe('female');
  });

  it('employee cannot issue their own document (403)', async () => {    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const req = await request(app)
      .post('/api/v1/documents')
      .set(authHeader(token))
      .send({ docType: 'experience_certificate' });
    expect(req.status).toBe(201);

    const issued = await request(app)
      .post(`/api/v1/documents/${req.body.id}/issue`)
      .set(authHeader(token))
      .send({ fields: {} });
    expect(issued.status).toBe(403);
  });
});
