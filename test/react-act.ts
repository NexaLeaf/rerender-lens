/**
 * `act` from wherever the installed React keeps it: `react` (18.3+ and 19) or `react-dom/test-utils`
 * (16.9-18.2, still shipped by 19 but deprecated there). Kept apart from `test/helpers.ts` so the
 * compat runs (`npm run test:react18`, `npm run test:react17`) need no changes there.
 */
import React from 'react';
import * as testUtils from 'react-dom/test-utils';

type ActFn = <T>(callback: () => T | Promise<T>) => Promise<T> | void;

const fromReact = (React as unknown as { act?: ActFn }).act;
const fromTestUtils = (testUtils as unknown as { act?: ActFn }).act;

if (!fromReact && !fromTestUtils) throw new Error('rerender-lens tests: no act() in this React (need react >= 16.9)');

export const act: ActFn = (fromReact ?? fromTestUtils)!;
