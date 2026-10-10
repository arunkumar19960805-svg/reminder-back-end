import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

export class EventAssignment extends Model {
  declare id: string;
  declare eventId: string;
  declare userId: string;
  declare isActive: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

EventAssignment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    eventId: { type: DataTypes.UUID, allowNull: false, field: 'event_id' },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active',
    },
  },
  {
    sequelize,
    tableName: 'event_assignments',
    indexes: [
      // One assignment row per (event, user): re-assigning is idempotent.
      { unique: true, fields: ['event_id', 'user_id'] },
      { fields: ['user_id'] },
    ],
  }
);

export default EventAssignment;
