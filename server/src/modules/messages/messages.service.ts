import db, { uuid } from '../../db/index.js';
import { getIO } from '../../lib/socket.js';
import { AppError } from '../../lib/app-error.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { encryptText, decryptText } from '../../lib/crypto.js';
import { getISTDate, getISTDateFromISO } from '../../lib/time.js';

const MESSAGE_LIMIT = 2;
const MAX_MESSAGE_CHARS = 100;

function currentIstMonthKey(): string {
  return getISTDate().slice(0, 7); // 'YYYY-MM'
}

function nextIstMonthFirst(): string {
  const [y = 0, m = 1] = getISTDate().slice(0, 7).split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny.toString().padStart(4, '0')}-${nm.toString().padStart(2, '0')}-01`;
}

export class MessagesService {
  /** Number of messages the user sent this business-calendar month (IST). */
  static async monthlySentCount(userId: string): Promise<number> {
    const month = currentIstMonthKey();
    const rows = await db.prepare(
      `SELECT created_at FROM messages WHERE sender_id = ? AND created_at >= (UTC_TIMESTAMP() - INTERVAL 45 DAY)`
    ).all(userId) as any[];
    let count = 0;
    for (const r of rows) {
      const key = getISTDateFromISO(r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)).slice(0, 7);
      if (key === month) count += 1;
    }
    return count;
  }

  /** Quota snapshot for the UI. Director/HR are unlimited. */
  static async getQuota(userId: string, accessLevel: string) {
    const isAdmin = accessLevel === 'director' || accessLevel === 'hr';
    if (isAdmin) return { limit: null as number | null, used: 0, remaining: null as number | null, resetsOn: nextIstMonthFirst() };
    const used = await MessagesService.monthlySentCount(userId);
    const limit = MESSAGE_LIMIT;
    return { limit, used, remaining: Math.max(0, limit - used), resetsOn: nextIstMonthFirst() };
  }

  /** Find or create the single thread for this employee (employee + all active HR/director). */
  static async ensureThread(userId: string): Promise<string> {
    const row = await db.prepare(
      'SELECT thread_id FROM thread_participants WHERE user_id = ? LIMIT 1'
    ).get(userId) as any;
    if (row?.thread_id) return row.thread_id;

    const threadId = uuid();
    const admins = await db.prepare(
      `SELECT u.id FROM users u JOIN roles r ON r.name = u.role WHERE r.access_level IN ('director', 'hr') AND u.status = 'active'`
    ).all() as any[];
    const participants = [userId, ...admins.map((a) => a.id)];

    await db.transaction(async () => {
      await db.prepare('INSERT INTO message_threads (id) VALUES (?)').run(threadId);
      for (const pid of participants) {
        await db.prepare('INSERT INTO thread_participants (thread_id, user_id) VALUES (?, ?)').run(threadId, pid);
      }
    })();
    return threadId;
  }

  static async listThreads(userId: string, accessLevel: string) {
    const isAdmin = accessLevel === 'director' || accessLevel === 'hr';
    if (isAdmin) {
      // All active employees — thread info joined if it exists (click to start)
      const rows = await db.prepare(`
        SELECT emp.id AS employeeId, emp.first_name AS employeeFirstName, emp.last_name AS employeeLastName,
               emp.employee_id AS employeeCode, emp.profile_picture_url AS profilePictureUrl,
               t.id AS threadId, t.updated_at AS updatedAt,
               (SELECT content FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessage,
               COALESCE((
                 SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.sender_id != ?
                   AND COALESCE((SELECT last_read_at FROM thread_participants tp2 WHERE tp2.thread_id = t.id AND tp2.user_id = ?), '1970-01-01') < m.created_at
               ), 0) AS unread
        FROM users emp
        JOIN roles r ON r.name = emp.role AND r.access_level = 'employee'
        LEFT JOIN thread_participants tpEmp ON tpEmp.user_id = emp.id
        LEFT JOIN message_threads t ON t.id = tpEmp.thread_id
        WHERE emp.status = 'active'
        ORDER BY (t.updated_at IS NULL) ASC, t.updated_at DESC, emp.first_name ASC
      `).all(userId, userId) as any[];
      return { threads: rows.map((r) => ({ ...r, lastMessage: r.lastMessage ? decryptText(r.lastMessage) : null, unread: Number(r.unread ?? 0) })) };
    }

    // Employee view: their own single thread
    const threadId = await MessagesService.ensureThread(userId);
    const row = await db.prepare(`
      SELECT t.id AS threadId, t.updated_at AS updatedAt,
             (SELECT content FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessage,
             (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.sender_id != ? AND COALESCE((SELECT last_read_at FROM thread_participants tp2 WHERE tp2.thread_id = t.id AND tp2.user_id = ?), '1970-01-01') < m.created_at) AS unread
      FROM message_threads t WHERE t.id = ?
    `).get(userId, userId, threadId) as any;
    return { threads: row ? [{ ...row, lastMessage: row.lastMessage ? decryptText(row.lastMessage) : null, unread: Number(row.unread ?? 0), employeeId: userId }] : [] };
  }

  static async getMessages(threadId: string, userId: string, accessLevel: string) {
    await MessagesService.assertParticipant(threadId, userId, accessLevel);
    const rows = await db.prepare(`
      SELECT m.id, m.thread_id AS threadId, m.sender_id AS senderId, m.content, m.created_at AS createdAt,
             u.first_name AS senderFirstName, u.last_name AS senderLastName, u.role AS senderRole
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.thread_id = ?
      ORDER BY m.created_at ASC, m.id ASC
    `).all(threadId) as any[];
    return { threadId, messages: rows.map((m) => ({ ...m, content: decryptText(m.content) })) };
  }

  static async send(threadId: string, senderId: string, content: string, senderRole?: string) {
    const trimmed = content.trim();
    if (!trimmed) throw new AppError(400, 'Message cannot be empty');
    if (trimmed.length > MAX_MESSAGE_CHARS) throw new AppError(400, `Message too long (max ${MAX_MESSAGE_CHARS} characters)`);
    if (senderRole === 'employee') {
      const used = await MessagesService.monthlySentCount(senderId);
      if (used >= MESSAGE_LIMIT) {
        throw new AppError(429, `You have used all ${MESSAGE_LIMIT} messages for this month. Credits reset on the 1st.`);
      }
    }
    await MessagesService.assertParticipant(threadId, senderId, senderRole);

    const id = uuid();
    const encrypted = encryptText(trimmed);
    await db.transaction(async () => {
      await db.prepare('INSERT INTO messages (id, thread_id, sender_id, content) VALUES (?, ?, ?, ?)').run(id, threadId, senderId, encrypted);
      await db.prepare('UPDATE message_threads SET updated_at = NOW() WHERE id = ?').run(threadId);
    })();

    const participants = await db.prepare('SELECT user_id FROM thread_participants WHERE thread_id = ?').all(threadId) as any[];
    const message = { id, threadId, senderId, content: trimmed };
    const sender = await db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(senderId) as any;
    const senderName = sender ? `${sender.first_name} ${sender.last_name}` : 'Someone';

    for (const p of participants) {
      if (p.user_id === senderId) continue;
      try {
        getIO().to(`user:${p.user_id}`).emit('message:new', message);
      } catch (e) { console.error('[Messages] Socket emit failed:', e); }
      try {
        await db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uuid(), p.user_id, senderId, 'New message', `${senderName}: ${trimmed.slice(0, 120)}`, 'info', '/chat');
      } catch (e) { console.error('[Messages] Notification failed:', e); }
    }
    try { await ActivityLogsService.createDiff(senderId, 'send_message', 'message', id, `Sent a message: ${trimmed.slice(0, 80)}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    return { message };
  }

  static async markRead(threadId: string, userId: string) {
    await MessagesService.assertParticipant(threadId, userId, undefined);
    await db.prepare('UPDATE thread_participants SET last_read_at = NOW() WHERE thread_id = ? AND user_id = ?').run(threadId, userId);
    const others = await db.prepare('SELECT user_id FROM thread_participants WHERE thread_id = ? AND user_id != ?').all(threadId, userId) as any[];
    for (const o of others) {
      try { getIO().to(`user:${o.user_id}`).emit('message:read', { threadId, readerId: userId }); } catch (e) { console.error('[Messages] Socket emit failed:', e); }
    }
    return { ok: true };
  }

  static async unreadCount(userId: string, accessLevel?: string) {
    const isAdmin = accessLevel === 'director' || accessLevel === 'hr';
    const row = await db.prepare(`
      SELECT COUNT(*) AS count FROM messages m
      JOIN thread_participants tp ON tp.thread_id = m.thread_id AND tp.user_id = ?
      WHERE m.sender_id != ? AND COALESCE((SELECT last_read_at FROM thread_participants tp2 WHERE tp2.thread_id = m.thread_id AND tp2.user_id = ?), '1970-01-01') < m.created_at
    `).get(userId, userId, userId) as any;
    return { count: Number(row?.count ?? 0) };
  }

  private static async assertParticipant(threadId: string, userId: string, accessLevel?: string): Promise<void> {
    const isAdmin = accessLevel === 'director' || accessLevel === 'hr';
    if (isAdmin) {
      const exists = await db.prepare('SELECT 1 FROM message_threads WHERE id = ?').get(threadId);
      if (!exists) throw new AppError(404, 'Thread not found');
      return;
    }
    // Admins should also be able to participate in employee threads for safety; but if not a participant and not admin, reject
    const row = await db.prepare('SELECT 1 FROM thread_participants WHERE thread_id = ? AND user_id = ?').get(threadId, userId) as any;
    if (!row) throw new AppError(403, 'Not a participant of this thread');
  }
}
