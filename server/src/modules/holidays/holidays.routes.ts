import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { apiCache } from '../../middleware/api-cache.js';
import { cache } from '../../lib/cache.js';
import { createHolidaySchema, deleteHolidaySchema, listHolidaysSchema } from './holidays.schema.js';
import { HolidaysService } from './holidays.service.js';

const router = Router();

router.use(authenticate);

router.get('/', apiCache({ ttl: 300_000 }), validate(listHolidaysSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const result = await HolidaysService.list(req.query as any);
    res.json(result);
  } catch (err) { next(err); }
});

router.use(requireRole('director', 'hr'));

router.post('/', validate(createHolidaySchema), async (req: Request, res: Response, next) => {
  try {
    const holiday = await HolidaysService.create(req.user!.sub, req.body);
    cache.delContaining('/api/v1/holidays');
    res.status(201).json(holiday);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('director'), requireUuid('id'), validate(deleteHolidaySchema), async (req: Request, res: Response, next) => {
  try {
    const result = await HolidaysService.delete(req.params.id!, req.body, req.user!.sub);
    cache.delContaining('/api/v1/holidays');
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
