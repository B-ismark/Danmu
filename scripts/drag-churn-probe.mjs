// What a drag that carries company costs the GPU — counted, not eyeballed.
//
// The report was "the lamp moving with the table introduces a performance issue,
// especially with the wobble on both". This drags a coffee table 20 moves in a 6 × 5 m
// room and counts WebGL calls over the gesture, twice: with a table lamp riding the
// table (`MODE=carried`, the lamp rigidly parented, which is what a lamp dropped on a
// table becomes) and with the lamp on the floor across the room (`MODE=apart`). The two
// runs must match. A count that grows with company is work a re-render is redoing.
//
// Run against a PRODUCTION build, with Playwright installed outside this repo, as
// `scripts/capture-route-probe.mjs` explains:
//
//     pnpm build && pnpm start -p 3000
//     MODE=carried PW_ROOT=/some/scratch node scripts/drag-churn-probe.mjs
//     MODE=apart   PW_ROOT=/some/scratch node scripts/drag-churn-probe.mjs
//
// REDUCED=1 turns on reduced motion, which switches the wobble off — the control for
// "is it the wobble". PX / PY are where the press lands (the table, at 1440 × 900 with
// the default camera); the script prints the stored transforms after the drop, so a
// press that missed and orbited the camera instead shows up as a coffee table that
// never moved rather than as a fast drag.
//
// MEASURED (swiftshader, 20 moves), lamp riding / lamp apart:
//
//                      textures  buffers  attachments  wall
//   before              38        372      175          36.2 s   / 2, 12, 24, 11.8 s
//   Environment fixed   38        372       60          11.5 s
//   + shadow scale       0        296       22          11.4 s
//   + wall holes         0          8       22          11.4 s   / 0, 8, 22, 11.8 s
//
// Reduced motion left the "before" row where it was (241.7 s against 252.4 s over 120
// moves), so the wobble was never the cost. `tests/render-churn.test.ts` holds the three
// fixes and the drei behaviour that makes each one matter.

import { createRequire } from 'node:module';
import { join } from 'node:path';

const PW_ROOT = process.env.PW_ROOT;
const req = createRequire(PW_ROOT ? join(PW_ROOT, 'probe.cjs') : import.meta.url);
const { chromium } = req('playwright');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const MODE = process.env.MODE === 'apart' ? 'apart' : 'carried';
const REDUCED = process.env.REDUCED === '1';
const N = +(process.env.N || 20);

const b = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: REDUCED ? 'reduce' : 'no-preference' });
await ctx.addInitScript(() => {
  window.__gl = {};
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const k of ['createTexture', 'createBuffer', 'framebufferTexture2D', 'linkProgram', 'drawElements', 'drawArrays']) {
      const f = C.prototype[k];
      if (!f) continue;
      C.prototype[k] = function (...a) { window.__gl[k] = (window.__gl[k] || 0) + 1; return f.apply(this, a); };
    }
  }
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));

const P = (o) => ({ rot: 0, locked: false, ...o });
const parts = [
  P({ id: 'coffee', name: 'Coffee table', category: 'table', shape: 'coffee-table', pos: [0, 0, 0], dimMM: [1600, 1000, 450] }),
  P({ id: 'lamp', name: 'Table lamp', category: 'lamp', shape: 'lamp-table', pos: MODE === 'carried' ? [0.3, 0.45, 0] : [2.4, 0, 1.9], dimMM: [300, 300, 500] }),
  P({ id: 'sofa', name: 'Sofa', category: 'sofa', shape: 'sofa', pos: [0, 0, -2.0], dimMM: [2000, 900, 800] }),
];
const transforms = { positions: {}, rotations: {}, dims: {}, parentIds: MODE === 'carried' ? { lamp: 'coffee' } : {}, hidden: {}, pinned: {} };
const id = `churn-${MODE}${REDUCED ? '-r' : ''}`;

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(async ([parts, transforms, id]) => {
  localStorage.setItem('danmu-studio-gate-dismissed', '1');
  await new Promise((res, rej) => {
    const rq = indexedDB.open('keyval-store');
    rq.onupgradeneeded = () => rq.result.createObjectStore('keyval');
    rq.onsuccess = () => {
      const tx = rq.result.transaction('keyval', 'readwrite');
      const st = tx.objectStore('keyval');
      const fp = [[-3, -2.5], [3, -2.5], [3, 2.5], [-3, 2.5]];
      st.put({ id, createdAt: Date.now(), version: 1, name: 'Churn', layoutId: 'custom', width: 6, depth: 5, height: 2.6, footprint: fp }, `room:${id}:meta`);
      st.put(parts, `room:${id}:scene`);
      st.put(transforms, `room:${id}:transforms`);
      st.put(Date.now(), `room:${id}:touched`);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    };
  });
}, [parts, transforms, id]);
await page.goto(`${BASE}/room/${id}/model`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForTimeout(9000);

const cx = +(process.env.PX || 690);
const cy = +(process.env.PY || 590);
await page.mouse.move(cx, cy);
await page.mouse.down();
const g0 = await page.evaluate(() => ({ ...window.__gl }));
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2;
  await page.mouse.move(cx + Math.sin(a) * 120, cy + (1 - Math.cos(a)) * 40);
}
const t1 = Date.now();
const g1 = await page.evaluate(() => ({ ...window.__gl }));
await page.mouse.up();
await page.waitForTimeout(1500);

const stored = await page.evaluate((id) => new Promise((res) => {
  const rq = indexedDB.open('keyval-store');
  rq.onsuccess = () => {
    const g = rq.result.transaction('keyval').objectStore('keyval').get(`room:${id}:transforms`);
    g.onsuccess = () => res(g.result?.positions ?? {});
  };
}), id);
const gl = Object.fromEntries(Object.keys(g1).map((k) => [k, g1[k] - (g0[k] || 0)]));
console.log(JSON.stringify({ MODE, REDUCED, moves: N, wallMs: t1 - t0, gl, stored }));
await b.close();
