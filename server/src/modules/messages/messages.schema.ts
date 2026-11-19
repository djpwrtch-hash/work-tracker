import { z } from 'zod';

export const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(100, 'Message too long (max 100 characters)'),
});

export const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(200),
  before: z.string().trim().optional(),
});
