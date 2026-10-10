import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';
import bcrypt from 'bcryptjs';
import { config } from '../../config/config';

export class User extends Model {
  declare id: string;
  declare email: string;
  declare password: string;
  declare fullName: string;
  declare phone: string | null;
  declare role: 'admin' | 'user';
  declare timezone: string;
  declare isActive: boolean;
  declare mustChangePassword: boolean;
  declare lastLoginAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  public async comparePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }

  /** Never leak password hashes through API responses. */
  public toJSON(): Record<string, unknown> {
    const values = { ...this.get() } as Record<string, unknown>;
    delete values.password;
    return values;
  }
}

User.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: { msg: 'Must be a valid email address' } },
    },
    password: { type: DataTypes.STRING(255), allowNull: false },
    fullName: { type: DataTypes.STRING(150), allowNull: false, field: 'full_name' },
    phone: { type: DataTypes.STRING(20), allowNull: true },
    role: {
      type: DataTypes.ENUM('admin', 'user'),
      allowNull: false,
      defaultValue: 'user',
    },
    timezone: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: config.defaultTimezone,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active',
    },
    mustChangePassword: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'must_change_password',
    },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true, field: 'last_login_at' },
  },
  {
    sequelize,
    tableName: 'users',
    hooks: {
      beforeCreate: async (user: User) => {
        const SALT_ROUNDS = 10;
        user.password = await bcrypt.hash(user.password, SALT_ROUNDS);
      },
      beforeUpdate: async (user: User) => {
        if (user.changed('password')) {
          const SALT_ROUNDS = 10;
          user.password = await bcrypt.hash(user.password, SALT_ROUNDS);
        }
      },
    },
  }
);

export default User;
