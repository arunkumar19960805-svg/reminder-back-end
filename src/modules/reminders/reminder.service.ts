import { Op } from 'sequelize';
import { sequelize } from '../../config/database';
import {
  ReminderInstance,
  ReminderRule,
  Acknowledgement,
  Event,
  Device,
  NotificationAttempt,
} from '../../database/models';
import { AppError } from '../../middleware/error-handler';
import { sendAcknowledgementSync } from '../../services/push.service';
import { materializeEventReminders } from '../../services/reminder-materializer.service';

const notFound = (): AppError => {
  const e: AppError = new Error('Reminder not found');
  e.statusCode = 404;
  return e;
};

const EVENT_ATTRS = [
  'id',
  'title',
  'description',
  'startAt',
  'endAt',
  'timezone',
  'location',
  'meetingLink',
  'eventType',
  'status',
];

export class ReminderService {
  /**
   * Reminders for the authenticated user only. `userId` is taken from the
   * token, never from the request, so one user can never read another's.
   */
  public static async listForUser(
    userId: string,
    query: {
      page?: number;
      limit?: number;
      scope?: 'today' | 'upcoming' | 'overdue' | 'acknowledged' | 'all';
      status?: string;
    }
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const now = new Date();

    const where: Record<string, unknown> = { userId };
    let order: any = [['scheduledAt', 'ASC']];

    switch (query.scope) {
      case 'today': {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);
        where.scheduledAt = { [Op.between]: [startOfDay, endOfDay] };
        where.status = { [Op.in]: ['pending', 'sent', 'acknowledged', 'failed'] };
        break;
      }
      case 'upcoming':
        where.scheduledAt = { [Op.gt]: now };
        where.status = { [Op.in]: ['pending', 'sent'] };
        break;
      case 'overdue':
        // Delivered (or attempted) but still not acknowledged.
        where.scheduledAt = { [Op.lte]: now };
        where.status = { [Op.in]: ['sent', 'failed'] };
        order = [['scheduledAt', 'DESC']];
        break;
      case 'acknowledged':
        where.status = 'acknowledged';
        order = [['updatedAt', 'DESC']];
        break;
      default:
        if (query.status) where.status = query.status;
    }

    const { rows, count } = await ReminderInstance.findAndCountAll({
      where: where as any,
      include: [
        { model: Event, as: 'event', attributes: EVENT_ATTRS },
        { model: ReminderRule, as: 'rule', attributes: ['id', 'offsetMinutes', 'label', 'isAlarm'] },
        { model: Acknowledgement, as: 'acknowledgement', required: false },
      ],
      order,
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });

    return {
      items: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  }

  public static async getForUser(id: string, userId: string) {
    const reminder = await ReminderInstance.findOne({
      where: { id, userId },
      include: [
        { model: Event, as: 'event', attributes: EVENT_ATTRS },
        { model: ReminderRule, as: 'rule', attributes: ['id', 'offsetMinutes', 'label', 'isAlarm'] },
        { model: Acknowledgement, as: 'acknowledgement', required: false },
        {
          model: NotificationAttempt,
          as: 'attempts',
          required: false,
          attributes: ['id', 'attemptNumber', 'status', 'errorCode', 'createdAt'],
        },
      ],
    });
    // 404 rather than 403 so the endpoint does not confirm the id exists.
    if (!reminder) throw notFound();
    return reminder;
  }

  /**
   * Acknowledges a reminder.
   *
   * Idempotent and race-safe: the unique index on acknowledgements.
   * reminder_instance_id means two devices acknowledging simultaneously
   * produce one row, and the second call returns the existing acknowledgement
   * rather than erroring.
   */
  public static async acknowledge(
    id: string,
    userId: string,
    options: { deviceId?: string | null; source?: 'app' | 'notification_action' } = {}
  ) {
    const reminder = await ReminderInstance.findOne({ where: { id, userId } });
    if (!reminder) throw notFound();

    if (reminder.status === 'cancelled') {
      const e: AppError = new Error('This reminder was cancelled and cannot be acknowledged');
      e.statusCode = 409;
      throw e;
    }

    const existing = await Acknowledgement.findOne({ where: { reminderInstanceId: id } });
    if (existing) {
      return { reminder, acknowledgement: existing, alreadyAcknowledged: true };
    }

    const acknowledgedAt = new Date();
    let acknowledgement: Acknowledgement;

    try {
      acknowledgement = await sequelize.transaction(async (transaction) => {
        const created = await Acknowledgement.create(
          {
            reminderInstanceId: id,
            eventId: reminder.eventId,
            userId,
            acknowledgedAt,
            deviceId: options.deviceId ?? null,
            source: options.source || 'app',
          },
          { transaction }
        );

        await reminder.update({ status: 'acknowledged' }, { transaction });

        // Acknowledging one reminder silences every LATER reminder for the
        // same user and occurrence — the point of acknowledging is "I know
        // about this", so the 10-minute and at-time alarms should not still
        // fire after the user confirmed at 30 minutes.
        await ReminderInstance.update(
          { status: 'acknowledged' },
          {
            where: {
              userId,
              eventId: reminder.eventId,
              occurrenceStart: reminder.occurrenceStart,
              status: { [Op.in]: ['pending', 'processing', 'sent', 'failed'] },
            },
            transaction,
          }
        );

        return created;
      });
    } catch (error: any) {
      // Lost the race: another device inserted first. Treat as success.
      if (error?.name === 'SequelizeUniqueConstraintError') {
        const winner = await Acknowledgement.findOne({ where: { reminderInstanceId: id } });
        if (winner) return { reminder, acknowledgement: winner, alreadyAcknowledged: true };
      }
      throw error;
    }

    // Tell the user's other devices to stop ringing.
    const otherDevices = await Device.findAll({
      where: {
        userId,
        isActive: true,
        ...(options.deviceId ? { id: { [Op.ne]: options.deviceId } } : {}),
      },
    });
    await sendAcknowledgementSync(otherDevices, id, reminder.eventId);

    await reminder.reload();
    return { reminder, acknowledgement, alreadyAcknowledged: false };
  }

  public static async acknowledgementHistory(
    userId: string,
    query: { page?: number; limit?: number }
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    const { rows, count } = await Acknowledgement.findAndCountAll({
      where: { userId },
      include: [{ model: Event, as: 'event', attributes: EVENT_ATTRS }],
      order: [['acknowledgedAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      items: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  }

  /** Admin: replace the reminder ladder on an event, then rebuild instances. */
  public static async configureRules(
    eventId: string,
    rules: { offsetMinutes: number; label?: string | null; isAlarm?: boolean; isEnabled?: boolean }[]
  ) {
    const event = await Event.findByPk(eventId);
    if (!event) {
      const e: AppError = new Error('Event not found');
      e.statusCode = 404;
      throw e;
    }
    if (event.status !== 'scheduled') {
      const e: AppError = new Error('Reminders cannot be configured on a cancelled event');
      e.statusCode = 400;
      throw e;
    }

    const offsets = rules.map((r) => r.offsetMinutes);
    if (new Set(offsets).size !== offsets.length) {
      const e: AppError = new Error('Duplicate reminder offsets are not allowed');
      e.statusCode = 400;
      throw e;
    }

    await sequelize.transaction(async (transaction) => {
      const existing = await ReminderRule.findAll({ where: { eventId }, transaction });
      const keepOffsets = new Set(offsets);

      // Remove rules the admin dropped, along with their pending instances.
      const toRemove = existing.filter((r) => !keepOffsets.has(r.offsetMinutes));
      if (toRemove.length > 0) {
        const ids = toRemove.map((r) => r.id);
        await ReminderInstance.update(
          { status: 'cancelled' },
          {
            where: { ruleId: { [Op.in]: ids }, status: { [Op.in]: ['pending', 'processing', 'failed'] } },
            transaction,
          }
        );
        await ReminderRule.destroy({ where: { id: { [Op.in]: ids } }, transaction });
      }

      for (const rule of rules) {
        const match = existing.find((r) => r.offsetMinutes === rule.offsetMinutes);
        if (match) {
          await match.update(
            {
              label: rule.label ?? match.label,
              isAlarm: rule.isAlarm ?? match.isAlarm,
              isEnabled: rule.isEnabled ?? match.isEnabled,
            },
            { transaction }
          );
          // Disabling a rule must stop its outstanding reminders.
          if (rule.isEnabled === false) {
            await ReminderInstance.update(
              { status: 'cancelled' },
              {
                where: {
                  ruleId: match.id,
                  status: { [Op.in]: ['pending', 'processing', 'failed'] },
                },
                transaction,
              }
            );
          }
        } else {
          await ReminderRule.create(
            {
              eventId,
              offsetMinutes: rule.offsetMinutes,
              label: rule.label ?? null,
              isAlarm: rule.isAlarm ?? rule.offsetMinutes === 0,
              isEnabled: rule.isEnabled ?? true,
            },
            { transaction }
          );
        }
      }

      await materializeEventReminders(eventId, { transaction });
    });

    return ReminderRule.findAll({
      where: { eventId },
      order: [['offsetMinutes', 'DESC']],
    });
  }
}
