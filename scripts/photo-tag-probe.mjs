// The scan screen's piece tags, pressed in a real browser. `lib/photo-tag.ts` decides
// where a tag goes and `tests/photo-tag.test.ts` sweeps that rule against a model of the
// layout; this is the check that the model IS the layout — that the flex row, the
// spacer, `clamp()` and the measured photo height do in Chromium what the sweep says.
// No gate runs it, and `scripts/fidelity-sweep.mjs` never opens the scan screen, which is
// how a tag 132 px past the photo on a phone went unseen.
//
// Run: install Playwright OUTSIDE this repo (its own scratch dir, `npm i playwright` then
// `npx playwright install chromium`), exactly as `scripts/rails-probe.mjs` requires and
// for the same reason — it is not a dependency. Point it at a PRODUCTION build, never
// `next dev`:
//
//     cd /some/scratch && npm i playwright && npx playwright install chromium
//     pnpm exec next build && pnpm exec next start -p 3061
//     PORT=3061 PW_ROOT=/some/scratch node scripts/photo-tag-probe.mjs
//
// PW_ROOT is where `playwright` is resolved FROM, because an ESM `import` does not honour
// NODE_PATH. SHOTS names the folder for the screenshots (a temp folder by default).
//
// WHAT IT DOES. Seeds one scanned room — no detector runs — whose boxes sit where tags
// used to go wrong: at the right edge, touching the top, in the top-right corner, thin
// against the right edge, running past the right edge and the foot, flush with the foot,
// wholly past the right edge, as tall as the photo, and one with a name longer than a
// phone is wide. Then, at 360, 768 and 1280 px, it checks:
//
//   · every tag and every box outline is on the photo, on all four sides;
//   · every tag is where its box says — above it, below it or inside its top, starting at
//     its left side or slid only as far as the photo's edge — and all three places occur,
//     so the fixture can express each of them;
//   · neither the review nor the page scrolls sideways, and the review's scroll box was
//     found at all (not finding it used to read as no scroll);
//   · hovering or focusing a list row whose box runs past the photo highlights that box
//     on the photo, and still scrolls nothing sideways;
//   · no box's press area lies over any tag's X — the tags are raised over every box, and
//     at 360 the thin lamp's box sits right under the long name's X;
//   · the thin box at the right edge keeps its whole name (a tag that slides has room);
//   · the small box at the top can still be pressed at its centre, and the press keeps /
//     un-keeps it (its tag sits below it rather than over it);
//   · while drawing a new box, no tag's body takes the press — a drag that starts on one
//     draws — while its X still does, and removes its piece.
//
// The tag rule's numbers are restated below rather than imported from `lib/photo-tag.ts`,
// which is TypeScript and could not be imported here anyway: a probe that read them from
// the rule would agree with the rule by construction.
//
// Tags overlapping EACH OTHER are counted and printed, not failed: they did before this
// change too, and `docs/visual-check.md` carries it as known and not fixed here.
//
// MEASURED, against two production builds. `main` at `fdd1f20`: 40 passed, 80 failed —
// at 360, tags up to 132 px past the right edge, 25 px above the top and 1.8 px below
// the foot, outlines up to 66 px past the right and 37 px past the foot, a list row's
// highlight drawn 66 px off the photo, the review scrolling 116 px sideways (158 px at
// 1280), and a drag that started on a tag drawing nothing. With the fix: 120 passed,
// 0 failed. Overlapping tags went from 5 to 7 on this fixture: the two extra were off
// the photo before, and are on it now, side by side.
//
// The probe was also run against a copy of the fix with two of its parts taken out —
// tags not raised over the boxes, and the X switched off while drawing. It failed five
// checks: a box's press area over Grandmother's X at 360 and 768, and an X that removed
// nothing while drawing, at all three widths. So those two checks can fail.

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
  ['Curtain', 'curtain', 'curtain', [0.6, 0.01, 0.08, 0.98]], // as tall as the photo: tag inside
  ['Plant', 'plant', 'plant', [1.05, 0.5, 0.1, 0.12]], // wholly past the right edge
];
const BOX_OF = Object.fromEntries(PIECES.map(([label, , , box]) => [label, box]));
// Rows hovered and focused: one past the right edge and the foot, one wholly past.
const PAST = ['Bookshelf', 'Plant'];
// lib/photo-tag.ts, restated: the tag's height, and how far it overlaps its box's border.
const TAG_H = 28;
const OVERLAP = 2;
const LIFT = TAG_H - OVERLAP;
// Sub-pixel layout: percentages of a fractional width land on 1/64 px.
const NEAR = 0.75;
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

// Where a tag should be, from its box and the photo alone: `lib/photo-tag.ts`'s rule,
// restated. `photo` is in viewport pixels; `box` in the photo's 0..1 space.
function expectedTag(box, width, photo) {
  const [bx, by, , bh] = box;
  const { w: W, h: H } = photo;
  const unit = (n) => Math.min(1, Math.max(0, n));
  const y0 = unit(by) * H;
  const y1 = Math.max(y0, unit(by + bh) * H);
  const place = y0 >= LIFT ? 'above' : y1 + LIFT <= H ? 'below' : 'inside';
  const at = place === 'above' ? y0 - LIFT : place === 'below' ? y1 - OVERLAP : y0;
  return {
    place,
    left: photo.left + Math.min(Math.max(0, bx) * W, W - Math.min(width, W)),
    top: photo.top + Math.max(0, Math.min(at, H - TAG_H)),
  };
}

// How far the review and the page scroll sideways, and the page's highlight of a box,
// read WITHOUT scrolling anything: a scroll moves the row out from under the pointer,
// and the highlight goes with the hover.
function readOverflow(page) {
  return page.evaluate(() => {
    const img = document.querySelector('img[alt^="Your photo"]');
    const root = img.parentElement;
    let scroller = root.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
    const p = root.getBoundingClientRect();
    const hl = [...root.parentElement.children].find(
      (el) => el !== root && el.getAttribute('aria-hidden') === 'true' && getComputedStyle(el).outlineStyle === 'solid',
    );
    const h = hl?.getBoundingClientRect();
    const doc = document.documentElement;
    return {
      scroller: !!scroller,
      sideways: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
      page: doc.scrollWidth - doc.clientWidth,
      highlight: h
        ? Math.max(p.left - h.left, h.right - p.right, p.top - h.top, h.bottom - p.bottom)
        : null,
    };
  });
}

// Every tag's rectangle, every box's, and the facts the checks need, in viewport pixels.
function readTags(page) {
  return page.evaluate(() => {
    const img = document.querySelector('img[alt^="Your photo"]');
    const root = img.parentElement;
    let scroller = root.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
    // Everything is read in one moment, before the cover check below scrolls anything.
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
    };
    const buttons = [...root.querySelectorAll('button[aria-label^="Remove "]')];
    const tags = buttons.map((x) => {
      const tag = x.parentElement;
      const name = tag.querySelector('span');
      return {
        name: x.getAttribute('aria-label').slice('Remove '.length),
        rect: rect(tag),
        ellipsised: name.scrollWidth > name.clientWidth + 0.5,
        pointerEvents: getComputedStyle(tag).pointerEvents,
        xPointerEvents: getComputedStyle(x).pointerEvents,
      };
    });
    // The keep toggles fill their boxes; the box is the toggle's parent.
    const boxes = [...root.querySelectorAll('button[aria-pressed]')].map((b) => ({
      name: b.getAttribute('aria-label').split(', ')[0],
      rect: rect(b.parentElement),
    }));
    const photo = rect(root);
    // Is anything else on top of each X? Scrolled into view first, or a tag at the foot
    // of a photo taller than its scroll box reads as covered by whatever is below it —
    // and put back afterwards, so the next reading starts where this one did.
    const was = { x: scrollX, y: scrollY, left: scroller?.scrollLeft ?? 0, top: scroller?.scrollTop ?? 0 };
    buttons.forEach((x, i) => {
      x.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const xr = x.getBoundingClientRect();
      const hit = document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2);
      // A box's toggle over an X is a defect (the tags are raised over every box);
      // another tag over it is the overlap this change does not fix.
      tags[i].xUnder = hit === x || x.contains(hit) ? null : hit?.closest('button[aria-pressed]') ? 'box' : 'tag';
    });
    scroller?.scrollTo(was.left, was.top);
    scrollTo(was.x, was.y);
    return { photo, tags, boxes };
  });
}

// Measured from the photo's own edges: how far a rectangle runs past each one.
function pastPhoto(rect, photo) {
  const out = { left: photo.left - rect.left, right: rect.right - photo.right, top: photo.top - rect.top, bottom: rect.bottom - photo.bottom };
  return Object.entries(out).filter(([, v]) => v > 0.5).map(([k, v]) => ` · ${k} +${v.toFixed(1)}px`).join('');
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

    const places = new Set();
    for (const t of r.tags) {
      const name = t.name.slice(0, 30);
      check(!pastPhoto(t.rect, photo), `${name} is on the photo${pastPhoto(t.rect, photo)}`);
      const want = expectedTag(BOX_OF[t.name], t.rect.w, photo);
      places.add(want.place);
      const dx = t.rect.left - want.left;
      const dy = t.rect.top - want.top;
      check(
        Math.abs(dx) <= NEAR && Math.abs(dy) <= NEAR,
        `${name} sits ${want.place} its box${Math.abs(dx) > NEAR ? ` · across ${dx.toFixed(1)}px` : ''}${Math.abs(dy) > NEAR ? ` · down ${dy.toFixed(1)}px` : ''}`,
      );
    }
    check(places.size === 3, `the fixture puts a tag above, below and inside a box (${[...places].join(', ')})`);
    for (const b of r.boxes) check(!pastPhoto(b.rect, photo), `${b.name.slice(0, 30)}'s outline is on the photo${pastPhoto(b.rect, photo)}`);
    const o = await readOverflow(page);
    check(o.scroller, "the review's scroll box was found");
    check(o.sideways <= 0 && o.page <= 0, `neither the review nor the page scrolls sideways (${o.sideways}px, ${o.page}px)`);

    // A list row whose box runs past the photo, hovered and then focused: the page draws
    // that box a second time, as a highlight, and that one read the raw box.
    for (const name of PAST) {
      const keep = page.locator(`button[aria-label="Keep ${name}"]`);
      await keep.hover();
      await page.waitForTimeout(100);
      const hover = await readOverflow(page);
      await page.mouse.move(1, 1);
      await keep.focus();
      await page.waitForTimeout(100);
      const focus = await readOverflow(page);
      await keep.blur();
      for (const [how, h] of [
        ['hovering', hover],
        ['focusing', focus],
      ])
        check(
          h.highlight !== null && h.highlight <= 0.5 && h.sideways <= 0 && h.page <= 0,
          `${how} ${name}'s row highlights its box on the photo, and scrolls nothing sideways` +
            ` (${h.highlight === null ? 'no highlight' : `highlight ${h.highlight > 0.5 ? `+${h.highlight.toFixed(1)}px past` : 'on the photo'}`}, ${h.sideways}px, ${h.page}px)`,
        );
    }

    const thin = r.tags.find((t) => t.name === THIN);
    check(!!thin && !thin.ellipsised, `${THIN}, thin at the right edge, keeps its whole name`);

    // The small box at the top: its centre is its own toggle, and pressing it answers.
    const toggle = page.locator(`button[aria-label^="${SMALL_TOP}, "]`);
    const before = await toggle.getAttribute('aria-pressed');
    // Back into view first: on a phone the rows above sit below the photo, and focusing
    // one scrolls the photo away.
    await toggle.scrollIntoViewIfNeeded();
    const tb = await toggle.boundingBox();
    const own = await page.evaluate(
      ([x, y, label]) => document.elementFromPoint(x, y)?.getAttribute('aria-label')?.startsWith(`${label}, `) ?? false,
      [tb.x + tb.width / 2, tb.y + tb.height / 2, SMALL_TOP],
    );
    await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
    const after = await toggle.getAttribute('aria-pressed');
    check(
      own && before !== after,
      `${SMALL_TOP}, small at the top, answers a press at its centre (${own ? 'its own toggle' : 'something else'} there, ${before} → ${after})`,
    );

    for (let i = 0; i < r.tags.length; i++)
      for (let j = i + 1; j < r.tags.length; j++) {
        const a = r.tags[i].rect,
          b = r.tags[j].rect;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          overlaps++;
          log(`  info tags overlap: ${r.tags[i].name.slice(0, 20)} / ${r.tags[j].name.slice(0, 20)}`);
        }
      }
    const underBox = r.tags.filter((t) => t.xUnder === 'box').map((t) => t.name.slice(0, 20));
    check(underBox.length === 0, `no box's press area lies over a tag's X${underBox.length ? ` · ${underBox.join(', ')}` : ''}`);
    const underTag = r.tags.filter((t) => t.xUnder === 'tag').map((t) => t.name.slice(0, 20));
    if (underTag.length) log(`  info X under another tag: ${underTag.join(', ')}`);
    await page.screenshot({ path: join(SHOTS, `tags-${vw}.png`) });

    // Drawing: no tag takes the press, so a drag that starts on one draws a box.
    await page.getByRole('button', { name: /Add a piece by hand|Adding by hand/ }).first().click();
    const drawing = await readTags(page);
    check(
      drawing.tags.every((t) => t.pointerEvents === 'none' && t.xPointerEvents === 'auto'),
      "while drawing, every tag's body lets the press through, and every X takes its own",
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
    // …and an X, pressed while drawing, removes its piece rather than starting a box.
    // Playwright's click refuses an X that something else is over, which is the point.
    let pressed = true;
    // Scoped to the photo: the list beside it has a "Remove Armchair" of its own.
    await page
      .locator('div:has(> img[alt^="Your photo"]) button[aria-label="Remove Armchair"]')
      .click({ timeout: 3000 })
      .catch(() => (pressed = false));
    await page.waitForTimeout(300);
    const n2 = (await readTags(page)).tags.length;
    check(pressed && n2 === n1 - 1, `while drawing, a tag's X removes its piece (${n1} → ${n2} pieces)`);
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
