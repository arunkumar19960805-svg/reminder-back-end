import { z } from 'zod';

export const deliveryReportSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    eventId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    status: z
      .enum(['pending', 'processing', 'sent', 'failed', 'acknowledged', 'cancelled', 'expired'])
      .optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  }),
});

export const summaryRangeSchema = z.object({
  query: z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  }),
});

export const eventIdParamSchema = z.object({
  params: z.object({ eventId: z.string().uuid() }),
});
