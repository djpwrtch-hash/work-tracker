import db from '../db/index.js';

interface CacheEntry {
  data: any;
  expiresAt: number;
}

const L1_MAX_SIZE = 100;
const L1_MAX_ENTRY_BYTES = 200_000;
const l1Cache = new Map<string, CacheEntry>();

function l1Get(key: string): any | undefined {
  const entry = l1Cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    l1Cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function l1Set(key: string, data: any, ttlMs: number): void {
  try { if (JSON.stringify(data).length > L1_MAX_ENTRY_BYTES) return; } catch {}
  if (l1Cache.size >= L1_MAX_SIZE) {
    const firstKey = l1Cache.keys().next().value;
    if (firstKey) l1Cache.delete(firstKey);
  }
  // LRU: move to end on set
  l1Cache.delete(key);
  l1Cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function l1Del(key: string): void {
  l1Cache.delete(key);
}

function l1DelByPrefix(prefix: string): void {
  for (const key of l1Cache.keys()) {
    if (key.startsWith(prefix)) l1Cache.delete(key);
  }
}

function l1DelContaining(needle: string): void {
  for (const key of l1Cache.keys()) {
    if (key.includes(needle)) l1Cache.delete(key);
  }
}

export const cache = {
  async get(key: string): Promise<any | undefined> {
    const l1 = l1Get(key);
    if (l1 !== undefined) return l1;

    const row = await db.prepare("SELECT data, expires_at FROM api_cache WHERE cache_key = ? AND expires_at > NOW()").get(key) as any;
    if (!row) return undefined;
    try {
      const data = JSON.parse(row.data);
      const remaining = Math.max(0, new Date(row.expires_at).getTime() - Date.now());
      l1Set(key, data, Math.min(remaining, 60_000));
      return data;
    } catch {
      return undefined;
    }
  },

  async set(key: string, data: any, ttlMs: number): Promise<void> {
    l1Set(key, data, ttlMs);
    const sec = Math.ceil(ttlMs / 1000);
    await db.prepare("REPLACE INTO api_cache (cache_key, data, expires_at) VALUES (?, ?, NOW() + INTERVAL ? SECOND)").run(key, JSON.stringify(data), sec);
  },

  async del(key: string): Promise<void> {
    l1Del(key);
    await db.prepare('DELETE FROM api_cache WHERE cache_key = ?').run(key);
  },

  async delByPrefix(prefix: string): Promise<void> {
    l1DelByPrefix(prefix);
    const escaped = prefix.replace(/[\\%_]/g, '\\$&');
    await db.prepare("DELETE FROM api_cache WHERE cache_key LIKE ? ESCAPE '\\\\'").run(`${escaped}%`);
  },

  async delContaining(needle: string): Promise<void> {
    l1DelContaining(needle);
    const escaped = needle.replace(/[\\%_]/g, '\\$&');
    await db.prepare("DELETE FROM api_cache WHERE cache_key LIKE ? ESCAPE '\\\\'").run(`%${escaped}%`);
  },

  async flush(): Promise<void> {
    l1Cache.clear();
    await db.prepare('DELETE FROM api_cache').run();
  },

  async size(): Promise<number> {
    const row = await db.prepare('SELECT COUNT(*) as c FROM api_cache').get() as any;
    return row?.c ?? 0;
  },
};