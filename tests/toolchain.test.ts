// Two properties of the lint setup that `next build` depends on, and that its
// exit code does not cover.
//
// `next build` runs its own ESLint pass over `eslint.config.mjs`. Both ways that
// pass can break print one line and then **exit 0 having linted nothing** — a
// silently skipped gate wearing a green build. Both have shipped here once:
//
//   · ESLint 8.57 with a flat config. Next only strips the eslintrc-era options
//     (`useEslintrc`, `extensions`, …) at ESLint >= 9; below that it loads
//     `FlatESLint` and hands it eslintrc options, so the pass dies before the
//     first file. `pnpm lint` is unaffected and stays green, which is why no
//     check anybody was reading caught it.
//   · A `*.config.mjs` ignore entry — what `.eslintignore` used to carry. Next
//     detects its plugin with `calculateConfigForFile('eslint.config.mjs')`, so
//     a config that ignores *itself* resolves to nothing and the build reports
//     the plugin missing while every Next rule is in fact firing.
//
// These assertions are the fast, local half of that guard; `.github/workflows/ci.yml`
// reads the build's own output as a backstop for a third way nobody has found yet.
//
// A third invariant of the same shape lives at the bottom of this file, about the
// `test` script rather than the lint one: vitest 4's default reporter DISCARDS
// `console.log` from a passing run, so a test file that reports a measurement
// reports it to nobody.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadESLint } from 'eslint';
import semver from 'semver';

const ROOT = join(__dirname, '..');
const CONFIG = 'eslint.config.mjs';

/** Loading ESLint and resolving `eslint-config-next` through `FlatCompat` is real
 *  work — a cold call measured 5.8 s on Windows, which overran vitest's 5 s default
 *  and failed the FIRST of these tests while the others passed on the warm module
 *  cache. The instance is reused (`calculateConfigForFile` only reads) and the three
 *  tests that resolve get a budget that is not a stopwatch: none of them is asserting
 *  how fast the toolchain is. */
const RESOLVE_TIMEOUT = 60_000;

type LintMessage = { ruleId: string | null };
let eslintP: Promise<{
  calculateConfigForFile: (f: string) => Promise<unknown>;
  lintText: (text: string, opts: { filePath: string }) => Promise<Array<{ messages: LintMessage[] }>>;
}> | null = null;

/** The flat config, resolved the way Next resolves it. */
async function resolveFor(file: string) {
  eslintP ??= loadESLint({ useFlatConfig: true }).then((ESLint) => new ESLint({ cwd: ROOT }));
  const eslint = await eslintP;
  return (await eslint.calculateConfigForFile(join(ROOT, file))) as
    | { plugins?: unknown; rules?: Record<string, unknown> }
    | undefined;
}

/** Lint a snippet through the real config, as a file that is not on disk. Asking
 *  what the gate REPORTS, rather than what its config says it should. */
async function lintProbe(file: string, text: string) {
  eslintP ??= loadESLint({ useFlatConfig: true }).then((ESLint) => new ESLint({ cwd: ROOT }));
  const eslint = await eslintP;
  const [res] = await eslint.lintText(text, { filePath: join(ROOT, file) });
  return res.messages.map((m: LintMessage) => m.ruleId);
}

describe('ESLint major version', () => {
  // Below 9 the build lints nothing and says so in a line that does not fail it.
  it('is at least 9, installed', async () => {
    const { ESLint } = await import('eslint');
    expect(semver.gte(ESLint.version, '9.0.0')).toBe(true);
  });

  it('is at least 9 in the declared range, so an install cannot go back', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const range: string = pkg.devDependencies.eslint;
    // Every version the range permits must be >= 9 — `^8 || ^9` would satisfy a
    // bare `gtr` check while still allowing the broken install.
    expect(semver.ltr('8.57.1', range)).toBe(true);
    expect(semver.minVersion(range)?.major).toBeGreaterThanOrEqual(9);
  });
});

describe('the flat config, as `next build` reads it', () => {
  // The exact call Next makes. If this stops finding the plugin, the build warns
  // and carries on, so nothing else would tell us.
  it('exposes @next/next when resolved for eslint.config.mjs itself', async () => {
    const resolved = await resolveFor(CONFIG);
    const plugins = resolved?.plugins;
    expect(plugins, `no config resolved for ${CONFIG} — is it self-ignored?`).toBeTruthy();
    const names = Array.isArray(plugins) ? plugins : Object.keys(plugins ?? {});
    expect(names).toContain('@next/next');
  }, RESOLVE_TIMEOUT);

  it('does not ignore itself', async () => {
    // Belt and braces on the above: a resolved config with no rules at all is
    // what an ignored file looks like.
    const resolved = await resolveFor(CONFIG);
    expect(Object.keys(resolved?.rules ?? {}).length).toBeGreaterThan(0);
  }, RESOLVE_TIMEOUT);

  it('still carries the Next rules for application source', async () => {
    // Guards the other direction — the config resolving *something* is not the
    // same as `eslint-config-next` still being in it.
    const resolved = await resolveFor('components/studio/TopBar.tsx');
    expect(resolved?.rules).toHaveProperty('@next/next/no-img-element');
    expect(resolved?.rules).toHaveProperty('react-hooks/exhaustive-deps');
  }, RESOLVE_TIMEOUT);

  it('extends next/typescript, so the lint gate can see a dead import', async () => {
    // The third load-bearing property of eslint.config.mjs, and the one nothing was
    // holding. `next/typescript` is what puts `@typescript-eslint/no-unused-vars`
    // in the chain; without it that rule is simply absent, `tsconfig.json` sets no
    // `noUnusedLocals`, and `pnpm lint --max-warnings 0`, `pnpm typecheck` and
    // `next build`'s own lint pass are ALL structurally unable to see an unused
    // import. Deleting the extends line leaves every gate green — which is how the
    // repo shipped thirteen dead imports across nine files, one of them a
    // `collidesAt` that had outlived its call site.
    //
    // Asserted on the RESOLVED config for a real source file, not by grepping this
    // config for the string 'next/typescript'. The string is not the rule: a rename
    // upstream, or a later block turning the rule off, would leave the grep green.
    // Asserted END TO END, by linting a dead import and demanding the error, not by
    // reading the resolved severity. The severity cannot fail: this config pins the
    // rule explicitly further down, so a later 'off' is unreachable and an earlier
    // one is overridden — an assertion on it would be exactly the decoration this
    // test exists to remove. What CAN fail is whether the gate sees the defect.
    // A real dead import, written as a template literal so the source of the probe
    // is legible as source rather than as an escaped one-liner.
    const rules = await lintProbe(
      'lib/__unused-import-probe.ts',
      `import { useRef } from 'react';
export const x = 1;
`,
    );
    expect(
      rules,
      'linting a dead import produced no no-unused-vars error — is next/typescript still extended?',
    ).toContain('@typescript-eslint/no-unused-vars');
  }, RESOLVE_TIMEOUT);

  it('turns no-img-element off for the generated-image routes, and only those', async () => {
    // (see the end of this file for the third invariant, about `pnpm test`)
    // `next/og` renders these with satori in Node at build time, so `next/image`
    // has nothing to optimise and the rule does not apply.
    //
    // This is pinned HERE, in a test that runs on every platform, because a
    // per-line `eslint-disable` could not do the job: the rule fired on Windows
    // and not on Linux, so the same directive read as suppressing a real warning
    // locally and as an UNUSED directive in CI — which is itself a warning, and at
    // `--max-warnings 0` a red build. `pnpm lint` passing on one machine says
    // nothing about the other for this rule; this assertion does.
    for (const f of ['app/opengraph-image.tsx', 'app/apple-icon.tsx']) {
      const rule = (await resolveFor(f))?.rules?.['@next/next/no-img-element'];
      expect(rule, `${f} should have the rule resolved`).toBeDefined();
      // Normalised: ESLint reports severity as `[0]`, or `0`, depending on shape.
      expect([rule].flat()[0], `${f} must have no-img-element off`).toBe(0);
    }
    // And nowhere else — a blanket "off" would hide a real `<img>` in the app.
    const app = (await resolveFor('components/ui/primitives.tsx'))?.rules?.['@next/next/no-img-element'];
    expect([app].flat()[0], 'the rule must still be live for ordinary components').not.toBe(0);
  }, RESOLVE_TIMEOUT);
});

// The `test` script's own flag, which is load-bearing and invisible when missing.
//
// vitest 4's default reporter swallows `console.log` from a run where nothing
// fails — verified by probe: a log at module scope, in a `describe` body and inside
// an `it` all three vanish. `tests/detect-pipeline.test.ts` exists to REPORT a
// measurement (ten pieces of furniture, their position and width error against
// analytic ground truth) and says in its own comments that it prints
// unconditionally, "because a number only visible on failure is not reported".
// Without `--disableConsoleIntercept` that claim was simply false, and had been for
// as long as the file existed: the assertions passed, the gate went green, and the
// baseline nobody could see was the whole point of building it.
//
// Pinned here rather than trusted, because there is no failure mode to notice. A
// dropped flag does not error; the report just stops appearing, and a report that
// stops appearing is indistinguishable from one nobody read.
describe('the test script keeps its console output', () => {
  it('runs vitest with console interception off', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    for (const script of ['test', 'test:watch']) {
      expect(pkg.scripts[script], `pnpm ${script}`).toContain('--disableConsoleIntercept');
    }
  });

  it('and the file that depends on that actually logs', () => {
    // The other half: the flag is pointless if the harness stops reporting, and a
    // reporting call is easy to lose in a refactor. Cheap, and it fails loudly.
    const src = readFileSync(join(ROOT, 'tests', 'detect-pipeline.test.ts'), 'utf8');
    // A CALL, at the start of a line — not the string anywhere in the file. That
    // file's own header discusses `console.log` in prose, so `toContain` was
    // satisfied by the commentary about the reporting rather than by the reporting:
    // delete the call, leave the paragraph, and the gate stayed green.
    expect(src).toMatch(/^\s*console\.log\(/m);
  });
});

// ── The three vitest settings the component tests depend on ─────────────────
//
// All three fail in the direction that looks like success, which is the only reason
// they are worth a test at all:
//
//   · `include` not matching `.tsx` means a component test file is **never
//     collected**. No error, no skip, no line of output — the suite reports green
//     and one file's worth of assertions has silently left the building. This is
//     the same shape as the `--disableConsoleIntercept` gate above, one level up:
//     not a broken check, an absent one.
//   · `environment` flipping to `jsdom` for the whole suite would make everything
//     pass while quietly charging every pure-logic file for a DOM. `CLAUDE.md` says
//     per-file, and the per-file pragma only works if the default stays `node`.
//   · `esbuild.jsx` falling back to the classic runtime emits `React.createElement`
//     into files that never import React, so **every** `.tsx` test fails to
//     compile. That one is loud, and it is pinned because the setting spent months
//     justified by a comment naming a file that had been deleted — the next reader
//     was one grep away from removing it as dead.
describe('vitest is configured so a component test can exist', () => {
  // The declared config, imported rather than read as text: a regex over the source
  // would pass on a commented-out setting.
  async function config() {
    const mod = (await import('../vitest.config')) as { default: Record<string, unknown> };
    return mod.default as {
      test: { include: string[]; environment: string; testTimeout?: number; hookTimeout?: number };
      esbuild: { jsx: string };
    };
  }

  /** Glob → RegExp for the three constructs these patterns use: `**` (any depth),
   *  `*` (one segment) and `{a,b}` (alternatives). Written out rather than pulled
   *  from a dependency because there is no glob matcher in this tree — vitest's is
   *  bundled — and six lines that can be read beat a transitive import that cannot. */
  function globToRe(glob: string): RegExp {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === '*' && glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else if (c === '*') out += '[^/]*';
      else if (c === '{') out += '(';
      else if (c === '}') out += ')';
      else if (c === ',') out += '|';
      else if (c === '.') out += '\\.';
      else if (c === '/') out += '/';
      else out += c.replace(/[\\^$+?()[\]|]/g, '\\$&');
    }
    return new RegExp('^' + out + '$');
  }

  it('collects every .tsx test file that exists on disk', async () => {
    // Derived from the directory, never from a list typed here: the whole failure
    // this guards is a file nobody notices is uncollected, and a hand-kept list
    // would be the same defect wearing a test's clothes.
    const tsx = readdirSync(join(ROOT, 'tests'))
      .filter((f) => f.endsWith('.test.tsx'))
      .map((f) => `tests/${f}`);
    // A pattern with no subject would make the loop below vacuously true — the
    // iterate-over-whatever-you-found shape. So the count is asserted first.
    expect(tsx.length, 'no .test.tsx files found, so the loop below proves nothing').toBeGreaterThan(0);

    const patterns = (await config()).test.include.map(globToRe);
    for (const file of tsx) {
      expect(
        patterns.some((re) => re.test(file)),
        `${file} matches none of vitest's include patterns, so it is never collected`,
      ).toBe(true);
    }
  });

  it('and the matcher this test relies on can actually say no', () => {
    // The glob translation above is code written in the same hour as the assertion
    // that uses it, which `CLAUDE.md` names as the most likely thing in a change to
    // be decoration. So it is exercised in both directions on the two patterns that
    // matter here.
    const wide = globToRe('tests/**/*.test.{ts,tsx}');
    const narrow = globToRe('tests/**/*.test.ts');
    expect(wide.test('tests/room-tools-findings.test.tsx')).toBe(true);
    expect(wide.test('tests/units.test.ts')).toBe(true);
    expect(narrow.test('tests/room-tools-findings.test.tsx')).toBe(false);
    expect(narrow.test('tests/units.test.ts')).toBe(true);
    expect(wide.test('tests/nested/deep.test.tsx')).toBe(true);
    expect(wide.test('lib/units.ts')).toBe(false);
    expect(wide.test('tests/helpers/color.ts')).toBe(false);
  });

  it('leaves the default environment as node, so jsdom stays per-file', async () => {
    expect((await config()).test.environment).toBe('node');
  });

  it('names the automatic JSX runtime, which tsconfig deliberately does not', async () => {
    expect((await config()).esbuild.jsx).toBe('automatic');
  });

  // ── The timeout, which is here for the same reason as the three above ──────
  //
  // Leaving it unset is not neutral. vitest resolves it to 5000 ms
  // (`resolved.testTimeout ??= resolved.browser.enabled ? 15e3 : 5e3`), and this
  // suite's honest worst case is a twenty-piece group solve at ~6.3 s in a warm
  // process on an IDLE machine. Measured 2026-09-03 under deliberate load, three
  // `layout-solve` tests died as `Test timed out in 5000ms` — and only one of the
  // three asserts anything about a clock. For months that read as a solver returning
  // different answers under a starved scheduler. It was the runner.
  //
  // So the number is pinned as a decision. The floor is what makes it a decision at
  // all; the ceiling is because a timeout that never fires is not a hang-catcher, and
  // a hung test that stalls the suite for a minute is its own defect.
  it('sets a testTimeout on purpose, rather than inheriting 5 s from vitest', async () => {
    const t = (await config()).test.testTimeout;
    expect(t, 'vitest.config.ts declares no testTimeout, so the 5 s default applies').toBeDefined();
    expect(t!).toBeGreaterThanOrEqual(20_000);
    expect(t!).toBeLessThanOrEqual(60_000);
  });

  it('gives hooks the same allowance, since they build fixtures with the same solver', async () => {
    const c = (await config()).test;
    expect(c.hookTimeout).toBe(c.testTimeout);
  });
});
