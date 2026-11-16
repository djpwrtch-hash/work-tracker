import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { apiCache } from '../../middleware/api-cache.js';
import { createReportSchema, updateReportSchema, listReportsSchema, reviewReportSchema } from './reports.schema.js';
import { ReportsService } from './reports.service.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';

const router = Router();

router.use(authenticate);

router.get('/', apiCache({ ttl: 60_000 }), validate(listReportsSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const result = await ReportsService.list(req.query as any, req.user!.sub, req.user!.accessLevel);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/slots', requireRole('director', 'hr'), async (_req: Request, res: Response, next) => {
  try {
    const slots = await ReportsService.getEmployeeSlots();
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
    const reports = await ReportsService.exportByUser(userId, req.query.startDate as string, req.query.endDate as string);
    res.json(reports);
  } catch (err) { next(err); }
});

router.get('/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const report = await ReportsService.getById(req.params.id!, req.user!.sub, req.user!.accessLevel);
    res.json(report);
  } catch (err) { next(err); }
});

router.post('/', validate(createReportSchema), async (req: Request, res: Response, next) => {
  try {
    const report = await ReportsService.create(req.user!.sub, req.body);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'create_report', 'work_report', report?.id ?? null, 'Created work report'); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.status(201).json(report);
  } catch (err) { next(err); }
});

router.patch('/:id', requireUuid('id'), validate(updateReportSchema), async (req: Request, res: Response, next) => {
  try {
    const report = await ReportsService.update(req.params.id!, req.user!.sub, req.body, req.user!.accessLevel);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'update_report', 'work_report', req.params.id!, `Updated work report ${req.params.id}: ${Object.keys(req.body ?? {}).join(', ')}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(report);
  } catch (err) { next(err); }
});

router.post('/:id/submit', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const report = await ReportsService.submit(req.params.id!, req.user!.sub);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'submit_report', 'work_report', req.params.id!, 'Submitted work report'); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(report);
  } catch (err) { next(err); }
});

router.post('/:id/review', requireRole('director', 'hr'), requireUuid('id'), validate(reviewReportSchema), async (req: Request, res: Response, next) => {
  try {
    const report = await ReportsService.review(req.params.id!, req.user!.sub, req.body.status, req.body.feedback);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'review_report', 'work_report', req.params.id!, `${req.body.status} report${req.body.feedback ? `: ${req.body.feedback}` : ''}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(report);
  } catch (err) { next(err); }
});

router.delete('/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await ReportsService.delete(req.params.id!, req.user!.sub, req.user!.accessLevel);
    try { await ActivityLogsService.createDiff(req.user!.sub, 'delete_report', 'work_report', req.params.id!, 'Deleted work report'); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
