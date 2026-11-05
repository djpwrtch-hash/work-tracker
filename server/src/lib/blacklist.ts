import db from '../db/index.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// Marks a user as revoked from now. Any access token issued
// *before* this timestamp is considered revoked until the entry expires,
// while tokens issued afterwards (e.g. from a fresh login) stay valid.
export async function revokeUserTokens(userId: string) {
  await db.prepare("INSERT INTO token_blacklist (user_id, revoked_at, expires_at) VALUES (?, NOW(), NOW() + INTERVAL ? SECOND) ON DUPLICATE KEY UPDATE revoked_at = NOW(), expires_at = NOW() + INTERVAL ? SECOND").run(userId, ACCESS_TOKEN_TTL_SECONDS, ACCESS_TOKEN_TTL_SECONDS);
}

export async function isTokenRevoked(userId: string, issuedAt?: number): Promise<boolean> {
  // Compare entirely in SQL to avoid timezone mismatch between MySQL NOW()
  // (server timezone, e.g. IST) and JavaScript Date.now() (UTC).
  const row = await db.prepare("SELECT UNIX_TIMESTAMP(revoked_at) > ? AS revoked FROM token_blacklist WHERE user_id = ? AND expires_at > NOW() LIMIT 1").get(issuedAt ?? 0, userId) as any;
  if (!row) return false;
  return row.revoked === 1;
}

export async function cleanupExpiredBlacklistEntries() {
  await db.prepare("DELETE FROM token_blacklist WHERE expires_at <= NOW()").run();
}