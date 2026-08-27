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

describe('grid snap', () => {
  // The step this pipeline was shipped without. It lived in `Draggable`'s
  // pointer-move handler and did not travel with the extraction, so the 3D drag
  // quantised and the 2D drag did not — the snap setting visibly worked in one tab
  // and did nothing in the other, which is the exact defect the extraction was
  // supposed to make impossible. It is the first step of `resolvePlacement` now, and
  // callers must pass the pointer position unrounded.
  const table = () => part({ id: 'table', pos: [2, 0, 1.5], dimMM: [1200, 800, 400] });

  it('leaves the target alone when snapping is off', () => {
    const r = resolve(table(), 1.234, 1.567, [], 'off');
    expect(r.pos[0]).toBeCloseTo(1.234);
    expect(r.pos[2]).toBeCloseTo(1.567);
  });

  it('rounds to 10 mm on fine', () => {
    const r = resolve(table(), 1.234, 1.567, [], 'fine');
    expect(r.pos[0]).toBeCloseTo(1.23);
    expect(r.pos[2]).toBeCloseTo(1.57);
  });

  it('rounds to 50 mm on coarse', () => {
    const r = resolve(table(), 1.234, 1.567, [], 'coarse');
    expect(r.pos[0]).toBeCloseTo(1.25);
    expect(r.pos[2]).toBeCloseTo(1.55);
  });

  it('runs BEFORE containment, so a clamped edge is not re-rounded', () => {
    // 870 mm deep, so the clamp lands the piece at z = 0.435 — deliberately off the
    // 50 mm lattice. Quantising after the clamp instead of before it would drag the
    // piece to 0.45 and push 15 mm of it through the wall, which is the one thing
    // the clamp exists to prevent.
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', pos: [2, 0, 1.5], dimMM: [2000, 870, 800] });
    const r = resolve(sofa, -5, -5, [], 'coarse');
    expect(r.pos[0]).toBeCloseTo(1.0);
    expect(r.pos[2]).toBeCloseTo(0.435);
    expect(r.valid).toBe(true);
  });

  it('steps by exactly one cell for a nudge of one step, from anywhere', () => {
    // What the plan's arrow keys rely on: `moveTo(pos + step)` must always land one
    // cell further on, even from an off-grid start. q(p + s) == q(p) + s for the same
    // s, so an off-grid piece aligns AND advances on the first press rather than
    // appearing to ignore it.
    const step = snapSteps('fine').translate!;
    const start = resolve(table(), 1.2345, 1.5, [], 'fine');
    const next = resolve(table(), start.pos[0] + step, 1.5, [], 'fine');
    expect(next.pos[0] - start.pos[0]).toBeCloseTo(step);
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

describe('a ceiling piece is not a wall rider', () => {
  // The wall branch used to be gated on `isWallMountedPart`, which asks "is this
  // piece's geometry centred on its origin" and answers yes for a ceiling fan.
  // `lib/physics.ts` has said so in `ridesWall`'s own doc since the day it was
  // written; this file asked the other question anyway. Two symptoms out of one
  // predicate: the fan was slid onto the nearest wall wherever you dragged it
  // ("it only sticks to the edges"), and the same flag then excused it from the
  // containment test on the way past ("it spawned outside the room").
  const fan = () => part({ id: 'fan', category: 'fan', shape: 'fan', dimMM: [1000, 1000, 200], pos: [2, 2.35, 1.5] });

  it('stays where it is dragged instead of sliding to the nearest wall', () => {
    // (2, 1.5) is the middle of this 4 x 3 m room. Before: z came back at 0.52,
    // flush against the north wall, from a pointer in the dead centre.
    const r = resolve(fan(), 2, 1.5);
    expect(r.pos[0]).toBeCloseTo(2, 6);
    expect(r.pos[2]).toBeCloseTo(1.5, 6);
    expect(r.valid).toBe(true);
  });

  it('keeps its mount height, wherever it is dragged', () => {
    // The fan is centre-anchored (`isFloorStanding` is false), so gravity must not
    // reach for it — this is the half `isWallMountedPart` was right about, and it
    // must not regress with the half it was wrong about.
    const r = resolve(fan(), 1, 1);
    expect(r.pos[1]).toBeCloseTo(2.35, 6);
    expect(r.supportId).toBeUndefined();
  });

  it('is refused over the quadrant an L cuts away', () => {
    // The exemption from the polygon test is EARNED by the wall snap placing a
    // piece exactly on an edge. A fan gets no snap, so it gets no exemption.
    //
    // It takes an L to show it, and that is the point: the containment clamp above
    // is a BOUNDING BOX, so inside a rectangle nothing can ever fail the polygon
    // test and the exemption looks harmless. The notch is the only place the two
    // disagree — which is why "wall-mounted parts skip the polygon test" hid a
    // ceiling fan hanging over next door for as long as it did.
    const L: Poly = [
      [0, 0],
      [4, 0],
      [4, 1.5],
      [2, 1.5],
      [2, 3],
      [0, 3],
    ];
    const overNotch = resolvePlacement({
      part: fan(), rawX: 3, rawZ: 2.5, rot: 0, dim: [1000, 1000, 200],
      parts: [fan()], footprint: L, roomHeight: H, snapMode: 'off', currentY: 2.35,
    });
    expect(overNotch.valid).toBe(false);
    // …and legal over floor that exists, so the test is about the notch and not
    // about the fan being refused everywhere.
    const overFloor = resolvePlacement({
      part: fan(), rawX: 1, rawZ: 2, rot: 0, dim: [1000, 1000, 200],
      parts: [fan()], footprint: L, roomHeight: H, snapMode: 'off', currentY: 2.35,
    });
    expect(overFloor.valid).toBe(true);
  });

  it('does not turn, because nothing aimed it', () => {
    // A wall rider comes back re-aimed at its wall. A fan has no wall to face, and
    // a rotation written back where none was asked for creates an override that
    // pins the value against a re-detect (lib/transforms.ts).
    const f = fan();
    f.rot = 0.4;
    const r = resolve(f, 2, 1.5);
    expect(r.rot).toBe(0.4);
  });

  it('still snaps a real wall rider — the TV must not regress', () => {
    const tv = part({ id: 'tv', category: 'tv', shape: 'tv', dimMM: [1200, 100, 700], pos: [2, 1.4, 0.07] });
    const r = resolve(tv, 2, 1.2);
    // Pulled back onto the nearest wall, facing into the room, and legal there.
    expect(r.pos[2]).toBeCloseTo(0.07, 5);
    expect(Math.cos(r.rot)).toBeCloseTo(1);
    expect(r.valid).toBe(true);
  });
});
