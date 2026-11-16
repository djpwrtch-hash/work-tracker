import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate, requireUuid } from '../../middleware/validate.js';
import { sendMessageSchema, listMessagesSchema } from './messages.schema.js';
import { MessagesService } from './messages.service.js';

const router = Router();
router.use(authenticate);

/** List threads (employee: own thread; admin: all threads). */
router.get('/threads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await MessagesService.listThreads(req.user!.sub, req.user!.accessLevel));
  } catch (err) { next(err); }
});

/** Unread count for the current user (for the Chat nav badge). */
router.get('/threads/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await MessagesService.unreadCount(req.user!.sub, req.user!.accessLevel));
  } catch (err) { next(err); }
});

/** Read messages in a thread (participants only; admins may read any). */
router.get('/threads/:id', requireUuid('id'), validate(listMessagesSchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await MessagesService.getMessages(req.params.id!, req.user!.sub, req.user!.accessLevel));
  } catch (err) { next(err); }
});

/** Send a message in a thread. */
router.post('/threads/:id', requireUuid('id'), validate(sendMessageSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await MessagesService.send(req.params.id!, req.user!.sub, req.body.content, req.user!.accessLevel));
  } catch (err) { next(err); }
});

/** Mark a thread as read for the current user. */
router.patch('/threads/:id/read', requireUuid('id'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await MessagesService.markRead(req.params.id!, req.user!.sub));
  } catch (err) { next(err); }
});

export default router;
