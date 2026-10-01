// Does the capture screen's DOCUMENT hold the motion-sensor grant, however it was reached?
// `lib/device-tilt.ts` reads the lens tilt off `deviceorientation`, which Blink dispatches
// only when `accelerometer` and `gyroscope` are allowed, and a Permissions-Policy is fixed
// when the document is created. Every way into capture is a `<Link>` or `router.push`,
// which keeps the document it started in, so the grant that counts is the one the FIRST
// page was served with. `docs/what-is-still-open.md` § 45 is the measurement this probe
// made; `tests/permissions-policy.test.ts` holds the config to it. No gate runs this.
//
// What it reads, in Chromium only: `document.featurePolicy.allowsFeature(…)` for the three
// tokens, and whether `new Accelerometer()` constructs. That is the document's answer, not
// the event — a headless browser has no sensor to fire one — and WebKit is not run.
//
// Run: install Playwright OUTSIDE this repo, exactly as `scripts/photo-tag-probe.mjs`
// describes, and point it at a PRODUCTION build:
//
//     pnpm exec next build && pnpm exec next start -p 3061
//     PORT=3061 PW_ROOT=/some/scratch node scripts/sensor-policy-probe.mjs
//
// On the shipping config every row must read allowed. To see the § 45 failure, build
// with the catch-all's source set to '/:path((?!onboarding/capture$).*)' and the trio
// `()` in it, beside a '/onboarding/capture' rule carrying `securityHeaders`, then run
// with EXPECT=split: the typed-address row reads allowed and every row the app's own
// router reached reads denied. Do not commit that config; the test above refuses it.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const PW_ROOT = process.env.PW_ROOT;
const req = createRequire(PW_ROOT ? join(PW_ROOT, 'probe.cjs') : import.meta.url);
let chromium;
try {
  ({ chromium } = req('playwright'));
} catch {
  console.log(
    'PROBE ERROR cannot resolve `playwright`.\n' +
      '  Install it OUTSIDE this repo and point PW_ROOT at that directory:\n' +
      '    cd /some/scratch && npm i playwright\n' +
      '    PORT=3061 PW_ROOT=/some/scratch node scripts/sensor-policy-probe.mjs',
  );
  process.exit(2);
}
const BASE = `http://localhost:${process.env.PORT || 3061}`;
const SPLIT = process.env.EXPECT === 'split';
const TRIO = ['accelerometer', 'gyroscope', 'magnetometer'];
const CAPTURE = '/onboarding/capture';
let pass = 0, fail = 0;

const read = (page) =>
  page.evaluate((trio) => {
    const fp = document.featurePolicy;
    if (!fp) return null;
    let ctor;
    try { new Accelerometer(); ctor = 'constructs'; } catch (e) { ctor = e.name; }
    return { path: location.pathname, allows: trio.map((t) => fp.allowsFeature(t)), ctor };
  }, TRIO);

function check(label, got, want) {
  if (!got) { console.log(`PROBE ERROR ${label}: no document.featurePolicy (not Chromium?)`); process.exit(2); }
  const ok = got.allows.every((a) => a === want) && (got.ctor === 'constructs') === want;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label.padEnd(50)} ${TRIO.map((t, i) => `${t}=${got.allows[i]}`).join(' ')}` +
      `  Accelerometer: ${got.ctor}  (want ${want ? 'allowed' : 'denied'})`,
  );
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

await page.goto(`${BASE}${CAPTURE}`);
await page.waitForLoadState('networkidle');
check('capture, typed address', await read(page), true);

await page.goto(`${BASE}/`);
await page.waitForLoadState('networkidle');
check('home, typed address', await read(page), !SPLIT);

// The way people arrive: a page the app routes FROM, then its own router.
for (const from of ['/', '/onboarding/layout-pick']) {
  await page.goto(`${BASE}${from}`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { window.__sameDoc = true; });
  if (!(await page.evaluate(() => typeof window.next?.router?.push === 'function'))) {
    // A probe that cannot navigate the app's way must not report a pass.
    console.log(`PROBE ERROR no window.next.router on ${from}`);
    process.exit(2);
  }
  await page.evaluate((to) => window.next.router.push(to), CAPTURE);
  await page.waitForURL(`**${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  if (!(await page.evaluate(() => window.__sameDoc === true))) {
    console.log(`PROBE ERROR ${from} -> capture was a new document, so it measured a hard load`);
    process.exit(2);
  }
  check(`capture, pressed through from ${from}`, await read(page), !SPLIT);
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed${SPLIT ? ' (EXPECT=split)' : ''}`);
process.exit(fail ? 1 : 0);
