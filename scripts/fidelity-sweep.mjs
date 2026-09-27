// The visual-fidelity sweep: every screen, seven widths, the rookie errors counted.
//
// WHY IT EXISTS. Nothing below the browser can see a label printing out through the
// bottom of its pill, a control clipped by a rail's `overflow: hidden`, or a page that
// scrolls sideways on a phone — CLAUDE.md rule 4 calls both overflow modes silent, and
// they are. Every UI-facing change is walked through this before it is called done,
// and the screenshots it writes are for LOOKING at: the counts catch the mechanical
// failures, not an awkward wrap or a lopsided row.
//
// Run it against a PRODUCTION build (a worker registered by `next dev` serves stale
// chunks — see `components/ServiceWorkerRegistrar.tsx`), with Playwright installed
// OUTSIDE this repo, exactly as `scripts/rails-probe.mjs` asks:
//
//     pnpm build && pnpm exec next start -p 3061
//     PORT=3061 PW_ROOT=/some/scratch node scripts/fidelity-sweep.mjs
//     … --widths 390,1280   --only studio   --units ft
//
// WHAT COUNTS AS A FINDING, and the false positives each rule was shaped around:
//   spill     an element with its own text whose content is wider than its box.
//             Elements that truncate on purpose (`text-overflow: ellipsis`) and scroll
//             boxes are skipped; so are elements with no direct text, which is what
//             keeps `.icon-btn`'s 44px `::after` hit pad from reading as overflow.
//   starved   an element that truncates on purpose, cut to under four characters'
//             width — "D…" for "Dining table". Intended ellipsis, useless result.
//   clipped   text-bearing content crossing the edge of an `overflow: hidden|clip`
//             ancestor by more than 1px.
//   offscreen a control partly outside the viewport horizontally.
//   overlap   two controls, neither containing the other, sharing more than 16px².
//   target    on widths under 1024, a control whose hit area (including an `::after`
//             pad) is under 44px on either side. Reported, and counted separately,
//             because a dense desktop control reflowed onto a tablet is a design
//             question rather than a bug.
//   hscroll   the page itself scrolling sideways.
//   cut       a text or number field whose value is wider than the field, so part of
//             the number is hidden. Inputs report no text overflow of their own.
//   orphan    a `.chrome-divider` with nothing shown on one side of it — the control it
//             separated was hidden (the plan's zoom box on a phone) and the rule stayed.
//   stretched on widths of 768 and up, a control, card or paragraph spread wider than
//             its content can use: a button more than 240px wide whose label and
//             icon occupy under half of it, a `.ds-card` over 760px, or a paragraph
//             of running text over ~80 characters a line (WCAG 1.4.8; Bringhurst's
//             45–75). A thing does not get wider because the window did. Rename
//             fields, disclosure rows and tiles are not buttons and are skipped.
//
// EXIT CODES: 0 clean, 1 findings, 2 the sweep could not run.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PW_ROOT = process.env.PW_ROOT;
const req = createRequire(PW_ROOT ? join(PW_ROOT, 'probe.cjs') : import.meta.url);
let chromium;
try {
  ({ chromium } = req('playwright'));
} catch {
  console.log('SWEEP ERROR cannot resolve `playwright` — set PW_ROOT (see the header).');
  process.exit(2);
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const PORT = Number(process.env.PORT || 3061);
const BASE = `http://localhost:${PORT}`;
const WIDTHS = arg('widths', '360,390,768,1024,1280,1440,1920').split(',').map(Number);
const ONLY = arg('only', '');
const UNITS = arg('units', 'm');
const OUT = process.env.SHOTS || join('/tmp', 'fidelity-sweep');
mkdirSync(OUT, { recursive: true });

const LONG_NAME = 'The long living room upstairs, by the window';
const room = (id, name) => ({ id, createdAt: Date.now(), version: 1, name, layoutId: 'l', width: 6, depth: 5, height: 2.6 });

async function seed(page, rooms) {
  await page.evaluate(
    async ([rooms, units]) => {
      localStorage.setItem('danmu-settings', JSON.stringify({ state: { dimUnit: units }, version: 0 }));
      await new Promise((res, rej) => {
        const rq = indexedDB.open('keyval-store');
        rq.onupgradeneeded = () => rq.result.createObjectStore('keyval');
        rq.onsuccess = () => {
          const tx = rq.result.transaction('keyval', 'readwrite');
          const st = tx.objectStore('keyval');
          for (const r of rooms) {
            st.put(r, `room:${r.id}:meta`);
            st.put(Date.now(), `room:${r.id}:touched`);
          }
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
        rq.onerror = () => rej(rq.error);
      });
    },
    [rooms, UNITS],
  );
}

/** Screens and states. `go` returns once the state is on screen. */
const SCREENS = [
  { key: 'welcome', go: (p) => p.goto(`${BASE}/onboarding/welcome`) },
  { key: 'layout-pick', go: (p) => p.goto(`${BASE}/onboarding/layout-pick`) },
  { key: 'capture', go: (p) => p.goto(`${BASE}/onboarding/capture`) },
  { key: 'workspace', go: (p) => p.goto(`${BASE}/workspace`) },
  { key: 'settings', go: (p) => p.goto(`${BASE}/settings`) },
  { key: 'studio-plan', studio: true, go: (p, id) => p.goto(`${BASE}/room/${id}/plan`) },
  {
    key: 'studio-plan-selected',
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}/plan`);
      await p.waitForTimeout(1500);
      // Pressed on the NAME, near the row's start. Playwright's default is the box's
      // centre, which on a piece row is where the floating actions reveal — so the
      // first version of this screen pressed "Keep … where it is", locked the piece,
      // and photographed a HOVERED row it had called selected.
      const row = p.locator('[role="option"].list-row').nth(1);
      if (await row.count()) await row.click({ position: { x: 40, y: 12 } }).catch(() => {});
      await p.mouse.move(0, 0);
    },
  },
  // Below 600px the studio is the phone shell (SheetShell): a toolbar, and panels
  // that rise as a sheet. Between 600 and 1023 it is the tablet pane. Each state is
  // swept at the widths that have it and skipped elsewhere.
  ...[
    ['studio-phone-room', 'plan', async (p) => {
      await p.locator('.phone-tool', { hasText: 'Room' }).click();
    }],
    ['studio-phone-add', 'model', async (p) => {
      await p.locator('.phone-tool', { hasText: 'Add' }).click();
    }],
    ['studio-phone-details', 'plan', async (p) => {
      await p.locator('.phone-tool', { hasText: 'Room' }).click();
      await p.waitForTimeout(500);
      await p.locator('.sheet [role="option"].list-row').nth(1).click({ position: { x: 40, y: 12 } });
      await p.waitForTimeout(300);
      // Selecting does not raise Details; the toolbar's named button does.
      await p.locator('.phone-tool[data-prominent]').click();
    }],
    ['studio-phone-selected', 'model', async (p) => {
      await p.locator('.phone-tool', { hasText: 'Room' }).click();
      await p.waitForTimeout(500);
      await p.locator('.sheet [role="option"].list-row').nth(1).click({ position: { x: 40, y: 12 } });
      await p.waitForTimeout(300);
      await p.locator('.sheet__close').click();
    }],
    ['studio-phone-full', 'model', async (p) => {
      await p.locator('.phone-tool', { hasText: 'View' }).click();
      // Wait for the rise to FINISH: a drag that starts mid-transition measures the
      // head where it was, and a cold SwiftShader page once took long enough that
      // the gesture missed and the screenshot showed `half` under this key's name.
      await p.waitForFunction(() => {
        const s = document.querySelector('.sheet');
        return s?.dataset.snap === 'half' && s.getAnimations().length === 0;
      }, null, { timeout: 5000 });
      // A real drag on the head, up past the top: settles at `full`.
      const head = await p.locator('.sheet__head').boundingBox();
      await p.mouse.move(head.x + 30, head.y + 30);
      await p.mouse.down();
      for (let i = 1; i <= 10; i++) await p.mouse.move(head.x + 30, head.y + 30 - i * 60);
      await p.mouse.up();
      // The state this screenshot is named for is checked, not assumed.
      const ok = await p
        .waitForFunction(() => document.querySelector('.sheet')?.dataset.snap === 'full', null, { timeout: 3000 })
        .then(() => true, () => false);
      if (!ok) throw new Error('studio-phone-full: a drag to the top did not settle the sheet at full');
    }],
    ['studio-phone-more', 'plan', async (p) => {
      await p.getByRole('button', { name: 'More' }).click();
    }],
  ].map(([key, tab, act]) => ({
    key,
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}/${tab}`);
      await p.waitForTimeout(1500);
      if (!(await p.locator('.phone-toolbar').count())) return 'skip';
      await act(p);
      await p.waitForTimeout(600);
    },
  })),
  {
    key: 'studio-pane-selected',
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}/plan`);
      await p.waitForTimeout(1500);
      if (!(await p.locator('.pane-shell').count())) return 'skip';
      await p.locator('.pane [role="option"].list-row').nth(1).click({ position: { x: 40, y: 12 } });
      await p.mouse.move(0, 0);
    },
  },
  { key: 'studio-model', studio: true, go: (p, id) => p.goto(`${BASE}/room/${id}/model`) },
];

async function measure(page) {
  return page.evaluate(() => {
    const W = innerWidth;
    const out = [];
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // `.sr-only` and friends are 1px boxes clipped on purpose: text for a screen reader
      // is not text anyone can see spill.
      if (r.width <= 2 || r.height <= 2 || cs.clip !== 'auto' || cs.clipPath !== 'none') return false;
      return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
    };
    /** On top where it is drawn — a control under a modal or a sheet is not one anybody
     *  can reach, and pairing it with the sheet's own buttons is a false overlap. */
    const onTop = (el) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 0), W - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    };
    const label = (el) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`;
    const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

    if (document.documentElement.scrollWidth > W + 1)
      out.push({ kind: 'hscroll', what: `page ${document.documentElement.scrollWidth}px wide in ${W}px` });

    // A field whose VALUE is wider than it. An input reports no overflow through the
    // text rules below (its value is not text content), so "6.00" printing as "6.0" in
    // a 51px room field passed this sweep at every width until it was seen by eye.
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file])')) {
      if (!vis(el) || !el.value) continue;
      if (el.scrollWidth > el.clientWidth + 1)
        out.push({ kind: 'cut', what: `field "${el.value.slice(0, 20)}" needs ${el.scrollWidth}px, has ${el.clientWidth}px` });
    }
    for (const el of document.querySelectorAll('body *')) {
      if (el instanceof SVGElement) continue; // drawing text is in the drawing's own units
      if (!ownText(el) || !vis(el) || !onTop(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis') {
        // Truncating on purpose is fine; truncating to nothing is not. A name cut to
        // "D…" passed every other rule here while telling nobody anything.
        const fs = parseFloat(cs.fontSize);
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth < fs * 4 && el.textContent.trim().length > 4)
          out.push({ kind: 'starved', what: `${label(el)} shown in ${el.clientWidth}px` });
        continue;
      }
      if (/auto|scroll/.test(cs.overflowX)) continue;
      if (cs.display === 'inline') continue; // an inline box has no width of its own to exceed
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
        out.push({ kind: 'spill', what: `${label(el)} content ${el.scrollWidth}px in ${el.clientWidth}px` });
      const r = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (/auto|scroll/.test(acs.overflowX)) break; // scrolled content is not clipped content
        if (/hidden|clip/.test(acs.overflowX)) {
          if (acs.textOverflow === 'ellipsis') break;
          const ar = a.getBoundingClientRect();
          if (r.right > ar.right + 1 || r.left < ar.left - 1)
            out.push({ kind: 'clipped', what: `${label(el)} crosses ${label(a).split(' ')[0]} by ${Math.round(Math.max(r.right - ar.right, ar.left - r.left))}px` });
          break;
        }
      }
    }

    const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="tab"], [role="slider"], [role="switch"]')].filter((el) => vis(el) && onTop(el));
    const rects = controls.map((el) => el.getBoundingClientRect());
    controls.forEach((el, i) => {
      const r = rects[i];
      let inScroll = false;
      for (let a = el.parentElement; a; a = a.parentElement) if (/auto|scroll/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth) inScroll = true;
      if (!inScroll && (r.left < -1 || r.right > W + 1)) out.push({ kind: 'offscreen', what: `${label(el)} spans ${Math.round(r.left)}–${Math.round(r.right)} of ${W}` });
      if (W < 1024 && el.tagName !== 'A') {
        const after = getComputedStyle(el, '::after');
        const aw = after.content !== 'none' ? parseFloat(after.width) || 0 : 0;
        const ah = after.content !== 'none' ? parseFloat(after.height) || 0 : 0;
        if (Math.max(r.width, aw) < 43.5 || Math.max(r.height, ah) < 43.5)
          out.push({ kind: 'target', what: `${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}` });
      }
    });
    if (W >= 768) {
      const contentW = (el) => {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        return rg.getBoundingClientRect().width;
      };
      for (const el of controls) {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') continue;
        // Not buttons, though they are <button>s: a rename field (`.editable`), a
        // disclosure ROW (a section header, which spans its panel on purpose), and a
        // tile taller than any button — a card you press.
        if (el.classList.contains('editable')) continue;
        if (el.hasAttribute('aria-expanded') && !el.classList.contains('ds-btn')) continue;
        if (el.getBoundingClientRect().height > 64) continue;
        const w = el.getBoundingClientRect().width;
        const c = contentW(el);
        if (w > 240 && c < w / 2) out.push({ kind: 'stretched', what: `${label(el)} ${Math.round(w)}px for ${Math.round(c)}px of content` });
      }
      for (const el of document.querySelectorAll('.ds-card')) {
        if (!vis(el)) continue;
        const w = el.getBoundingClientRect().width;
        if (w > 760) out.push({ kind: 'stretched', what: `${label(el).slice(0, 50)} card ${Math.round(w)}px wide` });
      }
      // The measure is read in the paragraph's own `ch`, by a probe set in its own
      // font, so the rule and the stylesheet's `70ch` speak one unit.
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:80ch;white-space:nowrap';
      for (const el of document.querySelectorAll('p, li')) {
        if (!vis(el) || !ownText(el)) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        el.appendChild(probe);
        const limit = probe.getBoundingClientRect().width;
        probe.remove();
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
        // Only running text — more than one line of it — has a measure to be too long.
        if (r.width > limit + 1 && r.height > lh * 1.5)
          out.push({ kind: 'stretched', what: `${label(el).slice(0, 50)} ${Math.round(r.width)}px, over 80ch (${Math.round(limit)}px)` });
      }
    }
    for (let i = 0; i < controls.length; i++)
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i], b = controls[j];
        if (a.contains(b) || b.contains(a)) continue;
        const r = rects[i], s = rects[j];
        // An adornment set INSIDE a field on purpose — a number field's steppers, a
        // search box's clear button — sits wholly within it and is positioned there.
        const inside = (p, q) => p.left >= q.left - 1 && p.right <= q.right + 1 && p.top >= q.top - 1 && p.bottom <= q.bottom + 1;
        const placed = (el) => getComputedStyle(el).position === 'absolute' || getComputedStyle(el.parentElement).position === 'absolute';
        if ((inside(s, r) && placed(b)) || (inside(r, s) && placed(a))) continue;
        // A popover floats over whatever is under it by design; what matters is that
        // it is on top, which `onTop` already checked at each control's centre.
        if (!!a.closest('.popover') !== !!b.closest('.popover')) continue;
        const w = Math.min(r.right, s.right) - Math.max(r.left, s.left);
        const h = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        if (w > 4 && h > 4 && w * h > 16) out.push({ kind: 'overlap', what: `${label(a)} × ${label(b)} (${Math.round(w)}×${Math.round(h)})` });
      }
    // A divider separates two things. One with nothing drawn on one side of it is a
    // stray line: the thing it divided from was hidden and the rule was left behind.
    const shown = (el) => el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
    for (const d of document.querySelectorAll('.chrome-divider')) {
      if (!shown(d)) continue;
      let prev = d.previousElementSibling, next = d.nextElementSibling;
      while (prev && !shown(prev)) prev = prev.previousElementSibling;
      while (next && !shown(next)) next = next.nextElementSibling;
      if (!prev || !next) out.push({ kind: 'orphan', what: `divider in ${label(d.parentElement).slice(0, 40)} with nothing ${prev ? 'after' : 'before'} it` });
    }
    return out;
  });
}

/** Could not run is not the same answer as found something: a refused connection or a
 *  browser that will not start exits 2, so a caller never reads a dead server as findings. */
const cannotRun = (why, e) => {
  console.error(`fidelity-sweep: ${why} — ${e?.message ?? e}`);
  process.exit(2);
};
const browser = await chromium
  .launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  .catch((e) => cannotRun('the browser would not start', e));
{
  const probe = await browser.newPage();
  await probe.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(async (e) => {
    await browser.close();
    cannotRun(`nothing is serving ${BASE} (start a production build first)`, e);
  });
  await probe.close();
}
const hasTouchAt = (width) => width < 1024;
const report = {};
let findings = 0, targets = 0;
try {
  for (const width of WIDTHS) {
    // Under 1024px the window is a touch screen: `(pointer: coarse)` matches, so the
    // sweep sees what a phone or tablet is served (44px fields, no hover-only
    // actions, the "Tap…" copy), not a laptop's rules at a phone's width.
    const ctx = await browser.newContext({ viewport: { width, height: width < 800 ? 820 : 900 }, hasTouch: hasTouchAt(width) });
    const page = await ctx.newPage();
    // Chromium drops touch emulation after a screenshot — `(pointer: coarse)` read
    // true on the first screen of a width and false on every one after it, so the
    // phone widths were being swept as a laptop's rules. Re-asserted per screen.
    const cdp = hasTouchAt(width) ? await ctx.newCDPSession(page) : null;
    const touch = () => cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    page.on('pageerror', (e) => console.log(`  [pageerror ${width}]`, e.message));
    const id = `sweep-${width}`;
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await seed(page, [room(id, LONG_NAME), room(`${id}-b`, 'Study')]);
    for (const s of SCREENS) {
      if (ONLY && !s.key.startsWith(ONLY)) continue;
      await touch();
      if ((await s.go(page, id)) === 'skip') continue;
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(s.studio ? 2500 : 700);
      const found = await measure(page);
      const shot = join(OUT, `${s.key}-${width}${UNITS === 'm' ? '' : '-' + UNITS}.jpg`);
      await page.screenshot({ path: shot, type: 'jpeg', quality: 60, fullPage: !s.studio });
      report[`${s.key}@${width}`] = found;
      const real = found.filter((f) => f.kind !== 'target');
      findings += real.length;
      targets += found.length - real.length;
      console.log(`${real.length ? 'FAIL' : 'ok  '} ${s.key}@${width}${real.length ? '' : ''}  (${found.length - real.length} small targets)`);
      for (const f of real) console.log(`       ${f.kind.padEnd(9)} ${f.what}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${findings} findings, ${targets} small touch targets — screenshots and report.json in ${OUT}`);
process.exit(findings ? 1 : 0);
