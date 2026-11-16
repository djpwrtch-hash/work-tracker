import { describe, expect, it, afterAll } from 'vitest';
import request from 'supertest';
import { app, createUser, loginAs, authHeader } from '../../test/helpers.js';
import fs from 'fs';
import path from 'path';

// Minimal valid 1x1 PNG (red pixel)
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngBuffer = Buffer.from(PNG_BASE64, 'base64');

afterAll(async () => {
  // Clean up any profile-photo files written to the local storage dir during tests
  const dir = path.resolve('uploads', 'profile-photos');
  if (fs.existsSync(dir)) {
    try {
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
    } catch { /* ignore */ }
  }
});

describe('POST /api/v1/profile-photo', () => {
  it('uploads a photo and returns profilePictureUrl', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app)
      .post('/api/v1/profile-photo')
      .set(authHeader(token))
      .attach('photo', pngBuffer, { filename: 'me.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.profilePictureUrl).toBe(`/api/v1/profile-photo/${user.id}`);
  });

  it('rejects a non-image file type', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app)
      .post('/api/v1/profile-photo')
      .set(authHeader(token))
      .attach('photo', Buffer.from('not an image'), { filename: 'me.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('unauthenticated requests receive 401', async () => {
    const res = await request(app).post('/api/v1/profile-photo').attach('photo', pngBuffer, { filename: 'me.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/profile-photo/:userId', () => {
  it('serves the uploaded photo bytes with an image content type', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    await request(app).post('/api/v1/profile-photo').set(authHeader(token)).attach('photo', pngBuffer, { filename: 'me.png', contentType: 'image/png' });

    const res = await request(app).get(`/api/v1/profile-photo/${user.id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/(png|jpeg)/);
    expect(Buffer.from(res.body).equals(pngBuffer)).toBe(true);
  });

  it('returns 404 when no photo exists', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    const res = await request(app).get(`/api/v1/profile-photo/${user.id}`).set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/profile-photo', () => {
  it('removes the photo and GET returns 404 afterwards', async () => {
    const user = await createUser({ password: 'Password123!' });
    const { token } = await loginAs(user.email, 'Password123!');
    await request(app).post('/api/v1/profile-photo').set(authHeader(token)).attach('photo', pngBuffer, { filename: 'me.png', contentType: 'image/png' });
    const res = await request(app).delete('/api/v1/profile-photo').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.profilePictureUrl).toBeNull();
    const get = await request(app).get(`/api/v1/profile-photo/${user.id}`).set(authHeader(token));
    expect(get.status).toBe(404);
  });
});
