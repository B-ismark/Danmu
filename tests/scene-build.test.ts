import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSceneFromRoom,
  CATALOG_SHAPES_ORDERED,
  collidesAt,
  defaultScene,
  isLightFixture,
  CATEGORIES,
  isWallMountedPart,
  lightFor,
  type ScenePart,
} from '../lib/scene-spec';
import { LAYOUT_IDS, type RoomData } from '../lib/storage';
import { heightForNewCeiling, MOUNT_PAD } from '../lib/physics';
import { stripCommentsAndStrings } from './helpers/source';
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
    // This existed because the two paths gave different answers: `groundY` hung a fan a
    // flat 0.15 below the slab, so a 0.4 m one reached 2.85 in a 2.8 m room, over the
    // cap. Since § 35 the ceiling arm IS `roomHeight - MOUNT_PAD - h / 2`, so the two
    // agree by construction — which is a reason to keep this test rather than to
    // retire it: agreement that holds by construction is exactly the kind that stops
    // holding silently when one side is edited.
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

describe('a wall snap is measured across the yaw the piece will actually keep', () => {
  // The WIRING, which is the half that had no coverage. `snapToWall`'s own tests
  // prove the projection; this proves `buildSceneFromRoom` hands it the rotation
  // that will really apply. Dropping `alongRot` from the two call sites leaves
  // every unit test in `physics-snap` green, because the argument still works - it
  // is simply never passed.
  //
  // The earlier attempt at this used a WARDROBE and measured 21 mm, which it read
  // as "too small to assert on". A wardrobe is floor-standing, so the settle pass
  // re-grounds and shifts it afterwards and most of the difference is smeared away.
  // A TV is wall-mounted and the settle pass leaves it alone, so what the clamp did
  // is what you can still see: 500 mm.
  const TV: [number, number, number] = [1200, 120, 700];

  function tvAt(yaw: number) {
    const parts = buildSceneFromRoom(
      room([
        saved(0, {
          label: 'tv',
          category: 'tv',
          shape: 'tv',
          dimMM: TV,
          // Aimed past where a 1.2 m TV lying flat could sit: the room is 5 m wide,
          // so the North wall runs x = -2.5 .. 2.5 and a flat TV stops at 1.9.
          position: { x: 2.4, y: 1.4, z: -1.9 },
          yaw,
        }),
      ]),
    );
    const tv = parts.find((p) => p.shape === 'tv');
    expect(tv, 'the fixture must produce a wall-mounted TV').toBeDefined();
    return tv!;
  }

  it('lets a TV the detector reported edge-on sit where an edge-on TV fits', () => {
    const edgeOn = tvAt(Math.PI / 2);
    // The model's yaw survives the snap, which is the precondition for the clamp
    // being measured across it. Without this the rest of the test proves nothing.
    expect(edgeOn.rot).toBeCloseTo(Math.PI / 2, 9);
    expect(edgeOn.pos[0]).toBeCloseTo(2.4, 6);
  });

  it('and still holds a flat one half its width off the corner', () => {
    const flat = tvAt(0);
    // |yaw| < 0.05, so the wall's own rot wins and the width is the right extent.
    expect(flat.pos[0]).toBeCloseTo(1.9, 6);
  });

  it('the two differ by 500 mm, which is the size of the defect', () => {
    // Named as a number so the next person can tell a real regression from noise.
    // Half the TV's width minus half its depth: (1200 - 120) / 2 = 540 mm of
    // clamp, of which 500 is reachable before the aim point itself binds.
    expect(tvAt(Math.PI / 2).pos[0] - tvAt(0).pos[0]).toBeCloseTo(0.5, 6);
  });
});

describe('one ceiling clearance: the duplication itself, not just its drift', () => {
  // The assertions in the describe above compare the two paths' RESULTS, which can
  // only catch a duplicate that has DRIFTED. Restore `const CEILING_PAD = 0.02` next
  // to the `MOUNT_PAD` import and every one of them stays green while the exact
  // duplication this describe is named for is back in the file. Reading the source is
  // the only way to see a second declaration; a regex over code, and named as such.
  //
  // **This was written against `lib/scene-spec.ts` by name and that rotted the moment
  // the clamp moved** — into `settleHeights` in `lib/layout-settle.ts`, so that both
  // the detected-scene path and Suggest could reach it. The test went red, which is
  // the right outcome and is the whole reason its second assertion existed: it says
  // "the file that clamps still reads the shared constant", so a green cannot mean
  // the clamp went away. It had not gone away. It had moved, and a check naming one
  // file cannot tell those apart.
  //
  // So it names no file now. The declaration ban sweeps every module in `lib/`, and
  // the positive half asks which file owns the clamp by FINDING it rather than by
  // remembering — whichever module clamps to the ceiling must read `MOUNT_PAD`, and
  // there must be exactly one.
  // Comments STRIPPED, and this is not tidiness — it is the difference between the
  // sweep working and not. Both assertions below are regexes over source, and a
  // docblock that QUOTES the arithmetic satisfies them exactly as well as the
  // arithmetic does. That is not hypothetical: the commit that added this line also
  // added a comment to `layout-settle.ts` reading `... - h / 2 - MOUNT_PAD ...` to
  // explain why the low guard matches `drag-resolve`, and with raw `src` the clamp
  // could then be deleted outright with this test still green. Measured by deleting
  // it. A check a comment can satisfy is a check that cannot fail.
  // One PASS, not two regexes. The regex version was wrong in both orderings and both
  // were measured wrong: comments-first lets a `/*` inside a STRING swallow real code
  // (planting `const GLOB_ALL = ...` above a duplicate pad left this sweep green with
  // the duplicate in the file), and strings-first lets an apostrophe in a comment eat
  // whatever follows - and this codebase's comments are full of apostrophes. See
  // `tests/helpers/source.ts` for the scanner and for the one limit it still has.
  const libDir = join(process.cwd(), 'lib');
  const modules = readdirSync(libDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, src: stripCommentsAndStrings(readFileSync(join(libDir, f), 'utf8')) }));

  it('and the stripper leaves the code it is asked about', () => {
    // The stripper has a known limit (a regex literal containing a quote), so every
    // sweep below is paired with a positive check. Without this, a stripper that ate
    // code would make both assertions pass over nothing, which is the exact failure
    // they exist to catch, one layer down.
    const physics = modules.find((m) => m.file === 'physics.ts');
    expect(physics, 'physics.ts must be in the sweep').toBeDefined();
    expect(physics!.src, 'the declaration must survive stripping').toMatch(/export const MOUNT_PAD\s*=/);
    const clampers = modules.filter((m) => /-\s*MOUNT_PAD/.test(m.src)).map((m) => m.file);
    expect(clampers.length, 'the readers must survive stripping').toBeGreaterThan(0);
  });

  it('and MOUNT_PAD is the value every one of them agrees on', () => {
    // Pinned, because nothing else in the suite pins it and every test that reads it
    // DERIVES from it - which is right, and leaves the constant itself free to move
    // silently. Measured: changing it to 0.05 left the whole suite green. A clearance
    // is a look, so changing it should be a deliberate act with a red test attached.
    expect(MOUNT_PAD).toBeCloseTo(0.02, 12);
  });

  it("and no module in lib/ computes a piece's top by hand", () => {
    // `pos[1]` is a BOTTOM for a floor anchor and the mesh CENTRE for every other one, so
    // `pos[1] + dimMM[2] / 1000` is wrong by half a height for a television and for the
    // whole ceiling family. `verticalExtent` is the one answer. Converting the last two
    // readers was otherwise unguarded: restoring either one killed no test, which is why
    // this sweep exists rather than a behavioural test of one call site.
    //
    // ZERO, not "zero except" - an exception list is how the next copy gets in. The one
    // legitimate-looking reader, a bedside lamp stood on a nightstand, was converted for
    // exactly that reason even though it was right.
    const offenders = modules
      .filter((m) => m.file !== 'physics.ts')
      .filter((m) => /pos\[1\] \+ [^;,)]*dimMM\[2\] \/ 1000/.test(m.src))
      .map((m) => m.file);
    expect(offenders, 'ask verticalExtent - pos[1] is not always a bottom').toEqual([]);
    // And the positive half: the readers must be findable, or this passes over nothing.
    const readers = modules.filter((m) => /verticalExtent\(/.test(m.src)).map((m) => m.file);
    expect(readers.length, 'the sweep must find the shared answer being used').toBeGreaterThan(3);
  });

  it('no module in lib/ declares a ceiling pad of its own', () => {
    expect(modules.length, 'the sweep must have files to sweep').toBeGreaterThan(20);
    const offenders = modules
      .filter((m) => m.file !== 'physics.ts')
      .filter((m) => /^\s*(?:export\s+)?const\s+\w*(?:CEILING|MOUNT)_PAD\s*=/m.test(m.src))
      .map((m) => m.file);
    expect(offenders, 'MOUNT_PAD lives in physics.ts and nowhere else').toEqual([]);
  });

  it('and every module that clamps to the ceiling reads the shared constant', () => {
    // `cap` is the local name the clamp gives `roomHeight - MOUNT_PAD`. Asking for the
    // ARITHMETIC rather than for a mention of `MOUNT_PAD` is what keeps this honest: a
    // module that imports the constant and does not use it would satisfy a mention.
    //
    // **The whole set, not `toContain('layout-settle.ts')` — and the title said
    // "exactly one" while the assertion could not check it.** `toContain` is satisfied
    // by any N >= 1, and N is THREE, so it held while saying nothing and would have held
    // just as well if a fourth module had grown a clamp of its own overnight. It also
    // could not fail in the direction the comment above it cares about — a clamp
    // DELETED rather than moved — unless the deleted one happened to be the single file
    // it named.
    //
    // Three is correct and is not a smell: they answer three different questions — a
    // piece under a live pointer, a whole room after a solve, and a ceiling the user has
    // just changed. What matters is that none of them declares its own pad, which is the
    // assertion above. This one pins WHO, so a fourth reader arrives as a decision
    // rather than as a diff nobody reads.
    const clampers = modules.filter((m) => /-\s*MOUNT_PAD/.test(m.src)).map((m) => m.file).sort();
    expect(clampers, 'the sweep must actually find the clampers').toEqual([
      'drag-resolve.ts',
      'layout-settle.ts',
      'physics.ts',
    ]);
  });
});

// ─── `wallMounted` is derived, never hand-set ─────────────────────────────────
//
// The flag means "is this piece's geometry centred on its origin", and
// `isWallMountedPart(category, shape)` — i.e. `anchorFor(...) !== 'floor'` — is that
// question's only answer. Six readers trust it: `floorBlockers`, `isObstacle`,
// `overlapsSomething`, `layout-score`'s window branch, `layout-solve`'s `movable`
// mask, and `MeasureGuides`.
//
// A `lamp-pendant` was seeded `wallMounted: false` directly beneath a comment saying
// "Ceiling-anchored, so `groundY` decides the height", so its `pos[1]` was a mesh
// CENTRE while its flag claimed floor-standing. Found by danmu-bc's sweep, and this
// is that sweep as an assertion: the seeder's default derives now, and the two
// hand-set overrides are gone.
describe('every part the app builds agrees with the derived mount flag', () => {
  // Not a hand-typed list: the layout ids come from `storage.ts`'s `as const` array,
  // minus `custom` (which has no preset footprint of its own to build from).
  const LAYOUTS = LAYOUT_IDS.filter((id) => id !== 'custom');
  const SIZES: Array<[number, number]> = [
    [6, 4],
    [7.5, 5.6],
    [6, 5],
    [12, 9],
    [3.2, 2.6],
  ];

  it('across every preset layout at five sizes', () => {
    const wrong: string[] = [];
    let swept = 0;
    for (const layoutId of LAYOUTS) {
      for (const [w, d] of SIZES) {
        for (const p of defaultScene(layoutId, w, d)) {
          swept++;
          // `!!`, not `!==`. `wallMounted` is OPTIONAL on `ScenePart` and floor-standing
          // furniture simply omits it, so ABSENT and `false` are the same answer — which
          // is not a shortcut here but what every reader actually does: `floorBlockers`,
          // `isObstacle`, `overlapsSomething` and `movable` all test `!p.wallMounted`.
          // The first version of this assertion compared strictly and reported 165 of
          // 323 parts as wrong, every one of them `stored=undefined derived=false`.
          const derived = isWallMountedPart(p.category, p.shape);
          if (!!p.wallMounted !== derived) {
            wrong.push(`${layoutId} ${w}x${d} · ${p.name} (${p.shape}) stored=${p.wallMounted} derived=${derived}`);
          }
        }
      }
    }
    // A COUNT, and a literal floor under it. `roomBays` returns [] for a footprint it
    // cannot fit two bays into, and `defaultScene` then returns no parts at all — so a
    // sweep whose sizes all fell through would report zero disagreements over zero
    // parts and read exactly like a pass.
    expect(swept, 'the sweep must have parts to sweep').toBeGreaterThan(200);
    expect(wrong, `${wrong.length} of ${swept} parts disagree`).toEqual([]);
  });

  it('and the detected-room path agrees too', () => {
    // `buildSceneFromRoom` is the other builder, and it now ends on `settleHeights`,
    // which reads the ANCHOR rather than this flag. So the two must not disagree: a
    // piece whose flag says floor and whose anchor says ceiling gets a floor clamp and
    // a centred geometry.
    //
    // **This test used to call `buildSceneFromRoom(room([]))`** — and `buildSceneFromRoom`
    // short-circuits an empty `detectedObjects` into `defaultScene`, so it swept the
    // starter scene, was a duplicate of the sweep above, and the detected builder was
    // evaluated by nothing in the suite. Its own message said "the fallback starter
    // scene" while its title said "the detected-room path": the two disagreed in prose
    // and the title is the half a reader believes. Hence `fromDetection` below — a key
    // `defaultScene` never sets, so the fallback cannot satisfy this again silently.
    // Categories ALONE cannot find this. The label is what `refineShape` reads, and the
    // disagreement only exists where a label refines to a shape the category's own row
    // did not describe — `lamp` + "pendant" is `lamp-pendant`, which anchors to the
    // ceiling, out of a row that carried no flag at all. Sweeping one label per category
    // gives each category its DEFAULT shape, where a hand-typed row and the derivation
    // agree by construction, so the first version of this test was green against a full
    // revert of the builder. These words are the ones `refineShape` actually branches on.
    const LABELS = ['', 'pendant', 'ceiling', 'hanging', 'chandelier', 'bulb', 'table', 'wall', 'floor'];
    const seen: string[] = [];
    const wrong: string[] = [];
    for (const cat of CATEGORIES) {
      for (const word of LABELS) {
        const label = `${word || cat}__slot:n`;
        const parts = buildSceneFromRoom(room([saved(1, { category: cat, label })]));
        for (const p of parts) {
          expect(p.fromDetection, `${p.name} came from ${cat} without a detection`).toBeDefined();
          seen.push(`${cat}/${word}->${p.shape}`);
          const derived = isWallMountedPart(p.category, p.shape);
          if (!!p.wallMounted !== derived) {
            wrong.push(`${cat} + "${label}" · ${p.shape} stored=${p.wallMounted} derived=${derived}`);
          }
        }
      }
    }
    // The pair that made this a defect has to be IN the sweep, or the sweep is a sweep
    // over agreement. Named, so a future narrowing of `refineShape` fails here loudly
    // rather than quietly removing the only case with teeth.
    expect(seen, 'the sweep must reach a ceiling-anchored refinement').toContain('lamp/pendant->lamp-pendant');
    // A count with a floor, for the same reason the sweep above has one: a detection
    // the builder refuses produces no parts, and a loop over nothing is green.
    expect(seen.length, 'the sweep must have produced detected parts').toBeGreaterThanOrEqual(
      CATEGORIES.length,
    );
    expect(wrong, `${wrong.length} of ${seen.length} detected parts disagree`).toEqual([]);
  });

  it('a detected ceiling piece is mounted at build time, not only after a reload', () => {
    // The measured consequence of the flag being keyed on CATEGORY here while `groundY`
    // keyed it on SHAPE: the builder produced a door with the flag unset, the writer
    // spreads so the key was ABSENT from the JSON, and the reader derived `true`. So
    // `isAperture` flipped on reload and the wall grew a light hole — with `dropped`
    // empty, because a file that OMITS the field disagrees with nothing. The round trip
    // was not an identity, and it was silent, which is the pair that makes it a defect
    // rather than a difference.
    // A DETECTED PENDANT, not a detected door. The door was the reported symptom, but
    // `CATEGORY_DEFAULTS.door` already carried `wallMounted: true`, so a door fixture is
    // green against the defect and would have been decoration. `lamp` carried no flag
    // and "pendant" refines to a ceiling anchor, which is the disagreement.
    const [lamp] = buildSceneFromRoom(room([saved(1, { category: 'lamp', label: 'pendant__slot:n' })]));
    expect(lamp.shape, 'the fixture must actually refine to a pendant').toBe('lamp-pendant');
    expect(isWallMountedPart(lamp.category, lamp.shape)).toBe(true);
    expect(lamp.wallMounted, 'the builder must not answer this by category').toBe(true);
  });
});
