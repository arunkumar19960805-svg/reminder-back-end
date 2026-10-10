import admin from 'firebase-admin';
import { config } from '../config/config';
import { logger } from '../config/logger';
import { Device } from '../database/models';

export interface PushResult {
  deviceId: string;
  status: 'accepted' | 'rejected' | 'error';
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  /** True when the token is permanently dead and should be deactivated. */
  tokenInvalid?: boolean;
}

let initialised = false;
let available = false;

/**
 * Firebase is optional at boot. Without credentials the rest of the system
 * (scheduling, acknowledgement, reporting) still runs and reminders are
 * recorded as failed delivery rather than crashing the server.
 */
export const initPush = (): boolean => {
  if (initialised) return available;
  initialised = true;

  const { projectId, clientEmail, privateKey } = config.firebase;
  if (!projectId || !clientEmail || !privateKey) {
    logger.warn(
      'Firebase credentials are not configured. Push delivery is DISABLED; ' +
        'reminders will still be scheduled and recorded, but not delivered.'
    );
    available = false;
    return false;
  }

  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
    }
    available = true;
    logger.info(`Firebase Admin initialised for project ${projectId}.`);
  } catch (error) {
    logger.error(error, 'Failed to initialise Firebase Admin; push delivery disabled.');
    available = false;
  }
  return available;
};

export const isPushAvailable = (): boolean => {
  if (!initialised) initPush();
  return available;
};

/** FCM error codes that mean the token will never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export interface ReminderPushPayload {
  reminderInstanceId: string;
  eventId: string;
  title: string;
  body: string;
  isAlarm: boolean;
  occurrenceStart: string;
  meetingLink?: string | null;
  location?: string | null;
}

/**
 * Sends one reminder to every active device of a user.
 *
 * Sent as a DATA-ONLY message on purpose. A `notification` payload would be
 * rendered by the system while the app is backgrounded, which gives us no
 * control over the channel, full-screen intent or the acknowledge action.
 * Data-only hands the payload to the app's background handler, which builds
 * the notification locally on the correct channel.
 */
export const sendReminderToUserDevices = async (
  devices: Device[],
  payload: ReminderPushPayload
): Promise<PushResult[]> => {
  if (!isPushAvailable()) {
    return devices.map((d) => ({
      deviceId: d.id,
      status: 'error' as const,
      errorCode: 'push/not-configured',
      errorMessage: 'Firebase credentials are not configured on the server',
    }));
  }

  const results: PushResult[] = [];

  for (const device of devices) {
    try {
      const messageId = await admin.messaging().send({
        token: device.fcmToken,
        data: {
          type: 'reminder',
          reminderInstanceId: payload.reminderInstanceId,
          eventId: payload.eventId,
          title: payload.title,
          body: payload.body,
          isAlarm: String(payload.isAlarm),
          occurrenceStart: payload.occurrenceStart,
          meetingLink: payload.meetingLink || '',
          location: payload.location || '',
        },
        android: {
          // `high` asks FCM to wake the device even in Doze. It is a request,
          // not a guarantee: OEM battery managers can still defer it.
          priority: 'high',
          ttl: 60 * 60 * 1000,
        },
      });

      results.push({
        deviceId: device.id,
        status: 'accepted',
        providerMessageId: messageId,
      });
    } catch (error: any) {
      const code: string = error?.errorInfo?.code || error?.code || 'unknown';
      const tokenInvalid = DEAD_TOKEN_CODES.has(code);
      results.push({
        deviceId: device.id,
        status: tokenInvalid ? 'rejected' : 'error',
        errorCode: code,
        // Never log the token itself.
        errorMessage: String(error?.message || '').slice(0, 900),
        tokenInvalid,
      });
    }
  }

  return results;
};

/**
 * Tells a user's other devices that a reminder was acknowledged, so an alarm
 * ringing on a second handset can stop itself.
 */
export const sendAcknowledgementSync = async (
  devices: Device[],
  reminderInstanceId: string,
  eventId: string
): Promise<void> => {
  if (!isPushAvailable() || devices.length === 0) return;

  await Promise.all(
    devices.map(async (device) => {
      try {
        await admin.messaging().send({
          token: device.fcmToken,
          data: {
            type: 'acknowledged',
            reminderInstanceId,
            eventId,
          },
          android: { priority: 'high' },
        });
      } catch (error: any) {
        logger.debug(
          { deviceId: device.id, code: error?.errorInfo?.code },
          'Acknowledgement sync push failed'
        );
      }
    })
  );
};

/** Event-level change broadcast (rescheduled / cancelled). */
export const sendEventUpdate = async (
  devices: Device[],
  eventId: string,
  updateType: 'rescheduled' | 'cancelled',
  title: string,
  body: string
): Promise<void> => {
  if (!isPushAvailable() || devices.length === 0) return;

  await Promise.all(
    devices.map(async (device) => {
      try {
        await admin.messaging().send({
          token: device.fcmToken,
          data: { type: updateType, eventId, title, body },
          android: { priority: 'high' },
        });
      } catch (error: any) {
        logger.debug(
          { deviceId: device.id, code: error?.errorInfo?.code },
          'Event update push failed'
        );
      }
    })
  );
};
