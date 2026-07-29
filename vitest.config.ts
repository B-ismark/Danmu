import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The default is the node environment: most of what is tested here is pure core
// logic (geometry, clearance, prompt composition, unit conversion) with no DOM or
// Three dependency, so the suite stays fast and deterministic.
//
// The files that need a browser opt in per-file with `// @vitest-environment jsdom`
// rather than switching the whole suite — tests/storage*.test.ts (IndexedDB, via
// fake-indexeddb) and tests/history.test.ts (zustand's `persist` wants
// localStorage). Per-file keeps one slow environment from becoming the cost of
// every test.
//
// The '@' alias mirrors tsconfig so test imports match app imports.
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
