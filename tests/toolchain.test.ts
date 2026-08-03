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

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadESLint } from 'eslint';
import semver from 'semver';

const ROOT = join(__dirname, '..');
const CONFIG = 'eslint.config.mjs';

/** The flat config, resolved the way Next resolves it. */
async function resolveFor(file: string) {
  const ESLint = await loadESLint({ useFlatConfig: true });
  return new ESLint({ cwd: ROOT }).calculateConfigForFile(join(ROOT, file));
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
  });

  it('does not ignore itself', async () => {
    // Belt and braces on the above: a resolved config with no rules at all is
    // what an ignored file looks like.
    const resolved = await resolveFor(CONFIG);
    expect(Object.keys(resolved?.rules ?? {}).length).toBeGreaterThan(0);
  });

  it('still carries the Next rules for application source', async () => {
    // Guards the other direction — the config resolving *something* is not the
    // same as `eslint-config-next` still being in it.
    const resolved = await resolveFor('components/studio/TopBar.tsx');
    expect(resolved?.rules).toHaveProperty('@next/next/no-img-element');
    expect(resolved?.rules).toHaveProperty('react-hooks/exhaustive-deps');
  });
});
