import { describe, expect, it, beforeEach } from 'vitest';
import db from '../db/index.js';
import { RateLimitStore } from './rate-limit-store.js';

describe('RateLimitStore', () => {
  beforeEach(async () => {
    await db.prepare("DELETE FROM rate_limits WHERE `key` LIKE 'test:%'").run();
  });

  it('increments and reads hits without changing the counter', async () => {
    const store = new RateLimitStore('test:get');
    store.init({ windowMs: 60_000 });

    expect(await store.getHits('user@example.com')).toBe(0);
    await store.increment('user@example.com');
    await store.increment('user@example.com');
    expect(await store.getHits('user@example.com')).toBe(2);
    // getHits must be read-only.
    expect(await store.getHits('user@example.com')).toBe(2);
  });

  it('resets a key', async () => {
    const store = new RateLimitStore('test:reset');
    store.init({ windowMs: 60_000 });

    await store.increment('k');
    await store.resetKey('k');
    expect(await store.getHits('k')).toBe(0);
  });

  it('hashes keys longer than the rate_limits key column', async () => {
    const store = new RateLimitStore('test:long');
    store.init({ windowMs: 60_000 });

    const longKey = `${'a'.repeat(300)}@example.com`;
    await store.increment(longKey);
    expect(await store.getHits(longKey)).toBe(1);
  });
});
