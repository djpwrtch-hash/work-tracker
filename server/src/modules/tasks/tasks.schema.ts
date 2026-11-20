import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500, 'Title too long'),
  description: z.string().trim().max(5000, 'Description too long').optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: z.string().trim().datetime('Invalid date format').optional(),
  assigneeIds: z.array(z.string().trim().min(1, 'Invalid assignee ID')).min(1, 'At least one assignee is required').refine(
    (ids) => new Set(ids).size === ids.length,
    { message: 'Duplicate assignees are not allowed' }
  ),
  departmentId: z.string().trim().min(1, 'Invalid department ID').optional(),
  teamName: z.string().trim().min(1, 'Invalid team name').max(200, 'Team name too long').optional(),
  estimatedHours: z.number().min(0, 'Hours must be positive').max(1000, 'Hours too high').optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500, 'Title too long').optional(),
  description: z.string().trim().max(5000, 'Description too long').optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'on_hold', 'cancelled']).optional(),
  progressPercent: z.number().min(0, 'Progress must be between 0-100').max(100, 'Progress must be between 0-100').optional(),
  dueDate: z.string().trim().datetime('Invalid date format').nullable().optional(),
  assigneeIds: z.array(z.string().trim().min(1, 'Invalid assignee ID')).optional().refine(
    (ids) => !ids || new Set(ids).size === ids.length,
    { message: 'Duplicate assignees are not allowed' }
  ),
  estimatedHours: z.number().min(0, 'Hours must be positive').max(1000, 'Hours too high').optional(),
  actualHours: z.number().min(0, 'Hours must be positive').max(1000, 'Hours too high').optional(),
  teamName: z.string().trim().min(1, 'Invalid team name').max(200, 'Team name too long').nullable().optional(),
});

export const listTasksSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'in_progress', 'completed', 'on_hold', 'cancelled']).optional(),
  statuses: z.preprocess(
    (val) => (val === undefined || val === null ? val : Array.isArray(val) ? val : [val]),
    z.array(z.enum(['pending', 'in_progress', 'completed', 'on_hold', 'cancelled'])).optional()
  ),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  priorities: z.preprocess(
    (val) => (val === undefined || val === null ? val : Array.isArray(val) ? val : [val]),
    z.array(z.enum(['low', 'medium', 'high', 'urgent'])).optional()
  ),
  assigneeId: z.string().trim().min(1).optional(),
  assigneeIds: z.preprocess(
    (val) => (val === undefined || val === null ? val : Array.isArray(val) ? val : [val]),
    z.array(z.string().trim().min(1)).optional()
  ),
  departmentId: z.string().trim().min(1).optional(),
  teamName: z.string().trim().min(1).max(200).optional(),
  search: z.string().trim().optional(),
  dueBefore: z.string().trim().optional(),
  dueAfter: z.string().trim().optional(),
});

export const addCommentSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const requestApprovalSchema = z.object({
  comment: z.string().trim().optional(),
});

export const reviewApprovalSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  comment: z.string().trim().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
