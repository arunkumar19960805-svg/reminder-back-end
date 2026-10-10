import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

export class Device extends Model {
  declare id: string;
  declare userId: string;
  declare fcmToken: string;
  declare platform: 'android' | 'ios' | 'web';
  declare deviceName: string | null;
  declare isActive: boolean;
  declare lastSeenAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  /** Push tokens are credentials; never return them from the API. */
  public toJSON(): Record<string, unknown> {
    const values = { ...this.get() } as Record<string, unknown>;
    const token = values.fcmToken as string | undefined;
    delete values.fcmToken;
    // A short suffix is enough for a user to recognise a device in a list.
    values.fcmTokenPreview = token ? `...${token.slice(-6)}` : null;
    return values;
  }
}

Device.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    fcmToken: {
      type: DataTypes.STRING(512),
      allowNull: false,
      unique: true,
      field: 'fcm_token',
    },
    platform: {
      type: DataTypes.ENUM('android', 'ios', 'web'),
      allowNull: false,
      defaultValue: 'android',
    },
    deviceName: { type: DataTypes.STRING(150), allowNull: true, field: 'device_name' },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active',
    },
    lastSeenAt: { type: DataTypes.DATE, allowNull: true, field: 'last_seen_at' },
  },
  {
    sequelize,
    tableName: 'devices',
    indexes: [{ fields: ['user_id', 'is_active'] }],
  }
);

export default Device;
