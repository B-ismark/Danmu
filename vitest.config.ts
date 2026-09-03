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
    // A timeout is a HANG-CATCHER, not a performance budget. The distinction is the
    // whole reason this line exists, because leaving it unset made the harness the
    // de-facto budget and it was a number nobody chose: vitest defaults to 5000 ms,
    // and the slowest honest test in this suite is a 20-piece group solve that takes
    // ~6.3 s in a warm process on an idle machine before anything is competing for a
    // core. Measured 2026-09-03 at `a23b50b`, one file, `--reporter=verbose`, against
    // deliberate CPU load (spinners on all 8 cores, then 18 of them):
    //
    //   test                                     idle    8-way   18-way  died as
    //   the solver can open a route › opens it     830 ms  3295 ms  7936 ms  TIMEOUT
    //   the solver and the room report › agree     732 ms  3248 ms  7392 ms  TIMEOUT
    //   cost of a solve › scales with the room     963 ms  4414 ms 10023 ms  TIMEOUT
    //
    // None of those three is a timing assertion. Two assert nothing about a clock at
    // all, and the third asserts a *ratio* — the shape that is supposed to survive a
    // loaded machine. It does not, on its own: the harness kills the body before the
    // ratio is ever evaluated. That is what made this look for months like a solver
    // returning different results under a starved scheduler, and it is not; the
    // results are identical and the runner shot them.
    //
    // 30 s is ~3x the worst body observed at 2.3x oversubscription, which leaves room
    // for a slower CI box, and is still short enough that a genuine hang is caught
    // rather than stalling the run. It is not a licence to be slow: the two real
    // performance bars live in `tests/layout-solve.test.ts` and
    // `tests/clearance-field.test.ts` as explicit assertions, and both take the best
    // of several samples so they measure what the machine CAN do rather than what it
    // happened to be doing. Raising this number can never make either of those pass.
    testTimeout: 30_000,
    // Same argument, and the same default. `beforeAll` here builds fixtures with the
    // same solver the tests call.
    hookTimeout: 30_000,
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
