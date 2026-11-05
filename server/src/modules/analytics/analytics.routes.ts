import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { apiCache } from '../../middleware/api-cache.js';
import { AnalyticsService } from './analytics.service.js';

const router = Router();

router.use(authenticate);
router.use(requireRole('director', 'hr'));

router.get('/attendance-trends', apiCache({ ttl: 120_000 }), async (req: Request, res: Response, next) => {
  try {
    const year = Math.min(2100, Math.max(2000, Number(req.query.year) || new Date().getFullYear()));
    const month = Math.min(12, Math.max(1, Number(req.query.month) || (new Date().getMonth() + 1)));
    const data = await AnalyticsService.attendanceTrends(year, month);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/department-stats', apiCache({ ttl: 120_000 }), async (_req: Request, res: Response, next) => {
  try {
    const data = await AnalyticsService.departmentStats();
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/leave-usage', apiCache({ ttl: 120_000 }), async (req: Request, res: Response, next) => {
  try {
    const year = Math.min(2100, Math.max(2000, Number(req.query.year) || new Date().getFullYear()));
    const data = await AnalyticsService.leaveUsage(year);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/task-summary', apiCache({ ttl: 120_000 }), async (_req: Request, res: Response, next) => {
  try {
    const data = await AnalyticsService.taskSummary();
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/overtime', apiCache({ ttl: 120_000 }), async (req: Request, res: Response, next) => {
  try {
    const year = Math.min(2100, Math.max(2000, Number(req.query.year) || new Date().getFullYear()));
    const data = await AnalyticsService.overtimeAnalytics(year);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/productivity', apiCache({ ttl: 60_000 }), async (req: Request, res: Response, next) => {
  try {
    const { userId, startDate, endDate } = req.query;
    const data = await AnalyticsService.productivity(
      userId as string | undefined,
      startDate as string | undefined,
      endDate as string | undefined,
    );
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/department-performance', apiCache({ ttl: 60_000 }), async (_req: Request, res: Response, next) => {
  try {
    const data = await AnalyticsService.departmentPerformance();
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/employee-productivity', apiCache({ ttl: 60_000 }), async (req: Request, res: Response, next) => {
  try {
    const { departmentId, period } = req.query;
    const validPeriod = ['week', 'month', 'quarter', 'year'].includes(period as string) ? (period as string) : 'month';
    const data = await AnalyticsService.employeeProductivity(
      departmentId as string | undefined,
      validPeriod,
    );
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/manager-dashboard', apiCache({ ttl: 60_000 }), async (req: Request, res: Response, next) => {
  try {
    const { managerId } = req.query;
    if (!managerId) {
      res.status(400).json({ error: 'managerId is required' });
      return;
    }
    const data = await AnalyticsService.managerDashboard(managerId as string);
    res.json(data);
  } catch (err) { next(err); }
});

export default router;
