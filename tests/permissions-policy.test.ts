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
//     text that never reaches a browser. `next.config.mjs` computes `dev` from
//     `NODE_ENV`, which is `'test'` here, so this is one of its two builds; that the
//     policy is the same in both is asserted rather than assumed.
//   · A feature LEFT OUT of the header is NOT denied — most default to `self` — so the
//     audit cannot be a sweep over the entries that happen to be present. That is what
//     `MUST_BE_DENIED` is for: absence is a finding.
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

import { describe, expect, it, vi } from 'vitest';
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

/** Every first-party source file, COMMENTS removed (string literals kept — see the note
 *  in the header), concatenated. Coarse on purpose — the question is only "does this API
 *  get called anywhere" — but stripped, so prose about an API cannot be mistaken for a
 *  use of it. Memoised: three features ask, and it reads the whole app.
 *
 *  **No globs.** This passed a double-star pathspec for each directory to `git ls-files`
 *  — `lib` slash star-star slash star dot ts-star — and git pathspecs are wildmatch
 *  WITHOUT `FNM_PATHNAME`, so a double star still requires the following slash literally.
 *  Against a flat `lib/` that matched **zero files**, and the `app` one likewise missed
 *  everything at the top of `app/`. The corpus was 76 files of app and components with the
 *  whole of `lib/` invisible, which is the direction that fails silently: restore a
 *  latitude read in `lib/solar.ts` and `consumed()` greps a corpus that cannot see it,
 *  the audit demands `geolocation=()`, the suite stays green, and the feature is dead on
 *  both engines with nothing errored. Directories plus a suffix filter have no glob
 *  semantics to get wrong. */
let appSource: string | null = null;
function filesOfApp(): string[] {
  return execFileSync('git', ['ls-files', '-z', 'app', 'components', 'lib'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((f) => /\.tsx?$/.test(f));
}
function sourceOfApp(): string {
  if (appSource !== null) return appSource;
  appSource = filesOfApp()
    .map((f) => stripComments(read(f)))
    .join('\n');
  return appSource;
}

/** What each powerful feature is FOR, and how to tell from the source whether that reason
 *  still exists. `consumed` is evaluated against the repo rather than hard-coded: deleting
 *  a consumer must change what this file expects the header to say. */
type Feature = { feature: string; why: string; consumed: () => boolean };

/** The two probes that are CALL-shaped rather than name-shaped, as named constants so the
 *  "can it say no" block below can exercise them on synthetic input. String literals
 *  survive the comment strip by design — that is how `addEventListener('deviceorientation')`
 *  is found at all — so a bare name would keep a permission open forever after the code
 *  behind it went, leaving only an error message that mentions it. */
const CALLS_GET_USER_MEDIA = /mediaDevices\s*\.\s*getUserMedia\s*\(/;
const WRITES_CLIPBOARD = /clipboard\s*\.\s*writeText\s*\(/;

/** The tilt read, which is one reading behind three tokens. Blink needs
 *  accelerometer + gyroscope for the relative event; WebKit needs the magnetometer too
 *  because it has no absolute variant. So all three share one consumer, and none of them
 *  can be dropped while it exists. Two halves to the check: the reader exists, AND
 *  something ships it — a module nothing imports is dead code, and dead code must not
 *  hold a permission open. */
const tiltIsRead = () =>
  /addEventListener\(\s*['"]deviceorientation['"]/.test(stripComments(read('lib/device-tilt.ts'))) &&
  /from ['"][^'"]*device-tilt['"]/.test(stripComments(read('app/onboarding/capture/page.tsx')));

/** Features that must be NAMED AND DENIED, asserted by name because absence is not
 *  denial: the default allowlist for almost all of these is `self`, so leaving one out of
 *  the header grants it to this origin. A rule cannot generate this list — the registry of
 *  powerful features is not derivable from anything in the repo — so it is written down,
 *  and the pairing test above covers the other direction (anything granted needs a row).
 *
 *  The five at the end are the ones the earlier version missed entirely, and they are why
 *  this list exists: `screen-wake-lock`, `window-management`, `local-fonts`,
 *  `xr-spatial-tracking` and `compute-pressure` were all effectively granted, and adding a
 *  consumer for any of them would have tripped nothing.
 *
 *  `geolocation` and `microphone` are deliberately NOT here even though both are denied:
 *  they have `FEATURES` rows, which is a different and better claim — denied *because
 *  nothing consumes them*, and granted the moment something does. Listing one in both
 *  places would make the two tests contradict each other the day a consumer appeared. */
const MUST_BE_DENIED = [
  'clipboard-read',
  'payment',
  'usb',
  'midi',
  'hid',
  'serial',
  'bluetooth',
  'display-capture',
  'idle-detection',
  'ambient-light-sensor',
  'autoplay',
  'encrypted-media',
  'fullscreen',
  'picture-in-picture',
  'otp-credentials',
  'publickey-credentials-get',
  'web-share',
  'screen-wake-lock',
  'window-management',
  'local-fonts',
  'xr-spatial-tracking',
  'compute-pressure',
] as const;

const FEATURES: Feature[] = [
  {
    feature: 'camera',
    why: 'the capture screen’s live viewfinder',
    // Call-shaped, not a bare name: string literals survive the strip by design (see
    // the header), so `throw new Error('getUserMedia is unavailable')` left behind after
    // the code went would have held `camera=(self)` open forever.
    consumed: () => CALLS_GET_USER_MEDIA.test(stripComments(read('lib/capture.ts'))),
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
  {
    feature: 'clipboard-write',
    why: 'the Room panel’s Copy — a plain-text parts list, the sanctioned form of “here is what is in the room”',
    consumed: () => WRITES_CLIPBOARD.test(sourceOfApp()),
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

  it('names AND denies every powerful feature it does not use', async () => {
    // The floor under the whole thing, and the fix for the hole in the test above:
    // that one iterates the header's own entries, so a feature nobody listed was
    // granted by default and no assertion could see it. Absence is a finding here.
    const policy = await servedPolicy();
    const granted = new Set(FEATURES.map((f) => f.feature));
    for (const f of MUST_BE_DENIED) {
      expect(policy[f], `${f} must be named in the header and denied — omission grants it`).toBe(
        '()',
      );
      // …and the two lists must not contradict each other.
      expect(granted.has(f), `${f} is in MUST_BE_DENIED and in FEATURES`).toBe(false);
    }
  });

  it('serves the same policy in both builds', async () => {
    // `next.config.mjs` computes `dev` from `NODE_ENV` at module scope and branches on it
    // for the CSP, so "the header this config actually SERVES" is true of ONE build unless
    // this is checked. Re-imported under both, which is the only way to ask.
    const under = async (env: string) => {
      // `vi.stubEnv` rather than assigning: vitest defines `process.env.NODE_ENV` as a
      // non-configurable descriptor, so a plain write throws.
      vi.stubEnv('NODE_ENV', env);
      vi.resetModules();
      try {
        return await servedPolicy();
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    };
    expect(await under('production')).toEqual(await under('development'));
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

  it('does not mistake an error MESSAGE about an API for a use of it', () => {
    // The other half of the same hazard, and the one a bare-name probe walks into: the
    // strip keeps string literals, so `throw new Error('getUserMedia is unavailable')`
    // left behind after the camera code went would hold `camera=(self)` open — the
    // too-generous direction wearing a passing test.
    expect(CALLS_GET_USER_MEDIA.test(`await navigator.mediaDevices.getUserMedia({ video: true })`)).toBe(
      true,
    );
    expect(CALLS_GET_USER_MEDIA.test(`throw new Error('getUserMedia is unavailable');`)).toBe(false);
    expect(WRITES_CLIPBOARD.test(`await navigator.clipboard.writeText(asText())`)).toBe(true);
    expect(WRITES_CLIPBOARD.test(`'Allow clipboard access, or read it off the panel'`)).toBe(false);
  });

  it('reads a corpus that actually contains the files it needs to read', () => {
    // The failure this replaced was a glob that matched nothing: `lib/***/*.ts*` against a
    // flat `lib/` is zero files, and the old floor (`< 50`) still passed on the 76 that
    // app and components contributed. So the floor is NAMED FILES, one per shape the old
    // globs got wrong — a flat `lib/` file, a file at the top of `app/`, a nested one, and
    // a component — plus a count that is a fraction of the real total rather than a
    // number calibrated to a broken result.
    const files = filesOfApp();
    for (const f of [
      'lib/capture.ts',
      'lib/device-tilt.ts',
      'app/layout.tsx',
      'app/onboarding/capture/page.tsx',
      'components/ServiceWorkerRegistrar.tsx',
    ]) {
      expect(files, `${f} must be in the scanned corpus`).toContain(f);
    }
    expect(files.length).toBeGreaterThan(150);
    // And the two consumers that read named files rather than the corpus are unaffected
    // by any of this, which is worth pinning: the Phase 1 pairing this file exists for
    // was genuinely held even while the corpus was broken.
    expect(tiltIsRead()).toBe(true);
  });
});
