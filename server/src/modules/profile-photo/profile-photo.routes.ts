import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/authenticate.js';
import { ProfilePhotoService } from './profile-photo.service.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { AppError } from '../../lib/app-error.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (Number(process.env.MAX_PROFILE_PHOTO_MB) || 2) * 1024 * 1024 },
});

const router = Router();
router.use(authenticate);

/** Upload or replace the current user's profile photo. */
router.post('/', upload.single('photo'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError(400, 'No photo provided');
    const result = await ProfilePhotoService.upload(req.user!.sub, req.file);
    try { await ActivityLogsService.create(req.user!.sub, 'update_profile_photo', 'user', req.user!.sub, undefined, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

/** Remove the current user's profile photo. */
router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ProfilePhotoService.remove(req.user!.sub);
    try { await ActivityLogsService.create(req.user!.sub, 'remove_profile_photo', 'user', req.user!.sub, undefined, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(result);
  } catch (err) { next(err); }
});

/** Serve a user's profile photo. Authenticated so any logged-in user can see avatars. */
router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { buffer, contentType } = await ProfilePhotoService.getPhoto(req.params.userId!);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(buffer);
  } catch (err) { next(err); }
});

export default router;
