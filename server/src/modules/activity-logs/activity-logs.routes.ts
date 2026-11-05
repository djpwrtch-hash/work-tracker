import { Router, Request, Response } from 'express';
import { validate } from '../../middleware/validate.js';
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

export default router;
