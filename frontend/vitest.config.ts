import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for pure frontend modules (`npm run test`). Node environment by default; a test file
 * that needs a DOM opts in with a `// @vitest-environment jsdom` comment (and the jsdom package).
 * Playwright end-to-end tests live in e2e/ and run with `npm run test:e2e`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src'), '@shared': path.resolve(__dirname, '..', 'shared', 'src') },
  },
  test: {
    environment: 'node',
    // shared/test/*.spec.ts (business calculations shared with the backend) run here and in backend jest
    include: ['src/**/*.test.{ts,tsx}', '../shared/test/**/*.spec.ts'],
    globals: true,
    exclude: ['node_modules', '.next', 'e2e'],
  },
});
