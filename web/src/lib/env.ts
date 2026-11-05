// Environment access that works in every runtime this app ships to:
// Vite browser builds (import.meta.env, VITE_*), Next.js remnants and
// Vitest/Node (process.env). Values are identical; only the lookup differs,
// so UI and behaviour stay byte-for-byte the same.
export function getEnv(name: string): string | undefined {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | boolean | undefined> };
    const v = meta?.env?.[name];
    if (typeof v === 'string' && v !== '') return v;
  } catch {
    // import.meta unavailable (very old bundlers) — fall through to process.env
  }
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[name];
    if (typeof v === 'string' && v !== '') return v;
  }
  return undefined;
}

export function isProduction(): boolean {
  try {
    const meta = import.meta as unknown as { env?: { PROD?: boolean; MODE?: string } };
    if (meta?.env) return meta.env.PROD === true || meta.env.MODE === 'production';
  } catch {
    // fall through
  }
  return getEnv('NODE_ENV') === 'production';
}
