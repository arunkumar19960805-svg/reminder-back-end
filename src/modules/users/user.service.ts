import { Op } from 'sequelize';
import { User } from '../../database/models';
import { AppError } from '../../middleware/error-handler';
import { AuthService } from '../auth/auth.service';

const notFound = (): AppError => {
  const e: AppError = new Error('User not found');
  e.statusCode = 404;
  return e;
};

export interface ListUsersQuery {
  page?: number;
  limit?: number;
  search?: string;
  role?: 'admin' | 'user';
  isActive?: boolean;
}

export class UserService {
  public static async create(data: {
    email: string;
    password: string;
    fullName: string;
    phone?: string | null;
    role?: 'admin' | 'user';
    timezone?: string;
  }) {
    const email = data.email.toLowerCase().trim();
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      const e: AppError = new Error('Email is already registered');
      e.statusCode = 409;
      throw e;
    }

    const user = await User.create({
      email,
      password: data.password,
      fullName: data.fullName,
      phone: data.phone ?? null,
      role: data.role || 'user',
      timezone: data.timezone,
      // A user created by an admin is handed a password the admin knows,
      // so force a change on first login.
      mustChangePassword: true,
    });
    return user.toJSON();
  }

  public static async list(query: ListUsersQuery) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const where: Record<string, unknown> = {};

    if (query.role) where.role = query.role;
    if (typeof query.isActive === 'boolean') where.isActive = query.isActive;
    if (query.search) {
      where[Op.or as any] = [
        { fullName: { [Op.iLike]: `%${query.search}%` } },
        { email: { [Op.iLike]: `%${query.search}%` } },
      ];
    }

    const { rows, count } = await User.findAndCountAll({
      where: where as any,
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      items: rows.map((r) => r.toJSON()),
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  }

  public static async getById(id: string) {
    const user = await User.findByPk(id);
    if (!user) throw notFound();
    return user.toJSON();
  }

  public static async update(
    id: string,
    data: {
      fullName?: string;
      phone?: string | null;
      timezone?: string;
      role?: 'admin' | 'user';
      email?: string;
    }
  ) {
    const user = await User.findByPk(id);
    if (!user) throw notFound();

    if (data.email && data.email.toLowerCase().trim() !== user.email) {
      const email = data.email.toLowerCase().trim();
      const clash = await User.findOne({ where: { email, id: { [Op.ne]: id } } });
      if (clash) {
        const e: AppError = new Error('Email is already registered');
        e.statusCode = 409;
        throw e;
      }
      data.email = email;
    }

    await user.update(data);
    return user.toJSON();
  }

  public static async setActive(id: string, isActive: boolean, actingUserId: string) {
    const user = await User.findByPk(id);
    if (!user) throw notFound();

    // Guard against an admin locking themselves out.
    if (!isActive && user.id === actingUserId) {
      const e: AppError = new Error('You cannot deactivate your own account');
      e.statusCode = 400;
      throw e;
    }

    // Keep at least one active admin in the system.
    if (!isActive && user.role === 'admin') {
      const activeAdmins = await User.count({
        where: { role: 'admin', isActive: true, id: { [Op.ne]: id } },
      });
      if (activeAdmins === 0) {
        const e: AppError = new Error('Cannot deactivate the last active administrator');
        e.statusCode = 400;
        throw e;
      }
    }

    await user.update({ isActive });
    // Deactivating must also kill live sessions, not just block new logins.
    if (!isActive) await AuthService.logout(id);
    return user.toJSON();
  }

  public static async resetPassword(id: string) {
    const temporaryPassword = await AuthService.adminResetPassword(id);
    return { temporaryPassword };
  }
}
