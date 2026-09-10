// The preset-plus-photos route, walked in a real browser — `docs/visual-check.md`'s § 44b
// item said it never had been, and that "everything known about it here was read out of
// the source rather than exercised."
//
// Run: install Playwright OUTSIDE this repo (its own scratch dir, `npm i playwright`),
// exactly as `scripts/rails-probe.mjs` requires and for the same reason — no gate runs
// this and it is not a dependency. Point it at a PRODUCTION build, never `next dev`:
//
//     cd /some/scratch && npm i playwright
//     cd <a worktree of the commit under test> && pnpm exec next build && \
//       pnpm exec next start -p 3061
//     PORT=3061 PW_ROOT=/some/scratch node scripts/capture-route-probe.mjs
//
// PW_ROOT is where `playwright` is resolved FROM, because an ESM `import` does not honour
// NODE_PATH and the module deliberately does not live here. Omit it and the bare specifier
// is tried, which works only if someone has installed it locally against this file's
// advice.
//
// WHAT IT MEASURES, and why it is an A/B rather than a look. § 44 and § 44b are merged and
// green, and the suite proves the arithmetic by round trip — project a piece with an
// independent camera model, invert it with the placer, require the truth back. That says
// nothing about whether the geometry reaches a person. So the same probe runs against the
// commit BEFORE § 44b (`0562489`, the verified parent of `9390323`) and against `main`, and
// the question is whether the numbers a user is shown actually move.
//
// The prediction was written and committed BEFORE this file existed, at
// scripts/capture-route-probe-PREDICTION.md, because a prediction read after the fact is
// not a prediction. It also records three uncertainties and what would falsify the whole
// exercise; read it before reading any number here.
//
// THE ASSERTIONS ARE THE POST-FIX EXPECTATIONS, so the pre-fix build is SUPPOSED to fail
// the discriminating ones. The failure count is the measurement, exactly as rails-probe
// reported "2 passed, 8 failed" against one build and "10 passed, 0 failed" against the
// other. A run of this file on its own tells you very little; the pair tells you
// everything.
//
// MEASURED, against two production builds, when this file held S1-S6:
//
//   surface     before 0562489                     after cda8801                      moved
//   T-Shape     5.50 / 4.70 / 5.50 / 4.70 m        5.50 / 4.70 / 5.50 / 4.70 m        NO
//   U-Shape     6.00 / 5.00 / 6.00 / 5.00 m        6.00 / 5.00 / 6.00 / 5.00 m        NO
//   Rectangle   6.00 / 4.00 / 6.00 / 4.00 m        6.00 / 4.00 / 6.00 / 4.00 m        no (control)
//   T east      1.31 × 1.23 m                      0.36 × 0.34 m                      YES 3.64×
//   Rect east   1.32 × 1.24 m                      1.32 × 1.24 m                      no (control)
//
//   12 passed, 4 failed on BOTH builds — the identical score, which is the finding.
//
// IT SPLIT IN HALF, and the halves are worth separating because one is the good news:
//
//   · THE GEOMETRY REACHES THE USER. The T's stem wall measures 0.36 m where the pre-fix
//     build said 1.31 — so § 44b is live end to end through the real click path, on a room
//     created by pressing the buttons a person presses. That was the thing this walk
//     existed to rule out and it is ruled out.
//   · BOTH CONTROLS HELD EXACTLY. The Rectangle's labels and its measured size are
//     identical across the builds, to the printed digit. A rectangle's bounding box and its
//     polygon agree bit-for-bit, so that is the no-op proof at the UI level and it is what
//     licenses reading anything into the row above.
//   · THE LABEL DID NOT MOVE AT ALL. A T-Shape's capture screen said "Wall 2 · 4.70 m wall"
//     before § 44b and says it after, and 4.70 m is the bounding-box side of a wall whose
//     real length is 2.58 m. Under an instruction that reads "Check each photo against the
//     wall length beside it." See the next block.
//
// THE DEFECT THIS FOUND, since a probe that only confirms is not worth committing.
// `app/onboarding/capture/page.tsx` held its room as `{ width, depth }` and set it with
// `setRoom({ width: meta.width, depth: meta.depth })`, dropping `layoutId` and `footprint`.
// § 44b changed that screen's label to read `wallFrame(slot, roomFootprint(room))` and left
// the narrowing — and `roomFootprint` took both polygon inputs as OPTIONAL, so a
// bounding-box-shaped object type-checked and fell back to `'rect'` in silence. Every
// preset was therefore measured as a rectangle on that one screen: exactly what § 44b set
// out to stop, on the surface whose own docblock calls it "the last place in the app that
// should be describing a different room."
//
// It is the § 44 lesson defeated at a boundary. That commit narrowed five signatures to a
// `Footprint` so a bounding box would be UNPASSABLE rather than merely unread; an optional
// polygon parameter hands the same hole back. The fix makes `layoutId` a REQUIRED KEY of
// possibly-undefined value, so `tsc` refuses a caller that has not thought about it while
// the defensive `?? 'rect'` still protects an old persisted record.
//
// And a comment certified it, which is the worse half. That call site read "Width and depth
// are what make 'Wall 2 · the 4.2 m wall' possible, and that line is the only check a
// person can make against their own photograph" — true of `wallSpan`, false the moment the
// label started reading `wallFrame`, and left in place to reassure the next reader.
//
// FOUR DETERMINISM GUARDS, all load-bearing, and the first one is the trap that would have
// silently invalidated every run:
//
//   · `public/models/` is absent here, but `localDetectorAvailable()` probes a SECOND base
//     — huggingface.co (`lib/local-detect.ts:60`) — and CI containers have outbound
//     network. Left alone, the detect screen quietly pulls ~64 MB of weights plus the
//     jsDelivr wasm runtime and runs real inference, which is neither deterministic nor the
//     offline path being tested. The CSP permits all of it on purpose. So the four weight
//     and CDN hosts are ROUTE-ABORTED below. Both HEAD probes are inside try/catch, so
//     aborting them is safe and lands exactly on the by-hand path.
//   · A fresh browser context per scenario. `app/layout.tsx` registers a service worker in
//     production, which is the build being tested, and it caches.
//   · The uploads are generated in-page as EXIF-less JPEGs, so neither build learns a focal
//     length and both fall back to the same assumed 66° lens. Slots then fill in arrival
//     order n,e,s,w (`lib/capture-slots.ts:191-206`), which is what makes "Wall 2" mean the
//     east photo on both builds.
//   · Nothing asserts on `path`. It flashes 'local' → 'cloud' → 'idle' before the NO_KEY
//     throw and the privacy banner can appear for a frame.
//
// TWO SCARS INHERITED FROM rails-probe, both of which cost that file a real assertion:
// assert an element EXISTS before believing what it says — one of its probes read the name
// of a COMMENT instead of a store key and so agreed with the fix for the same reason it
// agreed with the bug — and beware a selector that matches two elements. Every read here
// goes through `one()`, which fails loudly on a count other than 1.
//
// WHY `door` IS THE MIS-LABELLED CATEGORY. The detect screen prints a size only on a
// `suspect` verdict (`Measured W × H — {category} range is …`); a correctly labelled piece
// prints nothing at all, so a probe that labels honestly can read no measurement. `door`'s
// band is 620–1100 wide × 1980–2400 tall (`lib/dimension-ranges.ts:46`) and its anchor is
// `wall-floor` (`lib/physics.ts:29`), so it routes through `placeWallObject` — the § 44b
// path — and the fixed box misses that 1980 mm height floor on BOTH builds, in the same
// direction. That last part is what makes the two runs comparable: a category only one
// build failed would print a number once and measure a verdict rather than a size.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
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
      '    PORT=3061 PW_ROOT=/some/scratch node scripts/capture-route-probe.mjs',
  );
  process.exit(2);
}

const PORT = Number(process.env.PORT || 3061);
const BASE = `http://localhost:${PORT}`;
const LABEL = process.env.LABEL || `port-${PORT}`;
const SHOTS = process.env.SHOTS || join('/tmp', `capture-route-probe-${LABEL}`);
const WIDE = 1440; // well clear of the rail's compact step; the gallery is never `compact`
const TALL = 950;

// The keyboard-placed box, seeded by "Place with the keyboard" and identical on both
// builds (`app/onboarding/detect/page.tsx:128`). Stated here only so the header's claim
// about a CONSTANT box is checkable beside the code that relies on it; the probe never
// sends these numbers, it presses the button that does.
const KEY_BOX = [0.38, 0.44, 0.24, 0.3];

// Hosts that turn a by-hand run into a real-inference run. See the header.
const OFFLINE = [
  '**://huggingface.co/**',
  '**://*.hf.co/**',
  '**://cdn-lfs*.huggingface.co/**',
  '**://cdn.jsdelivr.net/**',
];

const log = (...a) => console.log(...a);
let pass = 0,
  fail = 0;
const ok = (n, m) => {
  pass++;
  log(`PASS ${n} ${m}`);
};
const no = (n, m) => {
  fail++;
  log(`FAIL ${n} ${m}`);
};
const note = (n, m) => log(`  ·  ${n} ${m}`);

/** A locator that is REQUIRED to match exactly one element. rails-probe lost an assertion
 *  to a selector that matched two buttons; this is that lesson as a function rather than a
 *  comment. Throws rather than returning, because a probe reading the wrong element is
 *  worse than a probe that stopped. */
async function one(page, selector, what) {
  const loc = typeof selector === 'string' ? page.locator(selector) : selector;
  const n = await loc.count();
  if (n !== 1) throw new Error(`${what}: expected exactly 1 match, got ${n}`);
  return loc.first();
}

/** Four EXIF-less JPEGs, drawn in the page so the probe carries no image encoder and no
 *  binary fixture. Each is labelled with its wall number, which costs nothing and makes
 *  the screenshots self-documenting — a screenshot nobody can orient is a screenshot
 *  nobody reads. 1200 × 900 clears `image-quality`'s 800 px low-res flag and sits under
 *  `normalizePhoto`'s 1600 px ceiling, so nothing is resampled on the way in. */
async function photos(page) {
  return page.evaluate(async () => {
    const out = [];
    for (let i = 1; i <= 4; i++) {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 900;
      const g = c.getContext('2d');
      // A plausible wall: a light plane, a floor band along the bottom, a coving line.
      const grad = g.createLinearGradient(0, 0, 0, 900);
      grad.addColorStop(0, '#d8d2c6');
      grad.addColorStop(1, '#c6bfb1');
      g.fillStyle = grad;
      g.fillRect(0, 0, 1200, 900);
      g.fillStyle = '#8d8577';
      g.fillRect(0, 770, 1200, 130);
      g.fillStyle = '#e8e3d8';
      g.fillRect(0, 60, 1200, 14);
      g.fillStyle = '#5b5348';
      g.font = '600 44px sans-serif';
      g.fillText(`wall ${i}`, 40, 130);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of buf) s += String.fromCharCode(b);
      out.push(btoa(s));
    }
    return out;
  });
}

/** `spans()` with the reader's own sanity check in front of it. Every preset the probe uses
 *  has at least one labelled wall, so a reading that is null all the way across means the
 *  READER is broken, not that the app printed nothing — and that is the difference between
 *  a finding and the false pass described on `spans()`. */
async function readSpans(page) {
  const got = await spans(page);
  const seen = Object.keys(got).length;
  if (seen !== 4) throw new Error(`found ${seen} wall cards, expected 4 — the reader is wrong`);
  if (!Object.values(got).some((v) => v !== null))
    throw new Error('no wall carries a span label at all — the reader is wrong, not the app');
  return got;
}

async function fresh(browser) {
  const ctx = await browser.newContext({ viewport: { width: WIDE, height: TALL } });
  const page = await ctx.newPage();
  for (const p of OFFLINE) await page.route(p, (r) => r.abort());
  return { ctx, page };
}

async function shot(page, name) {
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
  } catch {
    /* a screenshot is evidence for a person, never a gate — never fail the run for it */
  }
}

/** Walk the real click path to the capture screen for one preset. No seeding: reachability
 *  IS the question, and a seeded room would answer a different one. */
async function toCapture(page, preset) {
  await page.goto(`${BASE}/onboarding/layout-pick`, { waitUntil: 'domcontentloaded' });
  const radio = await one(
    page,
    page.getByRole('radio', { name: new RegExp(`^${preset}[,\\s]`) }),
    `${preset} radio`,
  );
  await radio.click();
  const cta = await one(
    page,
    page.getByRole('button', { name: /Photograph my real room first/ }),
    'the photograph-first CTA',
  );
  await cta.click();
  await page.waitForURL('**/onboarding/capture', { timeout: 20000 });
}

/** Upload the four generated photos through the real input. `.sr-only` rather than
 *  `display:none` is deliberate in the app (`capture/page.tsx:832-834`), which is what lets
 *  `setInputFiles` work with no click on the tile. */
async function upload(page) {
  const b64 = await photos(page);
  const input = await one(
    page,
    'input[aria-label="Choose photos of your room"]',
    'the photo input',
  );
  await input.setInputFiles(
    b64.map((d, i) => ({
      name: `wall-${i + 1}.jpg`,
      mimeType: 'image/jpeg',
      buffer: Buffer.from(d, 'base64'),
    })),
  );
  await page.getByText(/Wall 4/).first().waitFor({ timeout: 30000 });
}

/** The wall-length label, per wall, as the user reads it: the app renders the wall name and
 *  then `· {span} wall` beside it (`capture/page.tsx:957`), so the innermost element holding
 *  both reads exactly "Wall 2· 2.58 m wall".
 *
 *  It matches the name WITH THE SPAN OPTIONAL and keeps the innermost (shortest) match per
 *  wall, which is what lets "no label at all" be reported as a real answer rather than as a
 *  failure to find one — the U-Shape's Wall 1 is supposed to be bare.
 *
 *  THE FIRST VERSION OF THIS FUNCTION RETURNED null FOR EVERY WALL, and the run still showed
 *  one PASS: the U-Shape's bare Wall 1, which expects null and got it because the reader was
 *  broken. An assertion agreeing with the truth for the wrong reason is the exact scar
 *  rails-probe carries, so the reader now proves it can SEE a label before any absence is
 *  believed — `spans()`' caller fails the whole scenario if no wall on the card grid has one. */
async function spans(page) {
  return page.evaluate(() => {
    const best = {};
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const m = /^Wall ([1-4])(?:\s*·\s*([\d.]+)\s*(m|cm|mm|ft|in)\s*wall)?$/.exec(t);
      if (!m) continue;
      const prev = best[m[1]];
      if (prev && prev.len <= t.length) continue;
      best[m[1]] = { span: m[2] ? `${m[2]} ${m[3]}` : null, len: t.length };
    }
    const out = {};
    for (const k of Object.keys(best)) out[k] = best[k].span;
    return out;
  });
}

/** Commit the fixed keyboard box as a mis-labelled `door` and read back what the screen
 *  says it measured. Returns the raw sentence too, so a change of copy shows up as a
 *  changed string rather than as a silent null. */
async function measureByHand(page, wallLabel) {
  const go = await one(
    page,
    page.getByRole('button', { name: /Continue (with|·)/ }),
    'the continue-to-detect button',
  );
  await go.click();
  await page.waitForURL('**/onboarding/detect', { timeout: 20000 });

  // The by-hand path must be armed for us — with no key the app does that itself.
  await page.getByText(/Let's do this by hand|No key needed/).first().waitFor({ timeout: 40000 });

  // Pick the wall whose photo we draw on, and PROVE it took. The tabs live in a
  // role="group" labelled "Your wall photos" and carry aria-pressed.
  //
  // This assertion exists because the first working version of this function silently
  // measured Wall 1 while being asked for Wall 2 — and Wall 1 is the T's north wall, whose
  // distance is 2.350 m under BOTH conventions. So the A/B would have compared the one wall
  // § 44b does not move, printed two identical numbers, and read as "the fix does nothing".
  // A probe that measures the wrong subject accurately is this thread's own filed trap.
  const group = await one(page, '[role="group"][aria-label="Your wall photos"]', 'the wall-photo tabs');
  const tab = await one(page, group.getByRole('button', { name: new RegExp(`^${wallLabel}`) }), `the ${wallLabel} tab`);
  await tab.click();
  const pressedOn = await tab.getAttribute('aria-pressed');
  if (pressedOn !== 'true') throw new Error(`${wallLabel} tab did not become active (aria-pressed=${pressedOn})`);

  // NOT a <select>. `components/ui/Select.tsx` is a listbox — a role="combobox" trigger that
  // portals role="option" children — so `selectOption` throws on it, which is how this was
  // found. Its listbox also renders only once a measured `box` exists, and a synthetic click
  // on arrival at this screen had its `open` discarded by the page's own first render, so
  // the portal never appeared.
  //
  // The keyboard path avoids all of it and is a real user path the component implements
  // deliberately (`Select.tsx:158-196`): with the list CLOSED, ArrowDown commits the next
  // option directly via `onChange`, no portal involved. Walk until the trigger READS the
  // category rather than counting presses, so a reordered `MANUAL_CATEGORIES` cannot
  // silently select the wrong thing.
  const cat = await one(page, 'button[role="combobox"][aria-label="What is it?"]', 'the category combobox');
  await cat.focus();
  let reads = null;
  for (let i = 0; i < 40; i++) {
    reads = ((await cat.textContent()) || '').replace(/\s+/g, ' ').trim();
    if (reads === 'Door') break;
    await cat.press('ArrowDown');
    await page.waitForTimeout(40);
  }
  if (reads !== 'Door') throw new Error(`could not set the category to Door — it reads "${reads}"`);

  const arm = page.getByRole('button', { name: /Add a piece by hand|Adding by hand/ });
  if (await arm.count()) {
    const pressed = await arm.first().getAttribute('aria-pressed');
    if (pressed !== 'true') await arm.first().click();
  }

  const kb = await one(
    page,
    page.getByRole('button', { name: /Place with the keyboard/ }),
    'the keyboard-placement button',
  );
  await kb.click();
  const commit = await one(page, page.getByRole('button', { name: /Add this box/ }), 'the commit button');
  await commit.click();

  // The committed row names its own wall — "Door · Wall 2 · You" — so require that too.
  // Belt and braces with the aria-pressed check above: one proves the tab took, this proves
  // the DETECTION was filed against the wall whose distance the A/B turns on.
  const row = await page
    .getByText(new RegExp(`Door · ${wallLabel} · `))
    .first()
    .textContent({ timeout: 15000 })
    .catch(() => null);
  if (!row) throw new Error(`no committed row reads "Door · ${wallLabel} · …" — it landed on another wall`);

  const line = await page
    .getByText(/Measured .* range is/)
    .first()
    .textContent({ timeout: 15000 })
    .catch(() => null);
  const m = line && /Measured\s+([\d.]+)\s*×\s*([\d.]+)\s*(\w+)/.exec(line);
  return {
    line: line && line.replace(/\s+/g, ' ').trim(),
    row: row.replace(/\s+/g, ' ').trim(),
    w: m && m[1],
    h: m && m[2],
    unit: m && m[3],
  };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });

  log(`\ncapture-route probe · ${LABEL} · ${BASE}`);
  log(`  the fixed keyboard box is [${KEY_BOX.join(', ')}]; shots → ${SHOTS}\n`);

  const readings = {};

  // ── S1 · the route exists at all ────────────────────────────────────────────────
  {
    const { ctx, page } = await fresh(browser);
    try {
      // Welcome's onward control is a BUTTON, not a link — the first version of this
      // scenario asserted a link and failed for that reason alone, which would have read
      // as the route being broken.
      await page.goto(`${BASE}/onboarding/welcome`, { waitUntil: 'domcontentloaded' });
      const start = await one(page, page.getByRole('button', { name: /Start decorating/ }), 'welcome\'s onward button');
      await start.click();
      await page.waitForURL('**/onboarding/layout-pick', { timeout: 20000 });
      await toCapture(page, 'T-Shape');
      ok('S1', 'welcome → layout-pick → T-Shape → "Photograph my real room first" → capture');
      await shot(page, 'S1-capture-empty');
    } catch (e) {
      no('S1', `the route does not walk: ${e.message}`);
    } finally {
      await ctx.close();
    }
  }

  // ── S2 · the T-Shape's four wall-length labels ──────────────────────────────────
  const T_EXPECT = { 1: '5.50 m', 2: '2.58 m', 3: '2.42 m', 4: '2.58 m' };
  {
    const { ctx, page } = await fresh(browser);
    try {
      await toCapture(page, 'T-Shape');
      await upload(page);
      const got = await readSpans(page);
      readings.tShape = got;
      await shot(page, 'S2-t-shape-labels');
      for (const k of ['1', '2', '3', '4']) {
        const g = got[k] ?? null;
        if (g === T_EXPECT[k]) ok(`S2.${k}`, `T-Shape Wall ${k} reads ${g}`);
        else no(`S2.${k}`, `T-Shape Wall ${k} reads ${g} — expected ${T_EXPECT[k]}`);
      }
    } catch (e) {
      no('S2', `could not read the T-Shape labels: ${e.message}`);
    } finally {
      await ctx.close();
    }
  }

  // ── S3 · the U-Shape, where the honest answer is silence ────────────────────────
  const U_EXPECT = { 1: null, 2: '5.00 m', 3: '6.00 m', 4: '5.00 m' };
  {
    const { ctx, page } = await fresh(browser);
    try {
      await toCapture(page, 'U-Shape');
      await upload(page);
      const got = await readSpans(page);
      readings.uShape = got;
      await shot(page, 'S3-u-shape-labels');
      for (const k of ['1', '2', '3', '4']) {
        const g = got[k] ?? null;
        const want = U_EXPECT[k];
        if (g === want)
          ok(`S3.${k}`, `U-Shape Wall ${k} ${want === null ? 'carries NO span label' : `reads ${g}`}`);
        else
          no(
            `S3.${k}`,
            `U-Shape Wall ${k} reads ${g === null ? 'no label' : g} — expected ${want === null ? 'no label' : want}`,
          );
      }
    } catch (e) {
      no('S3', `could not read the U-Shape labels: ${e.message}`);
    } finally {
      await ctx.close();
    }
  }

  // ── S5 · the control, and the scenario that matters most ────────────────────────
  // A rectangle's bounding box and its polygon agree bit-for-bit, so NOTHING here may
  // move between the builds. If it does, this probe is measuring something other than
  // the footprint and every other row above is void.
  const R_EXPECT = { 1: '6.00 m', 2: '4.00 m', 3: '6.00 m', 4: '4.00 m' };
  {
    const { ctx, page } = await fresh(browser);
    try {
      await toCapture(page, 'Rectangle');
      await upload(page);
      const got = await readSpans(page);
      readings.rect = got;
      await shot(page, 'S5-rect-labels');
      for (const k of ['1', '2', '3', '4']) {
        const g = got[k] ?? null;
        if (g === R_EXPECT[k]) ok(`S5.${k}`, `Rectangle Wall ${k} reads ${g} (must match on BOTH builds)`);
        else no(`S5.${k}`, `Rectangle Wall ${k} reads ${g} — expected ${R_EXPECT[k]}`);
      }
    } catch (e) {
      no('S5', `could not read the Rectangle labels: ${e.message}`);
    } finally {
      await ctx.close();
    }
  }

  // ── S6 · the by-hand path is armed without a key ────────────────────────────────
  // ── S4 · the measured millimetres, from the fixed box ───────────────────────────
  // One walk serves both: reaching the measurement proves the arming.
  {
    const { ctx, page } = await fresh(browser);
    try {
      await toCapture(page, 'T-Shape');
      await upload(page);
      const armed = await measureByHand(page, 'Wall 2');
      ok('S6', 'no key and no model → the detect screen arrives with the draw tool armed');
      await shot(page, 'S4-t-shape-east-measured');
      readings.tEast = armed;
      if (armed.w) {
        ok('S4', `T-Shape east wall, fixed box as a door → ${armed.w} × ${armed.h} ${armed.unit}`);
        note('S4', `verbatim: "${armed.line}"`);
      } else {
        no('S4', `no "Measured …" line appeared — ${armed.line ? `saw "${armed.line}"` : 'nothing printed'}`);
      }
    } catch (e) {
      no('S4/S6', `the by-hand measurement did not complete: ${e.message}`);
    } finally {
      await ctx.close();
    }
  }

  // ── S4c · the same fixed box in a Rectangle, as the size control ────────────────
  {
    const { ctx, page } = await fresh(browser);
    try {
      await toCapture(page, 'Rectangle');
      await upload(page);
      const r = await measureByHand(page, 'Wall 2');
      readings.rectEast = r;
      await shot(page, 'S4c-rect-east-measured');
      if (r.w) {
        ok('S4c', `Rectangle east wall, same fixed box as a door → ${r.w} × ${r.h} ${r.unit}`);
        note('S4c', `verbatim: "${r.line}"`);
      } else {
        no('S4c', `no "Measured …" line appeared — ${r.line ? `saw "${r.line}"` : 'nothing printed'}`);
      }
    } catch (e) {
      no('S4c', `the Rectangle measurement did not complete: ${e.message}`);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();

  // The readings, printed as a table and written beside the screenshots, because the
  // A/B is read by comparing two runs and a number that only exists in a scrollback is a
  // number nobody diffs.
  log('\ncapture-route readings · %s', LABEL);
  log('  surface                     wall 1     wall 2     wall 3     wall 4');
  for (const [k, v] of Object.entries(readings)) {
    if (!v || v.line !== undefined) continue;
    const cell = (i) => String(v[i] ?? '—').padEnd(10);
    log(`  ${k.padEnd(26)} ${cell(1)} ${cell(2)} ${cell(3)} ${cell(4)}`);
  }
  for (const [k, v] of Object.entries(readings)) {
    if (!v || v.line === undefined) continue;
    log(`  ${k.padEnd(26)} ${v.w ? `${v.w} × ${v.h} ${v.unit}` : 'no measurement printed'}`);
  }
  try {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, 'readings.json'), JSON.stringify({ LABEL, BASE, readings }, null, 2));
  } catch {
    /* evidence for a person, not a gate */
  }

  log(`\n${pass} passed, ${fail} failed · ${LABEL}`);
  log('  A pre-§44b build is EXPECTED to fail the discriminating rows. See');
  log('  scripts/capture-route-probe-PREDICTION.md before reading anything into this.\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('PROBE ERROR', e.message);
  process.exit(2);
});
