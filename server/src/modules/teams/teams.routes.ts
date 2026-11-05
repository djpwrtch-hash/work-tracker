import { Router, Request, Response } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { apiCache } from '../../middleware/api-cache.js';
import { cache } from '../../lib/cache.js';
import { createTeamSchema, updateTeamSchema, addMembersSchema, removeMembersSchema, teamNameParamSchema } from './teams.schema.js';
import { TeamsService } from './teams.service.js';

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
    res.status(201).json(team);
  } catch (err) { next(err); }
});

router.put('/:teamName', requireRole('director'), validate(updateTeamSchema), async (req: Request, res: Response, next) => {
  try {
    const team = await TeamsService.update(req.params.teamName!, req.body);
    cache.delContaining('/api/v1/teams');
    res.json(team);
  } catch (err) { next(err); }
});

router.post('/:teamName/members', requireRole('director'), validate(addMembersSchema), async (req: Request, res: Response, next) => {
  try {
    const team = await TeamsService.addMembers(req.params.teamName!, req.body.userIds);
    cache.delContaining('/api/v1/teams');
    res.json(team);
  } catch (err) { next(err); }
});

router.delete('/:teamName/members', requireRole('director'), validate(removeMembersSchema), async (req: Request, res: Response, next) => {
  try {
    const team = await TeamsService.removeMembers(req.params.teamName!, req.body.userIds);
    cache.delContaining('/api/v1/teams');
    res.json(team);
  } catch (err) { next(err); }
});

router.delete('/:teamName', requireRole('director'), validate(teamNameParamSchema, 'params'), async (req: Request, res: Response, next) => {
  try {
    const result = await TeamsService.delete(req.params.teamName!);
    cache.delContaining('/api/v1/teams');
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
