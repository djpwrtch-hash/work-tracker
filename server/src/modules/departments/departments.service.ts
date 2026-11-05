import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';

function mapDepartment(d: any) {
  return { id: d.id, name: d.name, description: d.description, managerId: d.manager_id, createdAt: d.created_at, updatedAt: d.updated_at };
}

export class DepartmentsService {
  static async list() {
    const rows = await db.prepare('SELECT * FROM departments ORDER BY name').all() as any[];
    return rows.map(mapDepartment);
  }

  static async getById(id: string) {
    const d = await db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as any;
    if (!d) throw new AppError(404, 'Department not found');
    return mapDepartment(d);
  }

  static async create(input: any) {
    const id = uuid();
    await db.transaction(async () => {
      if (await db.prepare('SELECT id FROM departments WHERE name = ?').get(input.name)) throw new AppError(409, 'Name already exists');
      await db.prepare('INSERT INTO departments (id, name, description, manager_id) VALUES (?, ?, ?, ?)').run(id, input.name, input.description ?? null, input.managerId ?? null);
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
    await db.prepare(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return await this.getById(id);
  }

  static async delete(id: string) {
    await this.getById(id);
    const count = (await db.prepare('SELECT count(*) as c FROM users WHERE department_id = ?').get(id) as any).c;
    if (count > 0) throw new AppError(409, 'Cannot delete department with employees');
    await db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    return { message: 'Department deleted' };
  }

  static async getStats() { return { total: (await db.prepare('SELECT count(*) as c FROM departments').get() as any).c }; }
}
