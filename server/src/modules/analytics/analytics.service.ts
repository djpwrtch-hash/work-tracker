import db from '../../db/index.js';
import { getISTDate, getISTNow } from '../../lib/time.js';

export class AnalyticsService {
  static async attendanceTrends(year: number, month: number) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const rows = await db.prepare(`SELECT date, status, count(*) as count FROM attendance
      WHERE date >= ? AND date <= ? GROUP BY date, status ORDER BY date`).all(start, end) as any[];

    const daily: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      if (!daily[r.date]) daily[r.date] = {};
      const day = daily[r.date]!;
      day[r.status] = r.count;
    }

    const result = [];
    for (let d = 1; d <= lastDay; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayStats = daily[date] ?? {};
      result.push({
        date,
        present: dayStats.present ?? 0,
        absent: dayStats.absent ?? 0,
        leave: dayStats.leave ?? 0,
        holiday: dayStats.holiday ?? 0,
        half_day: dayStats.half_day ?? 0,
        on_break: dayStats.on_break ?? 0,
        work_end: dayStats.work_end ?? 0,
        total: Object.values(dayStats).reduce((a: number, b: any) => a + b, 0),
      });
    }
    return result;
  }

  static async departmentStats() {
    const totalUsers = (await db.prepare("SELECT count(*) as c FROM users WHERE status = 'active'").get() as any).c;

    const deptRows = await db.prepare(`SELECT d.id, d.name, count(u.id) as user_count FROM departments d
      LEFT JOIN users u ON u.department_id = d.id AND u.status = 'active' GROUP BY d.id ORDER BY d.name`).all() as any[];

    const today = getISTDate();
    const attendanceRows = await db.prepare(`SELECT u.department_id, a.status, count(*) as count FROM attendance a
      JOIN users u ON a.user_id = u.id WHERE a.date = ? AND u.department_id IS NOT NULL GROUP BY u.department_id, a.status`).all(today) as any[];

    const deptMap = new Map<string, { present: number; absent: number; leave: number; holiday: number; total: number }>();
    for (const d of deptRows) {
      deptMap.set(d.id, { present: 0, absent: 0, leave: 0, holiday: 0, total: d.user_count });
    }
    for (const r of attendanceRows) {
      const stat = deptMap.get(r.department_id);
      if (stat) {
        if (r.status === 'present' || r.status === 'work_end' || r.status === 'on_break' || r.status === 'half_day' || r.status === 'remote') stat.present += r.count;
        else if (r.status === 'absent') stat.absent += r.count;
        else if (r.status === 'leave') stat.leave += r.count;
        else if (r.status === 'holiday') stat.holiday += r.count;
      }
    }

    return {
      totalUsers,
      departments: Array.from(deptMap.entries()).map(([id, s]) => {
        const expected = s.total - s.leave - s.holiday;
        return {
          id, name: deptRows.find((d: any) => d.id === id)?.name ?? 'Unknown',
          total: s.total, present: s.present, absent: s.absent,
          attendanceRate: expected > 0 ? Math.round((s.present / expected) * 100) : 0,
        };
      }),
    };
  }

  static async leaveUsage(year: number) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;

    const leaves = await db.prepare(`SELECT l.type, l.start_date, l.end_date FROM leaves l
      WHERE l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?`).all(end, start) as any[];

    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const monthLabels = months.map((m) => ({
      month: m, label: new Date(2000, parseInt(m) - 1, 1).toLocaleString('en-US', { month: 'short' }),
    }));
    const types = [...new Set(leaves.map((r: any) => r.type))] as string[];

    const monthlyMap = new Map<string, Record<string, number>>();
    for (const m of months) {
      const entry: Record<string, number> = {};
      for (const t of types) entry[t] = 0;
      monthlyMap.set(m, entry);
    }

    const totalByType: Record<string, number> = {};
    for (const t of types) totalByType[t] = 0;

    // Fetch company-wide holidays (no assignees) for the year to exclude them from leave counting
    const holidays = new Set((await db.prepare(`
      SELECT h.date FROM holidays h
      LEFT JOIN holiday_assignees ha ON ha.holiday_id = h.id
      WHERE h.date >= ? AND h.date <= ?
      GROUP BY h.id HAVING COUNT(ha.user_id) = 0
    `).all(start, end) as any[]).map((h: any) => h.date));
    const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

    for (const l of leaves) {
      const clipStart = parseDate(l.start_date) < parseDate(start) ? parseDate(start) : parseDate(l.start_date);
      const clipEnd = parseDate(l.end_date) > parseDate(end) ? parseDate(end) : parseDate(l.end_date);

      let cursor = new Date(clipStart);
      while (cursor <= clipEnd) {
        const dayOfWeek = cursor.getUTCDay();
        const dateStr = cursor.toISOString().split('T')[0]!;
        if (dayOfWeek !== 0 && !holidays.has(dateStr)) {
          const monthKey = String(cursor.getUTCMonth() + 1).padStart(2, '0');
          const entry = monthlyMap.get(monthKey);
          if (entry) entry[l.type] = (entry[l.type] ?? 0) + 1;
          totalByType[l.type] = (totalByType[l.type] ?? 0) + 1;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const result = monthLabels.map(({ month, label }) => ({
      month, label, ...monthlyMap.get(month),
    }));

    return { monthly: result, totals: totalByType };
  }

  static async taskSummary() {
    const total = (await db.prepare('SELECT count(*) as c FROM tasks').get() as any).c;
    const byStatus = await db.prepare('SELECT status, count(*) as count FROM tasks GROUP BY status').all() as any[];
    const today = getISTDate();
    const overdue = (await db.prepare("SELECT count(*) as c FROM tasks WHERE status NOT IN ('completed','cancelled') AND date(due_date) < ?").get(today) as any).c;
    const completionRate = total > 0 ? Math.round(((byStatus.find((s: any) => s.status === 'completed')?.count ?? 0) / total) * 100) : 0;

    return { total, byStatus, overdue, completionRate };
  }

  static async overtimeAnalytics(year: number) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;

    const rows = await db.prepare(`
      SELECT u.department_id, d.name as dept_name,
        DATE_FORMAT(a.date, '%m') as month,
        COALESCE(SUM(a.overtime_hours), 0) as total_overtime,
        COUNT(DISTINCT a.user_id) as user_count
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE a.date >= ? AND a.date <= ? AND a.overtime_hours > 0
      GROUP BY u.department_id, month
      ORDER BY month
    `).all(start, end) as any[];

    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const monthlyMap = new Map<string, Record<string, number>>();
    for (const m of months) monthlyMap.set(m, {});

    for (const r of rows) {
      const monthKey = String(r.month).padStart(2, '0');
      const entry = monthlyMap.get(monthKey);
      if (entry) entry[r.dept_name ?? 'Unassigned'] = (entry[r.dept_name ?? 'Unassigned'] ?? 0) + r.total_overtime;
    }

    const departments = [...new Set(rows.map((r: any) => r.dept_name ?? 'Unassigned'))];
    const monthly = months.map((m) => {
      const entry = monthlyMap.get(m)!;
      const label = new Date(2000, parseInt(m) - 1, 1).toLocaleString('en-US', { month: 'short' });
      return { month: m, label, ...entry };
    });

    const totals = departments.reduce((acc: Record<string, number>, dept) => {
      acc[dept] = rows.filter((r: any) => (r.dept_name ?? 'Unassigned') === dept).reduce((s: number, r: any) => s + r.total_overtime, 0);
      return acc;
    }, {} as Record<string, number>);

    return { monthly, departments, totals };
  }

  static async productivity(userId?: string, startDate?: string, endDate?: string) {
    const today = getISTDate();
    const start = startDate || today;
    const end = endDate || today;

    if (userId) {
      const stats = await db.prepare(`
        SELECT
          COUNT(*) as tasksAssigned,
          SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as tasksCompleted,
          AVG(CASE WHEN t.status = 'completed' THEN t.actual_hours END) as avgCompletionTimeHours
        FROM tasks t
        JOIN task_assignments ta ON ta.task_id = t.id
        WHERE ta.user_id = ? AND date(t.created_at) >= ? AND date(t.created_at) <= ?
      `).get(userId, start, end) as any;

      const daily = await db.prepare(`
        SELECT
          date(t.completed_at) as date,
          COUNT(*) as completed,
          COALESCE(SUM(t.actual_hours), 0) as hours
        FROM tasks t
        JOIN task_assignments ta ON ta.task_id = t.id
        WHERE ta.user_id = ? AND t.status = 'completed'
          AND date(t.completed_at) >= ? AND date(t.completed_at) <= ?
        GROUP BY date(t.completed_at) ORDER BY date
      `).all(userId, start, end) as any[];

      const tasksAssigned = stats?.tasksAssigned ?? 0;
      const tasksCompleted = stats?.tasksCompleted ?? 0;

      return {
        userId,
        period: { start, end },
        tasksCompleted,
        tasksAssigned,
        avgCompletionTimeHours: stats?.avgCompletionTimeHours != null
          ? Math.round(stats.avgCompletionTimeHours * 10) / 10
          : 0,
        efficiency: tasksAssigned > 0
          ? Math.round((tasksCompleted / tasksAssigned) * 100 * 10) / 10
          : 0,
        dailyBreakdown: daily,
      };
    }

    const rows = await db.prepare(`
      SELECT
        ta.user_id,
        COUNT(*) as tasksAssigned,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as tasksCompleted,
        AVG(CASE WHEN t.status = 'completed' THEN t.actual_hours END) as avgCompletionTimeHours
      FROM tasks t
      JOIN task_assignments ta ON ta.task_id = t.id
      WHERE date(t.created_at) >= ? AND date(t.created_at) <= ?
      GROUP BY ta.user_id
    `).all(start, end) as any[];

    const dailyAll = await db.prepare(`
      SELECT
        ta.user_id,
        date(t.completed_at) as date,
        COUNT(*) as completed,
        COALESCE(SUM(t.actual_hours), 0) as hours
      FROM tasks t
      JOIN task_assignments ta ON ta.task_id = t.id
      WHERE t.status = 'completed' AND date(t.completed_at) >= ? AND date(t.completed_at) <= ?
      GROUP BY ta.user_id, date(t.completed_at) ORDER BY ta.user_id
    `).all(start, end) as any[];

    const dailyMap = new Map<string, any[]>();
    for (const d of dailyAll) {
      const list = dailyMap.get(d.user_id) || [];
      list.push({ date: d.date, completed: d.completed, hours: d.hours });
      dailyMap.set(d.user_id, list);
    }

    return rows.map((r: any) => {
      const assigned = r.tasksAssigned ?? 0;
      const completed = r.tasksCompleted ?? 0;
      return {
        userId: r.user_id,
        period: { start, end },
        tasksCompleted: completed,
        tasksAssigned: assigned,
        avgCompletionTimeHours: r.avgCompletionTimeHours != null
          ? Math.round(r.avgCompletionTimeHours * 10) / 10
          : 0,
        efficiency: assigned > 0
          ? Math.round((completed / assigned) * 100 * 10) / 10
          : 0,
        dailyBreakdown: dailyMap.get(r.user_id) || [],
      };
    });
  }

  static async departmentPerformance() {
    const now = getISTNow();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const deptRows = await db.prepare(`
      SELECT d.id, d.name, COUNT(u.id) as totalUsers
      FROM departments d
      LEFT JOIN users u ON u.department_id = d.id AND u.status = 'active'
      GROUP BY d.id, d.name ORDER BY d.name
    `).all() as any[];

    const attendanceRows = await db.prepare(`
      SELECT u.department_id,
        COUNT(*) as totalRecords,
        SUM(CASE WHEN a.status IN ('present', 'work_end', 'on_break', 'half_day', 'remote') THEN 1 ELSE 0 END) as presentRecords
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      WHERE a.date >= ? AND a.date <= ? AND u.department_id IS NOT NULL
      GROUP BY u.department_id
    `).all(monthStart, monthEnd) as any[];

    const taskRows = await db.prepare(`
      SELECT department_id,
        COUNT(*) as totalTasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks
      FROM tasks
      WHERE department_id IS NOT NULL
      GROUP BY department_id
    `).all() as any[];

    const leaveRows = await db.prepare(`
      SELECT u.department_id, COUNT(*) as leaveDays
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      WHERE a.date >= ? AND a.date <= ? AND a.status = 'leave' AND u.department_id IS NOT NULL
      GROUP BY u.department_id
    `).all(monthStart, monthEnd) as any[];

    const overtimeRows = await db.prepare(`
      SELECT u.department_id, SUM(a.overtime_hours) as totalOvertimeHours
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      WHERE a.date >= ? AND a.date <= ? AND a.overtime_hours > 0 AND u.department_id IS NOT NULL
      GROUP BY u.department_id
    `).all(monthStart, monthEnd) as any[];

    const attMap = new Map(attendanceRows.map((r: any) => [r.department_id, r]));
    const taskMap = new Map(taskRows.map((r: any) => [r.department_id, r]));
    const leaveMap = new Map(leaveRows.map((r: any) => [r.department_id, r]));
    const otMap = new Map(overtimeRows.map((r: any) => [r.department_id, r]));

    return {
      departments: deptRows.map((d: any) => {
        const att = attMap.get(d.id);
        const tasks = taskMap.get(d.id);
        const leaves = leaveMap.get(d.id);
        const ot = otMap.get(d.id);

        const avgAttendanceRate = att && att.totalRecords > 0
          ? Math.round((att.presentRecords / att.totalRecords) * 1000) / 10
          : 0;
        const taskCompletionRate = tasks && tasks.totalTasks > 0
          ? Math.round((tasks.completedTasks / tasks.totalTasks) * 1000) / 10
          : 0;
        const avgLeaveDays = d.totalUsers > 0 && leaves
          ? Math.round((leaves.leaveDays / d.totalUsers) * 10) / 10
          : 0;

        return {
          id: d.id,
          name: d.name,
          totalUsers: d.totalUsers,
          avgAttendanceRate,
          taskCompletionRate,
          avgLeaveDays,
          totalOvertimeHours: ot?.totalOvertimeHours ?? 0,
        };
      }),
    };
  }

  static async employeeProductivity(departmentId?: string, period: string = 'month') {
    const today = getISTDate();
    const now = getISTNow();
    let start: string;

    switch (period) {
      case 'week': {
        const dow = now.getDay();
        const offset = dow === 0 ? 6 : dow - 1;
        const d = new Date(now);
        d.setDate(d.getDate() - offset);
        start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        break;
      }
      case 'quarter': {
        const q = Math.floor(now.getMonth() / 3);
        start = `${now.getFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`;
        break;
      }
      case 'year':
        start = `${now.getFullYear()}-01-01`;
        break;
      case 'month':
      default:
        start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    const userWhere = departmentId
      ? 'WHERE u.status = ? AND u.department_id = ?'
      : 'WHERE u.status = ?';
    const userParams = departmentId ? ['active', departmentId] : ['active'];

    const users = await db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.department_id, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      ${userWhere}
      ORDER BY u.first_name, u.last_name
    `).all(...userParams) as any[];

    if (users.length === 0) {
      return { period, employees: [] };
    }

    const userIds = users.map((u: any) => u.id);
    const ph = userIds.map(() => '?').join(',');

    const taskStats = await db.prepare(`
      SELECT ta.user_id,
        COUNT(*) as tasksAssigned,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as tasksCompleted
      FROM task_assignments ta
      JOIN tasks t ON t.id = ta.task_id
      WHERE ta.user_id IN (${ph}) AND date(t.created_at) >= ? AND date(t.created_at) <= ?
      GROUP BY ta.user_id
    `).all(...userIds, start, today) as any[];

    const attStats = await db.prepare(`
      SELECT user_id,
        COUNT(*) as totalDays,
        SUM(CASE WHEN status IN ('present', 'work_end', 'on_break', 'half_day', 'remote') THEN 1 ELSE 0 END) as presentDays,
        AVG(working_hours) as avgHoursPerDay
      FROM attendance
      WHERE user_id IN (${ph}) AND date >= ? AND date <= ?
      GROUP BY user_id
    `).all(...userIds, start, today) as any[];

    const taskMap = new Map(taskStats.map((r: any) => [r.user_id, r]));
    const attMap = new Map(attStats.map((r: any) => [r.user_id, r]));

    const employees = users.map((u: any) => {
      const t = taskMap.get(u.id);
      const a = attMap.get(u.id);
      const tasksAssigned = t?.tasksAssigned ?? 0;
      const tasksCompleted = t?.tasksCompleted ?? 0;
      const totalDays = a?.totalDays ?? 0;
      const presentDays = a?.presentDays ?? 0;

      return {
        userId: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        departmentId: u.department_id,
        departmentName: u.department_name ?? 'Unknown',
        tasksCompleted,
        tasksAssigned,
        avgHoursPerDay: a?.avgHoursPerDay != null ? Math.round(a.avgHoursPerDay * 10) / 10 : 0,
        efficiency: tasksAssigned > 0
          ? Math.round((tasksCompleted / tasksAssigned) * 100 * 10) / 10
          : 0,
        attendanceRate: totalDays > 0
          ? Math.round((presentDays / totalDays) * 100 * 10) / 10
          : 0,
      };
    });

    employees.sort((a: any, b: any) => b.efficiency - a.efficiency);

    return { period, employees };
  }

  static async managerDashboard(managerId: string) {
    const today = getISTDate();
    const now = getISTNow();

    const dow = now.getDay();
    const offset = dow === 0 ? 6 : dow - 1;
    const mon = new Date(now);
    mon.setDate(mon.getDate() - offset);
    const weekStart = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;

    const teamRows = await db.prepare(
      'SELECT DISTINCT team_name FROM team_members WHERE user_id = ?'
    ).all(managerId) as any[];

    const teamNames = teamRows.map((r: any) => r.team_name);

    if (teamNames.length === 0) {
      return {
        teamSize: 0,
        teamAttendanceToday: { present: 0, absent: 0, leave: 0 },
        pendingApprovals: { tasks: 0, leaves: 0, reports: 0 },
        teamWorkload: [],
        upcomingDeadlines: [],
      };
    }

    const tnPh = teamNames.map(() => '?').join(',');

    const members = await db.prepare(`
      SELECT tm.user_id, u.first_name, u.last_name
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.team_name IN (${tnPh}) AND u.status = 'active'
    `).all(...teamNames) as any[];

    const memberMap = new Map<string, { firstName: string; lastName: string }>();
    for (const m of members) {
      if (m.user_id !== managerId && !memberMap.has(m.user_id)) {
        memberMap.set(m.user_id, { firstName: m.first_name, lastName: m.last_name });
      }
    }
    const memberIds = Array.from(memberMap.keys());

    if (memberIds.length === 0) {
      return {
        teamSize: 0,
        teamAttendanceToday: { present: 0, absent: 0, leave: 0 },
        pendingApprovals: { tasks: 0, leaves: 0, reports: 0 },
        teamWorkload: [],
        upcomingDeadlines: [],
      };
    }

    const mPh = memberIds.map(() => '?').join(',');

    const todayAtt = await db.prepare(`
      SELECT user_id, status
      FROM attendance
      WHERE date = ? AND user_id IN (${mPh})
    `).all(today, ...memberIds) as any[];

    let present = 0, absent = 0, leave = 0;
    const attended = new Set<string>();
    for (const a of todayAtt) {
      attended.add(a.user_id);
      if (['present', 'work_end', 'on_break', 'half_day', 'remote'].includes(a.status)) present++;
      else if (a.status === 'absent') absent++;
      else if (a.status === 'leave') leave++;
    }
    absent += memberIds.filter(id => !attended.has(id)).length;

    const pendingTasks = (await db.prepare(`
      SELECT COUNT(*) as c FROM task_approvals
      WHERE status = 'pending' AND requested_by_id IN (${mPh})
    `).get(...memberIds) as any)?.c ?? 0;

    const pendingLeaves = (await db.prepare(`
      SELECT COUNT(*) as c FROM leaves
      WHERE status = 'pending' AND user_id IN (${mPh})
    `).get(...memberIds) as any)?.c ?? 0;

    const pendingReports = (await db.prepare(`
      SELECT COUNT(*) as c FROM work_reports
      WHERE status != 'draft' AND reviewed_by_id IS NULL AND user_id IN (${mPh})
    `).get(...memberIds) as any)?.c ?? 0;

    const workload = await db.prepare(`
      SELECT ta.user_id,
        SUM(CASE WHEN t.status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) as activeTasks,
        SUM(CASE WHEN t.status = 'completed' AND date(t.completed_at) >= ? THEN 1 ELSE 0 END) as completedThisWeek
      FROM task_assignments ta
      JOIN tasks t ON t.id = ta.task_id
      WHERE ta.user_id IN (${mPh})
      GROUP BY ta.user_id
    `).all(weekStart, ...memberIds) as any[];

    const workloadMap = new Map(workload.map((w: any) => [w.user_id, w]));

    const teamWorkload = memberIds.map(id => {
      const m = memberMap.get(id)!;
      const w = workloadMap.get(id);
      return {
        userId: id,
        name: `${m.firstName} ${m.lastName}`,
        activeTasks: w?.activeTasks ?? 0,
        completedThisWeek: w?.completedThisWeek ?? 0,
      };
    });

    const deadlines = await db.prepare(`
      SELECT t.id as taskId, t.title, t.due_date as dueDate, ta.user_id as assigneeId
      FROM tasks t
      JOIN task_assignments ta ON ta.task_id = t.id
      WHERE ta.user_id IN (${mPh})
        AND t.status NOT IN ('completed', 'cancelled')
        AND t.due_date IS NOT NULL
        AND t.due_date >= ?
      ORDER BY t.due_date ASC
      LIMIT 10
    `).all(...memberIds, today) as any[];

    const upcomingDeadlines = deadlines.map((d: any) => {
      const m = memberMap.get(d.assigneeId);
      return {
        taskId: d.taskId,
        title: d.title,
        dueDate: d.dueDate,
        assignee: m ? `${m.firstName} ${m.lastName}` : 'Unknown',
      };
    });

    return {
      teamSize: memberIds.length,
      teamAttendanceToday: { present, absent, leave },
      pendingApprovals: { tasks: pendingTasks, leaves: pendingLeaves, reports: pendingReports },
      teamWorkload,
      upcomingDeadlines,
    };
  }
}
