import { z } from 'zod';

export const listRemindersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    scope: z.enum(['today', 'upcoming', 'overdue', 'acknowledged', 'all']).optional(),
    status: z
      .enum(['pending', 'processing', 'sent', 'failed', 'acknowledged', 'cancelled', 'expired'])
      .optional(),
  }),
});

export const reminderIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const acknowledgeSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    deviceId: z.string().uuid().nullable().optional(),
    source: z.enum(['app', 'notification_action']).optional(),
  }),
});

export const historySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

export const configureRulesSchema = z.object({
  params: z.object({ eventId: z.string().uuid() }),
  body: z.object({
    reminders: z
      .array(
        z.object({
          offsetMinutes: z.number().int().min(-1440).max(10080),
          label: z.string().max(100).nullable().optional(),
          isAlarm: z.boolean().optional(),
          isEnabled: z.boolean().optional(),
        })
      )
      .min(1, 'At least one reminder is required')
      .max(10),
  }),
});
