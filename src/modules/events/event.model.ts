import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

export type EventType = 'meeting' | 'appointment' | 'reminder' | 'event';
export type EventStatus = 'scheduled' | 'cancelled' | 'completed';
export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly';

export class Event extends Model {
  declare id: string;
  declare title: string;
  declare description: string | null;
  declare eventType: EventType;
  declare startAt: Date;
  declare endAt: Date | null;
  declare timezone: string;
  declare location: string | null;
  declare meetingLink: string | null;
  declare status: EventStatus;
  declare recurrenceFrequency: RecurrenceFrequency;
  declare recurrenceInterval: number;
  declare recurrenceDaysOfWeek: number[] | null;
  declare recurrenceEndAt: Date | null;
  declare createdById: string;
  declare cancelledAt: Date | null;
  declare cancellationReason: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Event.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    eventType: {
      type: DataTypes.ENUM('meeting', 'appointment', 'reminder', 'event'),
      allowNull: false,
      defaultValue: 'meeting',
      field: 'event_type',
    },
    // Always persisted in UTC. `timezone` records the wall-clock zone the
    // admin authored it in, which is what recurrence must step through so
    // that a 09:00 daily meeting stays 09:00 across a DST boundary.
    startAt: { type: DataTypes.DATE, allowNull: false, field: 'start_at' },
    endAt: { type: DataTypes.DATE, allowNull: true, field: 'end_at' },
    timezone: { type: DataTypes.STRING(64), allowNull: false },
    location: { type: DataTypes.STRING(255), allowNull: true },
    meetingLink: { type: DataTypes.STRING(500), allowNull: true, field: 'meeting_link' },
    status: {
      type: DataTypes.ENUM('scheduled', 'cancelled', 'completed'),
      allowNull: false,
      defaultValue: 'scheduled',
    },
    recurrenceFrequency: {
      type: DataTypes.ENUM('none', 'daily', 'weekly', 'monthly'),
      allowNull: false,
      defaultValue: 'none',
      field: 'recurrence_frequency',
    },
    recurrenceInterval: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      field: 'recurrence_interval',
    },
    // Only meaningful for weekly recurrence. 1=Monday .. 7=Sunday (ISO).
    recurrenceDaysOfWeek: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'recurrence_days_of_week',
    },
    recurrenceEndAt: { type: DataTypes.DATE, allowNull: true, field: 'recurrence_end_at' },
    createdById: { type: DataTypes.UUID, allowNull: false, field: 'created_by_id' },
    cancelledAt: { type: DataTypes.DATE, allowNull: true, field: 'cancelled_at' },
    cancellationReason: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'cancellation_reason',
    },
  },
  {
    sequelize,
    tableName: 'events',
    indexes: [{ fields: ['start_at'] }, { fields: ['status'] }, { fields: ['created_by_id'] }],
  }
);

export default Event;
