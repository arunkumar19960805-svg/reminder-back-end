import { Op, Transaction } from 'sequelize';
import { sequelize } from '../config/database';
import { config } from '../config/config';
import { logger } from '../config/logger';
import {
  Event,
  EventAssignment,
  ReminderRule,
  ReminderInstance,
} from '../database/models';
import { expandOccurrences, reminderTimeFor } from './recurrence.service';

/**
 * Turns an event's (assignments x rules x occurrences) into concrete
 * reminder_instances rows.
 *
 * Safe to call repeatedly and concurrently: the unique index
 * (assignment_id, rule_id, occurrence_start) means a re-run inserts only
 * genuinely new rows. We rely on `ignoreDuplicates` so a concurrent caller
 * racing us does not blow up the whole batch.
 */
export const materializeEventReminders = async (
  eventId: string,
  options: { transaction?: Transaction; horizonDays?: number } = {}
): Promise<{ created: number; skipped: number }> => {
  const horizonDays = options.horizonDays ?? config.scheduler.recurrenceHorizonDays;

  const event = await Event.findByPk(eventId, {
    include: [
      { model: EventAssignment, as: 'assignments', where: { isActive: true }, required: false },
      { model: ReminderRule, as: 'reminderRules', where: { isEnabled: true }, required: false },
    ],
    transaction: options.transaction,
  });

  if (!event) return { created: 0, skipped: 0 };

  // A cancelled event must never produce new reminders.
  if (event.status !== 'scheduled') {
    return { created: 0, skipped: 0 };
  }

  const assignments = (event.get('assignments') as EventAssignment[]) || [];
  const rules = (event.get('reminderRules') as ReminderRule[]) || [];
  if (assignments.length === 0 || rules.length === 0) return { created: 0, skipped: 0 };

  const now = new Date();
  const windowEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  // Look slightly back so an occurrence that just started still gets its
  // "at event time" reminder if the materialiser ran a moment late.
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const occurrences = expandOccurrences(event, windowStart, windowEnd);
  if (occurrences.length === 0) return { created: 0, skipped: 0 };

  const rows: Record<string, unknown>[] = [];
  for (const occurrence of occurrences) {
    for (const rule of rules) {
      const scheduledAt = reminderTimeFor(occurrence, rule.offsetMinutes);
      // Don't create rows that are already hopelessly stale.
      if (scheduledAt.getTime() < now.getTime() - config.scheduler.staleAfterMs) continue;

      for (const assignment of assignments) {
        rows.push({
          eventId: event.id,
          assignmentId: assignment.id,
          ruleId: rule.id,
          userId: assignment.userId,
          occurrenceStart: occurrence,
          scheduledAt,
          isAlarm: rule.isAlarm,
          status: 'pending',
        });
      }
    }
  }

  if (rows.length === 0) return { created: 0, skipped: 0 };

  const before = await ReminderInstance.count({
    where: { eventId: event.id },
    transaction: options.transaction,
  });

  await ReminderInstance.bulkCreate(rows as any, {
    ignoreDuplicates: true,
    transaction: options.transaction,
  });

  const after = await ReminderInstance.count({
    where: { eventId: event.id },
    transaction: options.transaction,
  });

  const created = after - before;
  logger.debug(
    { eventId: event.id, candidates: rows.length, created },
    'Materialised reminder instances'
  );
  return { created, skipped: rows.length - created };
};

/**
 * Drops future, not-yet-sent reminders for an event. Used when an event is
 * cancelled or rescheduled so stale reminders never fire.
 *
 * Rows already `sent` or `acknowledged` are left intact: they are history.
 */
export const cancelPendingReminders = async (
  eventId: string,
  options: { transaction?: Transaction; assignmentId?: string } = {}
): Promise<number> => {
  const where: Record<string, unknown> = {
    eventId,
    status: { [Op.in]: ['pending', 'processing', 'failed'] },
  };
  if (options.assignmentId) where.assignmentId = options.assignmentId;

  const [count] = await ReminderInstance.update(
    { status: 'cancelled', lockedAt: null, lockedBy: null },
    { where: where as any, transaction: options.transaction }
  );
  return count;
};

/**
 * Rescheduling = cancel everything still outstanding, then rebuild from the
 * event's new time. Doing it in one transaction means a crash midway cannot
 * leave both old and new reminders live at once.
 */
export const rebuildEventReminders = async (eventId: string): Promise<{ created: number }> => {
  return sequelize.transaction(async (transaction) => {
    await cancelPendingReminders(eventId, { transaction });
    const { created } = await materializeEventReminders(eventId, { transaction });
    return { created };
  });
};

/**
 * Periodic top-up for recurring events: as time passes, occurrences that were
 * beyond the horizon come into range and need rows.
 */
export const materializeDueHorizon = async (): Promise<number> => {
  const events = await Event.findAll({
    where: {
      status: 'scheduled',
      recurrenceFrequency: { [Op.ne]: 'none' },
    },
    attributes: ['id'],
  });

  let total = 0;
  for (const e of events) {
    const { created } = await materializeEventReminders(e.id);
    total += created;
  }
  return total;
};
