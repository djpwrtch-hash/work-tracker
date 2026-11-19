import { z } from 'zod';

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Department name is required').max(200, 'Department name too long').regex(/^[a-zA-Z0-9\s\-_&]+$/, 'Department name contains invalid characters'),
  description: z.string().trim().max(1000, 'Description too long').optional(),
  managerId: z.string().trim().min(1, 'Invalid manager ID').optional(),
  memberIds: z.array(z.string().min(1)).max(500, 'Too many members').optional(),
});

export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Department name is required').max(200, 'Department name too long').regex(/^[a-zA-Z0-9\s\-_&]+$/, 'Department name contains invalid characters').optional(),
  description: z.string().trim().max(1000, 'Description too long').optional(),
  managerId: z.string().trim().min(1, 'Invalid manager ID').nullable().optional(),
  memberIds: z.array(z.string().min(1)).max(500, 'Too many members').nullable().optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
