import { Router } from 'express';
import { DeviceController } from './device.controller';
import { authenticateToken } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  registerDeviceSchema,
  deviceIdParamSchema,
  unregisterTokenSchema,
} from './device.validation';

const router = Router();
router.use(authenticateToken);

/**
 * @openapi
 * /devices:
 *   post:
 *     summary: Register this device's push token for the authenticated user
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fcmToken]
 *             properties:
 *               fcmToken: { type: string }
 *               platform: { type: string, enum: [android, ios, web] }
 *               deviceName: { type: string }
 *     responses:
 *       201: { description: Device registered }
 */
router.post('/', validateRequest(registerDeviceSchema), DeviceController.register);

/**
 * @openapi
 * /devices:
 *   get:
 *     summary: List the authenticated user's registered devices (tokens are masked)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Device list }
 */
router.get('/', DeviceController.list);

/**
 * @openapi
 * /devices/unregister:
 *   post:
 *     summary: Deactivate a device by its token (used at logout)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Token removed }
 */
router.post(
  '/unregister',
  validateRequest(unregisterTokenSchema),
  DeviceController.unregisterToken
);

/**
 * @openapi
 * /devices/{id}:
 *   delete:
 *     summary: Deactivate one of the authenticated user's devices
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Device deactivated }
 */
router.delete('/:id', validateRequest(deviceIdParamSchema), DeviceController.deactivate);

export default router;
