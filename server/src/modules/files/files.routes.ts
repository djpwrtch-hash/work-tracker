import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { validate, requireUuid } from '../../middleware/validate.js';
import { listFilesSchema } from './files.schema.js';
import { FilesService } from './files.service.js';

const ALLOWED_MIMES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type "${file.mimetype}" not allowed`));
  },
});

const router = Router();

router.use(authenticate);

router.post('/upload', upload.single('file'), async (req: Request, res: Response, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    const file = await FilesService.upload(req.user!.sub, req.file);
    res.status(201).json(file);
  } catch (err) { next(err); }
});

router.get('/', validate(listFilesSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const result = await FilesService.list(req.query as any, req.user!.role, req.user!.sub);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/retention', requireRole('director', 'hr'), async (_req: Request, res: Response, next) => {
  try {
    const policies = await FilesService.getRetentionPolicies();
    res.json(policies);
  } catch (err) { next(err); }
});

router.post('/cleanup', requireRole('director', 'hr'), async (_req: Request, res: Response, next) => {
  try {
    const deleted = await FilesService.cleanupExpiredFiles();
    res.json({ deleted });
  } catch (err) { next(err); }
});

router.get('/:id/download', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const { buffer, filename, mimeType } = await FilesService.download(req.params.id!, req.user!.sub, req.user!.role);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

router.delete('/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    await FilesService.delete(req.params.id!, req.user!.sub, req.user!.role);
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
