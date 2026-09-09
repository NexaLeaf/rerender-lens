/**
 * `setupFilesAfterEnv: ['rerender-lens/jest/setup']` — starts rerender-lens for every test file with
 * the defaults (all memoized components, silent) and hands the reports to the reporter.
 * For custom options, call `setupRerenderLens` from your own setup file instead.
 *
 * It must be a `setupFilesAfterEnv` entry, not `setupFiles`: the test framework installs `afterAll`
 * only after the environment is set up. Jest's globals are read off `globalThis` so the package
 * never has to import `@jest/globals` (which would break `injectGlobals: false` users the other way).
 */
import { setupRerenderLens } from './runner-report';

interface JestGlobals {
  afterAll?: (fn: () => void) => void;
  expect?: { getState?: () => { testPath?: string } };
}
const g = globalThis as typeof globalThis & JestGlobals;

if (typeof g.afterAll !== 'function') {
  throw new Error("rerender-lens/jest/setup: no global afterAll. List it in `setupFilesAfterEnv` (not `setupFiles`), and with `injectGlobals: false` write your own setup file calling `setupRerenderLens(options, { afterAll })`.");
}

export const lens = setupRerenderLens(
  {},
  {
    afterAll: (fn) => g.afterAll!(fn),
    testPath: () => g.expect?.getState?.().testPath,
  },
);
