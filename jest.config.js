/** @type {import('ts-jest').JestConfigWithTsJest} **/
const shared = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
};

// unit: pure logic, no database. api: the real Express app against a throwaway test database.
// Run with NODE_OPTIONS=--experimental-vm-modules (see package.json).
export default {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/__tests__/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'api',
      testMatch: ['<rootDir>/src/__tests__/api/**/*.test.ts'],
      setupFiles: ['<rootDir>/src/__tests__/api/support/env.ts'],
      globalSetup: '<rootDir>/src/__tests__/api/support/globalSetup.mjs',
    },
  ],
};
