import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ReminderService } from './reminder.service';
import { AuditService } from '../audit/audit.service';

export class ReminderController {
  public static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await ReminderService.listForUser(req.user!.id, req.query as any);
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  public static async getOne(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const reminder = await ReminderService.getForUser(req.params.id, req.user!.id);
      res.status(200).json({ status: 'success', data: reminder });
    } catch (error) {
      next(error);
    }
  }

  public static async acknowledge(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await ReminderService.acknowledge(req.params.id, req.user!.id, {
        deviceId: req.body?.deviceId ?? null,
        source: req.body?.source,
      });
      if (!result.alreadyAcknowledged) {
        await AuditService.record({
          actorId: req.user!.id,
          action: 'reminder_acknowledge',
          resource: 'reminders',
          resourceId: req.params.id,
          ipAddress: req.ip,
        });
      }
      res.status(200).json({
        status: 'success',
        message: result.alreadyAcknowledged
          ? 'Reminder was already acknowledged'
          : 'Reminder acknowledged',
        data: {
          reminder: result.reminder,
          acknowledgement: result.acknowledgement,
          alreadyAcknowledged: result.alreadyAcknowledged,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  public static async history(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await ReminderService.acknowledgementHistory(req.user!.id, req.query as any);
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  public static async configureRules(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const rules = await ReminderService.configureRules(
        req.params.eventId,
        req.body.reminders
      );
      await AuditService.record({
        actorId: req.user!.id,
        action: 'reminder_rules_configure',
        resource: 'events',
        resourceId: req.params.eventId,
        metadata: { count: req.body.reminders.length },
        ipAddress: req.ip,
      });
      res.status(200).json({
        status: 'success',
        message: 'Reminder schedule updated',
        data: rules,
      });
    } catch (error) {
      next(error);
    }
  }
}
