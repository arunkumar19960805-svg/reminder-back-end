import { z } from 'zod';

export const registerDeviceSchema = z.object({
  body: z.object({
    fcmToken: z.string().min(20, 'A valid FCM token is required').max(512),
    platform: z.enum(['android', 'ios', 'web']).optional(),
    deviceName: z.string().max(150).nullable().optional(),
  }),
});

export const deviceIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const unregisterTokenSchema = z.object({
  body: z.object({ fcmToken: z.string().min(20).max(512) }),
});
