import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

export class RefreshToken extends Model {
  declare id: number;
  declare userId: string;
  declare token: string;
  declare expiresAt: Date;
  declare revokedAt: Date | null;
  declare readonly createdAt: Date;
}

RefreshToken.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    token: { type: DataTypes.STRING(500), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
    revokedAt: { type: DataTypes.DATE, allowNull: true, field: 'revoked_at' },
  },
  { sequelize, tableName: 'refresh_tokens', updatedAt: false }
);

export default RefreshToken;
