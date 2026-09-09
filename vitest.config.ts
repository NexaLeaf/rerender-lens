import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // `.test.ts` only: the Jest app (`test/jest/*.jest.test.tsx`, run by `npm run test:jest`) must
    // not be picked up here — it needs Jest's globals and the built package.
    include: ['test/**/*.test.ts', 'extension/test/**/*.test.ts'],
    globals: false,
    setupFiles: ['test/setup.ts'],
  },
});
