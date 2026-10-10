import os from 'os';
import crypto from 'crypto';
import { QueryTypes, Op } from 'sequelize';
import { sequelize } from '../config/database';
import { config } from '../config/config';
import { logger } from '../config/logger';
import {
  ReminderInstance,
  ReminderRule,
  Event,
  Device,
  NotificationAttempt,
} from '../database/models';
import { sendReminderToUserDevices } from '../services/push.service';
import { materializeDueHorizon } from '../services/reminder-materializer.service';

/** Identifies this process in `locked_by`, so claims are traceable. */
const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

/**
 * Atomically claims due reminders.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes running several backend instances
 * safe: each transaction locks the rows it takes and every other instance
 * skips straight past them instead of blocking or double-sending. The UPDATE
 * flips them to `processing` in the same transaction, so a crash right after
 * this still leaves them recoverable via the lease timeout below.
 */
const claimDueReminders = async (limit: number): Promise<string[]> => {
  const leaseCutoff = new Date(Date.now() - config.scheduler.leaseMs);

  const rows = await sequelize.query<{ id: string }>(
    `
    WITH due AS (
      SELECT id
      FROM reminder_instances
      WHERE (
              (status = 'pending' AND scheduled_at <= NOW())
           OR (status = 'failed'  AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW())
              -- Reclaim rows abandoned by a worker that died mid-send.
           OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at < :leaseCutoff)
            )
        AND attempt_count < :maxAttempts
      ORDER BY scheduled_at ASC
      LIMIT :limit
      FOR UPDATE SKIP LOCKED
    )
    UPDATE reminder_instances r
       SET status = 'processing',
           locked_at = NOW(),
           locked_by = :workerId,
           updated_at = NOW()
      FROM due
     WHERE r.id = due.id
    RETURNING r.id;
    `,
    {
      replacements: {
        leaseCutoff,
        maxAttempts: config.scheduler.maxAttempts,
        limit,
        workerId: WORKER_ID,
      },
      type: QueryTypes.SELECT,
    }
  );

  return rows.map((r) => r.id);
};

const backoffMs = (attempt: number): number =>
  Math.min(5 * 60_000, 5_000 * Math.pow(2, Math.max(0, attempt - 1)));

const formatBody = (event: Event, offsetLabel: string): string => {
  const parts = [offsetLabel];
  if (event.location) parts.push(`at ${event.location}`);
  return parts.join(' · ');
};

/** Processes a single claimed reminder end to end. */
const processReminder = async (id: string): Promise<void> => {
  const reminder = await ReminderInstance.findByPk(id, {
    include: [
      { model: Event, as: 'event' },
      { model: ReminderRule, as: 'rule' },
    ],
  });
  if (!reminder) return;

  const event = reminder.get('event') as Event | undefined;
  const rule = reminder.get('rule') as ReminderRule | undefined;

  // Event cancelled (or deleted) between scheduling and now: drop silently.
  if (!event || event.status !== 'scheduled') {
    await reminder.update({ status: 'cancelled', lockedAt: null, lockedBy: null });
    return;
  }

  // Already acknowledged (e.g. user pre-acknowledged from another reminder).
  if (reminder.status === 'acknowledged') {
    await reminder.update({ lockedAt: null, lockedBy: null });
    return;
  }

  // Too late to be useful — record as expired rather than sending a confusing
  // notification for something that happened hours ago.
  const lateBy = Date.now() - reminder.scheduledAt.getTime();
  if (lateBy > config.scheduler.staleAfterMs) {
    await reminder.update({
      status: 'expired',
      lockedAt: null,
      lockedBy: null,
      lastError: `Skipped: ${Math.round(lateBy / 60000)} minutes late`,
    });
    return;
  }

  const devices = await Device.findAll({
    where: { userId: reminder.userId, isActive: true },
  });

  const attemptNumber = reminder.attemptCount + 1;

  if (devices.length === 0) {
    await reminder.update({
      status: 'failed',
      attemptCount: attemptNumber,
      nextAttemptAt: new Date(Date.now() + backoffMs(attemptNumber)),
      lockedAt: null,
      lockedBy: null,
      lastError: 'No active devices registered for user',
    });
    return;
  }

  const offsetLabel =
    rule?.label ||
    (rule && rule.offsetMinutes > 0
      ? `In ${rule.offsetMinutes} minutes`
      : 'Starting now');

  const results = await sendReminderToUserDevices(devices, {
    reminderInstanceId: reminder.id,
    eventId: event.id,
    title: event.title,
    body: formatBody(event, offsetLabel),
    isAlarm: reminder.isAlarm,
    occurrenceStart: reminder.occurrenceStart.toISOString(),
    meetingLink: event.meetingLink,
    location: event.location,
  });

  await NotificationAttempt.bulkCreate(
    results.map((r) => ({
      reminderInstanceId: reminder.id,
      deviceId: r.deviceId,
      attemptNumber,
      status: r.status,
      providerMessageId: r.providerMessageId || null,
      errorCode: r.errorCode || null,
      errorMessage: r.errorMessage || null,
    })) as any
  );

  // Permanently dead tokens are retired so we stop wasting attempts on them.
  const deadDeviceIds = results.filter((r) => r.tokenInvalid).map((r) => r.deviceId);
  if (deadDeviceIds.length > 0) {
    await Device.update(
      { isActive: false },
      { where: { id: { [Op.in]: deadDeviceIds } } }
    );
    logger.info({ count: deadDeviceIds.length }, 'Deactivated invalid push tokens');
  }

  const anyAccepted = results.some((r) => r.status === 'accepted');

  if (anyAccepted) {
    // `sent` means FCM ACCEPTED it for delivery — not that it was displayed
    // or seen. Only an acknowledgement proves the user saw it.
    await reminder.update({
      status: 'sent',
      sentAt: new Date(),
      attemptCount: attemptNumber,
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    });
    return;
  }

  const exhausted = attemptNumber >= config.scheduler.maxAttempts;
  await reminder.update({
    status: 'failed',
    attemptCount: attemptNumber,
    nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs(attemptNumber)),
    lockedAt: null,
    lockedBy: null,
    lastError: results[0]?.errorMessage || results[0]?.errorCode || 'Delivery failed',
  });
};

/** One scheduler tick. Exported so tests can drive it deterministically. */
export const runSchedulerTick = async (): Promise<{ claimed: number }> => {
  const ids = await claimDueReminders(config.scheduler.batchSize);
  for (const id of ids) {
    try {
      await processReminder(id);
    } catch (error) {
      logger.error({ err: error, reminderId: id }, 'Reminder processing threw');
      try {
        const r = await ReminderInstance.findByPk(id);
        if (r) {
          const attempt = r.attemptCount + 1;
          await r.update({
            status: 'failed',
            attemptCount: attempt,
            nextAttemptAt:
              attempt >= config.scheduler.maxAttempts
                ? null
                : new Date(Date.now() + backoffMs(attempt)),
            lockedAt: null,
            lockedBy: null,
            lastError: String((error as Error).message).slice(0, 900),
          });
        }
      } catch {
        /* best effort */
      }
    }
  }
  return { claimed: ids.length };
};

let timer: NodeJS.Timeout | null = null;
let horizonTimer: NodeJS.Timeout | null = null;
let running = false;

export const startReminderWorker = (): void => {
  if (!config.scheduler.enabled) {
    logger.warn('Reminder scheduler is disabled (SCHEDULER_ENABLED=false).');
    return;
  }

  const tick = async () => {
    // Overlap guard: a slow tick must not stack on the next interval.
    if (running) return;
    running = true;
    try {
      const { claimed } = await runSchedulerTick();
      if (claimed > 0) logger.info({ claimed }, 'Processed due reminders');
    } catch (error) {
      logger.error({ err: error }, 'Scheduler tick failed');
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, config.scheduler.pollIntervalMs);
  // Run once immediately so a restart catches anything missed while down.
  void tick();

  // Extend recurring series into the horizon once an hour.
  horizonTimer = setInterval(
    () => {
      materializeDueHorizon()
        .then((n) => n > 0 && logger.info({ created: n }, 'Extended recurring reminders'))
        .catch((e) => logger.error({ err: e }, 'Horizon materialisation failed'));
    },
    60 * 60 * 1000
  );

  logger.info(
    { workerId: WORKER_ID, intervalMs: config.scheduler.pollIntervalMs },
    'Reminder scheduler worker started.'
  );
};

export const stopReminderWorker = (): void => {
  if (timer) clearInterval(timer);
  if (horizonTimer) clearInterval(horizonTimer);
  timer = null;
  horizonTimer = null;
};
