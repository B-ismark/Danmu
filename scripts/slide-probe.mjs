// Run: install Playwright OUTSIDE this repo (its own scratch dir, `npm i playwright`
// then `npx playwright install chromium`) and point it at a PRODUCTION build —
// `pnpm build && pnpm exec next start -p <port>`, never `next dev`. It is deliberately
// not a dependency here and no gate runs it.
//
//     node scripts/slide-probe.mjs http://localhost:3117 BRANCH
//
// Launch args are `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`,
// because R3F needs a GL context and SwiftShader is the software one.
//
// § H.8 slide-to-limit, in a real browser.
//
// The four mutants that survive the suite are the CALLER lines — `PlanView`'s
// `settled` gate and adoption of `leadPos`, and `Draggable`'s two. No test in the
// repo mounts either component, so this is the only thing that can speak for them.
//
// Discriminator: nudge a whole-room selection east until nothing moves, then measure
// each piece's gap to the wall it is heading for. On `main` the set refuses the first
// nudge that would clip ANY member, so the binding piece stops up to one nudge short.
// On the branch the set slides to that member's own limit, so the gap closes to ~0.
//
// The probe THROWS when a precondition is missing rather than reporting an empty
// measurement — four probes in this repo's history each measured themselves and
// returned a confident negative.

import { chromium } from 'playwright';

const base = process.argv[2];
const label = process.argv[3] || base;
if (!base) throw new Error('usage: node slide-probe.mjs <baseUrl> <label>');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const log = (...a) => console.log(`[${label}]`, ...a);

// ---------------------------------------------------------------- a furnished room
// Coarse snap — 50 mm steps — seeded straight into the persisted prefs.
//
// **Four versions of this probe could not discriminate at all, and the reason was
// always the same:** the member's clamp landed exactly on the 10 mm nudge lattice, so
// `main`'s last legal nudge stopped ON the limit and there was no partial step left
// for the branch to take. At 50 mm the limit sits strictly between two lattice
// points, which is the only arrangement where "refuse" and "slide to the limit" can
// give different numbers. The control itself lives in `TransformToolbar`, which
// renders on the model route only and needs a selection, so it is not reachable from
// the tab this drag happens on — `snapMode` is in `STUDIO_PREFS`, so the setting is
// seeded instead of clicked.
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() =>
  localStorage.setItem('danmu-studio-prefs', JSON.stringify({ state: { snapMode: 'coarse' }, version: 0 })),
);
await page.goto(base + '/onboarding/layout-pick', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const radios = page.getByRole('radio');
const n = await radios.count();
if (n === 0) throw new Error('layout-pick showed no radio: the preset picker is not on this page');
log('presets:', n);
await radios.first().click();
await page.waitForTimeout(400);

// Whatever moves us on from here — the picker's own CTA.
const ctas = await page.getByRole('button').all();
let went = false;
for (const b of ctas) {
  const t = ((await b.textContent()) || '').trim();
  if (/^(continue|next|start|open|use this|create)/i.test(t)) {
    await b.click();
    went = true;
    log('CTA:', t);
    break;
  }
}
if (!went) throw new Error('no continue-shaped button on layout-pick: ' + JSON.stringify(await Promise.all(ctas.map((b) => b.textContent()))));

await page.waitForURL(/\/room\/[^/]+\/(model|plan)/, { timeout: 30000 });
const roomId = page.url().match(/\/room\/([^/]+)\//)[1];
log('room', roomId, page.url());
await page.waitForTimeout(2500);

// ---------------------------------------------------------------- the 2D plan
const planTab = page.getByRole('button', { name: /2D Plan/i });
if ((await planTab.count()) === 0) throw new Error('no "2D Plan" button');
await planTab.first().click();
await page.waitForTimeout(1500);

const pieceSel = 'svg g[role="button"][aria-label]';
const pieces = await page.$$eval(pieceSel, (els) =>
  els.map((e) => e.getAttribute('aria-label')).filter((a) => !/Arrow keys move it\.$/.test(a || '')),
);
if (pieces.length === 0) throw new Error('the plan drew no furniture');
log('pieces on the plan:', pieces.length);

/** Positions straight out of the store's persisted transforms, never out of pixels. */
async function transforms() {
  return page.evaluate(
    (id) =>
      new Promise((res, rej) => {
        const open = indexedDB.open('keyval-store');
        open.onerror = () => rej(new Error('idb open failed'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('keyval', 'readonly');
          const g = tx.objectStore('keyval').get(`room:${id}:transforms`);
          g.onsuccess = () => res(g.result ?? null);
          g.onerror = () => rej(new Error('idb get failed'));
        };
      }),
    roomId,
  );
}

/** Focus a plan piece without clicking it — overlapping outlines eat clicks. */
async function focusPiece(i) {
  return page.$$eval(
    pieceSel,
    (els, idx) => {
      const furniture = els.filter((e) => !/Arrow keys move it\.$/.test(e.getAttribute('aria-label') || ''));
      const el = furniture[idx];
      if (!el) return null;
      el.focus();
      return el.getAttribute('aria-label');
    },
    i,
  );
}

// Clear everything that is not plain floor furniture.
//
// **The first version of this probe skipped this step and could not discriminate at
// all** — identical store values on both builds, to five decimals. A whole-room
// selection is stopped by a wall rider or by a member that could not stand where it
// started, and neither of those can set a slide limit BY DESIGN: a rider's correction
// is `snapToWall` doing its job, and an already-illegal member gets no vote. So the
// set refuses on both builds and the measurement is about a branch neither one takes.
// A fixture that cannot express the defect is the failure this repo keeps finding;
// here it wore a green A/B.
const KEEP = /^(sofa|table|rug|lamp|plant|chair|desk|bed|nightstand|shelf|stool|wardrobe|dresser)/i;
for (let guard = 0; guard < 40; guard++) {
  const labels = await page.$$eval(pieceSel, (els) =>
    els
      .filter((e) => !/Arrow keys move it\.$/.test(e.getAttribute('aria-label') || ''))
      .map((e) => e.getAttribute('aria-label') || ''),
  );
  const idx = labels.findIndex((l) => !KEEP.test(l));
  if (idx === -1) break;
  await focusPiece(idx);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(180);
}
const left = await page.$$eval(pieceSel, (els) =>
  els.filter((e) => !/Arrow keys move it\.$/.test(e.getAttribute('aria-label') || '')).map((e) => e.getAttribute('aria-label')),
);
log('floor pieces left:', left.length, left.map((l) => String(l).replace(/\..*$/, '')).join(' | '));
if (left.length < 2) throw new Error(`only ${left.length} floor piece(s) survived the cull — no set to drag`);

// Drive the piece with the most room, not the first one on the list. **The second
// version of this probe drove the sofa and still could not discriminate**, because
// the sofa is 2.2 m wide and hit its OWN clamp first — an ordinary wall stop, with no
// member limit anywhere in it. § H.8 is specifically the case where a MEMBER runs out
// before the piece under the hand, so the lead has to be the small one.
const LEAD_IDX = left.length - 1;
const focused = await focusPiece(LEAD_IDX);
if (!focused) throw new Error('could not focus a plan piece');
log('driving:', focused);

// The MEMBER, turned 15° off the axis so its own clamp is not a round number. With it
// axis-aligned the clamp was 1.90 — a multiple of both nudge steps — and the two
// builds necessarily agreed.
await focusPiece(0);
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
await focusPiece(0);
await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(500);
log('rotations after the turn:', JSON.stringify((await transforms())?.rotations ?? {}));

// Select everything, and MEASURE that the selection took: `PlanView` marks a selected
// piece with no ARIA attribute at all, so the DOM cannot be asked. One nudge, and
// count how many pieces the store moved.
await focusPiece(LEAD_IDX);
await page.keyboard.press('Control+a');
await page.waitForTimeout(300);
await focusPiece(LEAD_IDX);

const before = (await transforms())?.positions ?? {};
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
const after = (await transforms())?.positions ?? {};
const movedIds = Object.keys(after).filter(
  (id) => !before[id] || before[id][0] !== after[id][0] || before[id][2] !== after[id][2],
);
log('pieces the store moved on one ArrowRight:', movedIds.length);
if (movedIds.length < 2) throw new Error(`one nudge moved ${movedIds.length} piece(s) — Ctrl+A did not produce a SET`);

/** Press until the store stops changing, checking every ten presses so the 300 ms
 *  `RoomSync` debounce is not paid per key. */
async function nudgeUntilStuck(key) {
  let last = JSON.stringify(await transforms());
  let moved = 0;
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press(key);
    if (i % 10 === 9) {
      await page.waitForTimeout(400);
      const now = JSON.stringify(await transforms());
      if (now === last) break;
      last = now;
      moved = i + 1;
    }
  }
  await page.waitForTimeout(600);
  return { presses: moved };
}

const east = await nudgeUntilStuck('ArrowRight', 0);
log('east presses before nothing changed:', east.presses);
const setStop = (await transforms())?.positions ?? {};
// The driven piece is the one that is NOT the turned member.
 const turnedId = Object.keys((await transforms())?.rotations ?? {})[0];
const leadKey = Object.keys(setStop).find((k) => k !== turnedId) ?? Object.keys(setStop)[0];
console.log(`[${label}] === SET STOP (the measurement; the solo phase below only checks the premise) ===`);
for (const [id, pv] of Object.entries(setStop)) console.log(`[${label}]   ${id.padEnd(14)} x ${pv[0].toFixed(6)}  z ${pv[2].toFixed(6)}`);

// The § H.8 premise, measured rather than assumed: collapse the selection to the
// dragged piece alone and drive it again. If it goes further, the set was bounded by
// a MEMBER and not by the piece under the hand — which is the whole report. If it
// does not, this fixture is an ordinary wall stop and nothing below is evidence.
await focusPiece(LEAD_IDX);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await focusPiece(LEAD_IDX);
const solo = await nudgeUntilStuck('ArrowRight', 0);
const soloStop = (await transforms())?.positions ?? {};
log('ALONE, the same piece reaches x =', soloStop[leadKey]?.[0], `(+${solo.presses} presses)`);
const setX = setStop[leadKey]?.[0];
const soloX = soloStop[leadKey]?.[0];
if (typeof setX !== 'number' || typeof soloX !== 'number') throw new Error('lead position missing from the store');
console.log(`[${label}] PREMISE: the set stopped ${(soloX - setX).toFixed(4)} m short of where the lead can go alone`);
if (soloX - setX < 0.02) {
  console.log(`[${label}] WARNING: this fixture did not show a member-bounded set for ${leadKey}; the table below is still printed so the two builds can be compared directly.`);
}
const south = { presses: 0 };

// ---------------------------------------------------------------- what it landed on
//
// No room dimensions are read, and no pixels. A fresh room has **no `:scene` key**
// (nothing has re-detected), so deriving each piece's extent from the store is not
// available — the first version of this asked for one and threw, which is the right
// failure but the wrong question.
//
// What settles the A/B without any of that: the two builds are driven identically
// from the same preset, so the answer is simply HOW FAR EAST the set got. `main`
// refuses the first nudge that would clip any member, so it stops on the nudge
// lattice, up to one step short. The branch slides that last partial step and its
// binding piece ends flush against the wall.
const tf = await transforms();
const pos = tf?.positions ?? {};
const labels = await page.$$eval(pieceSel, (els) =>
  els
    .filter((e) => !/Arrow keys move it\.$/.test(e.getAttribute('aria-label') || ''))
    .map((e) => (e.getAttribute('aria-label') || '').replace(/\..*$/, '')),
);

const xs = Object.entries(pos).map(([id, p]) => ({ id, x: p[0], z: p[2] }));
xs.sort((a, b) => b.x - a.x);
console.log(`
[${label}] === where the set came to rest (m, store values) ===`);
for (const r of xs) console.log(`[${label}]   ${r.id.slice(0, 28).padEnd(30)} x ${r.x.toFixed(5)}  z ${r.z.toFixed(5)}`);
console.log(`[${label}] EASTMOST x = ${xs.length ? xs[0].x.toFixed(5) : 'n/a'}`);
console.log(`[${label}] SOUTHMOST z = ${xs.length ? Math.max(...xs.map((r) => r.z)).toFixed(5) : 'n/a'}`);
console.log(`[${label}] first-nudge step = ${step === null ? 'n/a' : step.toFixed(5)} m`);
if (step) {
  const rem = xs.map((r) => {
    const k = Math.abs(r.x - (baseline[r.id]?.[0] ?? r.x)) / step;
    return Math.abs(k - Math.round(k)) * step;
  });
  console.log(`[${label}] MAX off-lattice remainder = ${Math.max(...rem).toFixed(6)} m  (0 = every piece stopped on the nudge lattice)`);
}
console.log(`[${label}] pieces ${labels.length}, east presses ${east.presses}, south presses ${south.presses}`);
if (errors.length) console.log(`[${label}] console errors:`, errors.slice(0, 3));

await browser.close();
