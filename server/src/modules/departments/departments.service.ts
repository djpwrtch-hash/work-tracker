import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';

function mapDepartment(d: any) {
  return { id: d.id, name: d.name, description: d.description, managerId: d.manager_id, createdAt: d.created_at, updatedAt: d.updated_at };
}

async function fetchMembersMap(departmentIds: string[]) {
  if (departmentIds.length === 0) return new Map<string, any[]>();
  const placeholders = departmentIds.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT dm.department_id, u.id as user_id, u.first_name, u.last_name, u.email, u.role, u.employee_id
    FROM department_members dm JOIN users u ON u.id = dm.user_id WHERE dm.department_id IN (${placeholders}) ORDER BY u.first_name, u.last_name`).all(...departmentIds) as any[];
  const map = new Map<string, any[]>();
  for (const r of rows) {
    const arr = map.get(r.department_id) ?? [];
    arr.push({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, employeeId: r.employee_id });
    map.set(r.department_id, arr);
  }
  return map;
}

async function fetchMemberIds(departmentId: string) {
  const rows = await db.prepare('SELECT user_id FROM department_members WHERE department_id = ?').all(departmentId) as any[];
  return rows.map((r: any) => r.user_id);
}

async function replaceMembers(departmentId: string, memberIds: string[]) {
  await db.prepare('DELETE FROM department_members WHERE department_id = ?').run(departmentId);
  if (memberIds.length === 0) return;
  const unique = [...new Set(memberIds)];
  const values = unique.map(() => '(?, ?)').join(', ');
  const params: any[] = [];
  for (const uid of unique) params.push(departmentId, uid);
  await db.prepare(`INSERT IGNORE INTO department_members (department_id, user_id) VALUES ${values}`).run(...params);
}

export class DepartmentsService {
  static async list() {
    const rows = await db.prepare('SELECT * FROM departments ORDER BY name').all() as any[];
    if (rows.length === 0) return [];
    const membersMap = await fetchMembersMap(rows.map((r: any) => r.id));
    return rows.map((d: any) => {
      const members = membersMap.get(d.id) ?? [];
      return { ...mapDepartment(d), members, memberCount: members.length };
    });
  }

  static async getById(id: string) {
    const d = await db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as any;
    if (!d) throw new AppError(404, 'Department not found');
    const members = (await fetchMembersMap([id])).get(id) ?? [];
    return { ...mapDepartment(d), members, memberCount: members.length };
  }

  static async create(input: any) {
    const id = uuid();
    const memberIds: string[] = Array.isArray(input.memberIds) ? input.memberIds : [];
    await db.transaction(async () => {
      if (await db.prepare('SELECT id FROM departments WHERE name = ?').get(input.name)) throw new AppError(409, 'Name already exists');
      await db.prepare('INSERT INTO departments (id, name, description, manager_id) VALUES (?, ?, ?, ?)').run(id, input.name, input.description ?? null, input.managerId ?? null);
      if (memberIds.length > 0) {
        const unique = [...new Set(memberIds)];
        const values = unique.map(() => '(?, ?)').join(', ');
        const params: any[] = [];
        for (const uid of unique) params.push(id, uid);
        await db.prepare(`INSERT IGNORE INTO department_members (department_id, user_id) VALUES ${values}`).run(...params);
      }
    })();
    return await this.getById(id);
  }

  static async update(id: string, input: any) {
    await this.getById(id);
    const sets = ["updated_at = NOW()"]; const params: any[] = [];
    if (input.name !== undefined) {
      const existing = await db.prepare('SELECT id FROM departments WHERE name = ? AND id != ?').get(input.name, id);
      if (existing) throw new AppError(409, 'Name already exists');
      sets.push('name = ?'); params.push(input.name);
    }
    if (input.description !== undefined) { sets.push('description = ?'); params.push(input.description); }
    if (input.managerId !== undefined) { sets.push('manager_id = ?'); params.push(input.managerId); }
    params.push(id);
    await db.transaction(async () => {
      await db.prepare(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      if (input.memberIds !== undefined) {
        await replaceMembers(id, Array.isArray(input.memberIds) ? input.memberIds : []);
      }
    })();
    return await this.getById(id);
  }

  static async addMembers(id: string, userIds: string[]) {
    await this.getById(id);
    if (!Array.isArray(userIds) || userIds.length === 0) return await this.getById(id);
    const unique = [...new Set(userIds)];
    const values = unique.map(() => '(?, ?)').join(', ');
    const params: any[] = [];
    for (const uid of unique) params.push(id, uid);
    await db.prepare(`INSERT IGNORE INTO department_members (department_id, user_id) VALUES ${values}`).run(...params);
    return await this.getById(id);
  }

  static async removeMembers(id: string, userIds: string[]) {
    await this.getById(id);
    if (!Array.isArray(userIds) || userIds.length === 0) return await this.getById(id);
    await db.prepare(`DELETE FROM department_members WHERE department_id = ? AND user_id IN (${userIds.map(() => '?').join(',')})`).run(id, ...userIds);
    return await this.getById(id);
  }

  static async getMemberIds(id: string) {
    await this.getById(id);
    return await fetchMemberIds(id);
  }

  static async delete(id: string) {
    await this.getById(id);
    await db.transaction(async () => {
      await db.prepare('DELETE FROM department_members WHERE department_id = ?').run(id);
      await db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    })();
    return { message: 'Department deleted' };
  }

  static async getStats() { return { total: (await db.prepare('SELECT count(*) as c FROM departments').get() as any).c }; }
}
