import { Request, Response, NextFunction } from 'express';

/**
 * Restricts a route to one or more access levels. Access levels are derived from
 * the role master (`roles.access_level`), so custom roles inherit the permissions
 * of the level they were created with.
 */
export function requireRole(...levels: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const accessLevel = req.user.accessLevel ?? req.user.role;
    if (!levels.includes(accessLevel)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
