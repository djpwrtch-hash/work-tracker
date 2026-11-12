import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { ActivityLogsService } from './activity-logs.service.js';
import { listActivityLogsSchema } from './activity-logs.schema.js';

const router = Router();

router.use(authenticate);
router.use(requireRole('director', 'hr'));

router.get('/', validate(listActivityLogsSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const result = await ActivityLogsService.list(req.query as any);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await ActivityLogsService.deleteById(String(req.params.id));
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/', async (req: Request, res: Response, next) => {
  try {
    if (req.query.confirm !== 'DELETE') {
      return res.status(400).json({ error: 'Missing confirm=DELETE' });
    }
    if (req.query.all === 'true') {
      const result = await ActivityLogsService.deleteAll();
      return res.json(result);
    }
    const days = req.query.olderThanDays !== undefined ? Number(req.query.olderThanDays) : NaN;
    if (!Number.isFinite(days) || days < 1) {
      return res.status(400).json({ error: 'olderThanDays must be a positive integer' });
    }
    const result = await ActivityLogsService.deleteOlderThan(days);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
