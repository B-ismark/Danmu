import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Node-environment smoke tests for the pure core logic (geometry, prompt
// composition, unit conversion). No jsdom — these modules carry no DOM/Three
// dependencies, so the suite stays fast and deterministic. The '@' alias mirrors
// tsconfig so test imports match app imports.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
