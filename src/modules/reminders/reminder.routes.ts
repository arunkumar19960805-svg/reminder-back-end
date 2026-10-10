import { Router } from 'express';
import { ReminderController } from './reminder.controller';
import { authenticateToken, requireAdmin } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  listRemindersSchema,
  reminderIdParamSchema,
  acknowledgeSchema,
  historySchema,
  configureRulesSchema,
} from './reminder.validation';

const router = Router();
router.use(authenticateToken);

/**
 * @openapi
 * /reminders:
 *   get:
 *     summary: List the authenticated user's reminders
 *     tags: [Reminders]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [today, upcoming, overdue, acknowledged, all] }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: Paginated reminders }
 */
router.get('/', validateRequest(listRemindersSchema), ReminderController.list);

/**
 * @openapi
 * /reminders/history:
 *   get:
 *     summary: The authenticated user's acknowledgement history
 *     tags: [Reminders]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated acknowledgement history }
 */
router.get('/history', validateRequest(historySchema), ReminderController.history);

/**
 * @openapi
 * /reminders/{id}:
 *   get:
 *     summary: Get one of the authenticated user's reminders
 *     tags: [Reminders]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Reminder returned }
 *       404: { description: Not found or not yours }
 */
router.get('/:id', validateRequest(reminderIdParamSchema), ReminderController.getOne);

/**
 * @openapi
 * /reminders/{id}/acknowledge:
 *   post:
 *     summary: Acknowledge a reminder ("I have seen this"). Stops the alarm.
 *     tags: [Reminders]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Acknowledged (idempotent) }
 *       404: { description: Not found or not yours }
 */
router.post('/:id/acknowledge', validateRequest(acknowledgeSchema), ReminderController.acknowledge);

/**
 * @openapi
 * /reminders/events/{eventId}/rules:
 *   put:
 *     summary: Replace the reminder schedule for an event (Admin only)
 *     tags: [Reminders]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: eventId, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reminders]
 *             properties:
 *               reminders:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     offsetMinutes: { type: integer }
 *                     label: { type: string }
 *                     isAlarm: { type: boolean }
 *                     isEnabled: { type: boolean }
 *     responses:
 *       200: { description: Reminder schedule updated }
 */
router.put(
  '/events/:eventId/rules',
  requireAdmin,
  validateRequest(configureRulesSchema),
  ReminderController.configureRules
);

export default router;
