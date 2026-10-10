import { Op } from 'sequelize';
import { DateTime } from 'luxon';
import { sequelize } from '../../config/database';
import {
  Event,
  EventAssignment,
  ReminderRule,
  ReminderInstance,
  Acknowledgement,
  User,
  Device,
} from '../../database/models';
import { AppError } from '../../middleware/error-handler';
import {
  materializeEventReminders,
  cancelPendingReminders,
  rebuildEventReminders,
} from '../../services/reminder-materializer.service';
import { sendEventUpdate } from '../../services/push.service';

const notFound = (): AppError => {
  const e: AppError = new Error('Event not found');
  e.statusCode = 404;
  return e;
};

const badRequest = (message: string): AppError => {
  const e: AppError = new Error(message);
  e.statusCode = 400;
  return e;
};

export interface CreateEventInput {
  title: string;
  description?: string | null;
  eventType?: 'meeting' | 'appointment' | 'reminder' | 'event';
  startAt: string;
  endAt?: string | null;
  timezone?: string;
  location?: string | null;
  meetingLink?: string | null;
  recurrenceFrequency?: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrenceInterval?: number;
  recurrenceDaysOfWeek?: number[] | null;
  recurrenceEndAt?: string | null;
  assigneeIds: string[];
  reminders?: { offsetMinutes: number; label?: string | null; isAlarm?: boolean; isEnabled?: boolean }[];
}

type ReminderConfig = {
  offsetMinutes: number;
  label?: string | null;
  isAlarm?: boolean;
  isEnabled?: boolean;
};

/** Default ladder used when an admin creates an event without specifying reminders. */
const DEFAULT_REMINDERS: ReminderConfig[] = [
  { offsetMinutes: 30, label: '30 minutes before', isAlarm: false },
  { offsetMinutes: 10, label: '10 minutes before', isAlarm: false },
  { offsetMinutes: 5, label: '5 minutes before', isAlarm: false },
  { offsetMinutes: 0, label: 'Starting now', isAlarm: true },
];

export class EventService {
  private static async assertUsersExist(ids: string[]): Promise<void> {
    if (ids.length === 0) throw badRequest('At least one assignee is required');
    const found = await User.count({ where: { id: { [Op.in]: ids }, isActive: true } });
    if (found !== new Set(ids).size) {
      throw badRequest('One or more assignees do not exist or are deactivated');
    }
  }

  public static async create(input: CreateEventInput, createdById: string, creatorTz: string) {
    const timezone = input.timezone || creatorTz;
    const start = DateTime.fromISO(input.startAt, { setZone: true });
    if (!start.isValid) throw badRequest('startAt must be a valid ISO 8601 date-time');

    const end = input.endAt ? DateTime.fromISO(input.endAt, { setZone: true }) : null;
    if (end && !end.isValid) throw badRequest('endAt must be a valid ISO 8601 date-time');
    if (end && end <= start) throw badRequest('endAt must be after startAt');

    if (!DateTime.local().setZone(timezone).isValid) {
      throw badRequest(`Unknown timezone: ${timezone}`);
    }

    const assigneeIds = [...new Set(input.assigneeIds)];
    await EventService.assertUsersExist(assigneeIds);

    const reminders = input.reminders?.length ? input.reminders : DEFAULT_REMINDERS;
    const offsets = reminders.map((r) => r.offsetMinutes);
    if (new Set(offsets).size !== offsets.length) {
      throw badRequest('Duplicate reminder offsets are not allowed on the same event');
    }

    return sequelize.transaction(async (transaction) => {
      const event = await Event.create(
        {
          title: input.title,
          description: input.description ?? null,
          eventType: input.eventType || 'meeting',
          startAt: start.toUTC().toJSDate(),
          endAt: end ? end.toUTC().toJSDate() : null,
          timezone,
          location: input.location ?? null,
          meetingLink: input.meetingLink ?? null,
          recurrenceFrequency: input.recurrenceFrequency || 'none',
          recurrenceInterval: input.recurrenceInterval || 1,
          recurrenceDaysOfWeek: input.recurrenceDaysOfWeek ?? null,
          recurrenceEndAt: input.recurrenceEndAt
            ? DateTime.fromISO(input.recurrenceEndAt, { setZone: true }).toUTC().toJSDate()
            : null,
          createdById,
        },
        { transaction }
      );

      await EventAssignment.bulkCreate(
        assigneeIds.map((userId) => ({ eventId: event.id, userId })) as any,
        { transaction, ignoreDuplicates: true }
      );

      await ReminderRule.bulkCreate(
        reminders.map((r) => ({
          eventId: event.id,
          offsetMinutes: r.offsetMinutes,
          label: r.label ?? null,
          isAlarm: r.isAlarm ?? r.offsetMinutes === 0,
          isEnabled: r.isEnabled ?? true,
        })) as any,
        { transaction, ignoreDuplicates: true }
      );

      await materializeEventReminders(event.id, { transaction });

      return EventService.getByIdInternal(event.id, transaction);
    });
  }

  private static async getByIdInternal(id: string, transaction?: any) {
    const event = await Event.findByPk(id, {
      include: [
        {
          model: EventAssignment,
          as: 'assignments',
          include: [{ model: User, as: 'user', attributes: ['id', 'fullName', 'email', 'timezone'] }],
        },
        { model: ReminderRule, as: 'reminderRules' },
        { model: User, as: 'createdBy', attributes: ['id', 'fullName', 'email'] },
      ],
      order: [[{ model: ReminderRule, as: 'reminderRules' }, 'offsetMinutes', 'DESC']],
      transaction,
    });
    if (!event) throw notFound();
    return event;
  }

  public static async getById(id: string, requester: { id: string; role: string }) {
    const event = await EventService.getByIdInternal(id);

    // Ownership gate: a non-admin may only read an event they are assigned to.
    if (requester.role !== 'admin') {
      const assignments = (event.get('assignments') as EventAssignment[]) || [];
      const isAssigned = assignments.some((a) => a.userId === requester.id && a.isActive);
      if (!isAssigned) throw notFound();
    }
    return event;
  }

  public static async list(
    requester: { id: string; role: string },
    query: {
      page?: number;
      limit?: number;
      status?: 'scheduled' | 'cancelled' | 'completed';
      from?: string;
      to?: string;
      search?: string;
      assigneeId?: string;
    }
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.search) where.title = { [Op.iLike]: `%${query.search}%` };
    if (query.from || query.to) {
      const range: Record<symbol, Date> = {};
      if (query.from) range[Op.gte] = new Date(query.from);
      if (query.to) range[Op.lte] = new Date(query.to);
      where.startAt = range;
    }

    // Non-admins are constrained to their own assignments at the SQL level.
    const assignmentWhere: Record<string, unknown> = { isActive: true };
    if (requester.role !== 'admin') {
      assignmentWhere.userId = requester.id;
    } else if (query.assigneeId) {
      assignmentWhere.userId = query.assigneeId;
    }

    const { rows, count } = await Event.findAndCountAll({
      where: where as any,
      include: [
        {
          model: EventAssignment,
          as: 'assignments',
          where: assignmentWhere as any,
          required: true,
          include: [
            { model: User, as: 'user', attributes: ['id', 'fullName', 'email'] },
          ],
        },
        { model: ReminderRule, as: 'reminderRules' },
      ],
      order: [['startAt', 'ASC']],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });

    return {
      items: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  }

  public static async update(id: string, input: Partial<CreateEventInput>) {
    const event = await Event.findByPk(id);
    if (!event) throw notFound();
    if (event.status === 'cancelled') {
      throw badRequest('A cancelled event cannot be edited. Create a new event instead.');
    }

    const patch: Record<string, unknown> = {};
    let timingChanged = false;

    for (const key of ['title', 'description', 'location', 'meetingLink', 'eventType'] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }

    if (input.timezone !== undefined) {
      if (!DateTime.local().setZone(input.timezone).isValid) {
        throw badRequest(`Unknown timezone: ${input.timezone}`);
      }
      patch.timezone = input.timezone;
      timingChanged = true;
    }

    if (input.startAt !== undefined) {
      const start = DateTime.fromISO(input.startAt, { setZone: true });
      if (!start.isValid) throw badRequest('startAt must be a valid ISO 8601 date-time');
      patch.startAt = start.toUTC().toJSDate();
      timingChanged = true;
    }

    if (input.endAt !== undefined) {
      patch.endAt = input.endAt
        ? DateTime.fromISO(input.endAt, { setZone: true }).toUTC().toJSDate()
        : null;
    }

    for (const key of [
      'recurrenceFrequency',
      'recurrenceInterval',
      'recurrenceDaysOfWeek',
    ] as const) {
      if (input[key] !== undefined) {
        patch[key] = input[key];
        timingChanged = true;
      }
    }
    if (input.recurrenceEndAt !== undefined) {
      patch.recurrenceEndAt = input.recurrenceEndAt
        ? DateTime.fromISO(input.recurrenceEndAt, { setZone: true }).toUTC().toJSDate()
        : null;
      timingChanged = true;
    }

    await event.update(patch);

    // Any change to timing invalidates every outstanding reminder.
    if (timingChanged) {
      await rebuildEventReminders(event.id);
      await EventService.notifyAssignees(event.id, 'rescheduled');
    }

    return EventService.getByIdInternal(event.id);
  }

  public static async cancel(id: string, reason: string | null) {
    const event = await Event.findByPk(id);
    if (!event) throw notFound();
    if (event.status === 'cancelled') return event;

    await sequelize.transaction(async (transaction) => {
      await event.update(
        { status: 'cancelled', cancelledAt: new Date(), cancellationReason: reason },
        { transaction }
      );
      await cancelPendingReminders(event.id, { transaction });
    });

    await EventService.notifyAssignees(event.id, 'cancelled');
    return EventService.getByIdInternal(event.id);
  }

  public static async assignUsers(id: string, userIds: string[]) {
    const event = await Event.findByPk(id);
    if (!event) throw notFound();
    if (event.status !== 'scheduled') {
      throw badRequest('Users cannot be assigned to a cancelled or completed event');
    }

    const unique = [...new Set(userIds)];
    await EventService.assertUsersExist(unique);

    await sequelize.transaction(async (transaction) => {
      // Re-activate any previously removed assignment rather than duplicating.
      await EventAssignment.bulkCreate(
        unique.map((userId) => ({ eventId: id, userId, isActive: true })) as any,
        { transaction, ignoreDuplicates: true }
      );
      await EventAssignment.update(
        { isActive: true },
        { where: { eventId: id, userId: { [Op.in]: unique } }, transaction }
      );
      await materializeEventReminders(id, { transaction });
    });

    return EventService.getByIdInternal(id);
  }

  public static async unassignUser(id: string, userId: string) {
    const assignment = await EventAssignment.findOne({ where: { eventId: id, userId } });
    if (!assignment) throw notFound();

    await sequelize.transaction(async (transaction) => {
      await assignment.update({ isActive: false }, { transaction });
      await cancelPendingReminders(id, { transaction, assignmentId: assignment.id });
    });

    return EventService.getByIdInternal(id);
  }

  /** Pushes a change notice to every assignee's active devices. */
  private static async notifyAssignees(
    eventId: string,
    kind: 'rescheduled' | 'cancelled'
  ): Promise<void> {
    const event = await Event.findByPk(eventId, {
      include: [{ model: EventAssignment, as: 'assignments', where: { isActive: true }, required: false }],
    });
    if (!event) return;

    const assignments = (event.get('assignments') as EventAssignment[]) || [];
    const userIds = assignments.map((a) => a.userId);
    if (userIds.length === 0) return;

    const devices = await Device.findAll({
      where: { userId: { [Op.in]: userIds }, isActive: true },
    });
    if (devices.length === 0) return;

    const body =
      kind === 'cancelled'
        ? `"${event.title}" has been cancelled.`
        : `"${event.title}" has been rescheduled.`;

    await sendEventUpdate(devices, event.id, kind, event.title, body);
  }

  /** Admin view of per-assignee delivery and acknowledgement state. */
  public static async getStatus(id: string) {
    const event = await EventService.getByIdInternal(id);

    const instances = await ReminderInstance.findAll({
      where: { eventId: id },
      include: [
        { model: User, as: 'user', attributes: ['id', 'fullName', 'email'] },
        { model: ReminderRule, as: 'rule', attributes: ['id', 'offsetMinutes', 'label', 'isAlarm'] },
        { model: Acknowledgement, as: 'acknowledgement', required: false },
      ],
      order: [['scheduledAt', 'ASC']],
    });

    return { event, reminders: instances };
  }
}
