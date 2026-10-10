import { Router } from 'express';
import { EventController } from './event.controller';
import { authenticateToken, requireAdmin } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  createEventSchema,
  updateEventSchema,
  eventIdParamSchema,
  cancelEventSchema,
  assignUsersSchema,
  unassignUserSchema,
  listEventsSchema,
} from './event.validation';

const router = Router();
router.use(authenticateToken);

/**
 * @openapi
 * /events:
 *   get:
 *     summary: List events. Admins see all; users see only their assignments.
 *     tags: [Events]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [scheduled, cancelled, completed] } }
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *     responses:
 *       200: { description: Paginated events }
 */
router.get('/', validateRequest(listEventsSchema), EventController.list);

/**
 * @openapi
 * /events/{id}:
 *   get:
 *     summary: Get full event details (assignees only, or admin)
 *     tags: [Events]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Event returned }
 *       404: { description: Not found or not assigned to you }
 */
router.get('/:id', validateRequest(eventIdParamSchema), EventController.getOne);

/**
 * @openapi
 * /events:
 *   post:
 *     summary: Create an event with assignees and reminders (Admin only)
 *     tags: [Events]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, startAt, assigneeIds]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               eventType: { type: string, enum: [meeting, appointment, reminder, event] }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
 *               timezone: { type: string, example: Asia/Kolkata }
 *               location: { type: string }
 *               meetingLink: { type: string }
 *               assigneeIds: { type: array, items: { type: string } }
 *               recurrenceFrequency: { type: string, enum: [none, daily, weekly, monthly] }
 *               reminders:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     offsetMinutes: { type: integer, example: 30 }
 *                     label: { type: string }
 *                     isAlarm: { type: boolean }
 *     responses:
 *       201: { description: Event created }
 */
router.post('/', requireAdmin, validateRequest(createEventSchema), EventController.create);

/**
 * @openapi
 * /events/{id}:
 *   patch:
 *     summary: Update or reschedule an event (Admin only). Rebuilds reminders.
 *     tags: [Events]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Event updated }
 */
router.patch('/:id', requireAdmin, validateRequest(updateEventSchema), EventController.update);

/**
 * @openapi
 * /events/{id}/cancel:
 *   post:
 *     summary: Cancel an event and notify assignees (Admin only)
 *     tags: [Events]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Event cancelled }
 */
router.post('/:id/cancel', requireAdmin, validateRequest(cancelEventSchema), EventController.cancel);

/**
 * @openapi
 * /events/{id}/assignments:
 *   post:
 *     summary: Assign one or more users to an event (Admin only)
 *     tags: [Events]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Users assigned }
 */
router.post(
  '/:id/assignments',
  requireAdmin,
  validateRequest(assignUsersSchema),
  EventController.assign
);

/**
 * @openapi
 * /events/{id}/assignments/{userId}:
 *   delete:
 *     summary: Remove a user from an event and cancel their pending reminders (Admin only)
 *     tags: [Events]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: User unassigned }
 */
router.delete(
  '/:id/assignments/:userId',
  requireAdmin,
  validateRequest(unassignUserSchema),
  EventController.unassign
);

/**
 * @openapi
 * /events/{id}/status:
 *   get:
 *     summary: Per-assignee delivery and acknowledgement status (Admin only)
 *     tags: [Events]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Status matrix returned }
 */
router.get('/:id/status', requireAdmin, validateRequest(eventIdParamSchema), EventController.status);

export default router;
