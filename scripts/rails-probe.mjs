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
// MEASURED, against two production builds, when this file held S1-S8:
//   third-agent/mobile-ux-pass 8fbfd85 ..... 2 passed, 8 failed
//   fix/third-agent-rails (this repair) ... 10 passed, 0 failed
//   ...and a peer ran this same file against their own build and reproduced 10/0.
//
// S9, S10 and S11 were added after five review lenses measured four more ways to move
// a rail nobody asked to move — three of them present on `main` as well. Their numbers
// are in the run this file's PR quotes; do not read the 10/0 above as covering them.
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
  //
  // The busy string is the one this scenario exists for. `Shuffling…` is ~18px wider
  // than `Shuffle` and it is the tell that has to survive `prefers-reduced-motion`,
  // where the ring does not turn — so the arithmetic in the PR that widened this row
  // is about the BUSY label, and the first version of this scenario measured the idle
  // one and printed "not counted either way" when it missed the other. That is an
  // assertion opting out when its subject is absent: two recorded runs both reported
  // 10 of a possible 11 checks, which says it never once executed, on either build.
  // It fails now instead. A probe that cannot see its subject has not passed.
  {
    const { ctx, page } = await fresh(browser);
    const read = () =>
      page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /^(Shuffle|Shuffling)/.test(b.textContent?.trim() ?? ''),
        );
        if (!btn) return null;
        // The span carrying the TEXT. `querySelector('span')` takes the first one,
        // which in the busy state is the spinner — a plausible number about the wrong
        // element, which is worse than no number. A bare text node has no box, so the
        // button is the fallback.
        const label = [...btn.querySelectorAll('span')].find((s) => /Shuffl/.test(s.textContent ?? ''));
        const box = label ?? btn;
        const r = btn.getBoundingClientRect();
        const row = btn.parentElement?.getBoundingClientRect();
        return {
          text: btn.textContent.trim(),
          measured: label ? 'label span' : 'button',
          scroll: box.scrollWidth,
          client: box.clientWidth,
          buttonW: Math.round(r.width),
          buttonTop: Math.round(r.top),
          rowH: row ? Math.round(row.height) : null,
        };
      });

    const idle = await read();
    if (!idle) {
      no('S4', 'precondition: no Shuffle button on the plan tab');
    } else {
      note('S4', `idle "${idle.text}" (${idle.measured}): ${idle.scroll} in ${idle.client}, button ${idle.buttonW}px, row ${idle.rowH}px`);
      const cut = idle.scroll > idle.client + 1;
      if (!cut) ok('S4', `the idle label is whole (${idle.scroll} ≤ ${idle.client})`);
      else no('S4', `the idle label is cut: ${idle.scroll} of text in ${idle.client}`);

      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /^Shuffle/.test(b.textContent?.trim() ?? ''),
        );
        btn?.click();
      });
      // Polled rather than slept. The busy window is short and variable — four runs on
      // one machine caught it once — so a fixed wait decides whether this scenario runs
      // by luck, and the luck was 0 for 2 on the runs that were written down.
      let busy = null;
      for (let i = 0; i < 60 && !busy; i++) {
        const seen = await read();
        if (seen && /Shuffling/.test(seen.text)) busy = seen;
        else await page.waitForTimeout(25);
      }

      if (!busy) {
        no('S4-busy', 'the busy label never appeared within 1.5s — the string this row was widened for went unmeasured');
      } else {
        note('S4', `busy "${busy.text}" (${busy.measured}): ${busy.scroll} in ${busy.client}, button ${busy.buttonW}px, row ${busy.rowH}px`);
        if (busy.scroll > busy.client + 1) no('S4-busy', `the busy label is cut: ${busy.scroll} in ${busy.client}`);
        else ok('S4-busy', `the busy label is whole (${busy.scroll} ≤ ${busy.client})`);
        // [measurement, not a gate] Whether the row REFLOWS when the label grows. It
        // does: the two buttons go from side by side to stacked full-width, so the
        // button under a pointer that has not moved is no longer the one that was
        // pressed. That is a real finding and it is recorded rather than asserted,
        // because nothing here fixes it — see the PR and docs/visual-check.md.
        const moved = busy.buttonTop !== idle.buttonTop || busy.buttonW !== idle.buttonW;
        note(
          'S4',
          moved
            ? `[measurement] the row reflows on press: button ${idle.buttonW}→${busy.buttonW}px, top ${idle.buttonTop}→${busy.buttonTop}, row ${idle.rowH}→${busy.rowH}px — the control under a still pointer changes`
            : `[measurement] the row holds its shape on press (button ${busy.buttonW}px, row ${busy.rowH}px)`,
        );
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
  //
  // Two readings, and the finding is BOTH of them together: `.rail` computes
  // `overflow-y: visible`, so it cannot clip and would give no scrollbar and no error
  // if anything crossed it — and nothing does, because the Inspector and the View
  // section now share one scroll region. So the zero below is a MEASUREMENT, not a
  // guard: make the footer taller tomorrow and nothing here or in the suite fails.
  // The overflow line is printed for that reason and not as decoration.
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


  // ── S9 · a press that moves straight DOWN must not paint, and not close ───
  //
  // The door the click guard did not close, and it is two doors on two rails. `d.moved`
  // stays false when the pointer travels no horizontal distance, so the release
  // correctly commits nothing — but `paint()` used to run anyway and writes `pending`,
  // clamped UP to the drag floor, so a 208px rail was painted `228px` and no render
  // followed to take it back. On the right rail the same gesture ARMED the collapse,
  // because 248 < 276 − 24 is already true at zero delta, and the Inspector shut.
  for (const side of ['left', 'right']) {
    const { ctx, page } = await fresh(browser);
    const before = await railWidth(page, side);
    const box = await page.locator(`[aria-label="Resize the ${side} panel"]`).boundingBox();
    if (!box) {
      no(`S9-${side}`, 'precondition: no sash on screen');
    } else {
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 40, { steps: 4 }); // straight down: zero horizontal delta
      await page.waitForTimeout(60);
      await page.mouse.up();
      await page.waitForTimeout(250);
      const after = await railWidth(page, side);
      const open = await page.evaluate((s) => !!document.querySelector(`.rail--${s}`), side);
      const varValue = await page.evaluate(
        (s) => document.querySelector('.split')?.style.getPropertyValue(`--sash-${s}`).trim() ?? '(none)',
        side,
      );
      note(`S9-${side}`, `${before}px → ${after}px, --sash-${side} is "${varValue}", rail present: ${open}`);
      if (after === before) ok(`S9-${side}`, `a vertical press left the rail at ${after}px`);
      else no(`S9-${side}`, `a vertical press moved the rail ${before} → ${after}px`);
      if (!/^\d/.test(varValue)) ok(`S9-${side}-var`, `--sash-${side} is still an expression, not a painted literal`);
      else no(`S9-${side}-var`, `--sash-${side} was left as the literal "${varValue}", unclamped and stuck`);
    }
    await ctx.close();
  }

  // ── S10 · the separator publishes a range its own value fits inside ───────
  //
  // `aria-valuenow` sat BELOW `aria-valuemin` on both rails for the whole compact band
  // — 208 in [228, …] and 248 in [276, …]. The file's own comment says a CLOSED sash
  // publishes no value rather than an impossible one; this is the same impossibility,
  // open, and it went unnoticed because nothing reads these attributes but a screen
  // reader.
  {
    const { ctx, page } = await fresh(browser);
    for (const side of ['left', 'right']) {
      const a = await page.evaluate((s) => {
        const el = document.querySelector(`[aria-label="Resize the ${s} panel"]`);
        if (!el) return null;
        return {
          now: Number(el.getAttribute('aria-valuenow')),
          min: Number(el.getAttribute('aria-valuemin')),
          max: Number(el.getAttribute('aria-valuemax')),
        };
      }, side);
      if (!a || !Number.isFinite(a.now)) {
        no(`S10-${side}`, 'precondition: the sash publishes no value to read');
      } else {
        note(`S10-${side}`, `now ${a.now}, min ${a.min}, max ${a.max}`);
        if (a.min <= a.now && a.now <= a.max) ok(`S10-${side}`, `the value sits inside the published range`);
        else no(`S10-${side}`, `aria-valuenow ${a.now} is outside [${a.min}, ${a.max}]`);
      }
    }
    await ctx.close();
  }

  // ── S11 · the shrink key must not widen the rail, and must not persist one ─
  //
  // The only one of these that survives the session. One ArrowLeft on a focused left
  // sash at the compact step: 208 − 16 = 192, clamped up to the 228px floor, stored —
  // so the key that means "narrower" widened the rail 20px and pinned it out of the
  // compact step for good. `Home` did it too, which is worse, because `Home` means
  // "smallest". The grow key is the control: a guard that refused every key press would
  // pass the first half of this on its own.
  {
    const { ctx, page } = await fresh(browser);
    const sash = page.locator('[aria-label="Resize the left panel"]');
    await sash.focus();
    const before = await railWidth(page, 'left');
    await sash.press('ArrowLeft');
    await page.waitForTimeout(200);
    const afterShrink = await railWidth(page, 'left');
    const storedShrink = await storedW(page, 'left');
    note('S11', `ArrowLeft: ${before}px → ${afterShrink}px, stored ${JSON.stringify(storedShrink)}`);
    if (afterShrink <= before) ok('S11', `the shrink key did not widen the rail (${before} → ${afterShrink})`);
    else no('S11', `the shrink key WIDENED the rail ${before} → ${afterShrink}px`);

    await sash.press('Home');
    await page.waitForTimeout(200);
    const afterHome = await railWidth(page, 'left');
    if (afterHome <= before) ok('S11-home', `Home did not widen the rail (${before} → ${afterHome})`);
    else no('S11-home', `Home WIDENED the rail ${before} → ${afterHome}px`);

    await sash.press('ArrowRight');
    await page.waitForTimeout(200);
    const afterGrow = await railWidth(page, 'left');
    note('S11', `ArrowRight: → ${afterGrow}px, stored ${JSON.stringify(await storedW(page, 'left'))}`);
    if (afterGrow > afterHome) ok('S11-grow', `[control] the grow key still resizes (${afterHome} → ${afterGrow})`);
    else no('S11-grow', `[control] the grow key did nothing either — the guard refuses everything`);
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
