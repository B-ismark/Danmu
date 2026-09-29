// The scan screen's "Runs past the edge of the photo" note, pressed in a real browser.
// `lib/label-repair.ts` decides which axes a box the frame cut could not measure and
// `tests/label-repair.test.ts` holds that rule; this is the check that the row says it,
// on the rows the frame cut and on no others, and that the note fits its row at phone
// width rather than crowding the tick or the ✕. No gate runs it.
//
// Run: install Playwright OUTSIDE this repo, exactly as `scripts/photo-tag-probe.mjs`
// describes, and point it at a PRODUCTION build:
//
//     pnpm exec next build && pnpm exec next start -p 3061
//     PORT=3061 PW_ROOT=/some/scratch node scripts/cut-note-probe.mjs
//
// It seeds one scanned room — no detector runs — with nine boxes on one photo: four
// touching a side or the top (the left side twice, the right side, the top-left corner, the
// first of them also reaching the foot), two standing on the bottom edge and seen whole
// across — a sofa, and a tall piece called a nightstand, whose "Measured" sentence must say
// its numbers are estimates — and three well inside. The one-word "Bed" sits beside a
// "Double bed", so a row is found by its own name.
// VP='[[w,h],…]' narrows the widths, DUMP=1 prints each row's text, SHOTS names the
// screenshot folder (a temp folder by default).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const req = createRequire(join(process.env.PW_ROOT, 'probe.cjs'));
const { chromium } = req('playwright');
const BASE = `http://localhost:${process.env.PORT || 3061}`;
const SHOTS = process.env.SHOTS || join(tmpdir(), 'cut-note-probe');
mkdirSync(SHOTS, { recursive: true });
// [label, category, shape, box, expected note word or null]
const PIECES = [
  ['Wardrobe', 'wardrobe', 'wardrobe', [0, 0.3, 0.3, 0.7], 'size'],
  ['Picture', 'painting', 'painting', [0, 0, 0.25, 0.25], 'size'],
  ['Curtain', 'curtain', 'curtain', [0.88, 0.02, 0.12, 0.9], 'width'],
  ['Sofa', 'sofa', 'sofa', [0.3, 0.62, 0.4, 0.38], 'size'],
  ['Nightstand', 'nightstand', 'nightstand', [0.72, 0.1, 0.12, 0.9], 'size'],
  ['Double bed', 'bed', 'bed-double', [0.3, 0.5, 0.4, 0.4], null],
  ['Floor lamp', 'lamp', 'lamp-floor', [0.8, 0.3, 0.05, 0.5], null],
  ['Mirror', 'mirror', 'mirror', [0.4, 0.1, 0.15, 0.3], null],
  ['Bed', 'bed', undefined, [0, 0.4, 0.2, 0.2], 'width'],
];
const VIEWPORTS = (process.env.VP ? JSON.parse(process.env.VP) : [[360, 640], [390, 844], [768, 1024], [1280, 800]]);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const browser = await chromium.launch();
for (const [w, h] of VIEWPORTS) {
  console.log(`${w}x${h}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(async (pieces) => {
    const c = new OffscreenCanvas(1600, 1200);
    const g = c.getContext('2d'); g.fillStyle = '#d8cfc0'; g.fillRect(0, 0, 1600, 1200);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const detectedObjects = pieces.map(([label, category, shape, box], i) => ({
      id: i, uid: `p${i}`, label: `${label}__slot:n`, conf: 0.9, source: 'local', locked: true, box, category,
      ...(shape ? { shape } : {}), dimMM: [800, 800, 800], position: { x: 0, y: 0, z: 0 }, yaw: 0,
    }));
    const meta = { id: 'cutprobe', createdAt: 1, name: 'Cut', layoutId: 'rect', width: 5, depth: 4, height: 2.7, version: 2, detectedObjects };
    const db = await new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onupgradeneeded = () => r.result.createObjectStore('keyval'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    await new Promise((res) => { const tx = db.transaction('keyval', 'readwrite'); const s = tx.objectStore('keyval');
      s.put(meta, 'room:cutprobe:meta'); s.put({ slot: 'n', blob, takenAt: 1 }, 'room:cutprobe:cap:n'); s.put(Date.now(), 'room:cutprobe:touched'); tx.oncomplete = res; });
    localStorage.setItem('danmu-room', JSON.stringify({ state: { roomId: 'cutprobe' }, version: 0 }));
  }, PIECES);
  await page.goto(BASE + '/onboarding/detect');
  await page.waitForSelector('img[alt^="Your photo"]', { timeout: 20000 });
  await page.waitForFunction((n) => document.querySelectorAll('.rail--right .list > *').length >= n, PIECES.length, { timeout: 20000 });
  await page.waitForTimeout(800);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.rail--right .list > *')].map((el) => {
    const note = [...el.querySelectorAll('.t-hint')].find((n) => n.textContent.includes('edge of the photo'));
    const r = el.getBoundingClientRect();
    const nr = note?.getBoundingClientRect();
    const span = note?.querySelector('span');
    return { text: el.textContent, note: note?.textContent ?? null, rowR: r.right, rowL: r.left,
      noteR: nr?.right, noteL: nr?.left, noteH: nr?.height, clipped: span ? span.scrollWidth > span.clientWidth + 1 : false };
  }));
  if (process.env.DUMP) console.log(rows.map((r) => r.text.slice(0, 160)).join('\n'));
  for (const [label, , , , word] of PIECES) {
    const r = rows.find((x) => x.text.startsWith(label));
    if (!r) { check(false, `${label}: row not found`); continue; }
    if (word) {
      check(r.note === `Runs past the edge of the photo, so its ${word} is an estimate`, `${label}: note "${r.note}"`);
      check(r.noteR <= r.rowR + 0.5 && r.noteL >= r.rowL - 0.5 && !r.clipped, `${label}: note inside its row (${r.noteL?.toFixed(0)}–${r.noteR?.toFixed(0)} in ${r.rowL.toFixed(0)}–${r.rowR.toFixed(0)}, ${r.noteH?.toFixed(0)}px tall)`);
    } else check(r.note === null, `${label}: no note`);
  }
  // An estimate printed bare reads as a measurement: the tall piece called a nightstand is
  // read from the far end of where it could stand, and judged at that reading (D8), so the
  // sentence gives the numbers it was judged on and says "about" of both.
  const limits = rows.find((x) => x.text.startsWith('Nightstand'));
  check(/Measured about [\d.]+ × [\d.]+ \S+\./.test(limits?.text ?? ''), `Nightstand: says its reading is an estimate ("Measured${(limits?.text ?? '').split('Measured')[1]?.slice(0, 70)}")`);
  const sideways = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  check(sideways <= 0, `no sideways scroll (${sideways})`);
  const list = await page.$('.rail--right .list');
  await list.screenshot({ path: join(SHOTS, `cut-${w}.png`) });
  await ctx.close();
}
await browser.close();
console.log(`${pass} passed, ${fail} failed — screenshots in ${SHOTS}`);
process.exit(fail > 0 ? 1 : 0);
