import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticateToken } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  updateProfileSchema,
} from './auth.validation';

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate and receive access + refresh tokens
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: admin@reminder.local }
 *               password: { type: string, example: Admin@12345 }
 *     responses:
 *       200: { description: Logged in }
 *       401: { description: Invalid credentials }
 */
router.post('/login', validateRequest(loginSchema), AuthController.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new token pair
 *     tags: [Auth]
 *     responses:
 *       200: { description: New tokens issued }
 */
router.post('/refresh', validateRequest(refreshSchema), AuthController.refresh);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Revoke refresh tokens for the current user
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Logged out }
 */
router.post('/logout', authenticateToken, AuthController.logout);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get the authenticated user's profile
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile returned }
 */
router.get('/me', authenticateToken, AuthController.me);

/**
 * @openapi
 * /auth/me:
 *   patch:
 *     summary: Update the authenticated user's own profile
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile updated }
 */
router.patch(
  '/me',
  authenticateToken,
  validateRequest(updateProfileSchema),
  AuthController.updateProfile
);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     summary: Change the authenticated user's password
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Password changed }
 */
router.post(
  '/change-password',
  authenticateToken,
  validateRequest(changePasswordSchema),
  AuthController.changePassword
);

export default router;
