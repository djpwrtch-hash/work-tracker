import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { createApp } from '../app.js';
import db from '../db/index.js';

export const app = createApp();

let seq = 0;
const nextSeq = () => Date.now().toString().slice(-8) + ((seq++) % 100).toString().padStart(2, '0');

export async function createUser(opts: {
  email?: string;
  password?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
} = {}) {
  const n = nextSeq();
  const user = {
    id: randomUUID(),
    employeeId: `TE-${n}`,
    firstName: opts.firstName ?? 'Test',
    lastName: opts.lastName ?? 'User',
    email: opts.email ?? `test-${n}@example.com`,
    password: opts.password ?? 'Password123!',
    role: opts.role ?? 'employee',
  };
  const hash = await bcrypt.hash(user.password, 4);
  await db.prepare(
    'INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash, role, status, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(user.id, user.employeeId, user.firstName, user.lastName, user.email, hash, user.role, 'active', opts.gender ?? null);
  return user;
}

export async function loginAs(email: string, password: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    token: res.body.accessToken as string,
    user: res.body.user,
    cookies: res.headers['set-cookie'] as unknown as string[],
  };
}

export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

export function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split('T')[0]!;
}
