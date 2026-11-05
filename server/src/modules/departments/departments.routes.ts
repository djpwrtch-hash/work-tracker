import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { apiCache } from '../../middleware/api-cache.js';
import { cache } from '../../lib/cache.js';
import { createDepartmentSchema, updateDepartmentSchema } from './departments.schema.js';
import { DepartmentsService } from './departments.service.js';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('director', 'hr'), apiCache({ ttl: 300_000 }), async (_req: Request, res: Response, next) => {
  try {
    const depts = await DepartmentsService.list();
    res.json(depts);
  } catch (err) { next(err); }
});

router.get('/stats', requireRole('director', 'hr'), apiCache({ ttl: 300_000 }), async (_req: Request, res: Response, next) => {
  try {
    const stats = await DepartmentsService.getStats();
    res.json(stats);
  } catch (err) { next(err); }
});

router.get('/:id', requireRole('director', 'hr'), requireUuid('id'), apiCache({ ttl: 300_000 }), async (req: Request, res: Response, next) => {
  try {
    const dept = await DepartmentsService.getById(req.params.id!);
    res.json(dept);
  } catch (err) { next(err); }
});

router.post('/', requireRole('director'), validate(createDepartmentSchema), async (req: Request, res: Response, next) => {
  try {
    const dept = await DepartmentsService.create(req.body);
    cache.delContaining('/api/v1/departments');
    res.status(201).json(dept);
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('director'), requireUuid('id'), validate(updateDepartmentSchema), async (req: Request, res: Response, next) => {
  try {
    const dept = await DepartmentsService.update(req.params.id!, req.body);
    cache.delContaining('/api/v1/departments');
    res.json(dept);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('director'), requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await DepartmentsService.delete(req.params.id!);
    cache.delContaining('/api/v1/departments');
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
