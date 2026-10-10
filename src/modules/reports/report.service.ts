import { Op, fn, col, literal } from 'sequelize';
import {
  ReminderInstance,
  Acknowledgement,
  Event,
  EventAssignment,
  User,
} from '../../database/models';

export class ReportService {
  /** Admin dashboard counters. */
  public static async dashboard() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      scheduledEvents,
      eventsToday,
      upcomingEvents,
      pendingReminders,
      overdueReminders,
      acknowledgedToday,
      failedReminders,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { isActive: true } }),
      Event.count({ where: { status: 'scheduled' } }),
      Event.count({
        where: { status: 'scheduled', startAt: { [Op.between]: [startOfDay, endOfDay] } },
      }),
      Event.count({
        where: { status: 'scheduled', startAt: { [Op.between]: [now, weekAhead] } },
      }),
      ReminderInstance.count({ where: { status: 'pending' } }),
      // Delivered but never acknowledged, and already past due.
      ReminderInstance.count({
        where: { status: { [Op.in]: ['sent', 'failed'] }, scheduledAt: { [Op.lt]: now } },
      }),
      Acknowledgement.count({ where: { acknowledgedAt: { [Op.between]: [startOfDay, endOfDay] } } }),
      ReminderInstance.count({ where: { status: 'failed' } }),
    ]);

    return {
      users: { total: totalUsers, active: activeUsers },
      events: { scheduled: scheduledEvents, today: eventsToday, upcomingWeek: upcomingEvents },
      reminders: {
        pending: pendingReminders,
        overdueUnacknowledged: overdueReminders,
        failed: failedReminders,
        acknowledgedToday,
      },
    };
  }

  /** Upcoming events across all users, for the admin dashboard list. */
  public static async upcomingEvents(limit = 10) {
    return Event.findAll({
      where: { status: 'scheduled', startAt: { [Op.gte]: new Date() } },
      include: [
        {
          model: EventAssignment,
          as: 'assignments',
          where: { isActive: true },
          required: false,
          include: [{ model: User, as: 'user', attributes: ['id', 'fullName', 'email'] }],
        },
      ],
      order: [['startAt', 'ASC']],
      limit,
    });
  }

  /** Delivery + acknowledgement breakdown, optionally narrowed. */
  public static async deliveryReport(query: {
    page?: number;
    limit?: number;
    eventId?: string;
    userId?: string;
    status?: string;
    from?: string;
    to?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    const where: Record<string, unknown> = {};
    if (query.eventId) where.eventId = query.eventId;
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      const range: Record<symbol, Date> = {};
      if (query.from) range[Op.gte] = new Date(query.from);
      if (query.to) range[Op.lte] = new Date(query.to);
      where.scheduledAt = range;
    }

    const { rows, count } = await ReminderInstance.findAndCountAll({
      where: where as any,
      include: [
        { model: Event, as: 'event', attributes: ['id', 'title', 'startAt', 'status'] },
        { model: User, as: 'user', attributes: ['id', 'fullName', 'email'] },
        { model: Acknowledgement, as: 'acknowledgement', required: false },
      ],
      order: [['scheduledAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });

    return {
      items: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  }

  /** Per-status counts grouped by event. */
  public static async eventAcknowledgementSummary(eventId: string) {
    const rows = await ReminderInstance.findAll({
      where: { eventId },
      attributes: ['status', [fn('COUNT', col('id')), 'count']],
      group: ['status'],
      raw: true,
    });

    const summary: Record<string, number> = {};
    for (const r of rows as unknown as { status: string; count: string }[]) {
      summary[r.status] = Number(r.count);
    }
    return summary;
  }

  /** Per-user acknowledgement rate, used for the admin report screen. */
  public static async userAcknowledgementSummary(query: { from?: string; to?: string }) {
    const where: Record<string, unknown> = {};
    if (query.from || query.to) {
      const range: Record<symbol, Date> = {};
      if (query.from) range[Op.gte] = new Date(query.from);
      if (query.to) range[Op.lte] = new Date(query.to);
      where.scheduledAt = range;
    }

    const rows = (await ReminderInstance.findAll({
      where: where as any,
      attributes: [
        'userId',
        [fn('COUNT', col('ReminderInstance.id')), 'total'],
        [
          fn(
            'SUM',
            literal(`CASE WHEN "ReminderInstance"."status" = 'acknowledged' THEN 1 ELSE 0 END`)
          ),
          'acknowledged',
        ],
        [
          fn('SUM', literal(`CASE WHEN "ReminderInstance"."status" = 'failed' THEN 1 ELSE 0 END`)),
          'failed',
        ],
      ],
      include: [{ model: User, as: 'user', attributes: ['id', 'fullName', 'email'] }],
      group: ['ReminderInstance.user_id', 'user.id'],
      raw: true,
      nest: true,
    })) as unknown as {
      userId: string;
      total: string;
      acknowledged: string;
      failed: string;
      user: { id: string; fullName: string; email: string };
    }[];

    return rows.map((r) => {
      const total = Number(r.total);
      const acknowledged = Number(r.acknowledged || 0);
      return {
        user: r.user,
        total,
        acknowledged,
        failed: Number(r.failed || 0),
        acknowledgementRate: total > 0 ? Math.round((acknowledged / total) * 100) : 0,
      };
    });
  }
}
