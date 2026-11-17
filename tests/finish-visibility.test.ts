// Is every finish option VISIBLY different from the default it replaces?
//
// This file exists because of a deletion. A Finish row (Auto / Matte / Satin / Polished
// / Metal) once shipped in the Inspector and was removed because it "changed nothing a
// person could see" (Design.md): it moved roughness, and under the room's soft image
// light a roughness step from 0.7 to 0.5 barely moves a pixel. So each option here has
// to clear a bar on at least ONE of four things a renderer is actually handed, and the
// table prints on every green run so a drifting option is seen before it is shipped:
//
//   · tone    — std-dev of the colour map: how much the colour itself varies (grain, dye).
//   · relief  — mean slope the normal map draws, after `bump` and `normalScale`.
//   · gloss   — the GGX highlight's peak, 1/α⁴ with α = roughness², roughness being the
//               preset's times the roughness map's mean, as three multiplies them.
//   · sheen   — 1/sheenRoughness for a cloth preset: how tight its edge glow is.
//
// The bar is a factor of 3 either way. That is deliberately coarse: these are proxies
// for a rendered image, and a proxy can only be trusted with a difference that is large.
// The roughness-only row that was deleted would have read 1.9× on gloss and failed.

import { describe, expect, it } from 'vitest';
import { SURFACE, type SurfaceKey } from '@/components/three/materials';
import {
  boucleFields,
  fabricFields,
  paintedWoodFields,
  velvetFields,
  woodFields,
  type SurfaceFields,
} from '@/lib/textures';

type Preset = { roughness: number; normalScale: { x: number }; sheenRoughness?: number };

function stats(f: SurfaceFields, key: SurfaceKey) {
  const p = SURFACE[key] as unknown as Preset;
  const mean = (a: Float32Array) => a.reduce((s, x) => s + x, 0) / a.length;
  const m = mean(f.tone.data);
  const tone = Math.sqrt(f.tone.data.reduce((s, x) => s + (x - m) ** 2, 0) / f.tone.data.length);
  const n = f.height.size;
  const d = f.height.data;
  let slope = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const gx = (d[y * n + ((x + 1) % n)] - d[y * n + ((x - 1 + n) % n)]) * 0.5;
      const gy = (d[((y + 1) % n) * n + x] - d[((y - 1 + n) % n) * n + x]) * 0.5;
      slope += Math.hypot(gx, gy) * f.bump * p.normalScale.x;
    }
  const r = p.roughness * mean(f.rough.data);
  const a = r * r;
  return { tone, relief: slope / (n * n), gloss: 1 / (a * a), sheen: p.sheenRoughness ? 1 / p.sheenRoughness : 0 };
}

type Stats = ReturnType<typeof stats>;
const ratio = (a: number, b: number) => (a === 0 || b === 0 ? (a === b ? 1 : Infinity) : Math.max(a / b, b / a));
const BAR = 3;

const wood = stats(woodFields(), 'wood');
const linen = stats(fabricFields(), 'fabric');
const OPTIONS: Array<{ name: string; vs: Stats; is: Stats }> = [
  { name: 'wood: painted', vs: wood, is: stats(paintedWoodFields(), 'woodPainted') },
  { name: 'wood: lacquered', vs: wood, is: stats(woodFields(), 'woodLacquer') },
  { name: 'fabric: velvet', vs: linen, is: stats(velvetFields(), 'velvet') },
  { name: 'fabric: boucle', vs: linen, is: stats(boucleFields(), 'boucle') },
];

const fmt = (x: number) => (x >= 100 ? x.toFixed(0) : x.toPrecision(3));
console.log('\nfinish visibility — ratio to the default on each channel (bar ×3)');
for (const o of OPTIONS) {
  const cells = (['tone', 'relief', 'gloss', 'sheen'] as const).map((k) => `${k} ×${fmt(ratio(o.is[k], o.vs[k]))}`);
  console.log(`  ${o.name.padEnd(16)} ${cells.join('  ')}`);
}

describe('every finish option is visibly different from its default', () => {
  for (const o of OPTIONS) {
    it(o.name, () => {
      const best = Math.max(...(['tone', 'relief', 'gloss', 'sheen'] as const).map((k) => ratio(o.is[k], o.vs[k])));
      expect(best).toBeGreaterThanOrEqual(BAR);
    });
  }

  it('the bar refuses the row that was deleted: wood at satin instead of oiled', () => {
    expect(ratio(stats(woodFields(), 'woodSatin').gloss, wood.gloss)).toBeLessThan(BAR);
  });

  it('painted wood keeps some of its grain', () => {
    // "only the grain's texture shows" is what the option promises; zero relief would be
    // plastic. Between a tenth and a third of bare wood's.
    const painted = OPTIONS[0].is;
    expect(painted.relief / wood.relief).toBeGreaterThan(0.1);
    expect(painted.relief / wood.relief).toBeLessThan(0.34);
  });
});
