import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email format').toLowerCase(),
  password: z.string().trim().min(1, 'Password is required'),
  pendingAuthToken: z.string().trim().min(1, 'Pending authentication token is required').optional(),
  twoFactorCode: z.string().trim().regex(/^\d{6}$/, 'Two-factor code must be 6 digits').optional(),
}).refine((data) => !(data.pendingAuthToken && !data.twoFactorCode) && !(data.twoFactorCode && !data.pendingAuthToken), {
  message: 'Both pendingAuthToken and twoFactorCode are required for the 2FA step',
  path: ['twoFactorCode'],
});

export const registerSchema = z.object({
  email: z.string().trim().email('Invalid email format').toLowerCase(),
  password: z.string().trim().min(12, 'Password must be at least 12 characters').max(128, 'Password too long').regex(/[A-Z]/, 'Password must contain at least one uppercase letter').regex(/[a-z]/, 'Password must contain at least one lowercase letter').regex(/[0-9]/, 'Password must contain at least one number').regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name too long').regex(/^[a-zA-Z\s'-]+$/, 'First name contains invalid characters'),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name too long').regex(/^[a-zA-Z\s'-]+$/, 'Last name contains invalid characters'),
  phoneNumber: z.string().trim().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format').optional().or(z.literal('')),
  departmentId: z.string().trim().min(1, 'Invalid department ID').optional(),
  designation: z.string().trim().max(100, 'Designation too long').optional(),
  joiningDate: z.string().trim().datetime('Invalid date format').optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().trim().min(1, 'Current password is required'),
  newPassword: z.string().trim().min(12, 'Password must be at least 12 characters').max(128, 'Password too long').regex(/[A-Z]/, 'Password must contain at least one uppercase letter').regex(/[a-z]/, 'Password must contain at least one lowercase letter').regex(/[0-9]/, 'Password must contain at least one number').regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'New password must be different from current password',
  path: ['newPassword'],
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email format').toLowerCase(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(1, 'Refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().trim().min(1, 'Refresh token is required'),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Token is required'),
  newPassword: z.string().trim().min(12, 'Password must be at least 12 characters').max(128, 'Password too long').regex(/[A-Z]/, 'Password must contain at least one uppercase letter').regex(/[a-z]/, 'Password must contain at least one lowercase letter').regex(/[0-9]/, 'Password must contain at least one number').regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export const twoFactorVerifySchema = z.object({
  secret: z.string().trim().min(16, 'Invalid secret').regex(/^[A-Za-z2-7]+=*$/, 'Invalid base32 secret'),
  code: z.string().trim().regex(/^\d{6}$/, 'Two-factor code must be 6 digits'),
});

export const twoFactorDisableSchema = z.object({
  currentPassword: z.string().trim().min(1, 'Current password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
