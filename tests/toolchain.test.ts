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
import { readFileSync } from 'node:fs';
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
