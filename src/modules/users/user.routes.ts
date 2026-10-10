import { Router } from 'express';
import { UserController } from './user.controller';
import { authenticateToken, requireAdmin } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
  setActiveSchema,
  listUsersSchema,
} from './user.validation';

const router = Router();

// Every route in this module is admin-only, enforced server side.
router.use(authenticateToken, requireAdmin);

/**
 * @openapi
 * /users:
 *   post:
 *     summary: Create a user with their own login (Admin only)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, fullName]
 *             properties:
 *               email: { type: string }
 *               password: { type: string, minLength: 8 }
 *               fullName: { type: string }
 *               phone: { type: string }
 *               role: { type: string, enum: [admin, user] }
 *               timezone: { type: string, example: Asia/Kolkata }
 *     responses:
 *       201: { description: User created }
 *       409: { description: Email already registered }
 */
router.post('/', validateRequest(createUserSchema), UserController.create);

/**
 * @openapi
 * /users:
 *   get:
 *     summary: List users with pagination (Admin only)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: role, schema: { type: string, enum: [admin, user] } }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200: { description: Paginated user list }
 */
router.get('/', validateRequest(listUsersSchema), UserController.list);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Get a single user (Admin only)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: User returned }
 */
router.get('/:id', validateRequest(userIdParamSchema), UserController.getOne);

/**
 * @openapi
 * /users/{id}:
 *   patch:
 *     summary: Update a user (Admin only)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: User updated }
 */
router.patch('/:id', validateRequest(updateUserSchema), UserController.update);

/**
 * @openapi
 * /users/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a user (Admin only)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties: { isActive: { type: boolean } }
 *     responses:
 *       200: { description: Status updated }
 */
router.patch('/:id/status', validateRequest(setActiveSchema), UserController.setActive);

/**
 * @openapi
 * /users/{id}/reset-password:
 *   post:
 *     summary: Generate a temporary password for a user (Admin only)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Temporary password generated }
 */
router.post(
  '/:id/reset-password',
  validateRequest(userIdParamSchema),
  UserController.resetPassword
);

export default router;
