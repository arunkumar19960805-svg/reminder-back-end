import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('A valid email is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10, 'refreshToken is required'),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(128, 'New password is too long'),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().min(2).max(150).optional(),
    phone: z.string().max(20).nullable().optional(),
    timezone: z.string().min(2).max(64).optional(),
  }),
});
