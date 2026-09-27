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
  // Below 1024px the rails are a bottom sheet (SheetShell). Its states are swept like
  // any other screen; above 1024px there is no sheet and these are skipped.
  {
    key: 'studio-sheet-room',
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}/plan`);
      await p.waitForTimeout(1500);
      if (!(await p.locator('.sheet').count())) return 'skip';
      await p.getByRole('tab', { name: 'Room' }).click();
      await p.waitForTimeout(500);
    },
  },
  {
    key: 'studio-sheet-details',
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}/plan`);
      await p.waitForTimeout(1500);
      if (!(await p.locator('.sheet').count())) return 'skip';
      await p.getByRole('tab', { name: 'Room' }).click();
      await p.waitForTimeout(500);
      await p.locator('.sheet [role="option"].list-row').nth(1).click({ position: { x: 40, y: 12 } });
      await p.waitForTimeout(500);
    },
  },
  {
    // Selected, then the sheet lowered: the piece's name rides in the tab at rest.
    key: 'studio-sheet-rest-selected',
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}/plan`);
      await p.waitForTimeout(1500);
      if (!(await p.locator('.sheet').count())) return 'skip';
      await p.getByRole('tab', { name: 'Room' }).click();
      await p.waitForTimeout(500);
      await p.locator('.sheet [role="option"].list-row').nth(1).click({ position: { x: 40, y: 12 } });
      await p.waitForTimeout(300);
      await p.locator('.sheet__handle').focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(600);
    },
  },
  {
    key: 'studio-sheet-full',
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}/model`);
      await p.waitForTimeout(1500);
      if (!(await p.locator('.sheet').count())) return 'skip';
      await p.getByRole('tab', { name: 'Details' }).click();
      await p.waitForTimeout(400);
      // A real drag on the bar, up past the top: settles at `full`.
      const bar = await p.locator('.sheet__bar').boundingBox();
      await p.mouse.move(bar.x + 20, bar.y + 8);
      await p.mouse.down();
      for (let i = 1; i <= 10; i++) await p.mouse.move(bar.x + 20, bar.y + 8 - i * 80);
      await p.mouse.up();
      await p.waitForTimeout(600);
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
        const w = Math.min(r.right, s.right) - Math.max(r.left, s.left);
        const h = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        if (w > 4 && h > 4 && w * h > 16) out.push({ kind: 'overlap', what: `${label(a)} × ${label(b)} (${Math.round(w)}×${Math.round(h)})` });
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
const report = {};
let findings = 0, targets = 0;
try {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 800 ? 820 : 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  [pageerror ${width}]`, e.message));
    const id = `sweep-${width}`;
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await seed(page, [room(id, LONG_NAME), room(`${id}-b`, 'Study')]);
    for (const s of SCREENS) {
      if (ONLY && !s.key.startsWith(ONLY)) continue;
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
