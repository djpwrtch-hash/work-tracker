import { randomUUID } from 'node:crypto';

export function generateEmployeeId(): string {
  return `EMP-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
}
