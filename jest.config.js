module.exports = {
  testEnvironment: 'node',
  roots: [
    '<rootDir>/src',
    '<rootDir>/test'
  ],
  testMatch: [
    '**/test/**/*.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main/index.js',
    '!src/renderer/**',
    '!**/node_modules/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1'
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  testTimeout: 30000,
  verbose: true
};