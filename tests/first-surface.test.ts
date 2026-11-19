import { describe, expect, it } from 'vitest';
import { firstSurface, PART_ID_KEY, WALL_KEY, type SurfaceNode } from '@/lib/pick-through';

const P = (n: number) => ({ n });
const mesh = (extra: Partial<SurfaceNode> = {}): SurfaceNode => ({ type: 'Mesh', visible: true, material: { visible: true, colorWrite: true }, userData: {}, ...extra });

const ceiling = mesh({ material: { visible: true, colorWrite: false } });
const wall = mesh({ userData: { [WALL_KEY]: 2 } });
const floor = mesh();
const tvRoot: SurfaceNode = { userData: { [PART_ID_KEY]: 'tv-1' } };
const tv = mesh({ parent: tvRoot });

describe('firstSurface', () => {
  it('looks through the shadow-only ceiling to the wall behind it', () => {
    expect(firstSurface([{ object: ceiling, point: P(1) }, { object: wall, point: P(2) }])).toEqual({ kind: 'wall', point: P(2) });
  });

  it('names a piece in front of the wall', () => {
    expect(firstSurface([{ object: tv, point: P(1) }, { object: wall, point: P(2) }])).toEqual({ kind: 'part', id: 'tv-1', point: P(1) });
  });

  it('skips helpers, lines and hidden objects', () => {
    const frame = mesh({ parent: { userData: { helper: true } } });
    const line = mesh({ type: 'Line2' });
    const hidden = mesh({ parent: { visible: false, userData: {} } });
    const r = firstSurface([
      { object: frame, point: P(1) },
      { object: line, point: P(2) },
      { object: hidden, point: P(3) },
      { object: wall, point: P(4) },
    ]);
    expect(r).toEqual({ kind: 'wall', point: P(4) });
  });

  it('skips a mesh whose material is switched off', () => {
    const off = mesh({ material: { visible: false } });
    expect(firstSurface([{ object: off, point: P(1) }, { object: floor, point: P(2) }])?.kind).toBe('other');
  });

  it('counts a multi-material mesh while any material draws', () => {
    const mixed = mesh({ material: [{ colorWrite: false }, { colorWrite: true }], userData: { [WALL_KEY]: 0 } });
    expect(firstSurface([{ object: mixed, point: P(1) }])?.kind).toBe('wall');
  });

  it('is the floor, not the wall, when the floor is nearer', () => {
    expect(firstSurface([{ object: floor, point: P(1) }, { object: wall, point: P(2) }])?.kind).toBe('other');
  });

  it('is null when the ray sees nothing', () => {
    expect(firstSurface([])).toBeNull();
    expect(firstSurface([{ object: ceiling, point: P(1) }])).toBeNull();
  });
});
