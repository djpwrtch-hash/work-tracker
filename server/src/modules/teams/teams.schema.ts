import { z } from 'zod';

export const teamNameParamSchema = z.object({
  teamName: z.string().trim().min(1).max(200),
});

export const createTeamSchema = z.object({
  teamName: z.string().trim().min(1).max(200),
  memberIds: z.array(z.string().trim().min(1)).min(1),
  leaderId: z.string().trim().min(1).optional(),
});

export const updateTeamSchema = z.object({
  memberIds: z.array(z.string().trim().min(1)).min(1),
  leaderId: z.string().trim().min(1).optional(),
});

export const addMembersSchema = z.object({
  userIds: z.array(z.string().trim().min(1)).min(1, 'At least one user ID is required'),
});

export const removeMembersSchema = z.object({
  userIds: z.array(z.string().trim().min(1)).min(1, 'At least one user ID is required'),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
