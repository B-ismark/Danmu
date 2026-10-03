// A room built from photos must not come out one colour. Scanned pieces carry no
// colour of their own (photo colour reuse was deleted), so what they look like is
// decided at render time — and `Room` used to hand `part.locked` ("came out of your
// photo") to the geometry, which painted EVERY scanned piece the one aubergine tint.
// A preset room never saw it because its pieces are not locked.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSceneFromRoom, defaultScene } from '@/lib/scene-spec';
import { defaultBodyColor } from '@/lib/scene-palette';
import { stripComments } from './helpers/source';

const scanned = buildSceneFromRoom({
  id: 'r1', createdAt: 0, name: 'Scanned', layoutId: 'rect', width: 6, depth: 5, height: 2.8,
  detectedObjects: [
    { id: 0, label: 'bed__slot:n', conf: 0.9, locked: true, box: [0.1, 0.4, 0.3, 0.4], category: 'bed' },
    { id: 1, label: 'wardrobe__slot:e', conf: 0.9, locked: true, box: [0.1, 0.2, 0.2, 0.6], category: 'wardrobe' },
    { id: 2, label: 'desk__slot:s', conf: 0.9, locked: true, box: [0.4, 0.4, 0.3, 0.3], category: 'desk' },
    { id: 3, label: 'sofa__slot:w', conf: 0.9, locked: true, box: [0.5, 0.5, 0.3, 0.3], category: 'sofa' },
    { id: 4, label: 'shelf__slot:n', conf: 0.9, locked: true, box: [0.7, 0.2, 0.2, 0.5], category: 'shelf' },
  ],
} as never);

describe('scanned rooms are coloured like preset rooms', () => {
  it('builds several scanned pieces with no colour of their own', () => {
    expect(scanned.length).toBeGreaterThanOrEqual(4);
    expect(scanned.every((p) => p.locked)).toBe(true);
    expect(scanned.every((p) => p.color === undefined)).toBe(true);
  });

  it('gives each scanned piece the colour a preset piece of the same shape gets, and not all one colour', () => {
    const preset = defaultScene('rect', 6, 5);
    const presetColour = new Map(preset.map((p) => [`${p.category}/${p.shape}`, p.color ?? defaultBodyColor(p.category, p.shape)]));
    let compared = 0;
    for (const p of scanned) {
      const want = presetColour.get(`${p.category}/${p.shape}`);
      if (want === undefined) continue;
      compared++;
      expect(p.color ?? defaultBodyColor(p.category, p.shape), p.shape).toBe(want);
    }
    expect(compared, 'at least some shapes must be shared with the preset').toBeGreaterThan(0);
    const distinct = new Set(scanned.map((p) => p.color ?? defaultBodyColor(p.category, p.shape)));
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });

  it('does not hand `locked` to the 3D geometry, which is what tinted everything aubergine', () => {
    const src = stripComments(readFileSync(join(__dirname, '../components/three/Room.tsx'), 'utf8'));
    const call = src.match(/<PartGeometry[^>]*>/)?.[0] ?? '';
    expect(call, 'Room must still render PartGeometry').not.toBe('');
    expect(call).not.toMatch(/part\.locked/);
    expect(call).toMatch(/locked=\{false\}/);
  });

  it('lets a Style theme recolour the pieces from a photo like any other', () => {
    const src = stripComments(readFileSync(join(__dirname, '../components/studio/PartTree.tsx'), 'utf8'));
    const apply = src.slice(src.indexOf('function applyTheme'), src.indexOf('setLighting(theme.lighting)'));
    expect(apply, 'applyTheme must exist').toMatch(/themeColorFor/);
    expect(apply).not.toMatch(/locked/);
    const active = src.slice(src.indexOf('const activeTheme'), src.indexOf('function applyTheme'));
    expect(active).not.toMatch(/locked/);
  });
});
