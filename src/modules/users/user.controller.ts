import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { UserService } from './user.service';
import { AuditService } from '../audit/audit.service';

export class UserController {
  public static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await UserService.create(req.body);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'user_create',
        resource: 'users',
        resourceId: user.id as string,
        metadata: { email: user.email, role: user.role },
        ipAddress: req.ip,
      });
      res.status(201).json({ status: 'success', message: 'User created successfully', data: user });
    } catch (error) {
      next(error);
    }
  }

  public static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await UserService.list(req.query as any);
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  public static async getOne(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await UserService.getById(req.params.id);
      res.status(200).json({ status: 'success', data: user });
    } catch (error) {
      next(error);
    }
  }

  public static async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await UserService.update(req.params.id, req.body);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'user_update',
        resource: 'users',
        resourceId: req.params.id,
        metadata: req.body,
        ipAddress: req.ip,
      });
      res.status(200).json({ status: 'success', message: 'User updated successfully', data: user });
    } catch (error) {
      next(error);
    }
  }

  public static async setActive(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { isActive } = req.body;
      const user = await UserService.setActive(req.params.id, isActive, req.user!.id);
      await AuditService.record({
        actorId: req.user!.id,
        action: isActive ? 'user_activate' : 'user_deactivate',
        resource: 'users',
        resourceId: req.params.id,
        ipAddress: req.ip,
      });
      res.status(200).json({
        status: 'success',
        message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async resetPassword(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await UserService.resetPassword(req.params.id);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'user_password_reset',
        resource: 'users',
        resourceId: req.params.id,
        ipAddress: req.ip,
      });
      res.status(200).json({
        status: 'success',
        message:
          'Temporary password generated. Share it securely; the user must change it at next login.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
