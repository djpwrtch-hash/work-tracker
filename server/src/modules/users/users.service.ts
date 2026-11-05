import bcrypt from 'bcrypt';
import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';
import { bcryptBreaker } from '../../lib/circuit-breaker.js';
import { generateEmployeeId } from '../../lib/employee-id.js';
import { invalidateUserCache } from '../../middleware/authenticate.js';
import type { CreateUserInput, UpdateUserInput, ListUsersInput } from './users.schema.js';
import { getPasswordPolicy, validatePassword } from '../../lib/password-policy.js';

const SALT_ROUNDS = 12;

function toSQLDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes('T')) return s.slice(0, 10);
  return s;
}

function mapUser(u: any) {
  return {
    id: u.id, employeeId: u.employee_id, firstName: u.first_name, lastName: u.last_name,
    email: u.email, role: u.role, status: u.status, departmentId: u.department_id,
    designation: u.designation, phoneNumber: u.phone_number, joiningDate: u.joining_date,
    dob: u.dob, gender: u.gender, fatherName: u.father_name, nationality: u.nationality,
    qualification: u.qualification, addressStreet: u.address_street, addressCity: u.address_city,
    addressState: u.address_state, addressPincode: u.address_pincode,
    profilePictureUrl: u.profile_picture_url,
    twoFactorEnabled: !!u.two_factor_enabled, lastLoginAt: u.last_login_at,
    createdAt: u.created_at, updatedAt: u.updated_at,
  };
}

export async function nextEmployeeId(): Promise<string> {
  return generateEmployeeId();
}

export class UsersService {
  static async list(input: ListUsersInput) {
    const { page = 1, limit = 20, role, status, departmentId, search } = input;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: any[] = [];

    if (role) { conditions.push('role = ?'); params.push(role); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (departmentId) { conditions.push('department_id = ?'); params.push(departmentId); }
    if (search) { const escaped = search.replace(/[\\%_]/g, '\\$&'); conditions.push("(first_name LIKE ? ESCAPE '\\\\' OR last_name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\' OR employee_id LIKE ? ESCAPE '\\\\')"); params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT count(*) as c FROM users ${where}`).get(...params) as any).c;
    const rows = await db.prepare(`SELECT id, employee_id, first_name, last_name, email, role, designation, department_id, status, phone_number, joining_date, dob, gender, father_name, nationality, qualification, address_street, address_city, address_state, address_pincode, profile_picture_url, two_factor_enabled, last_login_at, created_at, updated_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { users: rows.map(mapUser), total: count, page, limit };
  }

  static async getById(id: string) {
    const u = await db.prepare('SELECT id, employee_id, first_name, last_name, email, role, status, department_id, designation, phone_number, joining_date, dob, gender, father_name, nationality, qualification, address_street, address_city, address_state, address_pincode, profile_picture_url, two_factor_enabled, last_login_at, created_at, updated_at FROM users WHERE id = ?').get(id) as any;
    if (!u) throw new AppError(404, 'User not found');
    return mapUser(u);
  }

  static async create(input: CreateUserInput) {
    const policy = await getPasswordPolicy();
    const { valid, errors } = await validatePassword(input.password, policy);
    if (!valid) throw new AppError(400, `Password does not meet policy: ${errors.join('; ')}`);

    const id = uuid();
    const passwordHash = await bcryptBreaker.call(() => bcrypt.hash(input.password, SALT_ROUNDS));

    await db.transaction(async () => {
      const empId = await nextEmployeeId();

      const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(input.email);
      if (existing) throw new AppError(409, 'Email already exists');

      await db.prepare(`INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash, role, phone_number, department_id, designation, joining_date, dob, gender, father_name, nationality, qualification, address_street, address_city, address_state, address_pincode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, empId, input.firstName, input.lastName, input.email, passwordHash, input.role, input.phoneNumber ?? null, input.departmentId ?? null, input.designation ?? null, toSQLDate(input.joiningDate), toSQLDate(input.dob), input.gender, input.fatherName, input.nationality, input.qualification, input.addressStreet, input.addressCity, input.addressState, input.addressPincode);

      return empId;
    })();
    // Retroactively create holiday attendance rows for existing global holidays (so new user sees them)
    try {
      const upcomingGlobalHolidays = await db.prepare(`
        SELECT h.date, h.name FROM holidays h
        LEFT JOIN holiday_assignees ha ON ha.holiday_id = h.id
        WHERE h.date >= CURDATE()
        GROUP BY h.id HAVING COUNT(ha.user_id) = 0
      `).all() as any[];
      if (upcomingGlobalHolidays.length > 0) {
        const insertAtt = db.prepare(`INSERT INTO attendance (id, user_id, date, status, notes, created_at, updated_at) VALUES (?, ?, ?, 'holiday', ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE status = VALUES(status)`);
        const trx = await db.transaction(async () => {
          for (const h of upcomingGlobalHolidays) {
            await insertAtt.run(uuid(), id, h.date, h.name);
          }
        });
        await trx();
      }
    } catch (e) {
      console.error('[Users] Failed to create retroactive holiday attendance for new user', e);
    }
    return await this.getById(id);
  }

  static async update(id: string, input: UpdateUserInput, requesterRole?: string) {
    if (!await db.prepare('SELECT id FROM users WHERE id = ?').get(id)) throw new AppError(404, 'User not found');
    const allowedFields = ['firstName', 'lastName', 'phoneNumber', 'departmentId', 'designation', 'joiningDate', 'status', 'role', 'dob', 'gender', 'fatherName', 'nationality', 'qualification', 'addressStreet', 'addressCity', 'addressState', 'addressPincode'];
    // Privilege guard: only directors may change role or status (HR would otherwise self-promote)
    const sanitized: Record<string, unknown> = { ...(input as Record<string, unknown>) };
    if (requesterRole !== 'director') {
      delete sanitized.role;
      delete sanitized.status;
    }
    const sets: string[] = ["updated_at = NOW()"];
    const params: any[] = [];
    for (const [k, v] of Object.entries(sanitized)) {
      if (v === undefined || !allowedFields.includes(k)) continue;
      const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      sets.push(`${col} = ?`);
      params.push((k === 'joiningDate' || k === 'dob') ? toSQLDate(v) : v);
    }
    params.push(id);
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    invalidateUserCache(id);
    return await this.getById(id);
  }

  static async delete(id: string, input: any) {
    if (input.confirm !== 'DELETE') throw new AppError(400, 'Deleting a user requires confirm=DELETE in the request body');
    if (!await db.prepare('SELECT id FROM users WHERE id = ?').get(id)) throw new AppError(404, 'User not found');

    const tasks = (await db.prepare('SELECT COUNT(*) as c FROM tasks WHERE created_by_id = ?').get(id) as any).c;
    if (tasks > 0) throw new AppError(409, `Cannot delete user: they created ${tasks} task(s). Delete or reassign those tasks first.`);
    const holidays = (await db.prepare('SELECT COUNT(*) as c FROM holidays WHERE created_by = ?').get(id) as any).c;
    if (holidays > 0) throw new AppError(409, `Cannot delete user: they created ${holidays} holiday(s). Delete those holidays first.`);

    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
    invalidateUserCache(id);
    return { message: 'User deleted' };
  }

  static async getStats() {
    const stats = await db.prepare('SELECT role, COUNT(*) as count, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) as active FROM users GROUP BY role').all() as any[];
    const total = stats.reduce((sum: number, r: any) => sum + r.count, 0);
    const active = stats.reduce((sum: number, r: any) => sum + (r.active || 0), 0);
    const roleMap = Object.fromEntries(stats.map((r: any) => [r.role, r.count]));
    return { total, active, admins: roleMap.director || 0, hrs: roleMap.hr || 0, employees: roleMap.employee || 0 };
  }
}
