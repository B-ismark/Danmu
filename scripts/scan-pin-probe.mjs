// The scan screen with a long list, scrolled to its end in a real browser. The list of
// found pieces is where a person works down the room one piece at a time, and the photo
// is how they tell which box is which — so the photo has to be on screen at the END of
// the list, not only at its top. It was not: the page grew with the list, the photo
// scrolled away with it, and on a phone a finger on the photo could not scroll anything
// at all, drawing mode or not.
//
// No gate runs it. Run it the way `scripts/photo-tag-probe.mjs` says — Playwright
// installed OUTSIDE this repo, against a PRODUCTION build:
//
//     PORT=3061 PW_ROOT=/some/scratch node scripts/scan-pin-probe.mjs
//
// WHAT IT DOES. Seeds one scanned room — no detector runs — with sixteen pieces over four
// walls, landscape photos on two of them and portrait ones on the other two, and at each
// viewport:
//
//   · scrolls to the end of the page, and checks the photo is on screen and whole —
//     inside the window and inside every box round it that clips — that the last row of
//     the list is on screen and not under it, and that no box between the photo and the
//     page can scroll on its own, which would take a swipe for itself;
//   · walks keyboard focus back up the list and checks none of it lands under the photo;
//   · turns on "Add a piece by hand", which grows the tool row, and checks the photo is
//     still whole with nothing scrolling on its own, and that "Place with the keyboard",
//     which focuses a button in the pinned column, leaves the page where it was;
//   · on a touch screen, swipes up starting ON the photo while nothing is being drawn,
//     and checks the page scrolled;
//   · turns on "Add a piece by hand" and drags on the photo, and checks that drew a box
//     rather than scrolling the page;
//   · checks the page does not scroll sideways.
//
// The swipe is raw touch events over CDP (`Input.dispatchTouchEvent`), which honour
// `touch-action` the way a finger does — checked on a bare page, where a swipe started
// on `touch-action: none` moves nothing and one on `manipulation` scrolls. Two others
// were tried and are wrong here: a Playwright mouse wheel scrolls straight through
// `touch-action: none`, and Chromium's synthesized touch scroll gesture does nothing at
// all in the headless shell, so every swipe check built on it fails on every page —
// which is why a control swipe on the list comes first, and a list that does not move
// reads as the probe's failure rather than the photo's.
//
// MEASURED — see the pull request that added this file.

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
      '    PORT=3061 PW_ROOT=/some/scratch node scripts/scan-pin-probe.mjs',
  );
  process.exit(2);
}

const PORT = Number(process.env.PORT || 3061);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || join(tmpdir(), 'scan-pin-probe');
// [width, height, touch, how much of the photo must be on screen at the list's end]
const VIEWPORTS = [
  [360, 640, true, 1],
  [390, 844, true, 1],
  // A phone on its side, where the pinned column is tightest.
  [844, 390, true, 1],
  [768, 1024, true, 1],
  // A laptop window narrowed until the list stacks: the likeliest place for a keyboard.
  [700, 800, false, 1],
  [1280, 800, false, 1],
  [1920, 900, false, 1],
];

// [label, category, shape, box, slot] — ten on the first wall, which is the one the
// screen opens on, and two on each of the other three. Four walls, because the capture
// screen asks for four: with four, the wall buttons wrap to a second row on a phone and
// on a phone on its side, which two walls never did, and that row is height the pinned
// column has to find.
const PIECES = [
  ['Sofa', 'sofa', 'sofa', [0.1, 0.55, 0.45, 0.3], 'n'],
  ['Armchair', 'chair', 'chair-armchair', [0.62, 0.55, 0.18, 0.28], 'n'],
  ['Coffee table', 'table', 'coffee-table', [0.3, 0.78, 0.25, 0.12], 'n'],
  ['Floor lamp', 'lamp', 'lamp-floor', [0.85, 0.3, 0.05, 0.55], 'n'],
  ['Picture', 'painting', 'painting', [0.25, 0.15, 0.2, 0.18], 'n'],
  ['Plant', 'plant', 'plant', [0.02, 0.45, 0.08, 0.35], 'n'],
  ['Rug', 'rug', 'rug', [0.15, 0.82, 0.6, 0.15], 'n'],
  ['Side table', 'table', 'side-table', [0.56, 0.68, 0.07, 0.14], 'n'],
  ['Curtain', 'curtain', 'curtain', [0.9, 0.02, 0.09, 0.9], 'n'],
  ['Pendant light', 'lamp', 'lamp-ceiling', [0.4, 0, 0.1, 0.12], 'n'],
  ['Bookshelf', 'shelf', 'bookshelf', [0.1, 0.2, 0.3, 0.7], 'e'],
  ['Desk', 'desk', 'desk-standard', [0.45, 0.55, 0.45, 0.25], 'e'],
  ['Desk chair', 'chair', 'chair-office', [0.55, 0.6, 0.2, 0.3], 's'],
  ['Shoe rack', 'shelf', 'shoe-rack', [0.5, 0.75, 0.35, 0.2], 's'],
  ['Mirror', 'mirror', 'mirror', [0.05, 0.1, 0.12, 0.3], 'w'],
  ['Air conditioner', 'ac', 'ac-unit', [0.55, 0.05, 0.3, 0.1], 'w'],
];

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
    const photo = async (w, h) => {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d');
      g.fillStyle = '#d8cfc0';
      g.fillRect(0, 0, w, h);
      return c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    };
    const detectedObjects = pieces.map(([label, category, shape, box, slot], i) => ({
      id: i,
      uid: `p${i}`,
      label: `${label}__slot:${slot}`,
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
    const meta = { id: 'pinprobe', createdAt: 1, name: 'Pin', layoutId: 'rect', width: 5, depth: 4, height: 2.7, version: 2, detectedObjects };
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('keyval-store');
      r.onupgradeneeded = () => r.result.createObjectStore('keyval');
      r.onsuccess = () => res(r.result);
      r.onerror = rej;
    });
    // Landscape and portrait in turn, as a phone turned between walls gives them.
    const shots = [];
    for (const [i, slot] of ['n', 'e', 's', 'w'].entries()) shots.push([slot, await photo(i % 2 ? 900 : 1600, 1200), i + 1]);
    await new Promise((res) => {
      const tx = db.transaction('keyval', 'readwrite');
      const s = tx.objectStore('keyval');
      s.put(meta, 'room:pinprobe:meta');
      for (const [slot, blob, takenAt] of shots) s.put({ slot, blob, takenAt }, `room:pinprobe:cap:${slot}`);
      s.put(Date.now(), 'room:pinprobe:touched');
      tx.oncomplete = res;
    });
    localStorage.setItem('danmu-room', JSON.stringify({ state: { roomId: 'pinprobe' }, version: 0 }));
  }, PIECES);
  await page.goto(BASE + '/onboarding/detect');
  await page.waitForSelector('img[alt^="Your photo"]', { timeout: 20000 });
  await page.waitForFunction(
    (n) => document.querySelectorAll('.rail--right .list > *').length >= n,
    PIECES.length,
    { timeout: 20000 },
  );
  await page.waitForTimeout(500);
}

/** Where things are, in viewport pixels, after whatever the caller just did. */
async function read(page) {
  return page.evaluate(() => {
    const img = document.querySelector('img[alt^="Your photo"]');
    const rows = [...document.querySelectorAll('.rail--right .list > *')];
    const r = img.getBoundingClientRect();
    const last = rows[rows.length - 1].getBoundingClientRect();
    // A row that is on screen and not under anything pinned, for the control swipe.
    const free = rows
      .map((el) => [el, el.getBoundingClientRect()])
      .find(([el, b]) => b.top >= 0 && b.bottom <= innerHeight && el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)));
    const row = free ? { left: free[1].left, top: free[1].top, w: free[1].width, h: free[1].height } : { left: 0, top: 0, w: 0, h: 0 };
    // What is painted at the last row's middle: the row, or something pinned over it.
    const mid = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
    // On screen means inside the window AND inside every box above it that clips —
    // a photo cut off by its own frame is not shown, wherever the window is.
    let [t, b, l, rt] = [0, innerHeight, 0, innerWidth];
    let inner = null;
    for (let el = img.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
      const c = el.getBoundingClientRect();
      [t, b, l, rt] = [Math.max(t, c.top), Math.min(b, c.bottom), Math.max(l, c.left), Math.min(rt, c.right)];
      // A box between the photo and the page that can scroll takes a swipe started on
      // the photo for itself, however little it has to scroll.
      if (!inner && /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) inner = `${el.scrollHeight - el.clientHeight}px`;
    }
    const vis = Math.max(0, Math.min(r.bottom, b) - Math.max(r.top, t)) * Math.max(0, Math.min(r.right, rt) - Math.max(r.left, l));
    return {
      photo: { left: r.left, top: r.top, w: r.width, h: r.height },
      shown: r.width * r.height > 0 ? vis / (r.width * r.height) : 0,
      last: { top: last.top, bottom: last.bottom },
      lastOnTop: !!mid && rows[rows.length - 1].contains(mid),
      scrollY: scrollY,
      maxY: document.scrollingElement.scrollHeight - innerHeight,
      sideways: document.scrollingElement.scrollWidth - innerWidth,
      rows: rows.length,
      row,
      inner,
    };
  });
}

/** The element at (x, y) and its ancestors, each with its `touch-action` where that is
 *  not `auto`, innermost first. */
async function under(page, x, y) {
  return page.evaluate(([x, y]) => {
    const out = [];
    for (let el = document.elementFromPoint(x, y); el && el !== document.documentElement; el = el.parentElement) {
      const t = getComputedStyle(el).touchAction;
      const name = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      out.push(t === 'auto' ? name : `${name}[${t}]`);
    }
    return out.slice(0, 8).join(' < ');
  }, [x, y]);
}

/** Focus the list's last control, then walk back up it with Shift+Tab, counting the
 *  controls focus lands on that are off screen or under something else there. */
async function focusWalk(page) {
  await page.evaluate(() => {
    const f = [...document.querySelectorAll('.rail--right .list :is(button, input)')];
    f[f.length - 1].focus();
  });
  let total = 0,
    hidden = 0;
  for (let k = 0; k < 40; k++) {
    await page.keyboard.press('Shift+Tab');
    const seen = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || !a.closest('.rail--right .list')) return null;
      const b = a.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!top && (a === top || a.contains(top));
    });
    if (seen === null) break;
    total++;
    if (!seen) hidden++;
  }
  return { total, hidden };
}

/** A finger from (x, y) moving `dy` pixels (negative is up, which scrolls the page
 *  down), in ten steps. */
async function swipe(page, cdp, x, y, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 10 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [vw, vh, touch, need] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch, isMobile: touch && vw < 700 });
    const page = await ctx.newPage();
    await seed(page);
    log(`\n${vw}×${vh}${touch ? ' · touch' : ''}`);

    // The end of the list: where the photo used to have gone.
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForTimeout(300);
    const end = await read(page);
    await page.screenshot({ path: join(SHOTS, `end-${vw}x${vh}.png`) });
    check(
      end.shown >= need - 0.005,
      `at the end of the list the photo is on screen (${Math.round(end.shown * 100)}% of ${Math.round(end.photo.w)}×${Math.round(end.photo.h)}, needs ${Math.round(need * 100)}%)`,
    );
    check(end.last.bottom <= vh + 0.5 && end.last.top >= 0, `the last row is on screen (${Math.round(end.last.top)}–${Math.round(end.last.bottom)} of ${vh})`);
    check(end.lastOnTop, 'the last row is not under the photo');
    check(end.sideways <= 0, `the page does not scroll sideways (${end.sideways}px)`);
    check(!end.inner, `nothing between the photo and the page scrolls on its own${end.inner ? ` (${end.inner} of it)` : ''}`);
    // Stacked, the rows scroll under the pinned strip, and a row that focus scrolls to
    // the top of the window went under it with nothing to say where focus was.
    const walk = await focusWalk(page);
    check(walk.total > 20 && walk.hidden === 0, `walking focus back up the list, none of it is under the photo (${walk.hidden} of ${walk.total} hidden)`);

    // Adding by hand grows the tool row under the photo by a line or two — a picker, a
    // button and a hint — and the pinned column still has to fit. Pressed through the
    // DOM rather than Playwright's click, which scrolls a target into view first and
    // would move the very page this is watching.
    const press = (name) =>
      page.evaluate((name) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name).click(), name);
    await press('Add a piece by hand');
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForTimeout(300);
    const adding = await read(page);
    check(
      adding.shown >= need - 0.005,
      `while adding by hand, the photo is whole on screen (${Math.round(adding.shown * 100)}% of ${Math.round(adding.photo.w)}×${Math.round(adding.photo.h)})`,
    );
    check(!adding.inner, `while adding by hand, nothing between the photo and the page scrolls on its own${adding.inner ? ` (${adding.inner} of it)` : ''}`);
    // "Place with the keyboard" moves focus to "Add this box", which is IN the pinned
    // column: nothing about that should move the list the person is part-way down.
    await press('Place with the keyboard');
    await page.waitForTimeout(300);
    const placing = await read(page);
    const focused = await page.evaluate(() => document.activeElement?.textContent.trim());
    check(
      focused === 'Add this box' && Math.abs(placing.scrollY - adding.scrollY) <= 1,
      `placing with the keyboard focuses "Add this box" and leaves the page where it was (${Math.round(adding.scrollY)} → ${Math.round(placing.scrollY)}px)`,
    );
    await page.keyboard.press('Escape');
    await press('Adding by hand');

    if (touch) {
      // A swipe that starts on the photo, with nothing being drawn, is a scroll. The
      // photo is brought on screen first — on a phone on its side it starts below the
      // fold — and each swipe goes whichever way the page has room to move. The list
      // is swiped first, as the control: if it does not move, nothing below means much.
      const cdp = await ctx.newCDPSession(page);
      const swipeFrom = async (pick, what) => {
        await page.evaluate(() => document.querySelector('img[alt^="Your photo"]').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        const at = await read(page);
        // Not a pass: a page with nothing to scroll has said nothing about the photo.
        if (at.maxY <= 40) return log(`  skip ${what}: nothing to scroll (${at.maxY}px of page)`);
        const [x, y] = pick(at);
        const up = at.maxY - at.scrollY > 60;
        const room = Math.min(150, up ? at.maxY - at.scrollY : at.scrollY);
        await swipe(page, cdp, x, y, up ? -room : room);
        const after = await read(page);
        const ok = Math.abs(after.scrollY - at.scrollY) > 20;
        check(ok, `${what} scrolls the page (${Math.round(at.scrollY)} → ${Math.round(after.scrollY)}px)`);
        // On a failure, name what was under the finger and every touch-action above it,
        // because "the page did not move" does not say which box claimed the gesture.
        if (!ok) log(`       under the finger at ${Math.round(x)},${Math.round(y)}: ${await under(page, x, y)}`);
      };
      await swipeFrom(
        (at) => [at.row.left + at.row.w / 2, (Math.max(at.row.top, 0) + Math.min(at.row.top + at.row.h, vh)) / 2],
        'control: a swipe on the list',
      );
      await swipeFrom(
        (at) => [at.photo.left + at.photo.w / 2, (Math.max(at.photo.top, 0) + Math.min(at.photo.top + at.photo.h, vh)) / 2],
        'a swipe that starts on the photo',
      );

      // …and while adding by hand, the same finger draws a box instead.
      await page.getByRole('button', { name: 'Add a piece by hand' }).click();
      await page.evaluate(() => document.querySelector('img[alt^="Your photo"]').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(200);
      const before = await read(page);
      const p = before.photo;
      const x0 = p.left + p.w * 0.3;
      const y0 = Math.max(p.top, 0) + (Math.min(p.top + p.h, vh) - Math.max(p.top, 0)) * 0.3;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 12, y: y0 + i * 10 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
      const drawn = await read(page);
      check(drawn.rows === before.rows + 1, `adding by hand, a drag on the photo draws a box (${before.rows} → ${drawn.rows} pieces)`);
      check(Math.abs(drawn.scrollY - before.scrollY) <= 1, `…and does not scroll the page (${Math.round(before.scrollY)} → ${Math.round(drawn.scrollY)}px)`);
    }
    await ctx.close();
  }
  await browser.close();
  log(`\n${pass} passed, ${fail} failed`);
  log(`  screenshots in ${SHOTS}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('PROBE ERROR', e.message);
  process.exit(2);
});
