import { Sequelize } from 'sequelize';
import { config } from './config';
import { logger } from './logger';

export const sequelize = new Sequelize(
  config.db.database,
  config.db.username,
  config.db.password,
  {
    host: config.db.host,
    port: config.db.port,
    dialect: 'postgres',
    logging: config.env === 'test' ? false : (sql) => logger.debug(sql),
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
    },
  }
);

export const connectDB = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    logger.info('PostgreSQL database connected successfully.');
  } catch (error: any) {
    logger.error(error, 'Unable to connect to the database');
    process.exit(1);
  }
};
