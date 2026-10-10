import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().email('A valid email is required'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    fullName: z.string().min(2, 'Full name is required').max(150),
    phone: z.string().max(20).nullable().optional(),
    role: z.enum(['admin', 'user']).optional(),
    timezone: z.string().min(2).max(64).optional(),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({ id: z.string().uuid('A valid user id is required') }),
  body: z.object({
    email: z.string().email().optional(),
    fullName: z.string().min(2).max(150).optional(),
    phone: z.string().max(20).nullable().optional(),
    role: z.enum(['admin', 'user']).optional(),
    timezone: z.string().min(2).max(64).optional(),
  }),
});

export const userIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid('A valid user id is required') }),
});

export const setActiveSchema = z.object({
  params: z.object({ id: z.string().uuid('A valid user id is required') }),
  body: z.object({ isActive: z.boolean() }),
});

export const listUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().max(150).optional(),
    role: z.enum(['admin', 'user']).optional(),
    isActive: booleanish.optional(),
  }),
});
