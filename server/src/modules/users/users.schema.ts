import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().trim().email('Invalid email format').toLowerCase(),
  password: z.string().trim().min(12, 'Password must be at least 12 characters').max(128, 'Password too long').regex(/[A-Z]/, 'Password must contain at least one uppercase letter').regex(/[a-z]/, 'Password must contain at least one lowercase letter').regex(/[0-9]/, 'Password must contain at least one number').regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name too long').regex(/^[a-zA-Z\s'-]+$/, 'First name contains invalid characters'),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name too long').regex(/^[a-zA-Z\s'-]+$/, 'Last name contains invalid characters'),
  phoneNumber: z.string().trim().min(1, 'Phone number is required').max(16, 'Phone number too long').regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  role: z.enum(['director', 'hr', 'employee']),
  departmentId: z.string().trim().min(1, 'Invalid department ID').optional(),
  designation: z.string().trim().max(100, 'Designation too long').optional(),
  joiningDate: z.string().trim().datetime('Invalid date format').optional(),
  dob: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD').refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d < new Date() && new Date().getFullYear() - d.getUTCFullYear() >= 18;
  }, 'Must be at least 18 years old and in the past'),
  gender: z.enum(['male', 'female', 'other']),
  fatherName: z.string().trim().min(2, 'Father/Husband name required').max(100),
  nationality: z.string().trim().min(2).max(56),
  qualification: z.string().trim().min(2).max(100),
  addressStreet: z.string().trim().min(3).max(200),
  addressCity: z.string().trim().min(2).max(100),
  addressState: z.string().trim().min(2).max(100),
  addressPincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
});

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name too long').regex(/^[a-zA-Z\s'-]+$/, 'First name contains invalid characters').optional(),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name too long').regex(/^[a-zA-Z\s'-]+$/, 'Last name contains invalid characters').optional(),
  phoneNumber: z.string().trim().min(1, 'Phone number is required').max(16, 'Phone number too long').regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  role: z.enum(['director', 'hr', 'employee']).optional(),
  departmentId: z.string().trim().min(1, 'Invalid department ID').nullable().optional(),
  designation: z.string().trim().max(100, 'Designation too long').optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  dob: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().refine((v) => {
    if (!v) return true;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d < new Date() && new Date().getFullYear() - d.getUTCFullYear() >= 18;
  }, 'Must be at least 18 years old and in the past'),
  gender: z.enum(['male', 'female', 'other']).optional(),
  fatherName: z.string().trim().min(2).max(100).optional(),
  nationality: z.string().trim().min(2).max(56).optional(),
  qualification: z.string().trim().min(2).max(100).optional(),
  addressStreet: z.string().trim().min(3).max(200).optional(),
  addressCity: z.string().trim().min(2).max(100).optional(),
  addressState: z.string().trim().min(2).max(100).optional(),
  addressPincode: z.string().trim().regex(/^\d{6}$/).optional(),
  joiningDate: z.string().trim().datetime().optional(),
});

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(['director', 'hr', 'employee']).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  departmentId: z.string().trim().min(1).optional(),
  search: z.string().trim().max(200).optional(),
});

export const deleteUserSchema = z.object({
  confirm: z.enum(['DELETE']).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
export type DeleteUserInput = z.infer<typeof deleteUserSchema>;
