import { z } from 'zod';

export const createLeaveSchema = z.object({
  type: z.enum(['casual', 'sick', 'proposal']),
  startDate: z.string().trim().min(1, 'Start date is required').refine((val) => !isNaN(Date.parse(val)), 'Invalid start date format'),
  endDate: z.string().trim().min(1, 'End date is required').refine((val) => !isNaN(Date.parse(val)), 'Invalid end date format'),
  reason: z.string().trim().min(1, 'Reason is required').max(2000, 'Reason too long'),
  duration: z.enum(['full_day', 'half_day']).default('full_day'),
  halfDayPeriod: z.enum(['morning', 'afternoon']).optional(),
}).refine((data) => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  return end >= start;
}, { message: 'End date must be after or equal to start date', path: ['endDate'] })
.refine((data) => {
  if (data.duration !== 'half_day') return true;
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  return start.toDateString() === end.toDateString();
}, { message: 'Half-day leave can only span a single day', path: ['endDate'] })
.refine((data) => data.duration !== 'half_day' || !!data.halfDayPeriod, { message: 'Select morning or afternoon for half-day leave', path: ['halfDayPeriod'] })
.refine((data) => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff <= 365;
}, { message: 'Leave duration cannot exceed 1 year', path: ['endDate'] });

export const listLeavesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().trim().min(1).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  statuses: z.array(z.enum(['pending', 'approved', 'rejected', 'cancelled'])).optional(),
  type: z.enum(['casual', 'sick', 'proposal']).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});

export const reviewLeaveSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewComment: z.string().trim().optional(),
}).refine((d) => d.status !== 'rejected' || (!!d.reviewComment && d.reviewComment.trim().length > 0), { message: 'Rejection reason is required', path: ['reviewComment'] });

export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type ListLeavesInput = z.infer<typeof listLeavesSchema>;
