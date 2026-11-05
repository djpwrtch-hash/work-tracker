import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from './config.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
}

export function signAccessToken(userId: string, email: string, role: string): string {
  const payload: AccessTokenPayload = { sub: userId, email, role };
  const opts: SignOptions = { expiresIn: config.jwtAccessTtl as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtAccessSecret, opts);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, config.jwtAccessSecret, { algorithms: ['HS256'] }) as AccessTokenPayload & { step?: string };
  if ((payload as any).step === '2fa') throw new Error('Invalid token type');
  return payload as AccessTokenPayload;
}

export function signRefreshToken(userId: string, tokenId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, tokenId };
  const opts: SignOptions = { expiresIn: `${config.jwtRefreshTtlDays}d` as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtRefreshSecret, opts);
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwtRefreshSecret, { algorithms: ['HS256'] }) as RefreshTokenPayload;
}

export interface PendingAuthPayload {
  sub: string;
  email: string;
  step: '2fa';
  iat?: number;
  exp?: number;
}

export function signPendingAuthToken(userId: string, email: string): string {
  const payload: PendingAuthPayload = { sub: userId, email, step: '2fa' };
  const opts: SignOptions = { expiresIn: '5m' as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtAccessSecret, opts);
}

export function verifyPendingAuthToken(token: string): PendingAuthPayload {
  const payload = jwt.verify(token, config.jwtAccessSecret, { algorithms: ['HS256'] }) as PendingAuthPayload;
  if (payload.step !== '2fa') throw new Error('Unexpected token type');
  return payload;
}
