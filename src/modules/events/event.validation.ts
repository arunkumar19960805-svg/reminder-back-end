import { z } from 'zod';

const reminderConfig = z.object({
  offsetMinutes: z
    .number()
    .int()
    .min(-1440, 'Offset cannot be more than a day after the event')
    .max(10080, 'Offset cannot be more than a week before the event'),
  label: z.string().max(100).nullable().optional(),
  isAlarm: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});

const recurrenceFields = {
  recurrenceFrequency: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
  recurrenceInterval: z.number().int().min(1).max(52).optional(),
  recurrenceDaysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).nullable().optional(),
  recurrenceEndAt: z.string().datetime({ offset: true }).nullable().optional(),
};

export const createEventSchema = z.object({
  body: z.object({
    title: z.string().min(2, 'Title is required').max(200),
    description: z.string().max(5000).nullable().optional(),
    eventType: z.enum(['meeting', 'appointment', 'reminder', 'event']).optional(),
    startAt: z
      .string()
      .datetime({ offset: true, message: 'startAt must be ISO 8601 with an offset' }),
    endAt: z.string().datetime({ offset: true }).nullable().optional(),
    timezone: z.string().min(2).max(64).optional(),
    location: z.string().max(255).nullable().optional(),
    meetingLink: z.string().url('meetingLink must be a valid URL').max(500).nullable().optional(),
    assigneeIds: z.array(z.string().uuid()).min(1, 'At least one assignee is required'),
    reminders: z.array(reminderConfig).max(10).optional(),
    ...recurrenceFields,
  }),
});

export const updateEventSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(2).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    eventType: z.enum(['meeting', 'appointment', 'reminder', 'event']).optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).nullable().optional(),
    timezone: z.string().min(2).max(64).optional(),
    location: z.string().max(255).nullable().optional(),
    meetingLink: z.string().url().max(500).nullable().optional(),
    ...recurrenceFields,
  }),
});

export const eventIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const cancelEventSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ reason: z.string().max(500).nullable().optional() }),
});

export const assignUsersSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    userIds: z.array(z.string().uuid()).min(1, 'At least one user is required'),
  }),
});

export const unassignUserSchema = z.object({
  params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
});

export const listEventsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(['scheduled', 'cancelled', 'completed']).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    search: z.string().max(200).optional(),
    assigneeId: z.string().uuid().optional(),
  }),
});
