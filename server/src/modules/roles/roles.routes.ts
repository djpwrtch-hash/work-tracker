import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { apiCache } from '../../middleware/api-cache.js';
import { cache } from '../../lib/cache.js';
import { createRoleSchema, updateRoleSchema } from './roles.schema.js';
import { RolesService } from './roles.service.js';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('director', 'hr'), apiCache({ ttl: 300_000 }), async (_req: Request, res: Response, next) => {
  try {
    res.json(await RolesService.list());
  } catch (err) { next(err); }
});

router.get('/stats', requireRole('director', 'hr'), apiCache({ ttl: 300_000 }), async (_req: Request, res: Response, next) => {
  try {
    res.json(await RolesService.getStats());
  } catch (err) { next(err); }
});

router.get('/:id', requireRole('director', 'hr'), requireUuid('id'), apiCache({ ttl: 300_000 }), async (req: Request, res: Response, next) => {
  try {
    res.json(await RolesService.getById(req.params.id!));
  } catch (err) { next(err); }
});

router.post('/', requireRole('director', 'hr'), validate(createRoleSchema), async (req: Request, res: Response, next) => {
  try {
    const role = await RolesService.create(req.body, req.user!.accessLevel);
    cache.delContaining('/api/v1/roles');
    res.status(201).json(role);
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('director', 'hr'), requireUuid('id'), validate(updateRoleSchema), async (req: Request, res: Response, next) => {
  try {
    const role = await RolesService.update(req.params.id!, req.body, req.user!.accessLevel);
    cache.delContaining('/api/v1/roles');
    res.json(role);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('director', 'hr'), requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await RolesService.delete(req.params.id!, req.user!.accessLevel);
    cache.delContaining('/api/v1/roles');
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
