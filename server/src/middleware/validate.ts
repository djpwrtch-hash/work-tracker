import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      (req as any)[source] = schema.parse((req as any)[source]);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues;
        console.warn(`[VALIDATION] ${req.method} ${req.path} - ${issues.length} error(s):`, issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
        res.status(400).json({
          error: 'Validation failed',
          details: issues.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(err);
    }
  };
}

export function requireUuid(...paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const name of paramNames) {
      const val = req.params[name];
      if (val !== undefined && val !== null && !UUID_RE.test(val)) {
        res.status(400).json({ error: `Invalid ${name} format` });
        return;
      }
    }
    next();
  };
}
