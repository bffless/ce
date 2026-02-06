/**
 * Jest Integration Test Configuration
 *
 * Used for running integration tests against real cloud providers.
 * These tests require valid credentials in environment variables.
 *
 * Run with: pnpm test:integration
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*__tests__/integration/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage/integration',
  testEnvironment: 'node',
  // Longer timeout for cloud operations
  testTimeout: 30000,
  // Run tests serially to avoid rate limiting
  maxWorkers: 1,
  // Verbose output for debugging
  verbose: true,
};
