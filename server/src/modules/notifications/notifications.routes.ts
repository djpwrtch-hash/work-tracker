import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { NotificationsService } from './notifications.service.js';
import { listNotificationsSchema } from './notifications.schema.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(listNotificationsSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const { unread, page, limit } = req.query as any;
    const result = await NotificationsService.list(req.user!.sub, { unreadOnly: unread, page, limit });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/read-all', async (req: Request, res: Response, next) => {
  try {
    const result = await NotificationsService.markAllRead(req.user!.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/read', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const notification = await NotificationsService.markRead(req.params.id!, req.user!.sub);
    res.json(notification);
  } catch (err) { next(err); }
});

router.delete('/all', async (req: Request, res: Response, next) => {
  try {
    const result = await NotificationsService.deleteAll(req.user!.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await NotificationsService.delete(req.params.id!, req.user!.sub);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
