import { describe, expect, it } from 'vitest';
import {
  buildSceneFromRoom,
  CATALOG_SHAPES_ORDERED,
  collidesAt,
  isLightFixture,
  lightFor,
  type ScenePart,
} from '../lib/scene-spec';
import type { RoomData } from '../lib/storage';
import { heightForNewCeiling, MOUNT_PAD } from '../lib/physics';
import { footprintForLayout } from '../lib/footprint';
import { footArea, footFromPart, footIntersectionArea, outsideShare } from '../lib/geometry';

type Saved = NonNullable<RoomData['detectedObjects']>[number];

function room(detected: Saved[], over: Partial<RoomData> = {}): RoomData {
  return {
    id: 'r1',
    createdAt: 0,
    name: 'Test room',
    layoutId: 'rect',
    width: 5,
    depth: 4,
    height: 2.8,
    detectedObjects: detected,
    ...over,
  };
}

function saved(i: number, over: Partial<Saved> = {}): Saved {
  return {
    id: i,
    label: `sofa__slot:n`,
    conf: 0.9,
    locked: false,
    box: [0.2, 0.4, 0.3, 0.3],
    category: 'sofa',
    ...over,
  };
}

describe('one ceiling clearance, not one per path', () => {
  // `lib/scene-spec.ts` held its own `CEILING_PAD = 0.02` for this clamp while
  // `MOUNT_PAD` was being introduced next door as "the single clearance" the
  // drag path, the Inspector and `heightForNewCeiling` share. Two numbers, the
  // same job, the same value — so nothing was visibly wrong and nothing would
  // have been until someone changed one of them and a DETECTED fan started
  // hanging a centimetre away from a DRAGGED one.
  //
  // Asserting the two paths against each other rather than against a literal is
  // what makes this able to fail: if the settle pass gets its own constant back,
  // the sides come apart the moment the constants differ, and a test written
  // against `rh - MOUNT_PAD` on both sides could never say so.
  const FAN_H_MM = 400;

  function ceilingFan(height: number) {
    const parts = buildSceneFromRoom(
      room(
        [
          saved(0, {
            label: 'fan__slot:n',
            category: 'fan',
            shape: 'fan',
            dimMM: [1200, 1200, FAN_H_MM],
          }),
        ],
        { height },
      ),
    );
    const fan = parts.find((p) => p.shape === 'fan');
    expect(fan, 'the fixture must actually produce a fan').toBeDefined();
    return fan!;
  }

  it('clamps a ceiling fan to the same height the physics path would', () => {
    const H = 2.8;
    const fan = ceilingFan(H);
    // `groundY` hangs a fan 0.15 below the slab, so a 0.4 m one reaches 2.85 in a
    // 2.8 m room — over the cap, which is the whole point of the fixture.
    const expected = heightForNewCeiling('fan', 'fan', [1200, 1200, FAN_H_MM], 99, 2.0, H);
    expect(expected).toBeCloseTo(H - MOUNT_PAD - FAN_H_MM / 2000, 9);
    expect(fan.pos[1]).toBeCloseTo(expected, 9);
  });

  it('agrees at a different ceiling too, so neither side can be a coincidence', () => {
    const H = 2.4;
    expect(ceilingFan(H).pos[1]).toBeCloseTo(
      heightForNewCeiling('fan', 'fan', [1200, 1200, FAN_H_MM], 99, 2.0, H),
      9,
    );
  });
});

// The detect → scene translation had no coverage at all, and it is where the
// higher-severity findings of the audit lived.
describe('buildSceneFromRoom', () => {
  it('falls back to the starter scene when there are no detections', () => {
    const parts = buildSceneFromRoom(room([]));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.locked === false)).toBe(true);
  });

  // The id is what every per-part user edit is keyed by — positions, rotations,
  // dims, hidden. It used to be a positional `${category}-${n}`, i.e. an ordinal
  // rather than an identity, so re-detecting a room re-pointed the old `sofa-1`'s
  // saved transform at whatever the new `sofa-1` happened to be.
  it('uses the detection uid as the part id when one is present', () => {
    const parts = buildSceneFromRoom(room([saved(0, { uid: 'stable-key-1' })]));
    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe('stable-key-1');
  });

  it('keeps ids stable when the set of detections changes around them', () => {
    const a = saved(0, { uid: 'aaa', label: 'sofa__slot:n' });
    const b = saved(1, { uid: 'bbb', label: 'armchair__slot:n', category: 'chair' });
    const before = buildSceneFromRoom(room([a, b]));
    // Delete the first detection and re-detect: 'bbb' must not inherit 'aaa'.
    const after = buildSceneFromRoom(room([b]));
    expect(before.map((p) => p.id)).toEqual(['aaa', 'bbb']);
    expect(after.map((p) => p.id)).toEqual(['bbb']);
  });

  it('falls back to the positional id for rooms saved before uid existed', () => {
    // Minting one here instead would orphan every transform those rooms already
    // have, which is worse than the bug being fixed.
    const parts = buildSceneFromRoom(room([saved(0)]));
    expect(parts[0].id).toBe('sofa-1');
  });

  it('honours an AI shape that is in the catalog', () => {
    const parts = buildSceneFromRoom(
      room([saved(0, { label: 'seat__slot:n', category: 'other', shape: 'window' })]),
    );
    // 'window' was missing from the catalog gate, so a locally-detected window
    // was rejected and fell back to a plain box — even though WindowGeo exists.
    expect(CATALOG_SHAPES_ORDERED).toContain('window');
    expect(parts[0].shape).toBe('window');
  });

  it('refuses a shape that is not in the catalog', () => {
    const parts = buildSceneFromRoom(
      room([saved(0, { label: 'thing__slot:n', category: 'other', shape: 'not-a-shape' })]),
    );
    expect(parts[0].shape).toBe('box');
  });

  it('clamps an absurd AI dimension into the shape range', () => {
    const parts = buildSceneFromRoom(room([saved(0, { dimMM: [40000, 1, 90000] })]));
    const [w, , h] = parts[0].dimMM;
    expect(w).toBeLessThanOrEqual(4000); // sofa max width
    expect(h).toBeGreaterThanOrEqual(600); // sofa min height
  });

  it('grounds a floor-standing part on the floor', () => {
    const parts = buildSceneFromRoom(room([saved(0, { position: { x: 0, y: 1.9, z: 0 } })]));
    expect(parts[0].pos[1]).toBe(0);
  });

  it('does not let a nonsense Y throw away a good X and Z', () => {
    // Y is owned by `groundY`, which overwrites pos[1] unconditionally. The
    // placement gate used to ALSO test Y and reject the whole position when it was
    // out of the room — so a fan the model put 3.2 m up in a 2.8 m room lost its
    // perfectly good floor position too and fell back to slot-snapping. A wrong
    // height is not a wrong corner.
    //
    // `chair` is wall-affinity `free`, so no snap or nudge sits between the gate
    // and the assertion.
    const at = (y: number) =>
      buildSceneFromRoom(
        room([saved(0, { label: 'chair__slot:n', category: 'chair', position: { x: 1.4, y, z: 0.9 } })]),
      )[0];
    const sane = at(0.45);
    const absurd = at(99);
    // Premise: the recorded position is being honoured at all, rather than both
    // rows quietly falling back to the same slot placement.
    expect(sane.pos[0]).toBeCloseTo(1.4, 3);
    expect(sane.pos[2]).toBeCloseTo(0.9, 3);
    // The claim: Y changes nothing about where it stands.
    expect(absurd.pos).toEqual(sane.pos);
  });

  it('keeps every part inside the room footprint', () => {
    const parts = buildSceneFromRoom(
      room([saved(0, { position: { x: 40, y: 0, z: 40 } }), saved(1, { uid: 'b' })]),
    );
    for (const p of parts) {
      expect(Math.abs(p.pos[0])).toBeLessThanOrEqual(2.5 + 0.01);
      expect(Math.abs(p.pos[2])).toBeLessThanOrEqual(2 + 0.01);
    }
  });

  // Clamping the CENTRE — which is all this used to do — leaves a 2.2 m sofa whose
  // centre is 150 mm inside the wall still half in the garden. The whole FOOTPRINT
  // has to be in the room, and in an L / U / T that means the polygon, not the box.
  it('keeps every part’s whole footprint inside the room, not just its centre', () => {
    for (const over of [{}, { layoutId: 'l' as const, width: 6, depth: 4.7 }]) {
      const poly =
        'layoutId' in over && over.layoutId
          ? footprintForLayout(over.layoutId, over.width!, over.depth!)
          : footprintForLayout('rect', 5, 4);
      const parts = buildSceneFromRoom(
        room(
          [
            saved(0, { uid: 'a', position: { x: 2.4, y: 0, z: 1.9 } }),
            saved(1, { uid: 'b', category: 'wardrobe', label: 'wardrobe__slot:e', position: { x: 2.9, y: 0, z: 0.2 } }),
            saved(2, { uid: 'c', category: 'bed', label: 'double bed__slot:s', position: { x: 1.6, y: 0, z: 1.6 } }),
          ],
          over,
        ),
      );
      for (const p of parts.filter((x) => !x.wallMounted)) {
        expect(outsideShare(footFromPart(p.pos, p.rot, p.dimMM, p.circle), poly, 5)).toBe(0);
      }
    }
  });

  it('separates two detections that arrive in the same place', () => {
    // The AI regularly returns the same sofa twice, or puts a bed and a wardrobe on
    // the same wall. There used to be no part-vs-part resolution at all, so the
    // scene opened with two pieces of furniture inside each other.
    const parts = buildSceneFromRoom(
      room([
        saved(0, { uid: 'a', position: { x: 0, y: 0, z: 1.4 } }),
        saved(1, { uid: 'b', category: 'bed', label: 'double bed__slot:s', position: { x: 0.2, y: 0, z: 1.3 } }),
      ]),
    );
    const [a, b] = parts.map((p) => footFromPart(p.pos, p.rot, p.dimMM, p.circle));
    expect(footIntersectionArea(a, b) / Math.min(footArea(a), footArea(b))).toBeLessThan(0.05);
  });

  it('drops a part that would poke through the ceiling back under it', () => {
    // A 2.0 m wardrobe in a 2.4 m room, handed a Y that would push its top through
    // the ceiling: the settle pass brings it back down.
    const parts = buildSceneFromRoom(
      room(
        [
          saved(0, {
            category: 'wardrobe',
            label: 'wardrobe__slot:n',
            dimMM: [2000, 600, 2000],
            position: { x: 0, y: 1.2, z: -1.5 },
          }),
        ],
        { height: 2.4 },
      ),
    );
    const top = parts[0].pos[1] + parts[0].dimMM[2] / 1000;
    expect(top).toBeLessThanOrEqual(2.4);
  });

  it('does NOT shrink a part that is genuinely taller than the room', () => {
    // A 2.6 m wardrobe does not fit under a 2.4 m ceiling, and quietly resizing it
    // to fit would be exactly the dimension lie this codebase exists to avoid. It
    // keeps its real height, sits on the floor, and lib/clearance reports it.
    const parts = buildSceneFromRoom(
      room([saved(0, { category: 'wardrobe', label: 'wardrobe__slot:n', dimMM: [2000, 600, 2600] })], {
        height: 2.4,
      }),
    );
    expect(parts[0].dimMM[2]).toBe(2600);
    expect(parts[0].pos[1]).toBe(0);
  });

  it('carries the saved locked flag and colour through', () => {
    const parts = buildSceneFromRoom(room([saved(0, { locked: true, color: '#123456' })]));
    expect(parts[0].locked).toBe(true);
    expect(parts[0].color).toBe('#123456');
  });
});

// ─── Light emission ─────────────────────────────────────────────────────────

const asPart = (over: Partial<ScenePart>): ScenePart =>
  ({
    id: 'p',
    category: 'lamp',
    name: 'Lamp',
    shape: 'lamp-floor',
    pos: [0, 0, 0],
    rot: 0,
    dimMM: [300, 300, 1700],
    locked: false,
    ...over,
  }) as ScenePart;

describe('lightFor', () => {
  it('gives every lamp shape a sensible domestic bulb', () => {
    for (const shape of ['lamp-table', 'lamp-floor', 'lamp-pendant'] as const) {
      const spec = lightFor(asPart({ shape }))!;
      expect(spec).not.toBeNull();
      expect(spec.lumens).toBeGreaterThan(100);
      expect(spec.lumens).toBeLessThan(2000);
      expect(spec.kelvin).toBeGreaterThanOrEqual(2200);
      expect(spec.kelvin).toBeLessThanOrEqual(6500);
    }
  });

  it('only a shaded fixture aims its light', () => {
    // Which matters beyond looks: a cone is one shadow map, a bare bulb is six.
    expect(lightFor(asPart({ shape: 'lamp-pendant' }))!.coneDeg).toBeGreaterThan(0);
    expect(lightFor(asPart({ shape: 'lamp-floor' }))!.coneDeg).toBeUndefined();
  });

  it('emits nothing for furniture that is not a lamp', () => {
    expect(lightFor(asPart({ shape: 'sofa' }))).toBeNull();
    expect(lightFor(asPart({ shape: 'tv' }))).toBeNull();
    expect(lightFor(asPart({ shape: 'bed-double' }))).toBeNull();
  });

  it('lets the user override the shape default', () => {
    const spec = lightFor(asPart({ shape: 'lamp-floor', light: { lumens: 120, kelvin: 2200 } }))!;
    expect(spec.lumens).toBe(120);
    expect(spec.kelvin).toBe(2200);
  });

  it('agrees with isLightFixture', () => {
    // The Inspector shows the light controls off one and the renderer emits off
    // the other; a disagreement is an uneditable lamp or an inert control.
    for (const shape of CATALOG_SHAPES_ORDERED) {
      expect(isLightFixture(shape)).toBe(lightFor(asPart({ shape })) !== null);
    }
  });
});

// ─── collidesAt over round footprints ───────────────────────────────────────
// The placement gate. This is where a round table's phantom corners actually bit
// the user: a chair dragged into the corner of a round table was refused, in the
// 3D view, the plan and the keyboard nudge, because all three ask this one
// function. The clash rule in the room report barely notices the change by
// comparison — its tucked-chair exemption already lets a chair reach 85% of its
// own footprint into a table before it says anything.

describe('collidesAt with a round footprint', () => {
  function piece(over: Partial<ScenePart> & Pick<ScenePart, 'id' | 'dimMM' | 'pos'>): ScenePart {
    return {
      name: over.id,
      category: 'other',
      shape: 'box',
      rot: 0,
      locked: false,
      ...over,
    } as ScenePart;
  }

  /** A 1.2 m table at the origin, round or square, and a 450 mm chair. */
  function scene(circle: boolean, chairAt: [number, number]): ScenePart[] {
    return [
      piece({ id: 'table', category: 'table', dimMM: [1200, 1200, 750], pos: [0, 0, 0], circle }),
      piece({ id: 'chair', category: 'chair', dimMM: [450, 450, 850], pos: [chairAt[0], 0, chairAt[1]] }),
    ];
  }

  function blocked(parts: ScenePart[]): boolean {
    const chair = parts.find((p) => p.id === 'chair')!;
    return collidesAt(parts, 'chair', chair.pos, chair.rot, chair.dimMM);
  }

  it('lets a chair into the corner a circle does not occupy', () => {
    // Diagonally placed so the chair's inner corner clears r = 600 mm while
    // staying inside the bounding square on both axes.
    const at: [number, number] = [0.655, 0.655];
    expect(blocked(scene(false, at))).toBe(true);
    expect(blocked(scene(true, at))).toBe(false);
  });

  it('still refuses a chair pushed into the table itself', () => {
    expect(blocked(scene(true, [0.7, 0]))).toBe(true);
    expect(blocked(scene(true, [0, 0]))).toBe(true);
  });

  it('respects the MOVER’s own round footprint, not just the obstacle’s', () => {
    // Same geometry as above with the roles swapped: the round piece is the one
    // being dragged. Its corners are the phantom ones now, so dropping them has to
    // work on the mover side too — `collidesAt` reads the flag off the part it
    // looks up by id, which is easy to get wrong when the dims arrive as a
    // separate argument.
    //
    // Note the reverse is NOT true and there is no test claiming it: a small round
    // mover beside a SQUARE table still collides, because that table's corner is
    // real.
    const build = (circle: boolean): ScenePart[] => [
      piece({ id: 'table', category: 'table', dimMM: [1200, 1200, 750], pos: [0, 0, 0], circle }),
      piece({ id: 'chair', category: 'chair', dimMM: [450, 450, 850], pos: [0.655, 0, 0.655] }),
    ];
    const at: [number, number, number] = [0, 0, 0];
    expect(collidesAt(build(false), 'table', at, 0, [1200, 1200, 750])).toBe(true);
    expect(collidesAt(build(true), 'table', at, 0, [1200, 1200, 750])).toBe(false);
  });
});
