import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { checkInSchema, listAttendanceSchema, updateAttendanceSchema, monthlyQuerySchema, deleteAttendanceSchema, locationOptionalSchema, reviewCorrectionRequestSchema, createExtraWorkSchema } from './attendance.schema.js';
import { AttendanceService, getAttendanceEvents, getAttendanceEventsForUser, getPauseLog } from './attendance.service.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';

const router = Router();

router.use(authenticate);

router.post('/check-in', validate(checkInSchema), async (req: Request, res: Response, next) => {
  try {
    const record = await AttendanceService.checkIn(req.user!.sub, req.body);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

router.post('/check-out', validate(locationOptionalSchema), async (req: Request, res: Response, next) => {
  try {
    const record = await AttendanceService.checkOut(req.user!.sub, req.body);
    res.json(record);
  } catch (err) { next(err); }
});

router.post('/pause-start', async (req: Request, res: Response, next) => {
  try {
    const record = await AttendanceService.startPause(req.user!.sub);
    res.json(record);
  } catch (err) { next(err); }
});

router.post('/pause-end', async (req: Request, res: Response, next) => {
  try {
    const record = await AttendanceService.endPause(req.user!.sub);
    res.json(record);
  } catch (err) { next(err); }
});

router.post('/extra-work', validate(createExtraWorkSchema), async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.createExtraWork(req.user!.sub, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/extra-work', async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.listExtraWork({
      userId: req.query.userId as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      accepted: req.query.accepted !== undefined ? req.query.accepted === 'true' : undefined,
      requesterId: req.user!.sub,
      requesterAccessLevel: req.user!.accessLevel,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.patch('/extra-work/:id/accept', requireRole('director', 'hr'), requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.acceptExtraWork(String(req.params.id!), req.user!.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/extra-work/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.deleteExtraWork(String(req.params.id!), req.user!.sub, req.user!.accessLevel);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/correction-requests/mine', async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.getMyCorrectionRequest(req.user!.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/correction-requests', requireRole('director', 'hr'), async (req: Request, res: Response, next) => {
  try {
    const status = (req.query.status as string)?.trim();
    if (status && !['pending', 'approved', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'status must be pending, approved or rejected' });
      return;
    }
    const result = await AttendanceService.listCorrectionRequests(status);
    res.json({ requests: result });
  } catch (err) { next(err); }
});

router.patch('/correction-requests/:id', requireRole('director', 'hr'), requireUuid('id'), validate(reviewCorrectionRequestSchema), async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.reviewCorrectionRequest(String(req.params.id!), req.body.status, req.user!.sub, req.body.comment);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/events/:attendanceId', requireUuid('attendanceId'), async (req: Request, res: Response, next) => {
  try {
    const isAdmin = req.user!.accessLevel === 'director' || req.user!.accessLevel === 'hr';
    const events = isAdmin
      ? await getAttendanceEvents(req.params.attendanceId!)
      : await getAttendanceEventsForUser(req.user!.sub, req.params.attendanceId!);
    res.json({ events });
  } catch (err) { next(err); }
});

router.get('/pause-log', requireRole('director', 'hr'), async (req: Request, res: Response, next) => {
  try {
    const startDate = (req.query.startDate as string)?.trim();
    const endDate = (req.query.endDate as string)?.trim();
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      res.status(400).json({ error: 'startDate must be YYYY-MM-DD format' });
      return;
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      res.status(400).json({ error: 'endDate must be YYYY-MM-DD format' });
      return;
    }
    const events = await getPauseLog(startDate, endDate);
    res.json({ events });
  } catch (err) { next(err); }
});

router.get('/today', async (req: Request, res: Response, next) => {
  try {
    const record = await AttendanceService.getTodayStatus(req.user!.sub);
    res.json(record);
  } catch (err) { next(err); }
});

router.get('/today-all', requireRole('director', 'hr'), async (req: Request, res: Response, next) => {
  try {
    const records = await AttendanceService.getTodayAll();
    res.json(records);
  } catch (err) { next(err); }
});

router.get('/history/:userId', requireRole('director', 'hr'), requireUuid('userId'), async (req: Request, res: Response, next) => {
  try {
    const year = Math.min(2100, Math.max(2000, parseInt(req.query.year as string) || new Date().getFullYear()));
    const month = Math.min(12, Math.max(1, parseInt(req.query.month as string) || new Date().getMonth() + 1));
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const result = await AttendanceService.getUserHistory(req.params.userId!, year, month, startDate, endDate);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/monthly', validate(monthlyQuerySchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const q = req.query as any;
    const targetUserId = (req.user!.accessLevel === 'director' || req.user!.accessLevel === 'hr') && q.userId ? q.userId : req.user!.sub;
    const summary = await AttendanceService.getMonthlySummary(targetUserId, q.year, q.month);
    res.json(summary);
  } catch (err) { next(err); }
});

router.get('/my', validate(listAttendanceSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.list({ ...req.query, userId: req.user!.sub });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/', requireRole('director', 'hr'), validate(listAttendanceSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.list(req.query as any);
    res.json(result);
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('director', 'hr'), requireUuid('id'), validate(updateAttendanceSchema), async (req: Request, res: Response, next) => {
  try {
    const record = await AttendanceService.update(req.params.id!, req.body);
    res.json(record);
  } catch (err) { next(err); }
});

router.delete('/bulk', requireRole('director'), validate(deleteAttendanceSchema), async (req: Request, res: Response, next) => {
  try {
    const result = await AttendanceService.bulkDelete(req.body);
    try {
      await ActivityLogsService.create(req.user!.sub, 'bulk_delete', 'attendance', undefined, { ...result.scope, deleted: result.deleted }, req.ip);
    } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/overtime/:year/:month', requireRole('director', 'hr'), async (req: Request, res: Response, next) => {
  try {
    const year = Math.min(2100, Math.max(2000, parseInt(req.params.year ?? '') || new Date().getFullYear()));
    const month = Math.min(12, Math.max(1, parseInt(req.params.month ?? '') || new Date().getMonth() + 1));
    const result = await AttendanceService.getMonthlyOvertimeAll(year, month);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/overtime/my/:year/:month', async (req: Request, res: Response, next) => {
  try {
    const year = Math.min(2100, Math.max(2000, parseInt(req.params.year ?? '') || new Date().getFullYear()));
    const month = Math.min(12, Math.max(1, parseInt(req.params.month ?? '') || new Date().getMonth() + 1));
    const result = await AttendanceService.getMonthlyOvertime(req.user!.sub, year, month);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
