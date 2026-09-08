// The Permissions-Policy header, held to the code that actually uses it.
//
// WHY THIS FILE EXISTS, because the thing it replaces was a comment. `next.config.mjs`
// used to end its policy block with "`tests/toolchain.test.ts` has no opinion on a policy
// that is merely too generous, which is why this comment is the guard." The comment then
// failed twice, in opposite directions, on the same three entries.
//
//   1. `accelerometer`/`gyroscope`/`magnetometer` were `(self)` for a "Compass" button.
//      The button was deleted with the sun mood and all three went back to `()` — right
//      for the compass, wrong because `lib/device-tilt.ts` reads the lens tilt off the
//      same `deviceorientation` event. The read went dead: `tilt` null forever, every
//      live-camera photo back on the assumed-level camera, ~20% distance error for an
//      ordinary 5° droop. Nothing errored, no test failed.
//   2. Restoring it, the obvious move is to grant only `accelerometer` + `gyroscope`,
//      since the W3C spec says the RELATIVE event needs those two and `magnetometer` is
//      for the absolute variant. Correct about the spec, correct about Blink, and it
//      would have left the read dead on iOS — WebKit requires all three for plain
//      `ondeviceorientation`. The grant is the UNION over engines, not the spec minimum.
//
// So the invariant is a PAIRING, asserted in BOTH directions:
//   · a feature is `(self)` only while something in this repo still consumes it;
//   · a feature is `()` the moment nothing does.
// The second direction is the privacy rule (`CLAUDE.md` § 5: a permission with no
// consumer reads as something the app keeps about you). The FIRST is the one that broke,
// and no "is this policy too generous" check could ever have seen it.
//
// Two deliberate choices about HOW it checks, both learned from the above:
//   · It reads the header this config actually SERVES — `nextConfig.headers()` — rather
//     than regexing the source. A guard that greps the file it guards can be satisfied by
//     text that never reaches a browser.
//   · Consumer detection runs over source with COMMENTS stripped
//     (`stripComments`, `tests/helpers/source.ts`). Otherwise a comment mentioning an
//     API — this very file's header mentions three — is enough to hold a permission open,
//     which is the too-generous direction wearing a passing test. String literals are
//     deliberately KEPT: `addEventListener('deviceorientation')` names its API *as* a
//     string, so the strings-stripping variant erases the very thing being looked for.
//     The first draft of this file used that variant and reported the tilt read missing;
//     the assertion below caught it, which is the only reason this note is accurate.
//
// The audit is a pure function over (served header, which consumers exist), so the last
// four tests hand it synthetic inputs and prove it says no. A guard written in the same
// hour as its subject is decoration until something shows it can fail.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { stripComments } from './helpers/source';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** The `Permissions-Policy` header as this config serves it for every route, parsed into
 *  feature → allowlist. Asking the config what it emits, not what it says. */
async function servedPolicy(): Promise<Record<string, string>> {
  // The specifier is a variable on purpose. `next.config.mjs` ships no type
  // declarations, so a literal import is a TS7016 error; a computed one resolves at
  // runtime and is typed by the cast below, which is the contract this test relies on.
  // Suppressing TS7016 with a directive would work too and say less about why.
  const spec = '../next.config.mjs';
  const { default: nextConfig } = (await import(spec)) as {
    default: {
      headers: () => Promise<
        Array<{ source: string; headers: Array<{ key: string; value: string }> }>
      >;
    };
  };
  const routes = await nextConfig.headers();
  const all = routes.find((r) => r.source === '/:path*');
  if (!all) throw new Error('no catch-all header route in next.config.mjs');
  const header = all.headers.find((h) => h.key === 'Permissions-Policy');
  if (!header) throw new Error('no Permissions-Policy in the catch-all route');

  const out: Record<string, string> = {};
  for (const entry of header.value.split(',')) {
    const m = /^\s*([a-z-]+)=(\([^)]*\))\s*$/.exec(entry);
    if (!m) throw new Error(`unparsable Permissions-Policy entry: ${entry.trim()}`);
    if (m[1] in out) throw new Error(`duplicate Permissions-Policy entry: ${m[1]}`);
    out[m[1]] = m[2];
  }
  return out;
}

/** Every first-party source file, comments and string literals removed, concatenated.
 *  Coarse on purpose — the question is only "does this API get called anywhere" — but
 *  stripped, so prose about an API cannot be mistaken for a use of it. Memoised: two
 *  features ask, and it reads the whole app. */
let appSource: string | null = null;
function sourceOfApp(): string {
  if (appSource !== null) return appSource;
  const files = execFileSync(
    'git',
    ['ls-files', 'app/**/*.ts*', 'components/**/*.ts*', 'lib/**/*.ts*'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  if (files.length < 50) throw new Error(`only ${files.length} source files found — bad glob?`);
  appSource = files.map((f) => stripComments(read(f))).join('\n');
  return appSource;
}

/** What each powerful feature is FOR, and how to tell from the source whether that reason
 *  still exists. `consumed` is evaluated against the repo rather than hard-coded: deleting
 *  a consumer must change what this file expects the header to say. */
type Feature = { feature: string; why: string; consumed: () => boolean };

/** The tilt read, which is one reading behind three tokens. Blink needs
 *  accelerometer + gyroscope for the relative event; WebKit needs the magnetometer too
 *  because it has no absolute variant. So all three share one consumer, and none of them
 *  can be dropped while it exists. Two halves to the check: the reader exists, AND
 *  something ships it — a module nothing imports is dead code, and dead code must not
 *  hold a permission open. */
const tiltIsRead = () =>
  /addEventListener\(\s*'deviceorientation'/.test(stripComments(read('lib/device-tilt.ts'))) &&
  /from '@\/lib\/device-tilt'/.test(stripComments(read('app/onboarding/capture/page.tsx')));

const FEATURES: Feature[] = [
  {
    feature: 'camera',
    why: 'the capture screen’s live viewfinder',
    consumed: () => /getUserMedia/.test(stripComments(read('lib/capture.ts'))),
  },
  ...(['accelerometer', 'gyroscope', 'magnetometer'] as const).map((feature) => ({
    feature,
    why: 'the lens tilt at the shutter, via the deviceorientation event',
    consumed: tiltIsRead,
  })),
  {
    feature: 'geolocation',
    why: 'nothing — the sun mood that read a latitude was collapsed to fixed presets',
    consumed: () => /navigator\.geolocation/.test(sourceOfApp()),
  },
  {
    feature: 'microphone',
    why: 'nothing — the capture screen wants pictures, not sound',
    consumed: () => /\baudio\s*:\s*true/.test(sourceOfApp()),
  },
];

export type Finding = { feature: string; problem: string };

/** The audit. `policy` is the served header; `consumed` says which features still have a
 *  reason to exist. Returns every disagreement, both directions. */
export function auditPolicy(
  policy: Record<string, string>,
  consumed: Record<string, boolean>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [feature, isConsumed] of Object.entries(consumed)) {
    const allow = policy[feature];
    if (allow === undefined) {
      findings.push({ feature, problem: 'not named in the header at all' });
      continue;
    }
    // The direction that killed the tilt read.
    if (isConsumed && allow !== '(self)') {
      findings.push({ feature, problem: `consumed but ${allow} — the feature cannot work` });
    }
    if (!isConsumed && allow !== '()') {
      findings.push({ feature, problem: `${allow} but nothing consumes it` });
    }
  }
  return findings;
}

describe('Permissions-Policy is paired with its consumers', () => {
  it('grants exactly the features something still uses, and denies the rest', async () => {
    const policy = await servedPolicy();
    const consumed = Object.fromEntries(FEATURES.map((f) => [f.feature, f.consumed()]));
    expect(auditPolicy(policy, consumed)).toEqual([]);
  });

  it('grants the whole sensor trio, because one reading needs the set', async () => {
    // Pinned as its own assertion because the narrowing looks so reasonable: the spec
    // really does say the relative event needs only two. WebKit is why it is three, and a
    // future reader with the spec open is exactly who would drop one.
    const policy = await servedPolicy();
    expect(tiltIsRead()).toBe(true);
    for (const f of ['accelerometer', 'gyroscope', 'magnetometer']) {
      expect(policy[f], `${f} gates the deviceorientation read on at least one engine`).toBe(
        '(self)',
      );
    }
  });

  it('denies every feature it does not name a reason for', async () => {
    // So a NEW `(self)` cannot be added without writing down what consumes it.
    const policy = await servedPolicy();
    const named = new Set(FEATURES.map((f) => f.feature));
    for (const [feature, allow] of Object.entries(policy)) {
      if (named.has(feature)) continue;
      expect(allow, `${feature} is allowed but no FEATURES row explains why`).toBe('()');
    }
  });

  it('refuses the powerful features this app has no business asking for', async () => {
    // A floor under the whole thing: these are never legitimate here, whatever the
    // FEATURES table grows to say, so they are asserted by name rather than by rule.
    const policy = await servedPolicy();
    for (const f of ['payment', 'usb', 'serial', 'bluetooth', 'display-capture', 'idle-detection']) {
      expect(policy[f], `${f} must be denied outright`).toBe('()');
    }
  });

  // ─── and the audit can actually say no ────────────────────────────────────
  it('reports a feature that is consumed but denied', () => {
    expect(auditPolicy({ gyroscope: '()' }, { gyroscope: true })).toEqual([
      { feature: 'gyroscope', problem: 'consumed but () — the feature cannot work' },
    ]);
  });

  it('reports a feature that is granted with nothing consuming it', () => {
    expect(auditPolicy({ geolocation: '(self)' }, { geolocation: false })).toEqual([
      { feature: 'geolocation', problem: '(self) but nothing consumes it' },
    ]);
  });

  it('reports a feature the header forgot', () => {
    expect(auditPolicy({}, { camera: true })).toEqual([
      { feature: 'camera', problem: 'not named in the header at all' },
    ]);
  });

  it('is quiet when both directions agree', () => {
    expect(auditPolicy({ camera: '(self)', usb: '()' }, { camera: true, usb: false })).toEqual([]);
  });

  // ─── and the consumer detection can say no ───────────────────────────────
  it('does not mistake prose about an API for a use of it', () => {
    // This file's own header names `deviceorientation` three times, and `next.config.mjs`
    // names it more. Stripping is what keeps a comment from holding a permission open.
    const commentOnly = `// navigator.geolocation is deliberately not used here\nexport const x = 1;\n`;
    expect(stripComments(commentOnly)).not.toMatch(/navigator\.geolocation/);
    // …and still sees an API named as a string literal, which is how events are bound.
    expect(stripComments(`addEventListener('deviceorientation', f);`)).toMatch(
      /'deviceorientation'/,
    );
  });
});
