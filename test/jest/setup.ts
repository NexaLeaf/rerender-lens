/**
 * `setupFilesAfterEnv` for the in-repo Jest app. In a real project this is one config line
 * (`setupFilesAfterEnv: ['rerender-lens/jest/setup']`); here the file exists so the tests can read
 * the collector and so `act()` has its flag.
 *
 * The import must come first: it creates the DevTools hook, and react-dom looks for the hook once,
 * when its module is evaluated.
 */
export { lens } from 'rerender-lens/jest/setup';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
