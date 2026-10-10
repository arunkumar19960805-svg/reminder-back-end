import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

/**
 * A reminder rule belongs to an EVENT, not to a user. One rule ("10 minutes
 * before") fans out into one ReminderInstance per assigned user.
 */
export class ReminderRule extends Model {
  declare id: string;
  declare eventId: string;
  declare offsetMinutes: number;
  declare label: string | null;
  declare isAlarm: boolean;
  declare isEnabled: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

ReminderRule.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    eventId: { type: DataTypes.UUID, allowNull: false, field: 'event_id' },
    // Minutes BEFORE the event start. 0 = exactly at start time.
    // Negative values are allowed and mean "after the event started".
    offsetMinutes: { type: DataTypes.INTEGER, allowNull: false, field: 'offset_minutes' },
    label: { type: DataTypes.STRING(100), allowNull: true },
    // Alarm-style reminders route to the high-importance Android channel and
    // drive the full-screen in-app alarm; normal ones are ordinary notifications.
    isAlarm: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_alarm',
    },
    isEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_enabled',
    },
  },
  {
    sequelize,
    tableName: 'event_reminder_rules',
    indexes: [
      // Prevents an admin creating "30 minutes before" twice on one event.
      { unique: true, fields: ['event_id', 'offset_minutes'] },
    ],
  }
);

export default ReminderRule;
