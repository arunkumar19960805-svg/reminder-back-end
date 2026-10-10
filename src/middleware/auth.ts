import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config';
import { AppError } from './error-handler';
import { User } from '../database/models';

export type UserRole = 'admin' | 'user';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; role: UserRole; timezone: string };
}

const extractToken = (req: Request): string | null => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  if ((req as any).cookies?.access_token) {
    return (req as any).cookies.access_token;
  }
  return null;
};

/**
 * Verifies the JWT and then re-checks the account against the database.
 *
 * The DB round-trip is deliberate: a token issued before an account was
 * deactivated stays cryptographically valid until it expires, so without this
 * check a deactivated user would keep access for up to JWT_EXPIRY.
 */
export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = extractToken(req);
  if (!token) {
    const error: AppError = new Error('Access token is missing or malformed');
    error.statusCode = 401;
    return next(error);
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch {
    const error: AppError = new Error('Invalid or expired token');
    error.statusCode = 401;
    return next(error);
  }

  try {
    const user = await User.findByPk(decoded.id);
    if (!user) {
      const error: AppError = new Error('Account no longer exists');
      error.statusCode = 401;
      return next(error);
    }
    if (!user.isActive) {
      const error: AppError = new Error('Account is deactivated');
      error.statusCode = 403;
      return next(error);
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      timezone: user.timezone,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole =
  (roles: UserRole[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      const error: AppError = new Error(
        'Forbidden: You do not have permission to access this resource'
      );
      error.statusCode = 403;
      return next(error);
    }
    next();
  };

export const requireAdmin = requireRole(['admin']);
