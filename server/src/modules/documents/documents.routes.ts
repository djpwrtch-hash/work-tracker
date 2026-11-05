import { Router, Request, Response } from 'express';
import { validate, requireUuid } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/rbac.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { createDocumentRequestSchema, listDocumentsSchema, issueDocumentBodySchema, rejectDocumentSchema } from './documents.schema.js';
import { DocumentsService } from './documents.service.js';

const router = Router();

router.use(authenticate);

// Create a document request (employees for themselves; director/HR may request on behalf of an employee)
router.post('/', validate(createDocumentRequestSchema), async (req: Request, res: Response, next) => {
  try {
    const doc = await DocumentsService.create(req.user!.sub, req.user!.role, req.body);
    try { await ActivityLogsService.create(req.user!.sub, 'request', 'document', doc.id, { docType: doc.docType, userId: doc.userId }, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

router.get('/', validate(listDocumentsSchema, 'query'), async (req: Request, res: Response, next) => {
  try {
    const result = await DocumentsService.list(req.query as any, req.user!.sub, req.user!.role);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const doc = await DocumentsService.getById(req.params.id!, req.user!.sub, req.user!.role);
    res.json(doc);
  } catch (err) { next(err); }
});

// Fill the boilerplate template and issue the document to the employee
router.post('/:id/issue', requireRole('director', 'hr'), requireUuid('id'), validate(issueDocumentBodySchema), async (req: Request, res: Response, next) => {
  try {
    const doc = await DocumentsService.issue(req.params.id!, req.user!.sub, req.user!.role, req.body);
    try { await ActivityLogsService.create(req.user!.sub, 'issue', 'document', doc.id, { docType: doc.docType, docNumber: doc.docNumber }, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(doc);
  } catch (err) { next(err); }
});

router.post('/:id/reject', requireRole('director', 'hr'), requireUuid('id'), validate(rejectDocumentSchema), async (req: Request, res: Response, next) => {
  try {
    const doc = await DocumentsService.reject(req.params.id!, req.user!.sub, req.user!.role, req.body.reason);
    try { await ActivityLogsService.create(req.user!.sub, 'reject', 'document', doc.id, { docType: doc.docType, reason: req.body.reason ?? null }, req.ip); } catch (e) { console.error('[ActivityLogs] Failed:', e); }
    res.json(doc);
  } catch (err) { next(err); }
});

router.post('/:id/cancel', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const doc = await DocumentsService.cancel(req.params.id!, req.user!.sub, req.user!.role);
    res.json(doc);
  } catch (err) { next(err); }
});

// Data used to render the downloadable PDF
router.get('/:id/download', requireUuid('id'), async (req: Request, res: Response, next) => {
  try {
    const result = await DocumentsService.download(req.params.id!, req.user!.sub, req.user!.role);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;