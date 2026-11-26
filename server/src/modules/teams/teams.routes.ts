import { Router, Request, Response } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { apiCache } from '../../middleware/api-cache.js';
import { cache } from '../../lib/cache.js';
import { createTeamSchema, updateTeamSchema, addMembersSchema, removeMembersSchema, teamNameParamSchema } from './teams.schema.js';
import { TeamsService } from './teams.service.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('director', 'hr'), apiCache({ ttl: 300_000 }), async (_req: Request, res: Response, next) => {
  try {
    const teams = await TeamsService.list();
    res.json(teams);
  } catch (err) { next(err); }
});

router.get('/mine', async (req: Request, res: Response, next) => {
  try {
    const teams = await TeamsService.getMyTeams(req.user!.sub);
    res.json(teams);
  } catch (err) { next(err); }
});

router.get('/stats', requireRole('director', 'hr'), async (_req: Request, res: Response, next) => {
  try {
    const stats = await TeamsService.getTeamsWithStats();
    res.json(stats);
  } catch (err) { next(err); }
});

router.get('/:teamName', requireRole('director', 'hr'), apiCache({ ttl: 300_000 }), async (req: Request, res: Response, next) => {
  try {
    const team = await TeamsService.getByName(req.params.teamName!);
    res.json(team);
  } catch (err) { next(err); }
});

router.post('/', requireRole('director'), validate(createTeamSchema), async (req: Request, res: Response, next) => {
  try {
    const team = await TeamsService.create(req.body);
    cache.delContaining('/api/v1/teams');
    try { await ActivityLogsService.createDiff(req.user!.sub, 'create_team', 'team', req.body.name ?? null, `Created team ${req.body.name ?? ''}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.status(201).json(team);
  } catch (err) { next(err); }
});

router.put('/:teamName', requireRole('director'), validate(updateTeamSchema), async (req: Request, res: Response, next) => {
  try {
    const team = await TeamsService.update(req.params.teamName!, req.body);
    cache.delContaining('/api/v1/teams');
    const renamed = req.body?.teamName && req.body.teamName !== req.params.teamName;
    const msg = renamed ? `Renamed team ${req.params.teamName} to ${req.body.teamName}` : `Updated team ${req.params.teamName}`;
    try { await ActivityLogsService.createDiff(req.user!.sub, 'update_team', 'team', req.params.teamName!, msg); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(team);
  } catch (err) { next(err); }
});

router.post('/:teamName/members', requireRole('director'), validate(addMembersSchema), async (req: Request, res: Response, next) => {
  try {
    const team = await TeamsService.addMembers(req.params.teamName!, req.body.userIds);
    cache.delContaining('/api/v1/teams');
    try { await ActivityLogsService.createDiff(req.user!.sub, 'add_team_members', 'team', req.params.teamName!, `Added ${(req.body.userIds ?? []).length} member(s) to ${req.params.teamName}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(team);
  } catch (err) { next(err); }
});

router.delete('/:teamName/members', requireRole('director'), validate(removeMembersSchema), async (req: Request, res: Response, next) => {
  try {
    const team = await TeamsService.removeMembers(req.params.teamName!, req.body.userIds);
    cache.delContaining('/api/v1/teams');
    try { await ActivityLogsService.createDiff(req.user!.sub, 'remove_team_members', 'team', req.params.teamName!, `Removed ${(req.body.userIds ?? []).length} member(s) from ${req.params.teamName}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(team);
  } catch (err) { next(err); }
});

router.delete('/:teamName', requireRole('director'), validate(teamNameParamSchema, 'params'), async (req: Request, res: Response, next) => {
  try {
    const result = await TeamsService.delete(req.params.teamName!);
    cache.delContaining('/api/v1/teams');
    try { await ActivityLogsService.createDiff(req.user!.sub, 'delete_team', 'team', req.params.teamName!, `Deleted team ${req.params.teamName}`); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
