import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The default is the node environment: most of what is tested here is pure core
// logic (geometry, clearance, prompt composition, unit conversion) with no DOM or
// Three dependency, so the suite stays fast and deterministic.
//
// The files that need a browser opt in per-file with `// @vitest-environment jsdom`
// rather than switching the whole suite — tests/storage*.test.ts (IndexedDB, via
// fake-indexeddb), tests/history.test.ts (zustand's `persist` wants localStorage)
// and the component tests, which mount React. Per-file keeps one slow environment
// from becoming the cost of every test.
//
// The '@' alias mirrors tsconfig so test imports match app imports.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // `.tsx` is in here because JSX will not parse inside a `.test.ts`, and a
    // component test written through `React.createElement` is a transcript of JSX
    // rather than JSX. This pattern is pinned by `tests/toolchain.test.ts`: a `.tsx`
    // test file that is simply never collected reports as a green suite, which is
    // the failure mode this repo keeps finding one level up.
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
  // Component tests import `.tsx`, and tsconfig says `jsx: "preserve"` because Next
  // owns that transform in the app build. esbuild reads the same setting and falls
  // back to the CLASSIC runtime, which emits `React.createElement` into files that —
  // correctly, under Next — never import React. Naming the automatic runtime here
  // fixes it for the test run only; the app build is untouched.
  //
  // This comment used to name `tests/sun-controls.test.ts` as the file that needed
  // it. That file went with the sun-mood collapse, so for a while a live setting was
  // justified by a file that did not exist — and the honest reading of the evidence
  // at the time ("no test imports a .tsx at all") would have talked someone into
  // deleting something that is now load-bearing. Left in place then, on the argument
  // that it becomes real the moment the first component test lands. It has.
  esbuild: { jsx: 'automatic' },
});
