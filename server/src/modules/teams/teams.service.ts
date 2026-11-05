import db from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';

export class TeamsService {
  static async list() {
    const rows = await db.prepare(`SELECT tm.team_name, tm.user_id, u.first_name, u.last_name, u.email, u.role, tm.role as member_role
      FROM team_members tm JOIN users u ON tm.user_id = u.id ORDER BY tm.team_name`).all() as any[];
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const arr = map.get(r.team_name) ?? [];
      arr.push({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, memberRole: r.member_role });
      map.set(r.team_name, arr);
    }
    return Array.from(map.entries()).map(([teamName, members]) => ({ teamName, members, memberCount: members.length }));
  }

  static async getMyTeams(userId: string) {
    const rows = await db.prepare(`SELECT tm.team_name, tm.user_id, u.first_name, u.last_name, u.email, u.role, tm.role as member_role
      FROM team_members tm JOIN users u ON tm.user_id = u.id WHERE tm.team_name IN (SELECT team_name FROM team_members WHERE user_id = ?) ORDER BY tm.team_name`).all(userId) as any[];
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const arr = map.get(r.team_name) ?? [];
      arr.push({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, memberRole: r.member_role });
      map.set(r.team_name, arr);
    }
    return Array.from(map.entries()).map(([teamName, members]) => ({ teamName, members, memberCount: members.length }));
  }

  static async getByName(teamName: string) {
    const rows = await db.prepare(`SELECT tm.user_id, u.first_name, u.last_name, u.email, u.role, u.employee_id, tm.role as member_role
      FROM team_members tm JOIN users u ON tm.user_id = u.id WHERE tm.team_name = ?`).all(teamName) as any[];
    if (rows.length === 0) throw new AppError(404, 'Team not found');
    return { teamName, members: rows.map((r: any) => ({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, employeeId: r.employee_id, memberRole: r.member_role })), memberCount: rows.length };
  }

  static async create(input: { teamName: string; memberIds: string[]; leaderId?: string }) {
    if (input.leaderId && !input.memberIds.includes(input.leaderId)) {
      throw new AppError(400, 'Leader must be a team member');
    }
    await db.transaction(async () => {
      const c = (await db.prepare('SELECT count(*) as c FROM team_members WHERE team_name = ?').get(input.teamName) as any).c;
      if (c > 0) throw new AppError(409, 'Team name already exists');
      if (input.memberIds.length > 0) {
        const ph = input.memberIds.map(() => '(?, ?, ?)').join(', ');
        const p: any[] = [];
        for (const uid of input.memberIds) {
          p.push(uid, input.teamName, uid === input.leaderId ? 'leader' : 'member');
        }
        await db.prepare(`INSERT INTO team_members (user_id, team_name, role) VALUES ${ph}`).run(...p);
      }
    })();
    return await this.getByName(input.teamName);
  }

  static async update(teamName: string, input: { memberIds: string[]; leaderId?: string }) {
    const exists = (await db.prepare('SELECT count(*) as c FROM team_members WHERE team_name = ?').get(teamName) as any).c;
    if (exists === 0) throw new AppError(404, 'Team not found');
    if (input.leaderId && !input.memberIds.includes(input.leaderId)) {
      throw new AppError(400, 'Leader must be a team member');
    }
    await db.transaction(async () => {
      await db.prepare('DELETE FROM team_members WHERE team_name = ?').run(teamName);
      if (input.memberIds.length > 0) {
        const ph = input.memberIds.map(() => '(?, ?, ?)').join(', ');
        const p: any[] = [];
        for (const uid of input.memberIds) {
          p.push(uid, teamName, uid === input.leaderId ? 'leader' : 'member');
        }
        await db.prepare(`INSERT INTO team_members (user_id, team_name, role) VALUES ${ph}`).run(...p);
      }
    })();
    return await this.getByName(teamName);
  }

  static async delete(teamName: string) {
    const c = (await db.prepare('SELECT count(*) as c FROM team_members WHERE team_name = ?').get(teamName) as any).c;
    if (c === 0) throw new AppError(404, 'Team not found');
    await db.prepare('DELETE FROM team_members WHERE team_name = ?').run(teamName);
    return { message: 'Team deleted' };
  }

  static async addMembers(teamName: string, userIds: string[]) {
    if (userIds.length === 0) return await this.getByName(teamName);
    return await db.transaction(async () => {
      const exists = (await db.prepare('SELECT count(*) as c FROM team_members WHERE team_name = ?').get(teamName) as any).c;
      if (exists === 0) throw new AppError(404, 'Team not found');
      const ph = userIds.map(() => '(?, ?, ?)').join(', ');
      const p: any[] = [];
      for (const uid of userIds) { p.push(uid, teamName, 'member'); }
      await db.prepare(`INSERT IGNORE INTO team_members (user_id, team_name, role) VALUES ${ph}`).run(...p);
      return await this.getByName(teamName);
    })();
  }

  static async removeMembers(teamName: string, userIds: string[]) {
    if (userIds.length === 0) return await this.getByName(teamName);
    return await db.transaction(async () => {
      await db.prepare(`DELETE FROM team_members WHERE team_name = ? AND user_id IN (${userIds.map(() => '?').join(',')})`).run(teamName, ...userIds);
      const remaining = (await db.prepare('SELECT count(*) as c FROM team_members WHERE team_name = ?').get(teamName) as any).c;
      if (remaining === 0) {
        return { message: 'Team deleted (no members remaining)' };
      }
      return await this.getByName(teamName);
    })();
  }

  static async getTeamsWithStats() {
    const teams = await this.list();
    if (teams.length === 0) return [];

    // Batch: get all member IDs across all teams
    const allMemberIds = new Set<string>();
    for (const t of teams) {
      for (const m of t.members) allMemberIds.add(m.userId);
    }
    if (allMemberIds.size === 0) return teams.map(t => ({ ...t, avgTaskProgress: 0 }));

    const memberArr = [...allMemberIds];
    const ph = memberArr.map(() => '?').join(',');
    const progressRows = await db.prepare(`
      SELECT ta.user_id, ROUND(AVG(CASE WHEN t.status = 'completed' THEN 100.0 ELSE t.progress_percent END), 0) as avg_progress
      FROM tasks t
      JOIN task_assignments ta ON t.id = ta.task_id
      WHERE ta.user_id IN (${ph})
      GROUP BY ta.user_id
    `).all(...memberArr) as any[];
    const progressMap = new Map<string, number>();
    for (const r of progressRows) progressMap.set(r.user_id, r.avg_progress);

    return teams.map(t => {
      const memberIds = t.members.map((m: any) => m.userId);
      const avg = memberIds.length > 0
        ? Math.round(memberIds.reduce((sum: number, id: string) => sum + (progressMap.get(id) ?? 0), 0) / memberIds.length)
        : 0;
      return { ...t, avgTaskProgress: avg };
    });
  }
}
