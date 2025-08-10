module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/test/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/integration/',
    '/test/unit/core/ffmpeg/',
    '/test/unit/core/storage/',
    '/test/unit/renderer/'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main/index.js',
    '!src/renderer/**',
    '!**/node_modules/**'
  ],
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  testTimeout: 30000,
  verbose: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};