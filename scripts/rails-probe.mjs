// Run: install Playwright OUTSIDE this repo (its own scratch dir, `npm i playwright`
// then `npx playwright install chromium`) and point it at a PRODUCTION build —
// `pnpm build && pnpm exec next start -p <port>`, never `next dev`. It is deliberately
// not a dependency here and no gate runs it.
//
//     PORT=3052 node scripts/rails-probe.mjs
//
// The rail sash and the two panels beside it, in a real browser — every defect it
// covers is a pixel or a computed style, and jsdom resolves no var(), has no layout and
// returns zeros from getBoundingClientRect, so tests/rail-sash-gestures.test.tsx asserts
// the store and the property STRING and says so in its own header.
//
// MEASURED, against two production builds:
//   third-agent/mobile-ux-pass 8fbfd85 ..... 2 passed, 8 failed
//   fix/third-agent-rails (this repair) ... 10 passed, 0 failed
//
// The prediction was written before the first run and is kept beside this file at
// scripts/rails-probe-PREDICTION.md, because a prediction read after the fact is not a
// prediction. One scenario in it (S2) did NOT discriminate, and that is a finding rather
// than a miss: a dblclick fires two press/release pairs before onDoubleClick, each of
// which committed the rendered width on the baseline, so reset()'s write of null WAS a
// change React could see and the property came back. One defect concealed the other.
//
// Two of this file's own assertions were decoration when first written. The persisted-
// width reader looked up STUDIO_PREFS — the name of the COMMENT describing the persisted
// set in lib/store.ts, not the store key, which is danmu-studio-prefs — so it answered
// null on both builds and agreed with the fix for the same reason it agreed with the bug.
// And the first Add-trigger selector matched two buttons. Assert that a key or an element
// EXISTS before believing what it says.

import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 3052);
const BASE = `http://localhost:${PORT}`;
const COMPACT_PX = 1100; // inside the 1024-1279 band
const TALL = 900;

const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const ok = (n, m) => { pass++; log(`PASS ${n} ${m}`); };
const no = (n, m) => { fail++; log(`FAIL ${n} ${m}`); };
const note = (n, m) => log(`  ·  ${n} ${m}`);

const room = (id) => ({
  id, createdAt: Date.now(), version: 1, name: 'Rails probe',
  layoutId: 'rect', width: 6, depth: 5, height: 2.5,
});

async function seed(page, r) {
  await page.evaluate(async (r) => {
    await new Promise((res, rej) => {
      const rq = indexedDB.open('keyval-store');
      rq.onupgradeneeded = () => rq.result.createObjectStore('keyval');
      rq.onsuccess = () => {
        const tx = rq.result.transaction('keyval', 'readwrite');
        const st = tx.objectStore('keyval');
        st.put(r, `room:${r.id}:meta`);
        st.put([], `room:${r.id}:scene`);
        st.put({}, `room:${r.id}:transforms`);
        st.put(Date.now(), `room:${r.id}:touched`);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      };
      rq.onerror = () => rej(rq.error);
    });
  }, r);
}

/** A fresh context every scenario: `railLeftW` persists through localStorage, so one
 *  scenario storing a width would decide the next one's answer. */
async function fresh(browser, { width = COMPACT_PX, height = TALL } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('  [pageerror]', e.message));
  const id = `rails-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await seed(page, room(id));
  await page.goto(`${BASE}/room/${id}/plan`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.split', { timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const cols = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.split');
    return el ? getComputedStyle(el).gridTemplateColumns : '(no .split)';
  });

const trackCount = (s) => (s === 'none' || s.startsWith('(') ? 0 : s.trim().split(/\s+/).length);

const railWidth = (page, side) =>
  page.evaluate((side) => {
    const el = document.querySelector(`.rail--${side}`);
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  }, side);

/** The persisted width, read out of zustand's own store.
 *
 *  The key is `danmu-studio-prefs` (`lib/store.ts:336`). The first version of this
 *  read `STUDIO_PREFS` — the name of the COMMENT that describes the persisted set,
 *  not the name of the store — so it returned null on every build and the half of S1
 *  that reads it was decoration: it agreed with the fix for the same reason it agreed
 *  with the defect. The key is asserted to exist before its contents are believed. */
const storedW = (page, side) =>
  page.evaluate((side) => {
    const raw = localStorage.getItem('danmu-studio-prefs');
    if (!raw) return '(no danmu-studio-prefs key — nothing has been persisted yet)';
    try {
      const s = JSON.parse(raw)?.state ?? {};
      const k = side === 'left' ? 'railLeftW' : 'railRightW';
      if (!(k in s)) return `(no ${k} in the persisted state)`;
      return s[k];
    } catch {
      return '(unparseable)';
    }
  }, side);

/** Press the sash at its own centre. `dispatchEvent` rather than `mouse`, because the
 *  strip is 10px wide and a pointer that misses reports the same as a handler that
 *  ignored it — this asserts the element it addressed. */
async function sashGesture(page, side, moves = []) {
  const box = await page.locator(`[aria-label="Resize the ${side} panel"]`).boundingBox();
  if (!box) throw new Error(`precondition: no ${side} sash on screen`);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const dx of moves) {
    await page.mouse.move(x + dx, y, { steps: 3 });
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function main() {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  });

  // ── S8 · CONTROL — the shell has three tracks at all ──────────────────────
  {
    const { ctx, page } = await fresh(browser);
    const c = await cols(page);
    if (trackCount(c) === 3) ok('S8', `[control] the studio grid has three tracks: ${c}`);
    else no('S8', `[control] grid-template-columns is \`${c}\` on a plain load — every other reading here is void`);
    await ctx.close();
  }

  // ── S1 · a press that moves nothing must not widen the rail ───────────────
  {
    const { ctx, page } = await fresh(browser);
    // Close it through the chevron, the way a user would.
    await page.getByRole('button', { name: /hide the left panel/i }).click();
    await page.waitForTimeout(250);
    await sashGesture(page, 'left');
    const w = await railWidth(page, 'left');
    const stored = await storedW(page, 'left');
    note('S1', `rail is ${w}px, stored width is ${JSON.stringify(stored)}`);
    // Two readings of one defect, and both are asserted because they fail in different
    // ways: the width is what the user sees, and the stored value is why it is
    // permanent. A build that fixed only the paint would pass the first alone.
    if (w === 208) ok('S1-width', 'the rail opened to --rail-left-tight (208px)');
    else no('S1-width', `the rail is ${w}px after a press that moved nothing (208 expected)`);
    if (stored === null) ok('S1-stored', 'nothing was persisted');
    else no('S1-stored', `railLeftW persisted as ${JSON.stringify(stored)}`);
    await ctx.close();
  }

  // ── S2 · double-click on a never-dragged rail ─────────────────────────────
  {
    const { ctx, page } = await fresh(browser);
    const before = await cols(page);
    await page.locator('[aria-label="Resize the left panel"]').dblclick();
    await page.waitForTimeout(250);
    const after = await cols(page);
    note('S2', `before \`${before}\` → after \`${after}\``);
    if (trackCount(after) === 3) ok('S2', 'the grid still has three tracks after a reset');
    else no('S2', `the grid has ${trackCount(after)} tracks after a reset: \`${after}\``);
    await ctx.close();
  }

  // ── S3 · grab open, push shut, reopen ─────────────────────────────────────
  {
    const { ctx, page } = await fresh(browser);
    await page.getByRole('button', { name: /hide the left panel/i }).click();
    await page.waitForTimeout(250);
    await sashGesture(page, 'left', [-8, -400]);
    const closed = await page.getByRole('button', { name: /show the left panel/i }).count();
    note('S3', `after the push-shut the rail is ${closed ? 'closed' : 'STILL OPEN'}`);
    await page.getByRole('button', { name: /show the left panel/i }).click();
    await page.waitForTimeout(300);
    const after = await cols(page);
    note('S3', `grid-template-columns on reopen: \`${after}\``);
    if (trackCount(after) === 3) ok('S3', 'the grid still has three tracks after a collapse and a reopen');
    else no('S3', `the grid has ${trackCount(after)} tracks after a collapse and a reopen: \`${after}\``);
    await ctx.close();
  }

  // ── S4 · the Shuffle label, idle and busy ─────────────────────────────────
  {
    const { ctx, page } = await fresh(browser);
    const read = () =>
      page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /^(Shuffle|Shuffling)/.test(b.textContent?.trim() ?? ''),
        );
        if (!btn) return null;
        // The label's own box, which is the span when there is one and the button
        // otherwise — a bare text node has no box to measure.
        const span = btn.querySelector('span') ?? btn;
        return {
          text: btn.textContent.trim(),
          scroll: span.scrollWidth,
          client: span.clientWidth,
          buttonW: Math.round(btn.getBoundingClientRect().width),
        };
      });

    const idle = await read();
    if (!idle) {
      no('S4', 'precondition: no Shuffle button on the plan tab');
    } else {
      note('S4', `idle "${idle.text}": span ${idle.scroll} in ${idle.client}, button ${idle.buttonW}px`);
      const cut = idle.scroll > idle.client + 1;
      if (!cut) ok('S4', `the idle label is whole (${idle.scroll} ≤ ${idle.client})`);
      else no('S4', `the idle label is cut: ${idle.scroll} of text in ${idle.client}`);

      // And the busy string, which is the longer one and the reduced-motion tell.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /^Shuffle/.test(b.textContent?.trim() ?? ''),
        );
        btn?.click();
      });
      await page.waitForTimeout(120);
      const busy = await read();
      if (busy && /Shuffling/.test(busy.text)) {
        note('S4', `busy "${busy.text}": span ${busy.scroll} in ${busy.client}`);
        if (busy.scroll > busy.client + 1) no('S4-busy', `the busy label is cut: ${busy.scroll} in ${busy.client}`);
        else ok('S4-busy', `the busy label is whole (${busy.scroll} ≤ ${busy.client})`);
      } else {
        note('S4', `the busy state was not caught (label read "${busy?.text}") — not counted either way`);
      }
    }
    await ctx.close();
  }

  // ── S5 · the dial's sentence, without hovering anything ───────────────────
  {
    const { ctx, page } = await fresh(browser);
    const said = await page.evaluate(() =>
      [...document.querySelectorAll('div,span,p')]
        .map((e) => e.textContent?.trim() ?? '')
        .some((t) => /Light comes from the dial's/.test(t) || /^Drag to set north\./.test(t)),
    );
    if (said) ok('S5', "the dial's hint is in the document with nothing hovered");
    else no('S5', "the dial's hint is not rendered until something is hovered");
    await ctx.close();
  }

  // ── S6 · the Room section, collapsed, still states the room ───────────────
  {
    const { ctx, page } = await fresh(browser);
    const head = page.getByRole('button', { name: /^Room/ }).first();
    await head.click(); // collapse it
    await page.waitForTimeout(200);
    const meta = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.rail-section-toggle')].find((x) =>
        /^Room/.test(x.textContent ?? ''),
      );
      return b?.textContent?.trim() ?? '(no Room section)';
    });
    note('S6', `the collapsed Room header reads "${meta}"`);
    if (/\d+\.\d\s*[×x]\s*\d+\.\d\s*m/.test(meta)) ok('S6', 'a collapsed Room section still states the room size');
    else no('S6', 'a collapsed Room section states nothing about the room');
    await ctx.close();
  }

  // ── S7 · the right rail's fixed stack at short windows ───────────────────
  for (const winH of [520, 420]) {
    const { ctx, page } = await fresh(browser, { width: COMPACT_PX, height: winH });
    const m = await page.evaluate(() => {
      const rail = document.querySelector('.rail--right');
      if (!rail) return null;
      const footer = rail.querySelector('.rail-footer');
      const r = rail.getBoundingClientRect();
      const f = footer?.getBoundingClientRect();
      const kids = [...rail.children].map((c) => ({
        cls: c.className || c.tagName, h: Math.round(c.getBoundingClientRect().height),
      }));
      return {
        railH: Math.round(r.height), railBottom: Math.round(r.bottom),
        footerBottom: f ? Math.round(f.bottom) : null,
        overflowY: getComputedStyle(rail).overflowY,
        kids,
      };
    });
    if (!m) {
      note('S7', '[measurement] no right rail on screen');
    } else {
      const spill = m.footerBottom === null ? null : m.footerBottom - m.railBottom;
      note('S7', `rail ${m.railH}px at a ${winH}px window, overflow-y: ${m.overflowY}`);
      note('S7', `children: ${m.kids.map((k) => `${k.cls}=${k.h}`).join(' · ')}`);
      if (spill === null) note('S7', 'no footer to measure');
      else if (spill > 0) no(`S7@${winH}`, `the pinned footer paints ${spill}px past the rail's own bottom edge`);
      else ok(`S7@${winH}`, `the footer sits inside the rail (bottom − bottom = ${spill}px)`);
    }
    await ctx.close();
  }

  log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log('PROBE ERROR', e.message);
  process.exit(2);
});
