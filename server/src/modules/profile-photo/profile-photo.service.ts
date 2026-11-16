import { getStorage } from '../../lib/storage.js';
import db from '../../db/index.js';
import { AppError } from '../../lib/app-error.js';
import { invalidateUserCache } from '../../middleware/authenticate.js';

const MAX_PHOTO_SIZE_MB = Number(process.env.MAX_PROFILE_PHOTO_MB || '2');
const MAX_PHOTO_SIZE_BYTES = MAX_PHOTO_SIZE_MB * 1024 * 1024;
const ALLOWED_MIMES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export class ProfilePhotoService {
  static async upload(userId: string, file: { mimetype: string; size: number; originalname: string; buffer: Buffer }): Promise<{ profilePictureUrl: string }> {
    const ext = ALLOWED_MIMES[file.mimetype];
    if (!ext) {
      throw new AppError(400, 'Only JPEG, PNG, GIF or WebP images are allowed');
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      throw new AppError(400, `Photo must be smaller than ${MAX_PHOTO_SIZE_MB}MB`);
    }

    const storage = getStorage();

    // Delete any existing profile-photo file(s) for this user (try every supported extension).
    for (const e of Object.values(ALLOWED_MIMES)) {
      try { await storage.delete(`profile-photos/${userId}.${e}`); } catch { /* missing or unsupported key — ignore */ }
    }

    const key = `profile-photos/${userId}.${ext}`;
    await storage.upload(key, file.buffer, file.mimetype);

    const url = `/api/v1/profile-photo/${userId}`;
    await db.prepare('UPDATE users SET profile_picture_url = ?, updated_at = NOW() WHERE id = ?').run(url, userId);
    invalidateUserCache(userId);
    return { profilePictureUrl: url };
  }

  static async remove(userId: string): Promise<{ profilePictureUrl: null }> {
    const storage = getStorage();
    for (const e of Object.values(ALLOWED_MIMES)) {
      try { await storage.delete(`profile-photos/${userId}.${e}`); } catch { /* ignore */ }
    }
    await db.prepare('UPDATE users SET profile_picture_url = NULL, updated_at = NOW() WHERE id = ?').run(userId);
    invalidateUserCache(userId);
    return { profilePictureUrl: null };
  }

  /** Best-effort deletion of a user's profile photo (used when a user is deleted). */
  static async removeForUser(userId: string): Promise<void> {
    try {
      await this.remove(userId);
    } catch (e) {
      console.error('[ProfilePhoto] Failed to delete photo for deleted user:', e);
    }
  }

  /** Read the photo from storage and return bytes + content type. Throws 404 if none. */
  static async getPhoto(userId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const row = await db.prepare('SELECT profile_picture_url FROM users WHERE id = ?').get(userId) as any;
    if (!row || !row.profile_picture_url) throw new AppError(404, 'Profile photo not found');
    const storage = getStorage();
    // The URL we store is /api/v1/profile-photo/<userId>; the storage key mirrors it.
    for (const e of Object.values(ALLOWED_MIMES)) {
      try {
        const buffer = await storage.download(`profile-photos/${userId}.${e}`);
        const contentType = Object.entries(ALLOWED_MIMES).find(([, ext]) => ext === e)?.[0] ?? 'image/jpeg';
        return { buffer, contentType };
      } catch { /* not this extension */ }
    }
    // Column says a photo exists but storage doesn't — clear the stale value.
    await db.prepare('UPDATE users SET profile_picture_url = NULL, updated_at = NOW() WHERE id = ?').run(userId);
    throw new AppError(404, 'Profile photo not found');
  }
}
