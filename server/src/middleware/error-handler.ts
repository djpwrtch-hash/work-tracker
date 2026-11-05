import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/app-error.js';

const SAFE_MESSAGES: Record<string, string> = {
  'UNIQUE constraint failed: users.email': 'A user with this email already exists',
  'Duplicate entry': 'A record with this value already exists',
  'ER_DUP_ENTRY': 'A record with this value already exists',
  'UNIQUE constraint failed: users.employee_id': 'Employee ID already exists',
  'UNIQUE constraint failed: attendance': 'Already checked in for this date',
  'FOREIGN KEY constraint failed': 'Referenced record not found',
  'Cannot add or update a child row': 'Referenced record not found',
  'ER_NO_REFERENCED_ROW': 'Referenced record not found',
  'NOT NULL constraint failed': 'Required field is missing',
  'Column.*cannot be null': 'Required field is missing',
  'CHECK constraint failed': 'Invalid data provided',
};

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  let status: number;
  if (err.name === 'CircuitBreakerOpenError') {
    status = 503;
  } else if (err instanceof AppError) {
    status = err.statusCode;
  } else if (err.message.includes('Duplicate entry') || err.message.includes('UNIQUE constraint failed')) {
    status = 409;
  } else if (err.message.includes('Cannot add or update a child row') || err.message.includes('FOREIGN KEY constraint failed') || err.message.includes('ER_NO_REFERENCED_ROW')) {
    status = 400;
  } else if (err.message.includes('NOT NULL constraint failed') || err.message.includes('cannot be null') || err.message.includes('CHECK constraint failed')) {
    status = 400;
  } else {
    status = 500;
  }
  const reqId = (req as any).id || '-';

  if (status >= 500) {
    console.error(`[ERROR] [${reqId}] ${status} - ${err.message}`, err);
  } else {
    console.error(`[ERROR] [${reqId}] ${status} - ${err.message}`);
  }

  let message: string;
  if (status === 503) {
    message = 'Service temporarily unavailable';
  } else if (status >= 500) {
    message = 'Internal server error';
  } else if (err instanceof AppError) {
    message = err.message;
  } else {
    const safeKey = Object.keys(SAFE_MESSAGES).find((k) => new RegExp(k).test(err.message));
    message = (safeKey && SAFE_MESSAGES[safeKey]) || 'An error occurred';
  }

  res.status(status).json({ error: message, requestId: reqId });
}
