import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { apiCache } from '../../middleware/api-cache.js';
import { createPlanSchema, updatePlanSchema, listPlansSchema, reviewPlanSchema } from './plans.schema.js';
import { PlansService } from './plans.service.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';

const router = Router();

router.use(authenticate);

router.get('/', apiCache({ ttl: 60_000 }), validate(listPlansSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const result = await PlansService.list(req.query as any, req.user!.sub, req.user!.accessLevel);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/slots', requireRole('director', 'hr'), async (_req: Request, res: Response, next) => {
  try {
    const slots = await PlansService.getEmployeeSlots();
    res.json(slots);
  } catch (err) { next(err); }
});

router.get('/export', requireRole('director', 'hr'), async (req: Request, res: Response, next) => {
  try {
    const userId = req.query.userId as string | undefined;
    if (userId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      res.status(400).json({ error: 'Invalid userId format' });
      return;
    }
    const plans = await PlansService.exportByUser(userId, req.query.startDate as string, req.query.endDate as string);
    res.json(plans);
  } catch (err) { next(err); }
});

router.get('/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const plan = await PlansService.getById(req.params.id!, req.user!.sub, req.user!.accessLevel);
    res.json(plan);
  } catch (err) { next(err); }
});

router.post('/', validate(createPlanSchema), async (req: Request, res: Response, next) => {
  try {
    const plan = await PlansService.create(req.user!.sub, req.body);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'create_plan', 'work_plan', plan?.id ?? null, 'Created work plan'); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.status(201).json(plan);
  } catch (err) { next(err); }
});

router.patch('/:id', requireUuid('id'), validate(updatePlanSchema), async (req: Request, res: Response, next) => {
  try {
    const plan = await PlansService.update(req.params.id!, req.user!.sub, req.body, req.user!.accessLevel);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'update_plan', 'work_plan', req.params.id!, `Updated work plan ${req.params.id}: ${Object.keys(req.body ?? {}).join(', ')}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(plan);
  } catch (err) { next(err); }
});

router.post('/:id/submit', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const plan = await PlansService.submit(req.params.id!, req.user!.sub);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'submit_plan', 'work_plan', req.params.id!, 'Submitted work plan'); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(plan);
  } catch (err) { next(err); }
});

router.post('/:id/review', requireRole('director', 'hr'), requireUuid('id'), validate(reviewPlanSchema), async (req: Request, res: Response, next) => {
  try {
    const plan = await PlansService.review(req.params.id!, req.user!.sub, req.body.status, req.body.reviewComment);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'review_plan', 'work_plan', req.params.id!, `${req.body.status} plan${req.body.reviewComment ? `: ${req.body.reviewComment}` : ''}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(plan);
  } catch (err) { next(err); }
});

router.delete('/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await PlansService.delete(req.params.id!, req.user!.sub, req.user!.accessLevel);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'delete_plan', 'work_plan', req.params.id!, 'Deleted work plan'); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
