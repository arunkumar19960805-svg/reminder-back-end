import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

export class Acknowledgement extends Model {
  declare id: string;
  declare reminderInstanceId: string;
  declare eventId: string;
  declare userId: string;
  declare acknowledgedAt: Date;
  declare deviceId: string | null;
  declare source: 'app' | 'notification_action';
  declare readonly createdAt: Date;
}

Acknowledgement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    reminderInstanceId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'reminder_instance_id',
    },
    eventId: { type: DataTypes.UUID, allowNull: false, field: 'event_id' },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    acknowledgedAt: { type: DataTypes.DATE, allowNull: false, field: 'acknowledged_at' },
    deviceId: { type: DataTypes.UUID, allowNull: true, field: 'device_id' },
    source: {
      type: DataTypes.ENUM('app', 'notification_action'),
      allowNull: false,
      defaultValue: 'app',
    },
  },
  {
    sequelize,
    tableName: 'acknowledgements',
    updatedAt: false,
    indexes: [
      // Acknowledging twice (e.g. from two devices racing) is a no-op rather
      // than a duplicate audit row.
      { unique: true, fields: ['reminder_instance_id'] },
      { fields: ['user_id'] },
      { fields: ['event_id'] },
    ],
  }
);

export default Acknowledgement;
