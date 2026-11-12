import { z } from 'zod';

const planItemPriority = z.enum(['low', 'medium', 'high', 'urgent']);
export const planItemSchema = z.object({
  text: z.string().trim().min(1, 'Point text is required').max(1000, 'Point text too long'),
  priority: planItemPriority.default('medium'),
  estimatedDays: z.number().min(0, 'Days must be positive').max(365, 'Days too large').optional(),
  estimatedHours: z.number().min(0, 'Hours must be positive').max(1000, 'Hours too large').optional(),
});
export const planItemsSchema = z.array(planItemSchema).max(50, 'Too many points (max 50)');

export const createPlanSchema = z.object({
  date: z.string().trim().datetime('Invalid date format'),
  plannedWork: z.string().trim().min(1, 'Planned work is required').max(5000, 'Planned work too long'),
  priority: planItemPriority.default('medium'),
  estimatedHours: z.number().min(0, 'Hours must be positive').max(24, 'Hours cannot exceed 24 for a day').optional(),
  items: planItemsSchema.optional(),
});

export const updatePlanSchema = z.object({
  plannedWork: z.string().trim().min(1, 'Planned work is required').max(5000, 'Planned work too long').optional(),
  priority: planItemPriority.optional(),
  estimatedHours: z.number().min(0, 'Hours must be positive').max(24, 'Hours cannot exceed 24 for a day').optional(),
  items: planItemsSchema.optional(),
});

export const listPlansSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().trim().min(1).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  status: z.enum(['draft', 'submitted', 'reviewed', 'approved', 'rejected']).optional(),
  priority: planItemPriority.optional(),
});

export const reviewPlanSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewComment: z.string().trim().optional(),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ListPlansInput = z.infer<typeof listPlansSchema>;
