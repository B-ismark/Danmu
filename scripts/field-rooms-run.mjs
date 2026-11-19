// Walk the real capture route with the field-room photos and record what the app builds.
// The photos, the rooms' ground truth and the last recorded runs live in
// tests/fixtures/field-rooms/ — read its README before reading any number this prints.
//
// Run against a PRODUCTION build, never `next dev`:
//
//     pnpm build && pnpm exec next start -p 3061
//     BASE=http://localhost:3061 OUT=/some/scratch/runs \
//       node scripts/field-rooms-run.mjs seaview-suite ultrawide 1234
//
// Arguments: <room slug> <lens: ultrawide | 1x> [upload order, e.g. 4231] [--no-detect]
// The order is the order the four wall photos are handed to the file picker; the app
// should put them back on Walls 1–4 from their shutter times, and `log.txt` says whether
// it did. KEEP=none leaves the review screen's ticks as the app set them; the default
// ticks every row, which is the worst case the studio has to hold.
//
// Playwright is not a dependency of this repo. Install it outside (or use a machine that
// has it) and point PW_ROOT at that directory, as scripts/capture-route-probe.mjs does.
// The first run downloads the ~65 MB local furniture finder into the browser profile in
// OUT, so keep OUT between runs.
//
// What it writes, per run, into OUT/<slug>-<lens>-<order>/:
//   log.txt           wall slots (right/wrong), detect time, rows offered and pre-ticked
//   capture-text.txt  the capture screen's text (wall-length labels)
//   detect-text.txt   the review screen's text
//   rows.json         every review row: label, ticked or not, its note
//   room.json         the saved room from IndexedDB (photos replaced by "<blob N>")
//   probe.json / cals.json  only when the build exposes window.__probe / window.__cals,
//                     a temporary hook that is NOT in the app; absent otherwise
//   *.png             screenshots of each step
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', 'tests', 'fixtures', 'field-rooms');
const BASE = process.env.BASE || 'http://localhost:3061';
const OUT_ROOT = process.env.OUT;
const PW_ROOT = process.env.PW_ROOT;
const req = createRequire(PW_ROOT ? join(PW_ROOT, 'probe.cjs') : import.meta.url);

const [slug, lens, order = '1234', flag] = process.argv.slice(2);
const kit = JSON.parse(readFileSync(join(KIT, 'rooms.json'), 'utf8'));
const room = kit.rooms.find((r) => r.slug === slug);
if (!room || !['ultrawide', '1x'].includes(lens) || !/^[1-4]{4}$/.test(order) || !OUT_ROOT) {
  console.error(
    'usage: OUT=<dir> node scripts/field-rooms-run.mjs <room> <ultrawide|1x> [order] [--no-detect]\n' +
      '  rooms: ' + kit.rooms.map((r) => r.slug).join(', '),
  );
  process.exit(2);
}
let chromium;
try {
  ({ chromium } = req('playwright'));
} catch {
  console.error('playwright not found. Install it outside this repo and set PW_ROOT to that directory.');
  process.exit(2);
}

const detect = flag !== '--no-detect';
const OUT = join(OUT_ROOT, `${slug}-${lens}-${order}`);
mkdirSync(OUT, { recursive: true });
const log = (...a) => {
  console.log(...a);
  appendFileSync(join(OUT, 'log.txt'), a.join(' ') + '\n');
};

const ctx = await chromium.launchPersistentContext(join(OUT_ROOT, '.pw-profile'), {
  viewport: { width: 1440, height: 950 },
});
try {
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('pageerror', (e) => log('PAGEERROR', e.message));
  const shot = (n) => page.screenshot({ path: join(OUT, `${n}.png`) }).catch(() => {});

  await page.goto(`${BASE}/onboarding/layout-pick`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: /^Rectangle[,\s]/ }).click();
  for (const [axis, v] of [['Width', room.widthM], ['Depth', room.depthM], ['Height', room.heightM]]) {
    const f = page.getByLabel(`${axis} in m`);
    await f.fill(String(v));
    await f.press('Tab');
  }
  await page.waitForTimeout(300);
  await shot('1-layout');
  await page.getByRole('button', { name: /^Start with photos$/ }).click();
  await page.waitForURL('**/onboarding/capture', { timeout: 30000 });

  const files = order.split('').map((n) => join(KIT, 'photos', `${slug}-wall${n}-${lens}.jpg`));
  await page.locator('input[aria-label="Choose photos of your room"]').setInputFiles(files);
  await page.getByAltText('Your photo of Wall 4').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot('2-capture');

  // Which source photo landed in which slot: compare 16×12 thumbnails.
  const srcs = files.map((f) => 'data:image/jpeg;base64,' + readFileSync(f).toString('base64'));
  const assign = await page.evaluate(async (list) => {
    const fp = (src) =>
      new Promise((res) => {
        const im = new Image();
        im.onload = () => {
          const c = document.createElement('canvas');
          c.width = 16;
          c.height = 12;
          const g = c.getContext('2d');
          g.drawImage(im, 0, 0, 16, 12);
          res(Array.from(g.getImageData(0, 0, 16, 12).data));
        };
        im.src = src;
      });
    const ref = [];
    for (const s of list) ref.push(await fp(s));
    const out = {};
    for (let w = 1; w <= 4; w++) {
      const el = document.querySelector(`img[alt="Your photo of Wall ${w}"]`);
      if (!el) {
        out[w] = null;
        continue;
      }
      const f = await fp(el.src);
      let best = -1;
      let bd = Infinity;
      ref.forEach((r, i) => {
        let d = 0;
        for (let k = 0; k < r.length; k++) d += Math.abs(r[k] - f[k]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      out[w] = best;
    }
    return out;
  }, srcs);
  const seq = order.split('');
  const slotOf = {};
  for (let w = 1; w <= 4; w++) slotOf[w] = assign[w] == null ? '—' : `wall${seq[assign[w]]}`;
  const right = [1, 2, 3, 4].filter((w) => slotOf[w] === `wall${w}`).length;
  log(
    `SLOTS ${slug} ${lens} order=${order}: ` +
      [1, 2, 3, 4].map((w) => `Wall ${w}←${slotOf[w]}`).join('  ') +
      `  (${right}/4 right)`,
  );
  const text = async () => (await page.locator('main').innerText().catch(() => '')).replace(/\n+/g, ' | ');
  writeFileSync(join(OUT, 'capture-text.txt'), await text());

  if (detect) {
    await page.getByRole('button', { name: /^Continue$/ }).first().click();
    await page.waitForURL('**/onboarding/detect', { timeout: 30000 });
    const t0 = Date.now();
    let accepted = false;
    const cont = () => page.getByRole('button', { name: /^Continue (with \d+ piece|to the studio|with an empty room)/ });
    for (;;) {
      // The scan screen asks in its card; the photos screen may already have started it.
      const dl = page.getByRole('dialog').getByRole('button', { name: /^(Download|Update)$/ });
      if (!accepted && (await dl.count())) {
        log('accepting finder download');
        await dl.first().click();
        accepted = true;
      }
      const done = await cont().count();
      const running = await page.getByRole('dialog').count();
      if (done && !running && Date.now() - t0 > 5000) break;
      if (Date.now() - t0 > 15 * 60 * 1000) {
        log('TIMEOUT waiting for detection');
        break;
      }
      await page.waitForTimeout(2000);
    }
    log(`detect took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await page.waitForTimeout(1000);
    await shot('3-detect');
    const probe = await page.evaluate(() => {
      const p = window.__probe;
      return p
        ? { v: p.v, d: p.d.map((x) => ({ label: x.label, conf: x.conf, source: x.source, box: x.box, dimMM: x.dimMM, slot: x.slot })) }
        : null;
    });
    if (probe) writeFileSync(join(OUT, 'probe.json'), JSON.stringify(probe, null, 1));
    const cals = await page.evaluate(() => window.__cals || null);
    if (cals) writeFileSync(join(OUT, 'cals.json'), JSON.stringify(cals, null, 1));
    log('initially kept: ' + (await page.getByText(/of \d+ pieces? kept/).first().textContent().catch(() => '?')));
    writeFileSync(join(OUT, 'detect-text.txt'), await text());

    for (let w = 1; w <= 4; w++) {
      const tab = page
        .locator('[role="group"][aria-label="Your wall photos"]')
        .getByRole('button', { name: new RegExp('^Wall ' + w) });
      if (await tab.count()) {
        await tab.first().evaluate((b) => b.click());
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(OUT, `3-wall${w}.png`), fullPage: true }).catch(() => {});
      }
    }
    const allWalls = page.getByRole('button', { name: /^All walls$/ }).or(page.getByRole('radio', { name: /^All walls$/ }));
    if (await allWalls.count()) await allWalls.first().evaluate((b) => b.click());
    await page.waitForTimeout(600);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('button[aria-label^="Keep "]')].map((b) => ({
        label: b.getAttribute('aria-label').slice(5),
        pressed: b.getAttribute('aria-pressed'),
        title: b.getAttribute('title'),
        text: (b.parentElement.innerText || '').replace(/\s+/g, ' ').trim(),
      })),
    );
    writeFileSync(join(OUT, 'rows.json'), JSON.stringify(rows, null, 1));
    log(`rows offered: ${rows.length}`);
    if ((process.env.KEEP || 'all') === 'all') {
      for (let i = 0; i < 80; i++) {
        const b = page.locator('button[aria-label^="Keep "][aria-pressed="false"]').first();
        if (!(await b.count())) break;
        await b.evaluate((el) => el.click());
        await page.waitForTimeout(80);
      }
    }
    await page.waitForTimeout(600);
    await shot('3b-detect-kept');
    log('status: ' + (await page.getByText(/of \d+ pieces? kept/).first().textContent().catch(() => '?')));
    await cont().first().evaluate((b) => b.click());
    await page.waitForURL('**/room/**', { timeout: 60000 });
    await page.waitForTimeout(4000);
    const roomId = /\/room\/([^/]+)/.exec(page.url())[1];
    await shot('4-model');

    const dump = await page.evaluate(async (id) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('keyval-store');
        r.onsuccess = () => res(r.result);
        r.onerror = rej;
      });
      const st = db.transaction('keyval', 'readonly').objectStore('keyval');
      const keys = await new Promise((res) => {
        const r = st.getAllKeys();
        r.onsuccess = () => res(r.result);
      });
      const out = {};
      for (const k of keys) {
        if (!String(k).includes(id)) continue;
        const v = await new Promise((res) => {
          const r = st.get(k);
          r.onsuccess = () => res(r.result);
        });
        out[k] = JSON.parse(JSON.stringify(v, (_k, vv) => (vv instanceof Blob ? `<blob ${vv.size}>` : vv)));
      }
      return out;
    }, roomId);
    writeFileSync(join(OUT, 'room.json'), JSON.stringify(dump, null, 1));

    await page.goto(`${BASE}/room/${roomId}/plan`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await shot('5-plan');
    log(`room ${roomId} saved`);
  }
} catch (e) {
  log('ERROR', e.message);
  process.exitCode = 1;
} finally {
  await ctx.close();
}
