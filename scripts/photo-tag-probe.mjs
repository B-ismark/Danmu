// The scan screen's piece tags, pressed in a real browser. `lib/photo-tag.ts` decides
// where a tag goes and `tests/photo-tag.test.ts` sweeps that rule against a model of the
// layout; this is the check that the model IS the layout — that the flex row, the
// spacer, `clamp()` and the measured photo height do in Chromium what the sweep says.
// No gate runs it, and `scripts/fidelity-sweep.mjs` never opens the scan screen, which is
// how a tag 92 px past the photo on every phone went unseen.
//
// Run: install Playwright OUTSIDE this repo (its own scratch dir, `npm i playwright`),
// exactly as `scripts/rails-probe.mjs` requires and for the same reason — it is not a
// dependency. Point it at a PRODUCTION build, never `next dev`:
//
//     cd /some/scratch && npm i playwright
//     pnpm exec next build && pnpm exec next start -p 3061
//     PORT=3061 PW_ROOT=/some/scratch node scripts/photo-tag-probe.mjs
//
// PW_ROOT is where `playwright` is resolved FROM, because an ESM `import` does not honour
// NODE_PATH. SHOTS names the folder for the screenshots (a temp folder by default).
//
// WHAT IT DOES. Seeds one scanned room — no detector runs — whose boxes sit where tags
// used to go wrong: at the right edge, touching the top, in the top-right corner, thin
// against the right edge, running past the right edge and the foot, flush with the foot,
// and one with a name longer than a phone is wide. Then, at 360, 768 and 1280 px, it
// checks:
//
//   · every tag is on the photo, on all four sides, and the review never scrolls sideways;
//   · the thin box at the right edge keeps its whole name (a tag that slides has room);
//   · the small box at the top can still be pressed at its centre, and the press keeps /
//     un-keeps it (its tag sits below it rather than over it);
//   · while drawing a new box, no tag takes the press — a drag that starts on one draws.
//
// Tags overlapping EACH OTHER are counted and printed, not failed: they did before this
// change too, and `docs/visual-check.md` carries it as known and not fixed here.
//
// MEASURED, against two production builds. `main` at `fdd1f20`: 10 passed, 26 failed —
// tags up to 132 px past the right edge, 25 px above the top, 1.8 px below the foot, the
// review scrolling 116 px sideways at 360, and a drag that started on a tag drawing
// nothing. With the fix: 36 passed, 0 failed. Overlapping tags went from 2 to 4 on this
// fixture: the two extra were off the photo before, and are on it now, side by side.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
      '    PORT=3061 PW_ROOT=/some/scratch node scripts/photo-tag-probe.mjs',
  );
  process.exit(2);
}

const PORT = Number(process.env.PORT || 3061);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || join(tmpdir(), 'photo-tag-probe');
const VIEWPORTS = [
  [360, 780],
  [768, 1024],
  [1280, 900],
];

// [label, category, shape, box] — boxes in the photo's 0..1 space, as detections are.
const PIECES = [
  ['Armchair', 'chair', 'chair-armchair', [0.82, 0.62, 0.18, 0.2]], // at the right edge
  ['Pendant light', 'lamp', 'lamp-pendant', [0.05, 0, 0.12, 0.15]], // small, touching the top
  ["Grandmother's reading armchair by the window", 'chair', 'chair-armchair', [0.02, 0.4, 0.2, 0.15]],
  ['Picture', 'painting', 'painting', [0.9, 0, 0.1, 0.12]], // the top-right corner
  ['Floor lamp', 'lamp', 'lamp-floor', [0.95, 0.3, 0.03, 0.25]], // thin, at the right edge
  ['Bookshelf', 'shelf', 'bookshelf', [0.8, 0.85, 0.4, 0.3]], // past the right edge and the foot
  ['Air conditioner', 'ac', 'ac-unit', [0.4, 0.995, 0.1, 0.05]], // at the very foot
];
const THIN = 'Floor lamp';
const SMALL_TOP = 'Pendant light';

const log = (...a) => console.log(...a);
let pass = 0,
  fail = 0;
function check(ok, what) {
  if (ok) pass++;
  else fail++;
  log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

async function seed(page) {
  await page.goto(BASE);
  await page.evaluate(async (pieces) => {
    const c = new OffscreenCanvas(1600, 1200);
    const g = c.getContext('2d');
    g.fillStyle = '#d8cfc0';
    g.fillRect(0, 0, 1600, 1200);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const detectedObjects = pieces.map(([label, category, shape, box], i) => ({
      id: i,
      uid: `p${i}`,
      label: `${label}__slot:n`,
      conf: 0.9,
      source: 'local',
      locked: true,
      box,
      category,
      shape,
      dimMM: [800, 800, 800],
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
    }));
    const meta = { id: 'tagprobe', createdAt: 1, name: 'Tags', layoutId: 'rect', width: 5, depth: 4, height: 2.7, version: 2, detectedObjects };
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('keyval-store');
      r.onupgradeneeded = () => r.result.createObjectStore('keyval');
      r.onsuccess = () => res(r.result);
      r.onerror = rej;
    });
    await new Promise((res) => {
      const tx = db.transaction('keyval', 'readwrite');
      const s = tx.objectStore('keyval');
      s.put(meta, 'room:tagprobe:meta');
      s.put({ slot: 'n', blob, takenAt: 1 }, 'room:tagprobe:cap:n');
      s.put(Date.now(), 'room:tagprobe:touched');
      tx.oncomplete = res;
    });
    localStorage.setItem('danmu-room', JSON.stringify({ state: { roomId: 'tagprobe' }, version: 0 }));
  }, PIECES);
  await page.goto(BASE + '/onboarding/detect');
  await page.waitForSelector('img[alt^="Your photo"]', { timeout: 20000 });
  await page.waitForFunction((n) => document.querySelectorAll('button[aria-label^="Remove "]').length >= n, PIECES.length, {
    timeout: 20000,
  });
  // One frame for the ResizeObserver's height to arrive and the tags to settle.
  await page.waitForTimeout(500);
}

// Every tag's rectangle, and the facts the checks need, in viewport pixels.
function readTags(page) {
  return page.evaluate(() => {
    const img = document.querySelector('img[alt^="Your photo"]');
    const photo = img.parentElement.getBoundingClientRect();
    let scroller = img.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
    const tags = [...img.parentElement.querySelectorAll('button[aria-label^="Remove "]')].map((x) => {
      const tag = x.parentElement;
      const r = tag.getBoundingClientRect();
      const name = tag.querySelector('span');
      return {
        name: x.getAttribute('aria-label').slice('Remove '.length),
        rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        ellipsised: name.scrollWidth > name.clientWidth + 0.5,
        pointerEvents: getComputedStyle(tag).pointerEvents,
      };
    });
    // Is anything else on top of each X? Scrolled into view first, or a tag at the foot
    // of a photo taller than its scroll box reads as covered by whatever is below it.
    const buttons = [...img.parentElement.querySelectorAll('button[aria-label^="Remove "]')];
    buttons.forEach((x, i) => {
      x.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const xr = x.getBoundingClientRect();
      const hit = document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2);
      tags[i].xCovered = hit !== x && !x.contains(hit);
    });
    if (scroller) scroller.scrollTo(0, 0);
    return {
      photo: { left: photo.left, right: photo.right, top: photo.top, bottom: photo.bottom, w: photo.width, h: photo.height },
      sideways: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      tags,
    };
  });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let overlaps = 0;
  for (const [vw, vh] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 700 });
    const page = await ctx.newPage();
    await seed(page);
    const r = await readTags(page);
    const { photo } = r;
    log(`\n${vw}×${vh} · photo ${Math.round(photo.w)}×${Math.round(photo.h)}`);

    for (const t of r.tags) {
      const out = {
        left: photo.left - t.rect.left,
        right: t.rect.right - photo.right,
        top: photo.top - t.rect.top,
        bottom: t.rect.bottom - photo.bottom,
      };
      const past = Object.entries(out).filter(([, v]) => v > 0.5);
      check(past.length === 0, `${t.name.slice(0, 30)} is on the photo${past.map(([k, v]) => ` · ${k} +${v.toFixed(1)}px`).join('')}`);
    }
    check(r.sideways <= 0, `the review does not scroll sideways (${r.sideways}px)`);

    const thin = r.tags.find((t) => t.name === THIN);
    check(!!thin && !thin.ellipsised, `${THIN}, thin at the right edge, keeps its whole name`);

    // The small box at the top: its centre is its own toggle, and pressing it answers.
    const toggle = page.locator(`button[aria-label^="${SMALL_TOP}, "]`);
    const before = await toggle.getAttribute('aria-pressed');
    const tb = await toggle.boundingBox();
    const own = await page.evaluate(
      ([x, y, label]) => document.elementFromPoint(x, y)?.getAttribute('aria-label')?.startsWith(`${label}, `) ?? false,
      [tb.x + tb.width / 2, tb.y + tb.height / 2, SMALL_TOP],
    );
    await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
    const after = await toggle.getAttribute('aria-pressed');
    check(own && before !== after, `${SMALL_TOP}, small at the top, answers a press at its centre (${before} → ${after})`);

    for (let i = 0; i < r.tags.length; i++)
      for (let j = i + 1; j < r.tags.length; j++) {
        const a = r.tags[i].rect,
          b = r.tags[j].rect;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          overlaps++;
          log(`  info tags overlap: ${r.tags[i].name.slice(0, 20)} / ${r.tags[j].name.slice(0, 20)}`);
        }
      }
    const covered = r.tags.filter((t) => t.xCovered).map((t) => t.name.slice(0, 20));
    if (covered.length) log(`  info X under another tag: ${covered.join(', ')}`);
    await page.screenshot({ path: join(SHOTS, `tags-${vw}.png`) });

    // Drawing: no tag takes the press, so a drag that starts on one draws a box.
    await page.getByRole('button', { name: /Add a piece by hand|Adding by hand/ }).first().click();
    const drawing = await readTags(page);
    check(
      drawing.tags.every((t) => t.pointerEvents === 'none'),
      'while drawing, every tag lets the press through',
    );
    const longTag = drawing.tags.find((t) => t.name.startsWith('Grandmother'));
    const from = { x: longTag.rect.left + 20, y: (longTag.rect.top + longTag.rect.bottom) / 2 };
    const n0 = drawing.tags.length;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + photo.w * 0.2, from.y + photo.h * 0.2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    // Counted on the photo: the list beside it carries its own Remove buttons.
    const n1 = (await readTags(page)).tags.length;
    check(n1 === n0 + 1, `a drag that starts on a tag draws a new box (${n0} → ${n1} pieces)`);
    await ctx.close();
  }
  await browser.close();
  log(`\n${pass} passed, ${fail} failed · ${overlaps} tag overlap(s), known and not fixed here`);
  log(`  screenshots in ${SHOTS}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('PROBE ERROR', e.message);
  process.exit(2);
});
