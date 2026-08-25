import { describe, it, expect } from 'vitest';
import { resolvePlacement, snapSteps } from '@/lib/drag-resolve';
import type { ScenePart } from '@/lib/scene-spec';
import type { Poly } from '@/lib/geometry';

// The pipeline this pins used to live inside `components/three/Draggable.tsx`,
// where no test could reach it — which is how the 2D plan came to run a different
// one. These assertions are the contract both surfaces now share, step by step,
// so a change that only suits one of them fails here first.

function part(p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'dimMM' | 'pos'>): ScenePart {
  return {
    name: p.id,
    category: 'table',
    shape: 'coffee-table',
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

/** 4 x 3 m, corner at the origin. */
const ROOM: Poly = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];
const H = 2.5;

function resolve(target: ScenePart, rawX: number, rawZ: number, others: ScenePart[] = [], snapMode: 'off' | 'fine' | 'coarse' = 'off') {
  return resolvePlacement({
    part: target,
    rawX,
    rawZ,
    rot: target.rot,
    dim: target.dimMM,
    parts: [...others, target],
    footprint: ROOM,
    roomHeight: H,
    snapMode,
  });
}

describe('snapSteps', () => {
  it('is the one place the increments live', () => {
    expect(snapSteps('off')).toEqual({ translate: null, rotate: null });
    expect(snapSteps('fine')).toEqual({ translate: 0.01, rotate: Math.PI / 12 });
    expect(snapSteps('coarse')).toEqual({ translate: 0.05, rotate: Math.PI / 4 });
  });
});

describe('containment', () => {
  it('keeps the whole footprint inside the room', () => {
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', pos: [2, 0, 1.5], dimMM: [2000, 900, 800] });
    // Asked for the corner; gets the nearest spot whose footprint still fits.
    const r = resolve(sofa, -5, -5);
    expect(r.pos[0]).toBeCloseTo(1.0); // half of 2.0 m
    expect(r.pos[2]).toBeCloseTo(0.45); // half of 0.9 m
    expect(r.valid).toBe(true);
  });

  it('measures the clamp against the ROTATED footprint', () => {
    const sofa = part({
      id: 'sofa',
      category: 'sofa',
      shape: 'sofa',
      pos: [2, 0, 1.5],
      dimMM: [2000, 900, 800],
      rot: Math.PI / 2,
    });
    const r = resolve(sofa, -5, -5);
    // Turned a quarter turn, so the 2 m side now runs along z.
    expect(r.pos[0]).toBeCloseTo(0.45);
    expect(r.pos[2]).toBeCloseTo(1.0);
  });
});

describe('gravity', () => {
  it('stands a piece on the floor', () => {
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', pos: [1, 0, 1], dimMM: [450, 500, 900] });
    expect(resolve(chair, 1, 1).pos[1]).toBeCloseTo(0);
  });

  it('stands a small piece ON the table it is over, and drops it when it leaves', () => {
    const table = part({ id: 'table', category: 'table', shape: 'coffee-table', pos: [1, 0, 1], dimMM: [1400, 800, 750] });
    const vase = part({ id: 'vase', category: 'other', shape: 'box', pos: [1, 0.75, 1], dimMM: [180, 180, 300] });
    const on = resolve(vase, 1, 1, [table]);
    expect(on.pos[1]).toBeGreaterThan(0.7);
    expect(on.supportId).toBe('table');
    // The bug this fixes in the plan: slide it off the table and it must fall, not
    // hang in the air at table height. From directly above, nothing else would say.
    const off = resolve(vase, 3, 2.5, [table]);
    expect(off.pos[1]).toBeCloseTo(0);
    expect(off.supportId).toBeUndefined();
  });

  it('lays a rug flat on the floor', () => {
    const rug = part({ id: 'rug', category: 'rug', shape: 'rug', pos: [2, 0, 1.5], dimMM: [2000, 1400, 10] });
    expect(resolve(rug, 2, 1.5).pos[1]).toBe(0);
  });

  it('keeps a wall-mounted piece at the height it was given', () => {
    const tv = part({ id: 'tv', category: 'tv', shape: 'tv', pos: [2, 1.2, 0.05], dimMM: [1200, 60, 700] });
    const r = resolvePlacement({
      part: tv,
      rawX: 2,
      rawZ: 0.2,
      rot: tv.rot,
      dim: tv.dimMM,
      parts: [tv],
      footprint: ROOM,
      roomHeight: H,
      snapMode: 'off',
      currentY: 1.2,
    });
    expect(r.pos[1]).toBeCloseTo(1.2);
  });

  it('falls back to the canonical height when there is no current one', () => {
    const tv = part({ id: 'tv', category: 'tv', shape: 'tv', pos: [2, 0, 0.05], dimMM: [1200, 60, 700] });
    const r = resolve(tv, 2, 0.2);
    expect(r.pos[1]).toBeGreaterThan(0.5);
    expect(r.pos[1]).toBeLessThan(H);
  });
});

describe('wall snapping', () => {
  it('puts a wall-mounted piece on the nearest wall and turns it to face in', () => {
    const tv = part({ id: 'tv', category: 'tv', shape: 'tv', pos: [2, 1.2, 1.5], dimMM: [1200, 60, 700] });
    // Dragged towards the far wall (z = 3) but left short of it.
    const r = resolve(tv, 2, 2.6);
    expect(r.pos[2]).toBeGreaterThan(2.9);
    // Facing back into the room, not out through the plaster.
    expect(Math.cos(r.rot)).toBeLessThan(0);
  });
});

describe('magnetic item snapping', () => {
  const wall = part({ id: 'shelf', category: 'shelf', shape: 'bookshelf', pos: [1, 0, 0.2], dimMM: [800, 400, 2000] });

  it('pulls an edge flush when snapping is on', () => {
    const box = part({ id: 'box', category: 'other', shape: 'box', pos: [3, 0, 1], dimMM: [800, 400, 400] });
    const near = resolve(box, 1.82, 0.2, [wall], 'fine');
    // 0.8 m wide each, so flush right-of-shelf is x = 1.8 exactly.
    expect(near.pos[0]).toBeCloseTo(1.8);
    expect(near.snapLines?.length).toBeGreaterThan(0);
  });

  it('leaves the same drag alone when snapping is off', () => {
    const box = part({ id: 'box', category: 'other', shape: 'box', pos: [3, 0, 1], dimMM: [800, 400, 400] });
    const free = resolve(box, 1.82, 0.2, [wall], 'off');
    expect(free.pos[0]).toBeCloseTo(1.82);
    expect(free.snapLines).toBeUndefined();
  });
});

describe('legality', () => {
  it('allows a piece to come to rest on top of another', () => {
    // Worth pinning, because it is the reason the refusal case below has to be
    // built the way it is: the pipeline resolves a piece dropped onto furniture as
    // STANDING on it, and that is legal.
    const table = part({ id: 'table', category: 'table', shape: 'coffee-table', pos: [1, 0, 1], dimMM: [1400, 800, 750] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [3, 0, 2], dimMM: [220, 220, 420] });
    const r = resolve(lamp, 1, 1, [table]);
    expect(r.valid).toBe(true);
    expect(r.supportId).toBe('table');
  });

  it('refuses a spot already occupied, without moving the piece for you', () => {
    // A wardrobe leaves no room to stack on: its top is at 2.0 m and the desk is
    // 0.75 m tall in a 2.5 m room, so the ceiling clamp pushes the desk back down
    // INTO it — which is exactly the overlap `collidesAt` is for.
    const wardrobe = part({ id: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', pos: [1, 0, 1], dimMM: [1200, 600, 2000] });
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [3, 0, 2], dimMM: [1200, 600, 750] });
    const r = resolve(desk, 1, 1, [wardrobe]);
    expect(r.valid).toBe(false);
    // The refusal reports the spot asked for. Silently sliding it somewhere legal
    // is the one thing this must never do — the caller decides what to say.
    expect(r.pos[0]).toBeCloseTo(1);
    expect(r.pos[2]).toBeCloseTo(1);
  });

  it('refuses the notch an L-shaped room does not have', () => {
    // An L: the far corner (3..4, 2..3) is missing.
    const L: Poly = [
      [0, 0],
      [4, 0],
      [4, 2],
      [3, 2],
      [3, 3],
      [0, 3],
    ];
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', pos: [1, 0, 1], dimMM: [450, 500, 900] });
    const inside = resolvePlacement({
      part: chair, rawX: 1, rawZ: 1, rot: 0, dim: chair.dimMM, parts: [chair],
      footprint: L, roomHeight: H, snapMode: 'off',
    });
    const notch = resolvePlacement({
      part: chair, rawX: 3.6, rawZ: 2.6, rot: 0, dim: chair.dimMM, parts: [chair],
      footprint: L, roomHeight: H, snapMode: 'off',
    });
    expect(inside.valid).toBe(true);
    expect(notch.valid).toBe(false);
  });

  it('keeps a piece taller than the room from being buried in the ceiling', () => {
    const shelf = part({ id: 'tall', category: 'shelf', shape: 'bookshelf', pos: [1, 0, 1], dimMM: [800, 400, 2400] });
    const r = resolve(shelf, 1, 1);
    // Floor-standing, so it keeps its real height and stays on the floor; the
    // ceiling clamp only ever moves a piece DOWN.
    expect(r.pos[1]).toBeLessThanOrEqual(H - 2.4 - 0.02 + 1e-9);
  });
});
