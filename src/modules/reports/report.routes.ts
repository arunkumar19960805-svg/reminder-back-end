import { Router } from 'express';
import { ReportController } from './report.controller';
import { authenticateToken, requireAdmin } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  deliveryReportSchema,
  summaryRangeSchema,
  eventIdParamSchema,
} from './report.validation';

const router = Router();
// Reporting exposes cross-user data, so the whole module is admin-only.
router.use(authenticateToken, requireAdmin);

/**
 * @openapi
 * /reports/dashboard:
 *   get:
 *     summary: Admin dashboard statistics and upcoming events
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Dashboard payload }
 */
router.get('/dashboard', ReportController.dashboard);

/**
 * @openapi
 * /reports/delivery:
 *   get:
 *     summary: Reminder delivery and acknowledgement report
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: eventId, schema: { type: string } }
 *       - { in: query, name: userId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated delivery rows }
 */
router.get('/delivery', validateRequest(deliveryReportSchema), ReportController.delivery);

/**
 * @openapi
 * /reports/events/{eventId}/summary:
 *   get:
 *     summary: Status breakdown for one event
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Counts per reminder status }
 */
router.get(
  '/events/:eventId/summary',
  validateRequest(eventIdParamSchema),
  ReportController.eventSummary
);

/**
 * @openapi
 * /reports/users/summary:
 *   get:
 *     summary: Acknowledgement rate per user
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Per-user acknowledgement rates }
 */
router.get('/users/summary', validateRequest(summaryRangeSchema), ReportController.userSummary);

export default router;
