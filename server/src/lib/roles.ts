import db from '../db/index.js';

export type AccessLevel = 'director' | 'hr' | 'employee';

const ROLE_CACHE_TTL_MS = 30_000;
const roleCache = new Map<string, { accessLevel: AccessLevel; expiresAt: number }>();

export function invalidateRoleCache(name?: string): void {
  if (name) roleCache.delete(name);
  else roleCache.clear();
}

function normalizeAccessLevel(value: unknown): AccessLevel {
  return value === 'director' || value === 'hr' ? value : 'employee';
}

export async function getRoleAccessLevel(name: string): Promise<AccessLevel> {
  if (!name) return 'employee';
  const cached = roleCache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.accessLevel;

  const row = await db.prepare('SELECT access_level FROM roles WHERE name = ?').get(name) as any;
  const accessLevel = normalizeAccessLevel(row?.access_level);
  roleCache.set(name, { accessLevel, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return accessLevel;
}

export async function roleExists(name: string): Promise<boolean> {
  if (!name) return false;
  const row = await db.prepare('SELECT id FROM roles WHERE name = ?').get(name);
  return !!row;
}

export function isAdminAccess(level: string | undefined | null): boolean {
  return level === 'director' || level === 'hr';
}
