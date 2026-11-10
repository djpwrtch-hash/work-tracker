import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        email: string;
        role: string;
        accessLevel: 'director' | 'hr' | 'employee';
        iat?: number;
        exp?: number;
      };
    }
  }
}

export {};
