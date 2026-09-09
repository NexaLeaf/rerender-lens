/**
 * The in-repo Jest app that keeps `rerender-lens/jest` honest (`npm run test:jest`, a CI job).
 * It uses the built package by name, exactly as a consumer would, so `npm run build` must run first.
 *
 * `scripts/jest-check.mjs` runs this twice: once with a budget nothing can meet (a non-zero exit and
 * the ranked fixes are the point) and once with a budget that fits (a zero exit).
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/**/*.jest.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // The one line a user adds. It must be setupFilesAfterEnv, not setupFiles: `afterAll` has to exist.
  setupFilesAfterEnv: ['<rootDir>/setup.ts'],
  reporters: [
    'default',
    ['rerender-lens/jest', { budget: process.env.RERENDER_LENS_BUDGET, limit: 5, exportTo: process.env.RERENDER_LENS_EXPORT }],
  ],
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
};
