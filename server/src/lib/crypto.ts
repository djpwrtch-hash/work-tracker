import crypto from 'crypto';

const ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

export function hashToken(token: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(token, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyTokenHash(token: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const verify = crypto.pbkdf2Sync(token, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const verifyBuf = Buffer.from(verify, 'hex');
  if (hashBuf.length !== verifyBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, verifyBuf);
}

export function generateEmployeeId(seq: number): string {
  return `EMP-${String(seq).padStart(4, '0')}`;
}

export function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  const masked = user[0] + '***' + (user.length > 1 ? user[user.length - 1] : '');
  return `${masked}@${domain}`;
}

/**
 * Server-side at-rest encryption for sensitive fields (e.g. chat messages).
 * Format: "enc:" + base64(iv || authTag || ciphertext).
 * Falls back to plaintext when MESSAGE_ENCRYPTION_KEY is not set (dev mode).
 */

const ENC_PREFIX = 'enc:';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer | null {
  const raw = process.env.MESSAGE_ENCRYPTION_KEY;
  if (!raw) return null;
  // Accept hex (64 chars = 32 bytes) or raw string (hashed to 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

let warnedMissingKey = false;

export function encryptText(plaintext: string): string {
  const key = getKey();
  if (!key) {
    if (!warnedMissingKey) {
      console.warn('[Crypto] MESSAGE_ENCRYPTION_KEY not set — storing messages as plaintext (dev mode).');
      warnedMissingKey = true;
    }
    return plaintext;
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptText(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext or dev mode
  const key = getKey();
  if (!key) {
    console.error('[Crypto] MESSAGE_ENCRYPTION_KEY not set but encrypted content found — returning placeholder');
    return '[encrypted]';
  }
  try {
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[Crypto] Decrypt failed:', e);
    return '[unreadable]';
  }
}

/** True if value is encrypted with our scheme. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}
