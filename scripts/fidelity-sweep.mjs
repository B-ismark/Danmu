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
//   orphan    a `.chrome-pill__rule` with nothing shown on one side of it — the control it
//             separated was hidden and the rule stayed (the plan's old zoom-box divider on
//             a phone was the first).
//   stretched on widths of 768 and up, a control, card or paragraph spread wider than
//             its content can use: a button more than 240px wide whose label and
//             icon occupy under half of it, a tile (a pressable card, taller than a
//             button) wider than `--measure-page`, a `.ds-card` over 760px, or a
//             line of text over ~80 characters (WCAG 1.4.8; Bringhurst's 45–75). A
//             thing does not get wider because the window did. Rename fields,
//             disclosure rows and controls laid over something else (a found piece's
//             box on a photo) are not buttons and are skipped. A line is measured
//             line by line, from the text that flows in the block itself, so a wide
//             child is not read as a long line; one line counts, and any block of
//             text is read, not only a `<p>`: the scan screen's subtitle ran 952px on
//             one line at 1920 and passed twice over, being a `<div>` and never
//             wrapping to the two lines the rule used to ask for. And an image, video
//             or canvas taller than the window, which nobody can see whole.
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

/** Where `lib/storage.ts` keeps rooms (idb-keyval's defaults): named once, because
 *  `seed` and `openRoom` both write there, and one left on an old name would open an
 *  empty room and sweep a screen it never rendered, clean. */
const IDB = { db: 'keyval-store', store: 'keyval' };

async function seed(page, rooms) {
  await page.evaluate(
    async ([rooms, units, IDB]) => {
      localStorage.setItem('danmu-settings', JSON.stringify({ state: { dimUnit: units }, version: 0 }));
      await new Promise((res, rej) => {
        const rq = indexedDB.open(IDB.db);
        rq.onupgradeneeded = () => rq.result.createObjectStore(IDB.store);
        rq.onsuccess = () => {
          const tx = rq.result.transaction(IDB.store, 'readwrite');
          const st = tx.objectStore(IDB.store);
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
    [rooms, UNITS, IDB],
  );
}

/** Screens and states. `go` returns once the state is on screen. */
const SCREENS = [
  { key: 'layout-pick', go: (p) => p.goto(`${BASE}/onboarding/layout-pick`) },
  // The size fields TYPED: a small room, so every outline redraws at a size no preset
  // offers and the reset appears beside the note. Per unit, because a legal 3.2 m is
  // 10.5 in feet and 3.2 cm is no room at all. Filled after the network settles: a
  // fill that lands before hydration is overwritten by the controlled value.
  {
    key: 'layout-pick-typed',
    go: async (p) => {
      await p.goto(`${BASE}/onboarding/layout-pick`);
      await p.waitForLoadState('networkidle').catch(() => {});
      const typed = { m: ['3.2', '2.6'], cm: ['320', '260'], mm: ['3200', '2600'], ft: ['10.5', '8.5'], in: ['126', '102'] }[UNITS];
      await p.getByLabel(/^Width in /).fill(typed[0]);
      await p.getByLabel(/^Depth in /).fill(typed[1]);
      await p.evaluate(() => document.activeElement?.blur());
    },
  },
  // …and REFUSED, after a press: every sentence the step can say on screen at once,
  // beside the fields it names. `999999` is out of range in all five units, and an
  // empty box is the other kind of wrong.
  {
    key: 'layout-pick-refused',
    go: async (p) => {
      await p.goto(`${BASE}/onboarding/layout-pick`);
      await p.waitForLoadState('networkidle').catch(() => {});
      await p.getByLabel(/^Width in /).fill('999999');
      await p.getByLabel(/^Depth in /).fill('');
      await p.getByRole('button', { name: /^Start decorating/ }).click();
    },
  },
  // With no room open the capture screen is a gate card, and for as long as this list
  // named that state `capture` the sweep never saw the screen itself: the drop zone
  // and the instruction line stretched edge to edge at 1920 with every width `ok`.
  { key: 'capture-no-room', go: (p) => p.goto(`${BASE}/onboarding/capture`) },
  { key: 'workspace', go: (p) => p.goto(`${BASE}/`) },
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
  // A room still at its shape's typical size (`roughSize`: the size step was skipped).
  // The note sits above the size boxes, so it is photographed wherever those are: the
  // rail on a desk — including the compact step's narrow one, which is what the note's
  // wrapping is for — and the Room sheet on a phone.
  {
    key: 'studio-rough',
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}-rough/plan`);
      await p.waitForTimeout(1500);
      if (await p.locator('.phone-toolbar').count()) {
        await p.locator('.phone-tool', { hasText: 'Room' }).click();
        await p.waitForTimeout(600);
      }
    },
  },
  // The studio's size boxes REFUSED. In the glass rail the clay rule owns
  // `box-shadow`, so the danger rim on `.field[aria-invalid]` is only half of what it
  // is anywhere else — this is where that has to be looked at, not assumed.
  {
    key: 'studio-dims-refused',
    studio: true,
    go: async (p, id) => {
      await p.goto(`${BASE}/room/${id}/plan`);
      await p.waitForTimeout(1500);
      if (await p.locator('.phone-toolbar').count()) {
        await p.locator('.phone-tool', { hasText: 'Room' }).click();
        await p.waitForTimeout(600);
      }
      const width = p.getByLabel('Width', { exact: true });
      if (!(await width.count())) return 'skip';
      await width.first().fill('999999');
      await p.waitForTimeout(500);
    },
  },
  // The capture screen with a room open, empty and then with two walls photographed.
  // Last, because opening a room is what the workspace and settings read too, and the
  // screens above are swept without one.
  { key: 'capture', go: async (p, id) => {
    await openRoom(p, `${id}-cap`);
    await p.goto(`${BASE}/onboarding/capture`);
  } },
  { key: 'capture-photos', go: async (p, id) => {
    await openRoom(p, `${id}-cap`, ['n', 'e']);
    await p.goto(`${BASE}/onboarding/capture`);
  } },
  // The scan screen for the same two photos. No key is set, so nothing is sent
  // anywhere: this is the hand-drawn path, with its notice.
  { key: 'detect', go: async (p, id) => {
    await openRoom(p, `${id}-cap`, ['n', 'e']);
    await p.goto(`${BASE}/onboarding/detect`);
    await p.waitForTimeout(3000);
  } },
];

/** Make `id` the open room, with a plain photo on each of `slots`. The room is written
 *  here rather than seeded, so the workspace above is swept with the rooms it always was. */
async function openRoom(page, id, slots = []) {
  await page.evaluate(
    async ([id, slots, meta, IDB]) => {
      localStorage.setItem('danmu-room', JSON.stringify({ state: { roomId: id }, version: 0 }));
      const photo = async (hue) => {
        const c = document.createElement('canvas');
        c.width = 1200;
        c.height = 900;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, 900);
        grad.addColorStop(0, `hsl(${hue} 20% 80%)`);
        grad.addColorStop(1, `hsl(${hue} 15% 45%)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 1200, 900);
        return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
      };
      const blobs = await Promise.all(slots.map((_, i) => photo(30 + i * 60)));
      await new Promise((res, rej) => {
        const rq = indexedDB.open(IDB.db);
        rq.onsuccess = () => {
          const tx = rq.result.transaction(IDB.store, 'readwrite');
          const st = tx.objectStore(IDB.store);
          st.put(meta, `room:${id}:meta`);
          slots.forEach((slot, i) => st.put({ slot, blob: blobs[i], takenAt: Date.now() }, `room:${id}:cap:${slot}`));
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
        rq.onerror = () => rej(rq.error);
      });
    },
    [id, slots, room(id, 'Hall'), IDB],
  );
}

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
      // Resolved by the browser, so the rule moves when the token does and speaks
      // whatever unit it is written in. No fallback: a token that resolves to nothing
      // is said, rather than quietly replaced by a number that looks like it.
      const pageProbe = document.createElement('div');
      pageProbe.style.cssText = 'position:absolute;visibility:hidden;inline-size:var(--measure-page)';
      document.body.appendChild(pageProbe);
      const measurePage = pageProbe.getBoundingClientRect().width;
      pageProbe.remove();
      if (!measurePage) out.push({ kind: 'stretched', what: '--measure-page resolves to nothing, so no tile was measured' });
      const contentW = (el) => {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        return rg.getBoundingClientRect().width;
      };
      for (const el of controls) {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') continue;
        // Not buttons, though they are <button>s: a rename field (`.editable`) and a
        // disclosure ROW (a section header, which spans its panel on purpose).
        if (el.classList.contains('editable')) continue;
        if (el.hasAttribute('aria-expanded') && !el.classList.contains('ds-btn')) continue;
        // Nor one laid over something else, as the keep toggle over a found piece is:
        // it is as big as the piece in the photo, which is not a layout's choice.
        if (getComputedStyle(el).position === 'absolute') continue;
        const w = el.getBoundingClientRect().width;
        // A tile taller than any button is a card you press: its content is meant to
        // sit in space, so the question is not how full it is but whether it grew
        // with the window. The capture screen's drop zone spanned 1,886px at 1920.
        if (el.getBoundingClientRect().height > 64) {
          if (measurePage && w > measurePage + 1) out.push({ kind: 'stretched', what: `${label(el).slice(0, 50)} tile ${Math.round(w)}px wide, over --measure-page (${measurePage}px)` });
          continue;
        }
        const c = contentW(el);
        if (w > 240 && c < w / 2) out.push({ kind: 'stretched', what: `${label(el)} ${Math.round(w)}px for ${Math.round(c)}px of content` });
      }
      // A picture taller than the window cannot be seen whole, and whatever sits under
      // it is below the fold: the scan screen's tools for drawing a box were, at 1920.
      // A viewfinder and a canvas are pictures too.
      for (const el of document.querySelectorAll('img, video, canvas')) {
        if (!vis(el)) continue;
        const h = el.getBoundingClientRect().height;
        const name = `${el.tagName.toLowerCase()}${el.alt ? ` "${el.alt.slice(0, 40)}"` : ''}`;
        if (h > innerHeight) out.push({ kind: 'stretched', what: `${name} ${Math.round(h)}px tall in a ${innerHeight}px window` });
      }
      for (const el of document.querySelectorAll('.ds-card')) {
        if (!vis(el)) continue;
        const w = el.getBoundingClientRect().width;
        if (w > 760) out.push({ kind: 'stretched', what: `${label(el).slice(0, 50)} card ${Math.round(w)}px wide` });
      }
      // A line of words over 80ch, in any block. Measured by LINE: the text that
      // flows in the block itself — through its inline children, as a sentence with a
      // link or a bold word does — grouped by the line it sits on. Not the range of
      // the block's contents, which is the union of every box inside it, so a caption
      // beside a wide toolbar read as a line as wide as the toolbar.
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:80ch;white-space:nowrap';
      // 80ch in the block's own font, measured once per font rather than per block.
      const limits = new Map();
      const limitFor = (el, cs) => {
        const key = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStretch, cs.fontStyle].join('|');
        if (!limits.has(key)) {
          el.appendChild(probe);
          limits.set(key, probe.getBoundingClientRect().width);
          probe.remove();
        }
        return limits.get(key);
      };
      const INLINE = new Set(['inline', 'contents']);
      // Text inside a field is not laid out as the page's text.
      const FIELD = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'OPTION']);
      const flowText = (block) => {
        const out = [];
        const walk = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => {
            if (n.nodeType === 3) return n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            if (n === block) return NodeFilter.FILTER_SKIP;
            const cs = getComputedStyle(n);
            // A block, a positioned box or a field inside is its own measure, or none.
            if (!INLINE.has(cs.display) || cs.position === 'absolute' || cs.position === 'fixed' || FIELD.has(n.tagName) || n instanceof SVGElement)
              return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP;
          },
        });
        for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n);
        return out;
      };
      const longestLine = (texts) => {
        const rects = [];
        const rg = document.createRange();
        for (const t of texts) {
          rg.selectNodeContents(t);
          for (const r of rg.getClientRects()) if (r.width > 0 && r.height > 0) rects.push(r);
        }
        rects.sort((a, b) => a.top - b.top);
        let best = 0;
        let line = null;
        for (const r of rects) {
          const mid = (r.top + r.bottom) / 2;
          if (line && mid >= line.top && mid <= line.bottom) {
            line.left = Math.min(line.left, r.left);
            line.right = Math.max(line.right, r.right);
          } else line = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          best = Math.max(best, line.right - line.left);
        }
        return best;
      };
      for (const el of document.querySelectorAll('body *')) {
        if (el instanceof SVGElement || FIELD.has(el.tagName)) continue;
        const cs = getComputedStyle(el);
        if (INLINE.has(cs.display) || !vis(el)) continue;
        const texts = flowText(el);
        if (!texts.length) continue;
        // No wider than the block: a clipped, ellipsised name is as long as it shows.
        const line = Math.min(longestLine(texts), el.getBoundingClientRect().width);
        const limit = limitFor(el, cs);
        if (line > limit + 1)
          out.push({ kind: 'stretched', what: `${label(el).slice(0, 50)} line ${Math.round(line)}px, over 80ch (${Math.round(limit)}px)` });
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
    for (const d of document.querySelectorAll('.chrome-pill__rule')) {
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
    await seed(page, [room(id, LONG_NAME), room(`${id}-b`, 'Study'), { ...room(`${id}-rough`, 'Spare room'), roughSize: true }]);
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
