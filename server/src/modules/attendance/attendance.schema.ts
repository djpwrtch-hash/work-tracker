import { z } from 'zod';

const attendanceStatuses = ['present', 'on_break', 'work_end', 'absent', 'leave', 'half_day', 'holiday', 'remote'] as const;

const checkInStatuses = ['present', 'remote'] as const;

const dbDatetimeISO = z.string().trim().datetime().transform((v) => v.replace('T', ' ').replace(/\.\d{3}Z$/, ''));

export const checkInSchema = z.object({
  status: z.enum(checkInStatuses).default('present'),
  notes: z.string().trim().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).optional(),
  locationCapturedAt: dbDatetimeISO.optional(),
});

export const locationOptionalSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).optional(),
  locationCapturedAt: dbDatetimeISO.optional(),
});

export const monthlyQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  month: z.coerce.number().int().min(1).max(12).default(new Date().getMonth() + 1),
  userId: z.string().trim().optional(),
});

const timeHHMM = z.string().trim().regex(/^\d{1,2}:\d{2}$/, 'Time must be HH:MM');
const dateYYYYMMDD = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const booleanQuery = z.preprocess((v) => v === true || v === 'true' || v === 1 || v === '1', z.boolean());

export const createExtraWorkSchema = z.object({
  date: dateYYYYMMDD,
  startTime: timeHHMM,
  endTime: timeHHMM,
  notes: z.string().trim().max(500).optional(),
}).refine((d) => {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return toMinutes(d.endTime) > toMinutes(d.startTime);
}, { message: 'End time must be after start time', path: ['endTime'] });

export const listAttendanceSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().trim().min(1).optional(),
  includeHolidays: booleanQuery.optional(),
  userIds: z.preprocess(
    (val) => (val === undefined || val === null ? val : Array.isArray(val) ? val : [val]),
    z.array(z.string().trim().min(1)).optional()
  ),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  status: z.enum(attendanceStatuses).optional(),
  statuses: z.preprocess(
    (val) => (val === undefined || val === null ? val : Array.isArray(val) ? val : [val]),
    z.array(z.enum(attendanceStatuses)).optional()
  ),
});

export const updateAttendanceSchema = z.object({
  status: z.enum(attendanceStatuses).optional(),
  loginTime: dbDatetimeISO.optional(),
  logoutTime: dbDatetimeISO.optional(),
  workingHours: z.number().min(0).optional(),
  overtimeHours: z.number().min(0).optional(),
  pauseStartTime: dbDatetimeISO.optional(),
  pauseEndTime: dbDatetimeISO.optional(),
  pauseMinutes: z.number().min(0).optional(),
  notes: z.string().trim().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).optional(),
  locationCapturedAt: dbDatetimeISO.optional(),
});

export const deleteAttendanceSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  userIds: z.preprocess(
    (val) => (val === undefined || val === null ? val : Array.isArray(val) ? val : [val]),
    z.array(z.string().trim().min(1)).optional()
  ),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  status: z.enum(attendanceStatuses).optional(),
  statuses: z.preprocess(
    (val) => (val === undefined || val === null ? val : Array.isArray(val) ? val : [val]),
    z.array(z.enum(attendanceStatuses)).optional()
  ),
  confirm: z.enum(['DELETE']).optional(),
});

export const reviewCorrectionRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(500).optional(),
});

export type ReviewCorrectionRequestInput = z.infer<typeof reviewCorrectionRequestSchema>;

export type CheckInInput = z.infer<typeof checkInSchema>;
export type ListAttendanceInput = z.infer<typeof listAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;
export type DeleteAttendanceInput = z.infer<typeof deleteAttendanceSchema>;
export type CreateExtraWorkInput = z.infer<typeof createExtraWorkSchema>;
