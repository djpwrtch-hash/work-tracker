import { createHash } from 'crypto';
import db from '../db/index.js';

interface IncrementResponse {
  totalHits: number;
  resetTime: Date | undefined;
}

interface StoreOptions {
  windowMs: number;
}

export class RateLimitStore {
  private windowMs = 60000;
  private keyPrefix: string;

  get prefix(): string {
    return this.keyPrefix;
  }

  constructor(prefix = '') {
    this.keyPrefix = prefix ? prefix + ':' : '';
  }

  init(options: StoreOptions) {
    this.windowMs = options.windowMs;
  }

  private prefixed(key: string): string {
    const prefixed = this.keyPrefix + key;
    // rate_limits.key is VARCHAR(255). Hash unusually long keys (e.g. a
    // max-length email) so the insert cannot overflow and fail closed.
    if (prefixed.length <= 255) return prefixed;
    return `${this.keyPrefix}sha256:${createHash('sha256').update(key).digest('hex')}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const pk = this.prefixed(key);
    try {
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      const resetTime = new Date(Date.now() + this.windowMs);
      const resetStr = resetTime.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

      // Atomic: insert-or-update in one statement
      await db.prepare(
        `INSERT INTO rate_limits (\`key\`, hits, expires_at) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE
           hits = IF(expires_at <= ?, 1, hits + 1),
           expires_at = IF(expires_at <= ?, ?, expires_at)`
      ).run(pk, resetStr, now, now, resetStr);

      // Read the current state after atomic upsert
      const row = await db.prepare('SELECT hits, expires_at FROM rate_limits WHERE `key` = ?').get(pk) as any;
      return { totalHits: row?.hits ?? 1, resetTime: new Date(row?.expires_at ?? resetStr) };
    } catch (err) {
      console.error('[RATE-LIMIT] Store unavailable, failing closed:', err);
      // Fail-closed: block request when DB is down (do not allow unlimited brute-force)
      return { totalHits: 999999, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  // Read-only view of the current counter, used by callers that need the number
  // of attempts without incrementing (e.g. deciding whether to send a security alert).
  async getHits(key: string): Promise<number> {
    try {
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      const row = await db.prepare('SELECT hits FROM rate_limits WHERE `key` = ? AND expires_at > ?').get(this.prefixed(key), now) as any;
      return row?.hits ?? 0;
    } catch (err) {
      console.error('[RATE-LIMIT] Store unavailable during getHits:', err);
      return 0;
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await db.prepare('UPDATE rate_limits SET hits = GREATEST(0, hits - 1) WHERE `key` = ?').run(this.prefixed(key));
    } catch (err) {
      console.error('[RATE-LIMIT] Store unavailable during decrement:', err);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await db.prepare('DELETE FROM rate_limits WHERE `key` = ?').run(this.prefixed(key));
    } catch (err) {
      // Never fail an otherwise-successful login because cleanup failed.
      console.error('[RATE-LIMIT] Store unavailable during resetKey:', err);
    }
  }

  async resetAll(): Promise<void> {
    await db.prepare('DELETE FROM rate_limits').run();
  }

  static async resetExpired(): Promise<void> {
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    await db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').run(now);
  }
}

