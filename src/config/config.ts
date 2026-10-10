import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const isTest = process.env.NODE_ENV === 'test';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  env: process.env.NODE_ENV || 'development',
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: isTest
      ? process.env.DB_NAME_TEST || 'reminder_app_test'
      : process.env.DB_NAME || 'reminder_app_dev',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'super-secret-access-token-key-change-in-prod',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'super-secret-refresh-token-key-change-in-prod',
    expiry: process.env.JWT_EXPIRY || '1h',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    // Stored with literal \n escapes in .env; converted to real newlines here.
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  scheduler: {
    // How often the poller looks for due reminders.
    pollIntervalMs: parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '15000', 10),
    // Rows claimed per tick by a single instance.
    batchSize: parseInt(process.env.SCHEDULER_BATCH_SIZE || '50', 10),
    // A claimed row older than this is considered abandoned (crashed worker) and re-claimable.
    leaseMs: parseInt(process.env.SCHEDULER_LEASE_MS || '120000', 10),
    // Reminders older than this when first seen are expired rather than sent late.
    staleAfterMs: parseInt(process.env.SCHEDULER_STALE_AFTER_MS || '3600000', 10),
    maxAttempts: parseInt(process.env.SCHEDULER_MAX_ATTEMPTS || '5', 10),
    // Occurrences of a recurring event materialised ahead of now.
    recurrenceHorizonDays: parseInt(process.env.RECURRENCE_HORIZON_DAYS || '30', 10),
    enabled: process.env.SCHEDULER_ENABLED !== 'false',
  },
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
};
