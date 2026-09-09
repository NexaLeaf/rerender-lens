/**
 * `setupFiles: ['rerender-lens/vitest/setup']` — starts rerender-lens for every test file with the
 * defaults (all memoized components, silent) and hands the reports to the reporter.
 * For custom options, call `setupRerenderLens` from your own setup file instead.
 */
import { afterAll, expect } from 'vitest';
import { setupRerenderLens } from './runner-report';

export const lens = setupRerenderLens({}, { afterAll, testPath: () => expect.getState().testPath });
