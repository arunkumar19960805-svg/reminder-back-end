import { connectDB } from '../config/database';
import { initAssociations } from './models';
import { seedUsers } from './seeders/user.seeder';
import { logger } from '../config/logger';

const seed = async () => {
  try {
    await connectDB();
    initAssociations();
    await seedUsers();
    logger.info('Seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    logger.error(error, 'Seeding failed');
    process.exit(1);
  }
};

seed();
