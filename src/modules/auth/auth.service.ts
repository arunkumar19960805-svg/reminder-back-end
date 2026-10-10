import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { config } from '../../config/config';
import { User, RefreshToken } from '../../database/models';
import { AppError } from '../../middleware/error-handler';
import { UserRole } from '../../middleware/auth';

const unauthorized = (message: string): AppError => {
  const e: AppError = new Error(message);
  e.statusCode = 401;
  return e;
};

export class AuthService {
  public static generateTokens(user: { id: string; email: string; role: UserRole }) {
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiry as any }
    );
    // `jti` makes every refresh token unique. Without it, two tokens signed
    // in the same second for the same user are byte-identical, so rotation
    // would revoke a row and immediately re-insert the same string.
    const refreshToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, jti: crypto.randomUUID() },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiry as any }
    );
    return { accessToken, refreshToken };
  }

  private static async persistRefreshToken(userId: string, token: string): Promise<void> {
    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await RefreshToken.create({ userId, token, expiresAt });
  }

  public static async login(email: string, password: string) {
    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });

    // Same message and comparable work for both branches so the endpoint does
    // not reveal which emails exist.
    if (!user) {
      throw unauthorized('Invalid email or password');
    }
    const matches = await user.comparePassword(password);
    if (!matches) {
      throw unauthorized('Invalid email or password');
    }
    if (!user.isActive) {
      const e: AppError = new Error('Account is deactivated. Contact your administrator.');
      e.statusCode = 403;
      throw e;
    }

    const tokens = AuthService.generateTokens(user);
    await AuthService.persistRefreshToken(user.id, tokens.refreshToken);
    await user.update({ lastLoginAt: new Date() });

    return { user: user.toJSON(), ...tokens };
  }

  public static async refresh(token: string) {
    let decoded: any;
    try {
      decoded = jwt.verify(token, config.jwt.refreshSecret);
    } catch {
      throw unauthorized('Invalid or expired refresh token');
    }

    const stored = await RefreshToken.findOne({
      where: { token, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
    });
    if (!stored) throw unauthorized('Refresh token is not recognised');

    const user = await User.findByPk(decoded.id);
    if (!user || !user.isActive) throw unauthorized('Account is unavailable');

    // Rotate: the presented token is retired as the new pair is issued.
    await stored.update({ revokedAt: new Date() });
    const tokens = AuthService.generateTokens(user);
    await AuthService.persistRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  public static async logout(userId: string, token?: string): Promise<void> {
    const where: Record<string, unknown> = { userId, revokedAt: null };
    if (token) where.token = token;
    await RefreshToken.update({ revokedAt: new Date() }, { where: where as any });
  }

  public static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await User.findByPk(userId);
    if (!user) throw unauthorized('Account no longer exists');

    const matches = await user.comparePassword(currentPassword);
    if (!matches) {
      const e: AppError = new Error('Current password is incorrect');
      e.statusCode = 400;
      throw e;
    }

    await user.update({ password: newPassword, mustChangePassword: false });
    // Any session opened with the old password is invalidated.
    await AuthService.logout(userId);
  }

  /** Admin-initiated reset. Returns a one-time password for secure handover. */
  public static async adminResetPassword(targetUserId: string): Promise<string> {
    const user = await User.findByPk(targetUserId);
    if (!user) {
      const e: AppError = new Error('User not found');
      e.statusCode = 404;
      throw e;
    }
    // 12 URL-safe chars from a CSPRNG.
    const temporary = crypto.randomBytes(9).toString('base64url');
    await user.update({ password: temporary, mustChangePassword: true });
    await AuthService.logout(targetUserId);
    return temporary;
  }

  public static async getProfile(userId: string) {
    const user = await User.findByPk(userId);
    if (!user) {
      const e: AppError = new Error('User not found');
      e.statusCode = 404;
      throw e;
    }
    return user.toJSON();
  }

  public static async updateProfile(
    userId: string,
    data: { fullName?: string; phone?: string | null; timezone?: string }
  ) {
    const user = await User.findByPk(userId);
    if (!user) {
      const e: AppError = new Error('User not found');
      e.statusCode = 404;
      throw e;
    }
    await user.update(data);
    return user.toJSON();
  }
}
