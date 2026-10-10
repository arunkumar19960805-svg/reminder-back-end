import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

/**
 * One row per push send attempt per device. This is the delivery audit trail:
 * "accepted by FCM" is recorded as `accepted`, which is explicitly NOT the
 * same as the notification reaching or being seen on the handset.
 */
export class NotificationAttempt extends Model {
  declare id: string;
  declare reminderInstanceId: string;
  declare deviceId: string | null;
  declare attemptNumber: number;
  declare status: 'accepted' | 'rejected' | 'error';
  declare providerMessageId: string | null;
  declare errorCode: string | null;
  declare errorMessage: string | null;
  declare readonly createdAt: Date;
}

NotificationAttempt.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    reminderInstanceId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'reminder_instance_id',
    },
    deviceId: { type: DataTypes.UUID, allowNull: true, field: 'device_id' },
    attemptNumber: { type: DataTypes.INTEGER, allowNull: false, field: 'attempt_number' },
    status: {
      type: DataTypes.ENUM('accepted', 'rejected', 'error'),
      allowNull: false,
    },
    providerMessageId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'provider_message_id',
    },
    errorCode: { type: DataTypes.STRING(120), allowNull: true, field: 'error_code' },
    errorMessage: { type: DataTypes.STRING(1000), allowNull: true, field: 'error_message' },
  },
  {
    sequelize,
    tableName: 'notification_attempts',
    updatedAt: false,
    indexes: [{ fields: ['reminder_instance_id'] }, { fields: ['device_id'] }],
  }
);

export default NotificationAttempt;
