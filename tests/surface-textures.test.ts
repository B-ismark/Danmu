import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fabricFields,
  floorFields,
  grayBytes,
  metalFields,
  normalBytes,
  plasterFields,
  woodFields,
  woodMaps,
  type Field,
  type SurfaceFields,
} from '@/lib/textures';
import { boxProjectUV } from '@/lib/surface-uv';
import { CUSHION_MESH, GARMENT_MESH, SHOE_LINING_MESH, SHOE_SOLE_MESH, SHOE_UPPER_MESH, curtainCloth, type SoftMeshData } from '@/lib/soft-goods';
import { SURFACE } from '@/components/three/materials';

// The first texture kit was wired to every material and changed the picture by under a
// grey level (0.6 in 255 on wood and fabric, 0.3 on the floor, measured on a lit swatch
// at the studio's viewing scale), and on cloth by exactly nothing, because the cloth
// meshes had no UVs. Every check in the suite passed, because none of them asked
// whether the texture could be SEEN. These do.

const SURFACES: Record<string, SurfaceFields> = {
  wood: woodFields(),
  fabric: fabricFields(),
  floor: floorFields(),
  plaster: plasterFields(),
  metal: metalFields(),
};

function stats(f: Field) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of f.data) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  const mean = sum / f.data.length;
  let sq = 0;
  for (const v of f.data) sq += (v - mean) ** 2;
  return { min, max, mean, sd: Math.sqrt(sq / f.data.length) };
}

/** Mean tilt of a normal map away from flat, in byte units (0 = a flat surface). */
function tilt(f: SurfaceFields): number {
  const n = normalBytes(f.height, f.bump);
  let t = 0;
  for (let i = 0; i < n.length; i += 4) t += Math.hypot(n[i] - 127.5, n[i + 1] - 127.5);
  return t / (n.length / 4);
}

describe('surface textures can be seen', () => {
  // Floors at ~70% of what each set measured when it was tuned against rendered rooms.
  // Pinned per surface, every one of them: half a table pinned is the same defect as none.
  const TONE_SD: Record<string, number> = { wood: 0.06, fabric: 0.038, floor: 0.05, plaster: 0.01, metal: 0.008 };
  const TILT: Record<string, number> = { wood: 27, fabric: 17, floor: 14, plaster: 5.9, metal: 11 };

  for (const [name, f] of Object.entries(SURFACES)) {
    it(`${name}: its tone varies enough to read`, () => {
      expect(stats(f.tone).sd).toBeGreaterThan(TONE_SD[name]);
    });
    it(`${name}: its relief tilts the surface enough to read`, () => {
      expect(tilt(f)).toBeGreaterThan(TILT[name]);
    });
  }

  it('pins a floor for every surface it generates', () => {
    expect(Object.keys(TONE_SD).sort()).toEqual(Object.keys(SURFACES).sort());
    expect(Object.keys(TILT).sort()).toEqual(Object.keys(SURFACES).sort());
  });
});

describe('the tone layer keeps the user’s colour', () => {
  for (const [name, f] of Object.entries(SURFACES)) {
    it(`${name}: is a multiply that never brightens and never buries the colour`, () => {
      const s = stats(f.tone);
      expect(s.max).toBeLessThanOrEqual(1);
      expect(s.min).toBeGreaterThan(0.45);
      expect(s.mean).toBeGreaterThan(0.75);
    });
  }

  it('is grey, so it cannot shift a hue', () => {
    const b = grayBytes(woodFields(64).tone);
    for (let i = 0; i < b.length; i += 4) {
      expect(b[i]).toBe(b[i + 1]);
      expect(b[i]).toBe(b[i + 2]);
    }
  });
});

describe('surface textures tile and repeat', () => {
  /** The step across the wrap (last column → first), against the LARGEST step between
   *  neighbouring columns inside the tile, each averaged down the column. Not the
   *  average step: a weave's thread boundaries and a floor's board ends are meant to be
   *  sharp, and the wrap is allowed to be one of them. What it may not be is sharper
   *  than anything the tile draws itself — that is a seam, repeating every tile. */
  function seamRatio(f: Field, axis: 'u' | 'v'): number {
    const s = f.size;
    const at = (a: number, k: number) => (axis === 'u' ? f.data[k * s + a] : f.data[a * s + k]);
    const step = (a: number, b: number) => {
      let t = 0;
      for (let k = 0; k < s; k++) t += Math.abs(at(a, k) - at(b, k));
      return t / s;
    };
    let inner = 0;
    for (let a = 0; a < s - 1; a++) inner = Math.max(inner, step(a, a + 1));
    return step(s - 1, 0) / inner;
  }

  for (const [name, f] of Object.entries(SURFACES)) {
    for (const axis of ['u', 'v'] as const) {
      it(`${name}: has no seam across ${axis}`, () => {
        expect(seamRatio(f.height, axis)).toBeLessThanOrEqual(1);
        expect(seamRatio(f.tone, axis)).toBeLessThanOrEqual(1);
      });
    }
  }

  it('is deterministic, so a room looks the same on every open', () => {
    expect(Array.from(woodFields(64).tone.data)).toEqual(Array.from(woodFields(64).tone.data));
    expect(Array.from(floorFields(64).height.data)).toEqual(Array.from(floorFields(64).height.data));
  });

  it('is laid out in metres, at sizes a person would recognise', () => {
    // A board is 200 mm (twelve rows per 2.4 m tile); grain and plaster sit between.
    expect(SURFACES.floor.tileM).toBe(2.4);
    for (const f of Object.values(SURFACES)) {
      expect(f.tileM).toBeGreaterThan(0.1);
      expect(f.tileM).toBeLessThanOrEqual(2.4);
    }
    expect(woodMaps().map.repeat.x).toBeCloseTo(1 / SURFACES.wood.tileM);
  });
});

describe('normalBytes', () => {
  it('draws a flat field as straight up', () => {
    const n = normalBytes({ size: 4, data: new Float32Array(16).fill(0.5) }, 3);
    expect([n[0], n[1], n[2]]).toEqual([128, 128, 255]);
  });

  it("leans away from a rise, in three's OpenGL convention (+G is +V)", () => {
    const s = 8;
    const rampU = new Float32Array(s * s);
    const rampV = new Float32Array(s * s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      rampU[y * s + x] = x / s;
      rampV[y * s + x] = y / s;
    }
    const nu = normalBytes({ size: s, data: rampU }, 4);
    const nv = normalBytes({ size: s, data: rampV }, 4);
    const mid = (3 * s + 3) * 4;
    expect(nu[mid]).toBeLessThan(128); // rising toward +U faces -U
    expect(nu[mid + 1]).toBe(128);
    expect(nv[mid + 1]).toBeLessThan(128); // rising toward +V faces -V
    expect(nv[mid]).toBe(128);
  });
});

describe('materials carry the whole set', () => {
  for (const key of ['wood', 'woodSatin', 'fabric', 'metal', 'metalDark'] as const) {
    it(`SURFACE.${key} has tone, relief and roughness maps`, () => {
      const p = SURFACE[key] as Record<string, unknown>;
      expect(p.map).toBeTruthy();
      expect(p.normalMap).toBeTruthy();
      expect(p.roughnessMap).toBeTruthy();
    });
  }
});

describe('cloth has somewhere for a texture to land', () => {
  const meshes: Array<[string, SoftMeshData]> = [
    ...Object.entries(CUSHION_MESH).map(([k, m]) => [`cushion ${k}`, m] as [string, SoftMeshData]),
    ...Object.entries(GARMENT_MESH).map(([k, m]) => [`garment ${k}`, m] as [string, SoftMeshData]),
    ...Object.entries(SHOE_UPPER_MESH).map(([k, m]) => [`shoe upper ${k}`, m] as [string, SoftMeshData]),
    ...Object.entries(SHOE_LINING_MESH).map(([k, m]) => [`shoe lining ${k}`, m] as [string, SoftMeshData]),
    ['shoe sole', SHOE_SOLE_MESH],
    ['curtain', curtainCloth([1400, 120, 2400], 8)],
  ];

  for (const [name, m] of meshes) {
    it(`${name}: one finite UV per vertex, spread over both axes`, () => {
      expect(m.uvs.length).toBe((m.positions.length / 3) * 2);
      const us = m.uvs.filter((_, i) => i % 2 === 0);
      const vs = m.uvs.filter((_, i) => i % 2 === 1);
      expect(us.every(Number.isFinite) && vs.every(Number.isFinite)).toBe(true);
      expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0);
      expect(Math.max(...vs) - Math.min(...vs)).toBeGreaterThan(0);
    });
  }

  it('lays a curtain out by distance over the cloth, so its pleats do not shrink the weave', () => {
    // 1.4 m wide, gathered into waves: the cloth across it is LONGER than 1.4 m.
    const m = curtainCloth([1400, 120, 2400], 8);
    const us = m.uvs.filter((_, i) => i % 2 === 0);
    expect(Math.max(...us)).toBeGreaterThan(1.4);
  });

  it('is uploaded with the geometry, not merely built', () => {
    // Without this one line the arrays above reach nothing and the cloth renders plain.
    const box = readFileSync(join(process.cwd(), 'components/three/Box.tsx'), 'utf8');
    expect(box).toMatch(/setAttribute\('uv', new Float32BufferAttribute\(\[\.\.\.mesh\.uvs\], 2\)\)/);
  });
});

describe('boxProjectUV', () => {
  it('lays each face out in metres, grain up the fronts and sides and along the top', () => {
    const pos = [0.3, 0.5, 0.2, 0.3, 0.5, 0.2, 0.3, 0.5, 0.2];
    const nrm = [0, 0, 1, 1, 0, 0, 0, 1, 0];
    const uv = Array.from(boxProjectUV(pos, nrm)).map((x) => +x.toFixed(6));
    expect(uv.slice(0, 2)).toEqual([0.3, 0.5]); // front: (x, y)
    expect(uv.slice(2, 4)).toEqual([0.2, 0.5]); // side: (z, y)
    expect(uv.slice(4, 6)).toEqual([0.2, 0.3]); // top: (z, x)
  });

  it('gives a bigger panel more texture rather than a stretched copy', () => {
    const small = boxProjectUV([0.2, 0.2, 0], [0, 0, 1]);
    const big = boxProjectUV([1, 1, 0], [0, 0, 1]);
    expect(big[0] / small[0]).toBeCloseTo(5);
  });

  it('is applied by Box, for a textured surface', () => {
    const box = readFileSync(join(process.cwd(), 'components/three/Box.tsx'), 'utf8');
    expect(box).toMatch(/setAttribute\('uv', new BufferAttribute\(boxProjectUV\(/);
  });
});
