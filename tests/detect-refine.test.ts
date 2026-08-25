import { describe, expect, it } from 'vitest';
import { geoRefine, type CalMap, type RoomDims } from '@/lib/detect-refine';
import { placeFloorObject, placeWallObject, type CameraCal } from '@/lib/photo-geometry';
import type { Detection } from '@/lib/detection';

// The five contracts below are the ones every later phase of the detection plan
// has to keep. They deliberately do NOT re-test the projection maths — that is
// tests/photo-geometry.test.ts's job, against hand-computed cases. What geoRefine
// itself decides is *which* projection measures an object, and whether the AI's
// own numbers survive; that is what is pinned here, by comparing against the
// placer this detection should have gone through and asserting it did not go
// through the other one.

const ROOM: RoomDims = { width: 6, depth: 4 };
const CAL: CameraCal = { k: 1.2, aspect: 4 / 3 };
// 's' is deliberately absent — an unphotographed wall is a normal outcome.
const CALS: CalMap = { n: CAL, e: CAL, w: CAL };

// Bottom edge at v = 0.85, well below the horizon of a level camera, so
// placeFloorObject has a floor intersection to find.
const FLOOR_BOX: Detection['box'] = [0.4, 0.55, 0.2, 0.3];
// Bottom edge at v = 0.60 — still below the horizon, so BOTH placers return a
// result for it. That is what makes the wall case able to prove which one ran.
const WALL_BOX: Detection['box'] = [0.4, 0.4, 0.2, 0.2];

function det(p: Partial<Detection> & Pick<Detection, 'category' | 'slot'>): Detection {
  return { label: 'thing', conf: 0.9, box: FLOOR_BOX, ...p };
}

describe('geoRefine', () => {
  it('measures a floor-anchored detection through placeFloorObject', () => {
    const d = det({
      category: 'sofa',
      slot: 'n',
      // Absurd on purpose: the whole point is that these are discarded.
      position: { x: 99, y: 99, z: 99 },
      dimMM: [1, 2, 3],
    });
    const g = placeFloorObject(FLOOR_BOX, 'n', ROOM, CAL);
    expect(g).not.toBeNull();

    const out = geoRefine(d, CALS, ROOM);
    expect(out.position).toEqual(g!.position);
    // W and H are measured; the AI's depth hint is the one number that survives.
    expect(out.dimMM).toEqual([g!.widthMM, 2, g!.heightMM]);
    // Independent of the placer: a floor anchor sits on the floor, and the sizes
    // are millimetres of furniture rather than metres or pixels.
    expect(out.position!.y).toBe(0);
    expect(out.dimMM![0]).toBeGreaterThan(100);
    expect(out.dimMM![2]).toBeGreaterThan(100);
    expect(out.dimMM![2]).toBeLessThan(3000);
  });

  it('measures a wall-anchored detection through placeWallObject, not the floor one', () => {
    const d = det({ category: 'painting', shape: 'painting', slot: 'n', box: WALL_BOX });
    const wall = placeWallObject(WALL_BOX, 'n', ROOM, CAL);
    const floor = placeFloorObject(WALL_BOX, 'n', ROOM, CAL);
    expect(wall).not.toBeNull();
    expect(floor).not.toBeNull(); // both are available, so the next line has teeth

    const out = geoRefine(d, CALS, ROOM);
    expect(out.position).toEqual(wall!.position);
    expect(out.position).not.toEqual(floor!.position);
    expect(out.dimMM).toEqual([wall!.widthMM, 500, wall!.heightMM]);
    // A hung picture is off the floor; the floor placer would have said y = 0.
    expect(out.position!.y).toBeGreaterThan(0);
  });

  it('leaves a ceiling-anchored detection completely untouched', () => {
    const d = det({ category: 'fan', shape: 'fan', slot: 'n' });
    // Same object back, not a copy: three later phases read this as the honest
    // "nothing was measured here" answer.
    expect(geoRefine(d, CALS, ROOM)).toBe(d);
  });

  it('still measures a curtain whose shape resolves to the ceiling', () => {
    // The `&& d.category !== 'curtain'` half of the ceiling guard. Cloth reaching
    // the ceiling is on the wall plane; a pendant lamp is not.
    const d = det({ category: 'curtain', shape: 'fan', slot: 'n', box: WALL_BOX });
    const out = geoRefine(d, CALS, ROOM);
    expect(out).not.toBe(d);
    expect(out.position).toEqual(placeWallObject(WALL_BOX, 'n', ROOM, CAL)!.position);
  });

  it('leaves a detection from an uncalibrated slot completely untouched', () => {
    const d = det({ category: 'sofa', slot: 's', position: { x: 1, y: 0, z: 1 } });
    expect(geoRefine(d, CALS, ROOM)).toBe(d);
    expect(geoRefine(det({ category: 'sofa', slot: 'n' }), {}, ROOM)).toBeTruthy();
    expect(geoRefine(d, {}, ROOM)).toBe(d);
  });

  it('keeps the AI yaw when there is one, and takes the geometric yaw otherwise', () => {
    const g = placeFloorObject(FLOOR_BOX, 'w', ROOM, CAL)!;
    expect(g.yaw).not.toBe(0); // slot 'w' faces +X, so 0 is a distinguishable value

    expect(geoRefine(det({ category: 'sofa', slot: 'w', yaw: 1.23 }), CALS, ROOM).yaw).toBe(1.23);
    expect(geoRefine(det({ category: 'sofa', slot: 'w' }), CALS, ROOM).yaw).toBe(g.yaw);
    // A deliberate 0 is a yaw, not a missing yaw. `??` would in fact behave
    // identically here — `0 ?? x` is 0 — so the mutation this line actually
    // catches is `||`, which rotates every piece the AI said faces north.
    expect(geoRefine(det({ category: 'sofa', slot: 'w', yaw: 0 }), CALS, ROOM).yaw).toBe(0);
  });

  it('falls back to a 500 mm depth when the AI gave none', () => {
    // PINS CURRENT BEHAVIOUR AND IS MEANT TO CHANGE. One photo cannot observe
    // depth, but 500 mm is a literal, not a derivation, and it sits outside the
    // allowed depth range of every thin category (painting 15–60, rug 3–40 …).
    // Phase 2 of docs/history/PlanDetect.md replaces it with a derived default;
    // update this expectation there deliberately rather than deleting it.
    const out = geoRefine(det({ category: 'painting', shape: 'painting', slot: 'n', box: WALL_BOX }), CALS, ROOM);
    expect(out.dimMM![1]).toBe(500);
  });
});
