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
  // A test that renders a component (tests/sun-controls.test.ts) imports .tsx, and
  // tsconfig says `jsx: "preserve"` because Next owns that transform in the app
  // build. esbuild reads the same setting and falls back to the CLASSIC runtime,
  // which emits `React.createElement` into files that — correctly, under Next —
  // never import React. Naming the automatic runtime here fixes it for the test
  // run only; the app build is untouched.
  esbuild: { jsx: 'automatic' },
});
