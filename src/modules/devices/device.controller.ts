import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { DeviceService } from './device.service';

export class DeviceController {
  public static async register(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const device = await DeviceService.register(req.user!.id, req.body);
      res.status(201).json({ status: 'success', message: 'Device registered', data: device });
    } catch (error) {
      next(error);
    }
  }

  public static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const devices = await DeviceService.listForUser(req.user!.id);
      res.status(200).json({ status: 'success', data: devices });
    } catch (error) {
      next(error);
    }
  }

  public static async deactivate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const device = await DeviceService.deactivate(req.params.id, req.user!.id);
      res.status(200).json({ status: 'success', message: 'Device deactivated', data: device });
    } catch (error) {
      next(error);
    }
  }

  public static async unregisterToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await DeviceService.deactivateByToken(req.body.fcmToken, req.user!.id);
      res.status(200).json({ status: 'success', message: 'Device token removed', data: result });
    } catch (error) {
      next(error);
    }
  }
}
