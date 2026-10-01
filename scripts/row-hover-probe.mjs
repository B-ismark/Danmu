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
// characters at the list's 13px, chosen rather than derived. Then it selects a row, and
// walks Tab forward and Shift+Tab back through a row it has not selected — the ways Remove
// is still reached on a narrow rail, both directions, because a Remove that only exists
// once focus is inside its row is skipped going backwards. And it CLICKS a row's Hide with
// the mouse, since a click focuses the button in Chromium: whatever that does to the row,
// the button under the pointer afterwards must still be the one that was clicked, and the
// name must still read once the pointer has gone. The last width is a WIDE window whose
// list was dragged to its floor (`railLeftW`, persisted), because the rule follows the
// rail's own width, not the window's. VP='[[w,h,railLeftW?],…]' narrows the widths,
// DUMP=1 prints every row.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
      '    PORT=3061 PW_ROOT=/some/scratch node scripts/row-hover-probe.mjs',
  );
  process.exit(2);
}
const BASE = `http://localhost:${process.env.PORT || 3061}`;
const NAME_FLOOR = 64;
// The width below which a pointed-at row keeps Remove folded: read from the container
// query that holds the rule, so the probe and the stylesheet cannot name two numbers.
const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const NARROW_RAIL = (() => {
  const at = CSS.indexOf('.list-row:not(.is-selected)');
  const opens = [...CSS.slice(0, at).matchAll(/@container rail \(max-width: (\d+)px\)/g)];
  if (at < 0 || !opens.length) { console.log('PROBE ERROR no narrow-rail row rule in globals.css'); process.exit(2); }
  return Number(opens.at(-1)[1]);
})();
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
  // A button counts when it has a box: folded to no width is as absent as `display: none`.
  const buttons = [...act.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width >= 1);
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
  await page.goto(`${BASE}/`);
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

  // Keyboard, both ways, through row 6, which is not selected. Only the LANDING is
  // placed by script; every step that is checked is a real key press, because a
  // scripted `.focus()` is not what `:focus-visible` answers to. Read after the reveal's
  // fade has run: at once, the opacity is still 0.
  const focusedIn = (i) => rows.nth(i).evaluate((el) => {
    const a = document.activeElement;
    const b = [...el.querySelectorAll('.row-actions button')];
    return {
      inside: el.contains(a) && a !== el,
      label: el.contains(a) ? (a.getAttribute('aria-label') ?? '').split(' ')[0] : '',
      width: el.contains(a) ? Math.round(a.getBoundingClientRect().width) : 0,
      shown: b.filter((x) => x.getBoundingClientRect().width >= 1 && Number(getComputedStyle(x.parentElement).opacity) > 0).length,
    };
  });
  const pressUntilIn = async (key, i) => {
    for (let k = 0; k < 4; k++) { await page.keyboard.press(key); if ((await focusedIn(i)).inside) return true; }
    return false;
  };
  // Landed on row 5's last FOCUSABLE button — `display: none` cannot take focus.
  await rows.nth(5).evaluate((el) => [...el.querySelectorAll('.row-actions button')].filter((b) => getComputedStyle(b).display !== 'none').at(-1).focus());
  await pressUntilIn('Tab', 6);
  await page.waitForTimeout(400);
  const fwd = await focusedIn(6);
  let fwdLast = fwd;
  for (let k = 0; k < 4 && fwdLast.label !== 'Remove'; k++) { await page.keyboard.press('Tab'); fwdLast = await focusedIn(6); if (!fwdLast.inside) break; }
  check(fwd.shown === 3 && fwdLast.label === 'Remove' && fwdLast.width >= 24,
    `Tab into a row opens all three and reaches Remove (${fwd.shown} shown; last stop ${fwdLast.label || 'left the row'}, ${fwdLast.width}px)`);
  await rows.nth(7).evaluate((el) => el.querySelector('.row-actions button').focus());
  await pressUntilIn('Shift+Tab', 6);
  await page.waitForTimeout(400);
  const back = await focusedIn(6);
  check(back.label === 'Remove' && back.width >= 24,
    `Shift+Tab back into a row lands on its Remove (${back.label || 'nothing'}, ${back.width}px)`);
  await page.evaluate(() => document.activeElement?.blur());

  // The mouse, on a row that is not selected: click its Hide. A click focuses the button
  // in Chromium, so this is where a rule keyed on focus rather than on the keyboard would
  // unfold Remove — and shove Hide sideways, leaving Remove under the pointer for the
  // second click. Worse, the shove lands between the press and the release, so the click
  // is on neither button and nothing is hidden at all. Row 4, put back if it was hidden.
  await rows.nth(4).scrollIntoViewIfNeeded();
  const r4 = await rows.nth(4).boundingBox();
  await page.mouse.move(r4.x + r4.width / 2, r4.y + r4.height / 2);
  await page.waitForTimeout(250);
  const hide = await rows.nth(4).locator('.row-actions button[aria-label^="Hide "]').boundingBox();
  const at = { x: hide.x + hide.width / 2, y: hide.y + hide.height / 2 };
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(400);
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label')?.split(' ')[0] ?? '', at);
  check(under === 'Show', `after clicking Hide the pointer is still on that toggle (${under || 'nothing'})`);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const left = await rows.nth(4).evaluate(readable);
  check(left.shown >= Math.min(left.text, NAME_FLOOR),
    `and once the pointer has gone the name reads: "${left.name}" ${left.shown} of ${left.text}px [${left.buttons.join(' ')}]`);
  await page.mouse.move(r4.x + r4.width / 2, r4.y + r4.height / 2);
  await page.waitForTimeout(250);
  const shown = rows.nth(4).locator('.row-actions button[aria-label^="Show "]');
  if (await shown.count()) await shown.click();
  await page.evaluate(() => document.activeElement?.blur());

  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(sideways <= 0, `no sideways scroll (${sideways})`);
  await ctx.close();
}
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
