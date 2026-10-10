import { connectDB, sequelize } from '../config/database';
import { initAssociations } from './models';
import { seedUsers } from './seeders/user.seeder';
import { logger } from '../config/logger';
import { config } from '../config/config';

/**
 * Creates the schema and the bootstrap admin in one command.
 *
 * The sync mode differs by environment on purpose:
 *
 *  - development/test: `sync({ alter: true })` diffs the models against the
 *    live tables and rewrites columns to match. Convenient while the schema
 *    is still moving, but it can drop and recreate a column to "fix" a type
 *    mismatch, so it must never touch a server holding real data.
 *
 *  - production: plain `sync()`, which only issues CREATE TABLE IF NOT EXISTS.
 *    It creates anything missing and leaves every existing table untouched,
 *    so it is safe to re-run and cannot lose data. It also will NOT apply
 *    later schema changes — for those, write a numbered .sql file in
 *    src/database/migrations/ and apply it with psql.
 */
const migrate = async () => {
  try {
    const isProd = config.env === 'production';

    await connectDB();
    initAssociations();

    logger.info(
      `Starting ${isProd ? 'production (create-only)' : 'development (alter)'} ` +
        `schema sync on "${config.db.database}"...`
    );

    if (isProd) {
      await sequelize.sync();
      logger.info(
        'Schema sync complete (create-only). Existing tables were left unchanged; ' +
          'apply schema CHANGES via src/database/migrations/*.sql.'
      );
    } else {
      await sequelize.sync({ alter: true });
      logger.info('Schema sync complete (alter).');
    }

    // Always runs, in every environment. Idempotent: it creates the admin only
    // when none exists, so re-running a deploy is a no-op.
    await seedUsers();

    logger.info('Database migration and seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    logger.error(error, 'Migration failed');
    process.exit(1);
  }
};

migrate();
