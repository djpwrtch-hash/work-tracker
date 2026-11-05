import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';
import { getISTDate } from '../../lib/time.js';
import { sendTaskAssignment } from '../../lib/email.js';

function mapTask(t: any) {
  return {
    id: t.id, title: t.title, description: t.description, priority: t.priority, status: t.status,
    createdById: t.created_by_id, departmentId: t.department_id,
    progressPercent: t.progress_percent, dueDate: t.due_date,
    startedAt: t.started_at, completedAt: t.completed_at,
    estimatedHours: t.estimated_hours, actualHours: t.actual_hours,
    createdAt: t.created_at, updatedAt: t.updated_at,
  };
}

function mapComment(c: any) {
  return {
    id: c.id, taskId: c.task_id, authorId: c.author_id, message: c.message,
    firstName: c.first_name, lastName: c.last_name,
    createdAt: c.created_at, updatedAt: c.updated_at,
  };
}

export class TasksService {
  static async create(createdById: string, input: any) {
    return await db.transaction(async () => {
      const id = uuid();
      await db.prepare(`INSERT INTO tasks (id, title, description, priority, due_date, created_by_id, department_id, estimated_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.title, input.description ?? null, input.priority ?? 'medium', input.dueDate ? new Date(input.dueDate).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') : null, createdById, input.departmentId ?? null, input.estimatedHours ?? null);
      const taskPh = input.assigneeIds.map(() => '(?, ?)').join(', ');
      const tp: any[] = [];
      for (const uid of input.assigneeIds) { tp.push(id, uid); }
      await db.prepare(`INSERT INTO task_assignments (task_id, user_id) VALUES ${taskPh}`).run(...tp);
      const task = await db.prepare('SELECT id, title, description, priority, status, created_by_id, department_id, progress_percent, due_date, started_at, completed_at, estimated_hours, actual_hours, created_at, updated_at FROM tasks WHERE id = ?').get(id) as any;
      const notifPh = input.assigneeIds.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const np: any[] = [];
      for (const uid of input.assigneeIds) {
        np.push(uuid(), uid, createdById, 'New Task Assigned', `You have been assigned task: ${task.title}`, 'task', `/tasks/${id}`);
      }
      await db.prepare(`INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES ${notifPh}`).run(...np);

      if (input.assigneeIds.length > 0) {
        const placeholders = input.assigneeIds.map(() => '?').join(',');
        const assignees = await db.prepare(`SELECT id, email, first_name, last_name FROM users WHERE id IN (${placeholders})`).all(...input.assigneeIds) as any[];
        for (const assignee of assignees) {
          try { await sendTaskAssignment({ id, title: task.title }, { id: assignee.id, email: assignee.email, firstName: assignee.first_name, lastName: assignee.last_name }); } catch (e: any) { console.error('[Email] Failed:', e.message); }
        }
      }
      return mapTask(task);
    })();
  }

  static async list(input: any, userId: string, role: string) {
    const { page = 1, limit = 20, status, statuses, priority, priorities, search, assigneeId, assigneeIds, departmentId, dueBefore, dueAfter } = input;
    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: any[] = [];

    if (role === 'employee') {
      conds.push(`t.id IN (SELECT task_id FROM task_assignments WHERE user_id = ? UNION SELECT id FROM tasks WHERE created_by_id = ?)`);
      params.push(userId, userId);
    }
    if (status) { conds.push('t.status = ?'); params.push(status); }
    if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(',');
      conds.push(`t.status IN (${placeholders})`);
      params.push(...statuses);
    }
    if (priority) { conds.push('t.priority = ?'); params.push(priority); }
    if (priorities && priorities.length > 0) {
      const placeholders = priorities.map(() => '?').join(',');
      conds.push(`t.priority IN (${placeholders})`);
      params.push(...priorities);
    }
    if (departmentId) { conds.push('t.department_id = ?'); params.push(departmentId); }
    if (search) { conds.push("t.title LIKE ? ESCAPE '\\\\'"); params.push(`%${search.replace(/[\\%_]/g, (c: string) => '\\' + c)}%`); }
    if (dueBefore) { conds.push('t.due_date < ?'); params.push(new Date(dueBefore).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')); }
    if (dueAfter) { conds.push('t.due_date > ?'); params.push(new Date(dueAfter).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')); }
    if (assigneeId) {
      const ids = (await db.prepare('SELECT task_id FROM task_assignments WHERE user_id = ?').all(assigneeId) as any[]).map((r: any) => r.task_id);
      if (ids.length === 0) return { tasks: [], total: 0, page, limit };
      conds.push(`t.id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    if (assigneeIds && assigneeIds.length > 0) {
      const placeholders = assigneeIds.map(() => '?').join(',');
      const ids = (await db.prepare(`SELECT DISTINCT task_id FROM task_assignments WHERE user_id IN (${placeholders})`).all(...assigneeIds) as any[]).map((r: any) => r.task_id);
      if (ids.length === 0) return { tasks: [], total: 0, page, limit };
      conds.push(`t.id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const count = (await db.prepare(`SELECT count(*) as c FROM tasks t ${where}`).get(...params) as any).c;
    const tasks = await db.prepare(`SELECT t.id, t.title, t.description, t.priority, t.status, t.created_by_id, t.department_id, t.progress_percent, t.due_date, t.started_at, t.completed_at, t.estimated_hours, t.actual_hours, t.created_at, t.updated_at FROM tasks t ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
    
    // Optimize: Batch fetch assignees instead of N+1 queries
    if (tasks.length === 0) return { tasks: [], total: count, page, limit };
    const taskIds = tasks.map(t => t.id);
    const assigneesStmt = db.prepare(`SELECT ta.task_id, ta.user_id, u.first_name, u.last_name, u.employee_id FROM task_assignments ta JOIN users u ON ta.user_id = u.id WHERE ta.task_id IN (${taskIds.map(() => '?').join(',')})`);
    const allAssignees = await assigneesStmt.all(...taskIds) as any[];
    
    const enriched = tasks.map((t) => {
      const assignees = allAssignees.filter(a => a.task_id === t.id);
      return { ...mapTask(t), assignees: assignees.map((a: any) => ({ userId: a.user_id, firstName: a.first_name, lastName: a.last_name, employeeId: a.employee_id })) };
    });
    return { tasks: enriched, total: count, page, limit };
  }

  static async getById(id: string, userId: string, role: string) {
    const t = await db.prepare('SELECT id, title, description, priority, status, created_by_id, department_id, progress_percent, due_date, started_at, completed_at, estimated_hours, actual_hours, created_at, updated_at FROM tasks WHERE id = ?').get(id) as any;
    if (!t) throw new AppError(404, 'Task not found');
    if (role === 'employee') {
      const isAssignee = await db.prepare('SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?').get(id, userId);
      if (!isAssignee && t.created_by_id !== userId) throw new AppError(403, 'Forbidden');
    }
    const assignees = await db.prepare(`SELECT ta.user_id, u.first_name, u.last_name, u.employee_id FROM task_assignments ta JOIN users u ON ta.user_id = u.id WHERE ta.task_id = ?`).all(id);
    const comments = await db.prepare('SELECT tc.*, u.first_name, u.last_name FROM task_comments tc JOIN users u ON tc.author_id = u.id WHERE tc.task_id = ? ORDER BY tc.created_at DESC').all(id);
    const approvals = (await db.prepare('SELECT * FROM task_approvals WHERE task_id = ? ORDER BY requested_at DESC').all(id) as any[]).map((a: any) => ({
      id: a.id, taskId: a.task_id, requestedById: a.requested_by_id, status: a.status,
      requestComment: a.request_comment, reviewedById: a.reviewed_by_id, comment: a.comment,
      requestedAt: a.requested_at, reviewedAt: a.reviewed_at,
    }));
    return { ...mapTask(t), assignees: assignees.map((a: any) => ({ userId: a.user_id, firstName: a.first_name, lastName: a.last_name, employeeId: a.employee_id })), comments, approvals };
  }

  static async update(id: string, input: any, userId?: string, role?: string) {
    return await db.transaction(async () => {
      const existing = await db.prepare('SELECT id, title, status, started_at, created_at, created_by_id FROM tasks WHERE id = ?').get(id) as any;
      if (!existing) throw new AppError(404, 'Task not found');

      const isEmployee = role === 'employee';
      const empAllowed = ['status', 'progressPercent', 'actualHours'];
      if (isEmployee) {
        const isAssignee = await db.prepare('SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?').get(id, userId);
        if (!isAssignee && existing.created_by_id !== userId) throw new AppError(403, 'You are not assigned to this task');
        const blocked = Object.keys(input).filter((k) => !empAllowed.includes(k) && input[k] !== undefined);
        if (blocked.length > 0) throw new AppError(403, `Employees cannot update: ${blocked.join(', ')}`);
      }

      const sets = ["updated_at = NOW()"]; const params: any[] = [];
      if (input.title) { sets.push('title = ?'); params.push(input.title); }
      if (input.description !== undefined) { sets.push('description = ?'); params.push(input.description); }
      if (input.priority) { sets.push('priority = ?'); params.push(input.priority); }
      if (input.status) {
        const current = existing.status;
        const transitions: Record<string, string[]> = {
          pending: ['in_progress', 'completed', 'cancelled'],
          in_progress: ['pending', 'completed', 'cancelled', 'on_hold'],
          completed: ['pending', 'in_progress'],
          cancelled: ['pending', 'in_progress'],
          on_hold: ['in_progress', 'cancelled'],
        };
        if (input.status !== current && !(transitions[current] ?? []).includes(input.status)) {
          throw new AppError(400, `Invalid status transition: ${current} -> ${input.status}`);
        }
        sets.push('status = ?'); params.push(input.status);
        if (input.status === 'in_progress' && !existing.started_at) sets.push("started_at = NOW()");
        if (input.status === 'completed' && current !== 'completed') { sets.push("completed_at = NOW()"); }
        if (input.status !== 'completed') sets.push('completed_at = NULL');
        if (input.status === 'pending') sets.push('started_at = NULL');
      }
      if (input.progressPercent !== undefined) { sets.push('progress_percent = ?'); params.push(input.progressPercent); } else if (input.status === 'completed') { sets.push('progress_percent = 100'); }
      if (input.dueDate !== undefined) { sets.push('due_date = ?'); params.push(input.dueDate ? new Date(input.dueDate).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') : null); }
      if (input.estimatedHours !== undefined) { sets.push('estimated_hours = ?'); params.push(input.estimatedHours); }
      if (input.actualHours !== undefined) { sets.push('actual_hours = ?'); params.push(input.actualHours); }
      params.push(id);
      await db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      if (input.assigneeIds !== undefined) {
        await db.prepare('DELETE FROM task_assignments WHERE task_id = ?').run(id);
        if (input.assigneeIds.length > 0) {
          const ph = input.assigneeIds.map(() => '(?, ?)').join(', ');
          const p: any[] = [];
          for (const uid of input.assigneeIds) { p.push(id, uid); }
          await db.prepare(`INSERT INTO task_assignments (task_id, user_id) VALUES ${ph}`).run(...p);
        }
      }
      return mapTask(await db.prepare('SELECT id, title, description, priority, status, created_by_id, department_id, progress_percent, due_date, started_at, completed_at, estimated_hours, actual_hours, created_at, updated_at FROM tasks WHERE id = ?').get(id));
    })();
  }

  static async delete(id: string) {
    if (!await db.prepare('SELECT id FROM tasks WHERE id = ?').get(id)) throw new AppError(404, 'Task not found');
    await db.transaction(async () => {
      await db.prepare('DELETE FROM task_assignments WHERE task_id = ?').run(id);
      await db.prepare('DELETE FROM task_comments WHERE task_id = ?').run(id);
      await db.prepare('DELETE FROM task_approvals WHERE task_id = ?').run(id);
      await db.prepare('DELETE FROM task_attachments WHERE task_id = ?').run(id);
      await db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    })();
    return { message: 'Task deleted' };
  }

  static async addComment(taskId: string, authorId: string, message: string, role: string) {
    if (!await db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)) throw new AppError(404, 'Task not found');
    if (role !== 'director' && role !== 'hr') {
      const isAssignee = await db.prepare('SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?').get(taskId, authorId);
      const task = await db.prepare('SELECT created_by_id FROM tasks WHERE id = ?').get(taskId) as any;
      if (!isAssignee && task.created_by_id !== authorId) throw new AppError(403, 'You are not authorized to comment on this task');
    }
    const id = uuid();
    await db.prepare('INSERT INTO task_comments (id, task_id, author_id, message) VALUES (?, ?, ?, ?)').run(id, taskId, authorId, message);
    const comment = await db.prepare('SELECT tc.*, u.first_name, u.last_name FROM task_comments tc JOIN users u ON tc.author_id = u.id WHERE tc.id = ?').get(id);
    return mapComment(comment);
  }

  static async getComments(taskId: string, userId: string, role: string) {
    if (!await db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)) throw new AppError(404, 'Task not found');
    if (role !== 'director' && role !== 'hr') {
      const isAssignee = await db.prepare('SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?').get(taskId, userId);
      const task = await db.prepare('SELECT created_by_id FROM tasks WHERE id = ?').get(taskId) as any;
      if (!isAssignee && task.created_by_id !== userId) throw new AppError(403, 'Forbidden');
    }
    const comments = await db.prepare('SELECT tc.*, u.first_name, u.last_name FROM task_comments tc JOIN users u ON tc.author_id = u.id WHERE tc.task_id = ? ORDER BY tc.created_at DESC').all(taskId) as any[];
    return { comments: comments.map(mapComment) };
  }

  static async requestApproval(taskId: string, requestedById: string, comment?: string, role?: string) {
    return await db.transaction(async () => {
      const task = await db.prepare('SELECT id, title, created_by_id FROM tasks WHERE id = ?').get(taskId) as any;
      if (!task) throw new AppError(404, 'Task not found');
      // Prevent duplicate pending approval requests
      const existingPending = await db.prepare('SELECT id FROM task_approvals WHERE task_id = ? AND status = ?').get(taskId, 'pending');
      if (existingPending) throw new AppError(409, 'A pending approval request already exists for this task');
      if (role === 'employee') {
        const isAssignee = await db.prepare('SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?').get(taskId, requestedById);
        if (!isAssignee && task.created_by_id !== requestedById) throw new AppError(403, 'You are not assigned to this task');
      }
      const id = uuid();
      await db.prepare('INSERT INTO task_approvals (id, task_id, requested_by_id, request_comment) VALUES (?, ?, ?, ?)').run(id, taskId, requestedById, comment ?? null);
      const admins = await db.prepare("SELECT id FROM users WHERE role IN ('director', 'hr')").all() as any[];
      const insertNotif = db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const a of admins) {
        await insertNotif.run(uuid(), a.id, requestedById, 'Task Approval Requested', `Task "${task.title}" is pending your review`, 'approval', `/tasks/${taskId}`);
      }
      return await db.prepare('SELECT id, task_id, requested_by_id, status, request_comment, reviewed_by_id, comment, requested_at, reviewed_at FROM task_approvals WHERE id = ?').get(id);
    })();
  }

  static async reviewApproval(approvalId: string, reviewedById: string, status: string, comment?: string) {
    return await db.transaction(async () => {
      const a = await db.prepare('SELECT id, task_id, requested_by_id, status FROM task_approvals WHERE id = ?').get(approvalId) as any;
      if (!a) throw new AppError(404, 'Approval not found');
      if (a.status !== 'pending') throw new AppError(409, 'Already reviewed');
      if (a.requested_by_id === reviewedById) throw new AppError(403, 'Cannot review your own approval request');
      const result = await db.prepare("UPDATE task_approvals SET status = ?, reviewed_by_id = ?, comment = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'").run(status, reviewedById, comment ?? null, approvalId);
      if (result.changes === 0) throw new AppError(409, 'Already reviewed');
      await db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), a.requested_by_id, reviewedById, `Task ${status}`, `Your task approval has been ${status}`, status === 'approved' ? 'success' : 'warning', `/tasks/${a.task_id}`);
      return await db.prepare('SELECT id, task_id, requested_by_id, status, request_comment, reviewed_by_id, comment, requested_at, reviewed_at FROM task_approvals WHERE id = ?').get(approvalId);
    })();
  }

  static async getStats(userId?: string, role?: string) {
    let where = ''; const params: any[] = [];
    if (role === 'employee' && userId) {
      where = 'WHERE id IN (SELECT task_id FROM task_assignments WHERE user_id = ? UNION SELECT id FROM tasks WHERE created_by_id = ?)';
      params.push(userId, userId);
    }
    const stats = await db.prepare(`SELECT status, COUNT(*) as count FROM tasks ${where} GROUP BY status`).all(...params) as any[];
    const statusMap = Object.fromEntries(stats.map((r: any) => [r.status, r.count]));
    const total = stats.reduce((sum: number, r: any) => sum + r.count, 0);
    const today = getISTDate();
    const overdue = (await db.prepare(`SELECT COUNT(*) as c FROM tasks ${where ? where + ' AND' : 'WHERE'} DATE(CONVERT_TZ(due_date, '+00:00', '+05:30')) < ? AND status NOT IN ('completed', 'cancelled')`).get(...params, today) as any).c;
    return { total, pending: statusMap.pending || 0, inProgress: statusMap.in_progress || 0, completed: statusMap.completed || 0, overdue };
  }

  static async getEmployeeProgress() {
    const today = getISTDate();
    const rows = await db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.employee_id,
        COUNT(t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN t.status NOT IN ('completed','cancelled') AND DATE(CONVERT_TZ(t.due_date, '+00:00', '+05:30')) < ? THEN 1 ELSE 0 END) as overdue,
        ROUND(AVG(t.progress_percent), 0) as avg_progress
      FROM users u
      JOIN task_assignments ta ON ta.user_id = u.id
      JOIN tasks t ON t.id = ta.task_id
      WHERE u.status = 'active'
      GROUP BY u.id
      ORDER BY u.first_name
    `).all(today) as any[];
    return rows.map((r: any) => ({
      userId: r.id, firstName: r.first_name, lastName: r.last_name, employeeId: r.employee_id,
      totalTasks: r.total_tasks, completed: r.completed, inProgress: r.in_progress,
      overdue: r.overdue, avgProgress: r.avg_progress ?? 0,
    }));
  }
}
