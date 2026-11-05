import path from 'path';
import db, { uuid } from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';
import { getStorage } from '../../lib/storage.js';

const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || '10');
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip',
]);

function sanitizeFilename(name: string): string {
  let sanitized = name
    .replace(/\.\./g, '')
    .replace(/[\\]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  if (sanitized.length > 200) {
    const ext = path.extname(sanitized);
    sanitized = sanitized.slice(0, 200 - ext.length) + ext;
  }
  return sanitized || 'unnamed';
}

function mapFile(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    originalName: r.original_name,
    storageKey: r.storage_key,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    url: r.url,
    createdAt: r.created_at,
  };
}

function isAdminRole(role: string): boolean {
  return role === 'director' || role === 'hr';
}

export class FilesService {
  static async upload(userId: string, file: { mimetype: string; size: number; originalname: string; buffer: Buffer }): Promise<any> {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new AppError(400, `File type '${file.mimetype}' is not allowed`);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new AppError(400, `File size exceeds maximum of ${MAX_FILE_SIZE_MB}MB`);
    }

    const sanitizedName = sanitizeFilename(file.originalname);
    const now = new Date();
    const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    const storageKey = `${userId}/${datePath}/${Date.now()}-${sanitizedName}`;

    const storage = getStorage();
    const { url, size } = await storage.upload(storageKey, file.buffer, file.mimetype);

    const id = uuid();
    await db.prepare(
      `INSERT INTO file_uploads (id, user_id, original_name, storage_key, mime_type, size_bytes, url) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, file.originalname, storageKey, file.mimetype, size, url);

    const row = await db.prepare('SELECT * FROM file_uploads WHERE id = ?').get(id);
    return mapFile(row);
  }

  static async download(fileId: string, userId: string, role: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const row = await db.prepare('SELECT * FROM file_uploads WHERE id = ?').get(fileId) as any;
    if (!row) throw new AppError(404, 'File not found');

    const isOwner = row.user_id === userId;
    const isAdmin = isAdminRole(role);
    if (!isOwner && !isAdmin) {
      const assigned = await db.prepare(
        `SELECT 1 FROM task_assignments ta
         JOIN task_attachments att ON att.task_id = ta.task_id
         WHERE att.file_url = ? AND ta.user_id = ?`
      ).get(row.url, userId);
      if (!assigned) throw new AppError(403, 'Access denied');
    }

    const storage = getStorage();
    const buffer = await storage.download(row.storage_key);

    await db.prepare(
      `INSERT INTO activity_logs (id, actor_id, action, entity_type, entity_id) VALUES (?, ?, 'download', 'file', ?)`
    ).run(uuid(), userId, fileId);

    return { buffer, filename: row.original_name, mimeType: row.mime_type };
  }

  static async delete(fileId: string, userId: string, role: string): Promise<void> {
    const row = await db.prepare('SELECT * FROM file_uploads WHERE id = ?').get(fileId) as any;
    if (!row) throw new AppError(404, 'File not found');

    const isOwner = row.user_id === userId;
    const isAdmin = isAdminRole(role);
    if (!isOwner && !isAdmin) {
      throw new AppError(403, 'Only the file owner or an admin can delete files');
    }

    const storage = getStorage();
    try {
      await storage.delete(row.storage_key);
    } catch (e) {
      console.error('[Files] Failed to delete from storage:', e);
    }

    await db.prepare('DELETE FROM file_uploads WHERE id = ?').run(fileId);
  }

  static async list(input: { page?: number; limit?: number; userId?: string; mimeType?: string }, role: string, userId: string): Promise<{ files: any[]; total: number; page: number; limit: number }> {
    const page = input.page ?? 1;
    const limit = input.limit ?? 50;
    const conds: string[] = [];
    const params: any[] = [];

    if (!isAdminRole(role)) {
      conds.push('f.user_id = ?');
      params.push(userId);
    } else if (input.userId) {
      conds.push('f.user_id = ?');
      params.push(input.userId);
    }

    if (input.mimeType) {
      conds.push('f.mime_type LIKE ?');
      params.push(`${input.mimeType}%`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const rows = await db.prepare(
      `SELECT f.* FROM file_uploads f ${where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const total = (await db.prepare(
      `SELECT COUNT(*) AS c FROM file_uploads f ${where}`
    ).get(...params) as any).c;

    return { files: rows.map(mapFile), total, page, limit };
  }

  static async getRetentionPolicies(): Promise<any[]> {
    const rows = await db.prepare('SELECT * FROM file_retention_policies ORDER BY id').all();
    return rows.map((r: any) => ({
      id: r.id,
      mimePattern: r.mime_pattern,
      retentionDays: r.retention_days,
      maxSizeBytes: r.max_size_bytes,
      createdAt: r.created_at,
    }));
  }

  static async cleanupExpiredFiles(): Promise<number> {
    const policies = await db.prepare('SELECT * FROM file_retention_policies').all() as any[];
    const now = Date.now();
    let deleted = 0;

    for (const policy of policies) {
      const cutoffMs = policy.retention_days * 24 * 60 * 60 * 1000;
      const cutoffDate = new Date(now - cutoffMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      let conds: string[] = ['f.created_at < ?'];
      const params: any[] = [cutoffDate];

      if (policy.mime_pattern !== '*') {
        const pattern = policy.mime_pattern.replace('*', '%');
        conds.push('f.mime_type LIKE ?');
        params.push(pattern);
      }

      const where = `WHERE ${conds.join(' AND ')}`;
      const expired = await db.prepare(
        `SELECT f.* FROM file_uploads f ${where}`
      ).all(...params);

      const storage = getStorage();
      for (const file of expired) {
        try {
          await storage.delete(file.storage_key);
          await db.prepare('DELETE FROM file_uploads WHERE id = ?').run(file.id);
          deleted++;
        } catch (e) {
          console.error('[Files] Cleanup failed for file:', file.id, e);
        }
      }
    }

    return deleted;
  }
}
