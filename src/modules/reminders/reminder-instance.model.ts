import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

export type ReminderStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'acknowledged'
  | 'cancelled'
  | 'expired';

/**
 * One materialised, independently scheduled reminder for one user and one
 * occurrence of an event. This table is the single source of truth for the
 * scheduler — not an in-memory timer and not a queue.
 */
export class ReminderInstance extends Model {
  declare id: string;
  declare eventId: string;
  declare assignmentId: string;
  declare ruleId: string;
  declare userId: string;
  declare occurrenceStart: Date;
  declare scheduledAt: Date;
  declare status: ReminderStatus;
  declare isAlarm: boolean;
  declare attemptCount: number;
  declare nextAttemptAt: Date | null;
  declare lockedAt: Date | null;
  declare lockedBy: string | null;
  declare sentAt: Date | null;
  declare lastError: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

ReminderInstance.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    eventId: { type: DataTypes.UUID, allowNull: false, field: 'event_id' },
    assignmentId: { type: DataTypes.UUID, allowNull: false, field: 'assignment_id' },
    ruleId: { type: DataTypes.UUID, allowNull: false, field: 'rule_id' },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    // Which occurrence of a recurring event this belongs to (UTC instant of
    // that occurrence's start). For non-recurring events it equals event.startAt.
    occurrenceStart: { type: DataTypes.DATE, allowNull: false, field: 'occurrence_start' },
    // Absolute UTC instant this reminder becomes due.
    scheduledAt: { type: DataTypes.DATE, allowNull: false, field: 'scheduled_at' },
    status: {
      type: DataTypes.ENUM(
        'pending',
        'processing',
        'sent',
        'failed',
        'acknowledged',
        'cancelled',
        'expired'
      ),
      allowNull: false,
      defaultValue: 'pending',
    },
    isAlarm: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_alarm',
    },
    attemptCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'attempt_count',
    },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true, field: 'next_attempt_at' },
    // Lease fields: a row claimed by a crashed worker is reclaimable once
    // lockedAt falls outside the lease window.
    lockedAt: { type: DataTypes.DATE, allowNull: true, field: 'locked_at' },
    lockedBy: { type: DataTypes.STRING(100), allowNull: true, field: 'locked_by' },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    lastError: { type: DataTypes.STRING(1000), allowNull: true, field: 'last_error' },
  },
  {
    sequelize,
    tableName: 'reminder_instances',
    indexes: [
      // THE duplicate-delivery guarantee. Re-running materialisation for the
      // same event, however many times and from however many instances, can
      // never create a second row for the same (assignment, rule, occurrence).
      {
        unique: true,
        name: 'reminder_instances_dedupe',
        fields: ['assignment_id', 'rule_id', 'occurrence_start'],
      },
      // Drives the poller's "what is due now" scan.
      { name: 'reminder_instances_due', fields: ['status', 'scheduled_at'] },
      { fields: ['user_id', 'status'] },
      { fields: ['event_id'] },
    ],
  }
);

export default ReminderInstance;
