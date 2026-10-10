import { AuditLog } from '../../database/models';
import { logger } from '../../config/logger';

/** Keys that must never be persisted into the audit metadata blob. */
const REDACTED_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'temporarypassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'fcmtoken',
  'privatekey',
  'secret',
  'authorization',
]);

const sanitize = (input: unknown, depth = 0): unknown => {
  if (depth > 4 || input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
};

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export class AuditService {
  /**
   * Fire-and-forget: an audit write must never fail the business operation
   * that triggered it, but the failure itself is logged.
   */
  public static async record(entry: AuditEntry): Promise<void> {
    try {
      await AuditLog.create({
        actorId: entry.actorId ?? null,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        metadata: entry.metadata ? (sanitize(entry.metadata) as Record<string, unknown>) : null,
        ipAddress: entry.ipAddress ?? null,
      });
    } catch (error) {
      logger.error({ err: error, action: entry.action }, 'Failed to write audit log');
    }
  }
}
