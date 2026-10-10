process.env.NODE_ENV = 'test';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  // Tests share one Postgres database, so they must not run in parallel.
  maxWorkers: 1,
};
