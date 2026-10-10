import { Device } from '../../database/models';
import { AppError } from '../../middleware/error-handler';

export class DeviceService {
  /**
   * Registers or re-binds a push token to the authenticated user.
   *
   * A token is globally unique: if the same handset is later used by a
   * different account, the row is re-pointed at the new owner rather than
   * duplicated, which stops the previous user receiving the new user's
   * reminders.
   */
  public static async register(
    userId: string,
    data: { fcmToken: string; platform?: 'android' | 'ios' | 'web'; deviceName?: string | null }
  ) {
    const existing = await Device.findOne({ where: { fcmToken: data.fcmToken } });

    if (existing) {
      await existing.update({
        userId,
        platform: data.platform || existing.platform,
        deviceName: data.deviceName ?? existing.deviceName,
        isActive: true,
        lastSeenAt: new Date(),
      });
      return existing.toJSON();
    }

    const device = await Device.create({
      userId,
      fcmToken: data.fcmToken,
      platform: data.platform || 'android',
      deviceName: data.deviceName ?? null,
      isActive: true,
      lastSeenAt: new Date(),
    });
    return device.toJSON();
  }

  public static async listForUser(userId: string) {
    const devices = await Device.findAll({
      where: { userId },
      order: [['lastSeenAt', 'DESC']],
    });
    return devices.map((d) => d.toJSON());
  }

  /** Deactivates a device. Scoped to the owner so one user cannot kill another's. */
  public static async deactivate(id: string, userId: string) {
    const device = await Device.findOne({ where: { id, userId } });
    if (!device) {
      const e: AppError = new Error('Device not found');
      e.statusCode = 404;
      throw e;
    }
    await device.update({ isActive: false });
    return device.toJSON();
  }

  /** Called on logout when the client knows its own token. */
  public static async deactivateByToken(fcmToken: string, userId: string) {
    const [count] = await Device.update(
      { isActive: false },
      { where: { fcmToken, userId } }
    );
    return { deactivated: count };
  }
}
