// The room list's row actions, pointed at in a real browser. A piece row's lock / hide /
// remove buttons float over the END of the row when it is hovered (`.row-actions` in
// `app/globals.css`), which frees the name the rest of the time — and on a narrow rail
// the float covered all but the first ~45px of the name it was floating over: "Coff"
// for "Coffee table", under the pointer, beside a Remove button. `tests/reflow.test.ts`
// holds the CSS rule; this is the check that the name survives the hover. No gate runs it.
//
// Run: install Playwright OUTSIDE this repo, exactly as `scripts/photo-tag-probe.mjs`
// describes, and point it at a PRODUCTION build:
//
//     pnpm exec next build && pnpm exec next start -p 3061
//     PORT=3061 PW_ROOT=/some/scratch node scripts/row-hover-probe.mjs
//
// It seeds one furnished room (the L-shape's starter set, fourteen rows) and, at each
// width, hovers every row at its centre — where a person's pointer is — and measures how
// much of the name is still readable: the text up to where the actions' fade turns
// opaque. A name reads if it is shown whole or at least NAME_FLOOR px of it is — about ten
// characters at the list's 13px, chosen rather than derived. Then it selects a row and
// focuses another from the keyboard, the two ways Remove is still reached on a narrow
// rail. The last width is a WIDE window whose list was dragged to its floor
// (`railLeftW`, persisted), because the rule follows the rail's own width, not the
// window's. VP='[[w,h,railLeftW?],…]' narrows the widths, DUMP=1 prints every row.
import { createRequire } from 'node:module';
import { join } from 'node:path';
const req = createRequire(join(process.env.PW_ROOT, 'probe.cjs'));
const { chromium } = req('playwright');
const BASE = `http://localhost:${process.env.PORT || 3061}`;
const NAME_FLOOR = 64;
// The one container query that narrows the list (`@container rail (max-width: 240px)`).
const NARROW_RAIL = 240;
const VIEWPORTS = process.env.VP
  ? JSON.parse(process.env.VP)
  : [[1024, 800], [1100, 800], [1279, 800], [1280, 800], [1440, 900], [1440, 900, 228]];
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const room = { id: 'rowhover', createdAt: 1, version: 1, name: 'Row hover', layoutId: 'l', width: 6, depth: 5, height: 2.6 };

/** How much of `row`'s name is readable while its actions show. */
function readable(el) {
  const name = el.querySelector('.row-name');
  const act = el.querySelector('.row-actions');
  const nb = name.getBoundingClientRect();
  const ab = act.getBoundingClientRect();
  const cs = getComputedStyle(name);
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform}`;
  probe.textContent = name.textContent;
  document.body.append(probe);
  const text = probe.getBoundingClientRect().width;
  probe.remove();
  const acs = getComputedStyle(act);
  const floating = acs.position === 'absolute' && Number(acs.opacity) > 0;
  // The fade under the actions is transparent → the row's ground over its first 16px.
  const opaqueFrom = ab.left + Math.min(16, parseFloat(acs.paddingLeft));
  const room = floating ? Math.min(nb.width, opaqueFrom - nb.left) : nb.width;
  const buttons = [...act.querySelectorAll('button')].filter((b) => getComputedStyle(b).display !== 'none');
  return {
    name: name.textContent.trim(),
    text: Math.round(text),
    shown: Math.round(Math.max(0, Math.min(text, room))),
    buttons: buttons.map((b) => b.getAttribute('aria-label').split(' ')[0]),
    ownLine: ab.top >= nb.bottom - 1,
    rail: Math.round(el.closest('.rail').clientWidth),
    floating,
  };
}

const browser = await chromium.launch();
for (const [w, h, railLeftW] of VIEWPORTS) {
  console.log(`${w}x${h}${railLeftW ? `, list dragged to ${railLeftW}px` : ''}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/workspace`);
  await page.evaluate(async ([r, railLeftW]) => {
    if (railLeftW) localStorage.setItem('danmu-studio-prefs', JSON.stringify({ state: { railLeftW }, version: 0 }));
    const db = await new Promise((res, rej) => { const q = indexedDB.open('keyval-store'); q.onupgradeneeded = () => q.result.createObjectStore('keyval'); q.onsuccess = () => res(q.result); q.onerror = rej; });
    await new Promise((res) => { const tx = db.transaction('keyval', 'readwrite'); const s = tx.objectStore('keyval');
      s.put(r, `room:${r.id}:meta`); s.put(Date.now(), `room:${r.id}:touched`); tx.oncomplete = res; });
  }, [room, railLeftW ?? null]);
  await page.goto(`${BASE}/room/${room.id}/plan`);
  const rows = page.locator('.rail [role="option"].list-row[data-part-id]');
  await rows.first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const n = await rows.count();
  check(n >= 10, `a furnished list to point at (${n} piece rows)`);

  let worst = null, cut = 0, removeShown = 0, rail = 0, missed = 0;
  for (let i = 0; i < n; i++) {
    // Scrolled to first: the list is its own scroll box, and a row below its fold has a
    // bounding box the pointer lands on something else at — which reads, without this,
    // as a row whose actions stayed hidden and whose name therefore survived.
    await rows.nth(i).scrollIntoViewIfNeeded();
    const box = await rows.nth(i).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    const m = await rows.nth(i).evaluate(readable);
    rail = m.rail;
    if (!m.floating) missed++;
    if (process.env.DUMP) console.log(`       ${m.name.padEnd(14)} ${m.shown}/${m.text}px  [${m.buttons.join(' ')}]`);
    const reads = m.shown >= Math.min(m.text, NAME_FLOOR);
    if (!reads) cut++;
    if (!worst || m.shown - Math.min(m.text, NAME_FLOOR) < worst.shown - Math.min(worst.text, NAME_FLOOR)) worst = m;
    if (m.buttons.includes('Remove')) removeShown++;
  }
  const narrow = rail <= NARROW_RAIL;
  check(missed === 0, `the hover took on every row (${missed} of ${n} showed no actions)`);
  check(cut === 0, `every hovered name reads (rail ${rail}px): ${cut} of ${n} cut; tightest "${worst.name}" ${worst.shown} of ${worst.text}px`);
  check(narrow ? removeShown === 0 : removeShown === n,
    narrow ? `Remove waits for the selection on the narrow rail (${removeShown} of ${n} showed it on hover)`
           : `Remove shows on hover on a rail with room for it (${removeShown} of ${n})`);

  // Selected: all three, on a line of their own under the name.
  await page.mouse.move(0, 0);
  await rows.nth(3).click({ position: { x: 30, y: 10 } });
  await page.waitForTimeout(300);
  await page.mouse.move(0, 0);
  const sel = await rows.nth(3).evaluate(readable);
  check((await rows.nth(3).getAttribute('aria-selected')) === 'true' && sel.buttons.length === 3 && sel.ownLine && sel.shown === sel.text,
    `the selected row opens: [${sel.buttons.join(' ')}] ${sel.ownLine ? 'under' : 'OVER'} a whole name (${sel.shown}/${sel.text}px)`);

  // Keyboard: a button focused inside a row that is not selected shows Remove too.
  // Measured after the reveal's fade has run: read at once, the opacity is still 0.
  await rows.nth(6).evaluate((el) => el.querySelector('.row-actions button').focus());
  await page.waitForTimeout(400);
  const kb = await rows.nth(6).evaluate((el) => {
    const b = [...el.querySelectorAll('.row-actions button')];
    return { selected: el.getAttribute('aria-selected'), shown: b.filter((x) => getComputedStyle(x).display !== 'none' && Number(getComputedStyle(x.parentElement).opacity) > 0).length };
  });
  check(kb.shown === 3, `a keyboard focus inside a row reaches all three (${kb.shown}; row selected: ${kb.selected})`);

  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(sideways <= 0, `no sideways scroll (${sideways})`);
  await ctx.close();
}
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
