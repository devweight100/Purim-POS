import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for pure frontend modules (`npm run test`). Node environment by default; a test file
 * that needs a DOM opts in with a `// @vitest-environment jsdom` comment (and the jsdom package).
 * Playwright end-to-end tests live in e2e/ and run with `npm run test:e2e`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e'],
  },
});
