import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ReportService } from './report.service';

export class ReportController {
  public static async dashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const [stats, upcoming] = await Promise.all([
        ReportService.dashboard(),
        ReportService.upcomingEvents(10),
      ]);
      res.status(200).json({ status: 'success', data: { stats, upcomingEvents: upcoming } });
    } catch (error) {
      next(error);
    }
  }

  public static async delivery(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await ReportService.deliveryReport(req.query as any);
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  public static async eventSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const summary = await ReportService.eventAcknowledgementSummary(req.params.eventId);
      res.status(200).json({ status: 'success', data: summary });
    } catch (error) {
      next(error);
    }
  }

  public static async userSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const summary = await ReportService.userAcknowledgementSummary(req.query as any);
      res.status(200).json({ status: 'success', data: summary });
    } catch (error) {
      next(error);
    }
  }
}
