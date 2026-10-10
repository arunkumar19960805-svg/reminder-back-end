import { User } from '../models';
import { logger } from '../../config/logger';
import { config } from '../../config/config';

/**
 * Default bootstrap credentials.
 *
 * These are intentionally the same on a server as they are locally, so the
 * first login after a deploy needs no lookup. They are also committed to
 * .env.example, which means they are PUBLIC — override them with
 * SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD on anything internet-facing.
 */
const DEFAULT_ADMIN_EMAIL = 'admin@reminder.local';
const DEFAULT_ADMIN_PASSWORD = 'Admin@12345';

/**
 * Creates the bootstrap admin.
 *
 * Idempotent in both directions: it creates the account only when no admin
 * exists, and it never rewrites an existing account's password. That makes it
 * safe to run on every deploy, but it also means it cannot be used to reset a
 * forgotten password — do that in-app or via POST /users/:id/reset-password.
 */
export const seedUsers = async (): Promise<void> => {
  const email = (process.env.SEED_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const usingDefaults =
    !process.env.SEED_ADMIN_EMAIL && !process.env.SEED_ADMIN_PASSWORD;

  const existingAdmin = await User.findOne({ where: { role: 'admin' } });
  if (existingAdmin) {
    logger.info(
      `Admin already present (${existingAdmin.email}); skipping admin seed. ` +
        'Existing passwords are never overwritten.'
    );
    return;
  }

  // An account may already exist on this email as a non-admin (e.g. it was
  // created through the UI first). Promote it rather than failing on the
  // unique email constraint.
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    await existingUser.update({ role: 'admin', isActive: true });
    logger.warn(
      `Promoted existing user ${email} to admin. Their current password was kept.`
    );
    return;
  }

  await User.create({
    email,
    password,
    fullName: 'System Administrator',
    role: 'admin',
    timezone: config.defaultTimezone,
    isActive: true,
    // The bootstrap admin is not forced to rotate, so the documented
    // credentials keep working for that first login.
    mustChangePassword: false,
  });

  logger.info('─────────────────────────────────────────────');
  logger.info('Bootstrap admin created. Log in with:');
  logger.info(`  email:    ${email}`);
  logger.info(`  password: ${usingDefaults ? password : '<from SEED_ADMIN_PASSWORD>'}`);
  logger.info('─────────────────────────────────────────────');

  if (usingDefaults && config.env === 'production') {
    logger.warn(
      'SECURITY: this production admin uses the PUBLIC default credentials from ' +
        '.env.example. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, or change the ' +
        'password in-app immediately.'
    );
  } else if (usingDefaults) {
    logger.warn('Bootstrap admin used the DEFAULT password. Fine locally; change it before deploying.');
  }
};
