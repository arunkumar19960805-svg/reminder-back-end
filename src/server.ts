import app from './app';
import { config } from './config/config';
import { connectDB } from './config/database';
import { initAssociations } from './database/models';
import { logger } from './config/logger';
import { initPush } from './services/push.service';
import { startReminderWorker, stopReminderWorker } from './workers/reminder.worker';

const startServer = async () => {
  try {
    await connectDB();
    initAssociations();
    logger.info('Database models initialized.');

    // Non-fatal: the API still runs without Firebase, push delivery is just off.
    initPush();

    startReminderWorker();

    // 0.0.0.0 so the Android emulator can reach the host via 10.0.2.2.
    const server = app.listen(config.port, '0.0.0.0', () => {
      logger.info(`Server is running in ${config.env} mode at http://localhost:${config.port}`);
      logger.info(`Swagger API docs at http://localhost:${config.port}/api-docs`);
      logger.info(`Android emulator should use http://10.0.2.2:${config.port}`);
    });

    const shutdown = (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      stopReminderWorker();
      server.close(() => process.exit(0));
      // Don't hang forever on a stuck connection.
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error : new Error(String(error)) },
      'Failed to start server'
    );
    process.exit(1);
  }
};

startServer();
