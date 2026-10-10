import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';

export class AuthController {
  public static async login(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await AuthService.login(email, password);
      await AuditService.record({
        actorId: result.user.id as string,
        action: 'login',
        resource: 'auth',
        ipAddress: req.ip,
      });
      res.status(200).json({ status: 'success', message: 'Logged in successfully', data: result });
    } catch (error) {
      next(error);
    }
  }

  public static async refresh(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tokens = await AuthService.refresh(req.body.refreshToken);
      res.status(200).json({ status: 'success', data: tokens });
    } catch (error) {
      next(error);
    }
  }

  public static async logout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await AuthService.logout(req.user!.id, req.body?.refreshToken);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'logout',
        resource: 'auth',
        ipAddress: req.ip,
      });
      res.status(200).json({ status: 'success', message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  }

  public static async me(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await AuthService.getProfile(req.user!.id);
      res.status(200).json({ status: 'success', data: user });
    } catch (error) {
      next(error);
    }
  }

  public static async updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await AuthService.updateProfile(req.user!.id, req.body);
      res.status(200).json({ status: 'success', message: 'Profile updated', data: user });
    } catch (error) {
      next(error);
    }
  }

  public static async changePassword(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { currentPassword, newPassword } = req.body;
      await AuthService.changePassword(req.user!.id, currentPassword, newPassword);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'password_change',
        resource: 'auth',
        ipAddress: req.ip,
      });
      res.status(200).json({
        status: 'success',
        message: 'Password changed successfully. Please log in again.',
      });
    } catch (error) {
      next(error);
    }
  }
}
