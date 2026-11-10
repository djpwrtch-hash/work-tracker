import { z } from 'zod';

export const ACCESS_LEVELS = ['director', 'hr', 'employee'] as const;

const roleName = z
  .string()
  .trim()
  .min(2, 'Role name must be at least 2 characters')
  .max(50, 'Role name too long')
  .regex(/^[a-zA-Z][a-zA-Z0-9 _-]*$/, 'Role name must start with a letter and contain only letters, numbers, spaces, hyphens and underscores');

export const createRoleSchema = z.object({
  name: roleName,
  description: z.string().trim().max(255, 'Description too long').optional(),
  accessLevel: z.enum(ACCESS_LEVELS).default('employee'),
});

export const updateRoleSchema = z.object({
  name: roleName.optional(),
  description: z.string().trim().max(255, 'Description too long').nullable().optional(),
  accessLevel: z.enum(ACCESS_LEVELS).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
