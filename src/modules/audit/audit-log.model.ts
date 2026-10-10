import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../config/database';

export class AuditLog extends Model {
  declare id: string;
  declare actorId: string | null;
  declare action: string;
  declare resource: string;
  declare resourceId: string | null;
  declare metadata: Record<string, unknown> | null;
  declare ipAddress: string | null;
  declare readonly createdAt: Date;
}

AuditLog.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    actorId: { type: DataTypes.UUID, allowNull: true, field: 'actor_id' },
    action: { type: DataTypes.STRING(100), allowNull: false },
    resource: { type: DataTypes.STRING(100), allowNull: false },
    resourceId: { type: DataTypes.UUID, allowNull: true, field: 'resource_id' },
    // Callers must never put passwords or push tokens in here; see audit.service.
    metadata: { type: DataTypes.JSONB, allowNull: true },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true, field: 'ip_address' },
  },
  {
    sequelize,
    tableName: 'audit_logs',
    updatedAt: false,
    indexes: [{ fields: ['actor_id'] }, { fields: ['resource', 'resource_id'] }],
  }
);

export default AuditLog;
