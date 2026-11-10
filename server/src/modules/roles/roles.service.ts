import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';
import { invalidateRoleCache } from '../../lib/roles.js';
import type { AccessLevel } from '../../lib/roles.js';

function mapRole(r: any) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    accessLevel: r.access_level,
    isSystem: !!r.is_system,
    userCount: r.user_count !== undefined ? Number(r.user_count) : undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class RolesService {
  static async list() {
    const rows = await db.prepare(`
      SELECT r.*, COUNT(u.id) AS user_count
      FROM roles r
      LEFT JOIN users u ON u.role = r.name
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.name
    `).all() as any[];
    return rows.map(mapRole);
  }

  static async getById(id: string) {
    const row = await db.prepare(`
      SELECT r.*, COUNT(u.id) AS user_count
      FROM roles r
      LEFT JOIN users u ON u.role = r.name
      WHERE r.id = ?
      GROUP BY r.id
    `).get(id) as any;
    if (!row) throw new AppError(404, 'Role not found');
    return mapRole(row);
  }

  private static assertCanManageElevated(requesterAccessLevel: string, accessLevel: string) {
    if (accessLevel !== 'employee' && requesterAccessLevel !== 'director') {
      throw new AppError(403, 'Only a director can grant director or HR access');
    }
  }

  static async create(input: { name: string; description?: string; accessLevel: AccessLevel }, requesterAccessLevel: string) {
    RolesService.assertCanManageElevated(requesterAccessLevel, input.accessLevel);

    const id = uuid();
    await db.transaction(async () => {
      const existing = await db.prepare('SELECT id FROM roles WHERE name = ?').get(input.name);
      if (existing) throw new AppError(409, 'Role name already exists');
      await db.prepare('INSERT INTO roles (id, name, description, access_level, is_system) VALUES (?, ?, ?, ?, 0)')
        .run(id, input.name, input.description ?? null, input.accessLevel);
    })();
    invalidateRoleCache();
    return await this.getById(id);
  }

  static async update(id: string, input: { name?: string; description?: string | null; accessLevel?: AccessLevel }, requesterAccessLevel: string) {
    const existing = await db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
    if (!existing) throw new AppError(404, 'Role not found');

    if (existing.is_system) {
      if (input.name !== undefined && input.name !== existing.name) {
        throw new AppError(400, 'System roles cannot be renamed');
      }
      if (input.accessLevel !== undefined && input.accessLevel !== existing.access_level) {
        throw new AppError(400, 'System role access level cannot be changed');
      }
    }

    if (input.accessLevel !== undefined) {
      RolesService.assertCanManageElevated(requesterAccessLevel, input.accessLevel);
    }
    if (requesterAccessLevel !== 'director' && existing.access_level !== 'employee') {
      throw new AppError(403, 'Only a director can modify director or HR level roles');
    }

    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    if (input.name !== undefined) {
      const duplicate = await db.prepare('SELECT id FROM roles WHERE name = ? AND id != ?').get(input.name, id);
      if (duplicate) throw new AppError(409, 'Role name already exists');
      sets.push('name = ?'); params.push(input.name);
    }
    if (input.description !== undefined) { sets.push('description = ?'); params.push(input.description); }
    if (input.accessLevel !== undefined) { sets.push('access_level = ?'); params.push(input.accessLevel); }
    params.push(id);
    await db.prepare(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    invalidateRoleCache(existing.name);
    if (input.name !== undefined && input.name !== existing.name) invalidateRoleCache(input.name);
    return await this.getById(id);
  }

  static async delete(id: string, requesterAccessLevel: string) {
    const existing = await db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
    if (!existing) throw new AppError(404, 'Role not found');
    if (existing.is_system) throw new AppError(400, 'System roles cannot be deleted');
    if (requesterAccessLevel !== 'director' && existing.access_level !== 'employee') {
      throw new AppError(403, 'Only a director can delete director or HR level roles');
    }

    const count = (await db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get(existing.name) as any).c;
    if (Number(count) > 0) throw new AppError(409, `Cannot delete role: it is assigned to ${count} user(s)`);

    await db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    invalidateRoleCache(existing.name);
    return { message: 'Role deleted' };
  }

  static async getStats() {
    const total = (await db.prepare('SELECT COUNT(*) AS c FROM roles').get() as any).c;
    return { total: Number(total) };
  }
}
