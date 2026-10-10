import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { EventService } from './event.service';
import { AuditService } from '../audit/audit.service';

export class EventController {
  public static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const event = await EventService.create(req.body, req.user!.id, req.user!.timezone);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'event_create',
        resource: 'events',
        resourceId: event.id,
        metadata: { title: event.title, assignees: req.body.assigneeIds?.length },
        ipAddress: req.ip,
      });
      res.status(201).json({ status: 'success', message: 'Event created successfully', data: event });
    } catch (error) {
      next(error);
    }
  }

  public static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await EventService.list(req.user!, req.query as any);
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  public static async getOne(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const event = await EventService.getById(req.params.id, req.user!);
      res.status(200).json({ status: 'success', data: event });
    } catch (error) {
      next(error);
    }
  }

  public static async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const event = await EventService.update(req.params.id, req.body);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'event_update',
        resource: 'events',
        resourceId: req.params.id,
        metadata: req.body,
        ipAddress: req.ip,
      });
      res.status(200).json({ status: 'success', message: 'Event updated successfully', data: event });
    } catch (error) {
      next(error);
    }
  }

  public static async cancel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const event = await EventService.cancel(req.params.id, req.body?.reason ?? null);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'event_cancel',
        resource: 'events',
        resourceId: req.params.id,
        ipAddress: req.ip,
      });
      res.status(200).json({
        status: 'success',
        message: 'Event cancelled and assignees notified',
        data: event,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async assign(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const event = await EventService.assignUsers(req.params.id, req.body.userIds);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'event_assign',
        resource: 'events',
        resourceId: req.params.id,
        metadata: { count: req.body.userIds.length },
        ipAddress: req.ip,
      });
      res.status(200).json({ status: 'success', message: 'Users assigned successfully', data: event });
    } catch (error) {
      next(error);
    }
  }

  public static async unassign(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const event = await EventService.unassignUser(req.params.id, req.params.userId);
      await AuditService.record({
        actorId: req.user!.id,
        action: 'event_unassign',
        resource: 'events',
        resourceId: req.params.id,
        metadata: { userId: req.params.userId },
        ipAddress: req.ip,
      });
      res.status(200).json({ status: 'success', message: 'User removed from event', data: event });
    } catch (error) {
      next(error);
    }
  }

  public static async status(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await EventService.getStatus(req.params.id);
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }
}
