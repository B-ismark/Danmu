// § H.3 finding 5, widened by measurement: every placement path read the AUTHORED
// parts, so a new piece was placed against a room the user had already rearranged.
//
// The finding as filed said `openSpotForNewPart` reads `parts` rather than resolved
// positions, and named the ring search as the consequence — the second fan aimed
// around a spot the first one had been dragged out of. Tracing the callers made it
// wider in the direction that matters: all THREE placement paths pass the same raw
// array (`CatalogPanel.spawn`, `PlanView.onDrop`, `Room.onDrop`), and `placeNewPart`
// reads it for `findSupportUnder` as well as `openSpotForNewPart` reading it for
// `collidesAt`. So the visible failure is not a slightly-off ring, it is a lamp
// resting at desk height over empty floor.
//
// This is CLAUDE.md's own rule arriving on schedule: a part's transform lives in two
// layers, the authored one on `ScenePart` and the user's edit in `useStudio`, and the
// override wins. A drag writes ONLY the override map — which is exactly what lets a
// re-scan rebuild `parts` while the moves re-apply by id — so `useScene.parts` is
// the room as it was authored, not the room as it stands. `currentRoomScene()` in
// `lib/room-scene.ts` is the sanctioned reader for a non-React caller, and its own
// docblock says so: "for pointer handlers and one-shot actions".
//
// The two halves are deliberately in two files, because a gate on a pure function
// says nothing about the screen that calls it. THIS file measures the consequence on
// `placeNewPart` / `openSpotForNewPart`, which are pure and take `existing` as an
// argument. The caller half — that the three call sites actually hand over resolved
// parts — is in `tests/spawn-spread-wired.test.tsx`.

import { describe, expect, it } from 'vitest';
import { footprintForLayout } from '@/lib/footprint';
import { groundY, verticalExtent } from '@/lib/physics';
import { resolveParts } from '@/lib/transforms';
import { openSpotForNewPart, placeNewPart, type Category, type ScenePart, type Shape } from '@/lib/scene-spec';

const ROOM = { width: 6, depth: 5, height: 2.5, footprint: footprintForLayout('rect', 6, 5) };

const LAMP: [Category, Shape, [number, number, number]] = ['lamp', 'lamp-table', [200, 200, 450]];

/** A desk, authored in the middle and never moved by the fixture itself. The test
 *  moves it through the OVERRIDE map, which is the only thing a drag writes.
 *
 *  Category, shape and dims are the Library's own row for "Dining / desk table"
 *  (`lib/scene-spec.ts`), not invented here. The first draft wrote `shape: 'desk'`
 *  behind an `as ScenePart` cast: there is no such shape, the cast silenced the
 *  compiler, `groundY` fell through to a default, and **the file went 5-of-5 green
 *  measuring a piece that does not exist.** `pnpm test` cannot see this and
 *  `pnpm typecheck` can, which is the whole reason both run. */
const DESK: [Category, Shape, [number, number, number]] = ['desk', 'desk-standard', [1400, 700, 750]];

const DESK_AUTHORED: ScenePart = {
  id: 'desk-1',
  name: 'Desk',
  category: DESK[0],
  shape: DESK[1],
  dimMM: DESK[2],
  pos: [0, 0, 0],
  rot: 0,
  locked: false,
};

/** Where the user dragged it to. Far enough from the origin that the two answers
 *  cannot be confused for rounding: 2 m is nearly three desk-widths. */
const DRAGGED_TO: [number, number, number] = [2, 0, 1.5];

const OVERRIDES = { positions: { 'desk-1': DRAGGED_TO }, rotations: {}, dims: {} };

/** The desk's top, derived rather than typed. **`verticalExtent`, not
 *  `groundY + h/2`** — the first draft of this line wrote the half-height, which is
 *  the CENTRE, and got 0.375 for a top that is really 0.75. That is the exact
 *  base-versus-centre confusion `verticalExtent` exists to own, reproduced here by
 *  someone who had read the rule an hour earlier. The measurement caught it because
 *  it was run before anything was built on it. */
const DESK_TOP = verticalExtent(DESK[0], DESK[1], DESK_AUTHORED.dimMM, DESK_AUTHORED.pos[1])[1];

/** The floor answer for a table lamp, likewise derived. */
const LAMP_ON_FLOOR = groundY(LAMP[0], LAMP[1], LAMP[2], ROOM.height);

const placeLampAt = (existing: ScenePart[], x: number, z: number) =>
  placeNewPart(LAMP[0], LAMP[1], LAMP[2], ROOM, existing, [x, z]);

describe('a piece is placed against the room as it STANDS, not as it was authored', () => {
  it('the two readings of the room genuinely differ, or nothing below means anything', () => {
    // The control. If `resolveParts` ever stopped applying the override, every
    // assertion in this file would pass for the wrong reason — both arrays would be
    // the authored one and every comparison would be a tautology. Asserting the
    // POSITIONS rather than object identity, because `resolvePart` deliberately
    // returns the same object when nothing overrides it.
    const authored = [DESK_AUTHORED];
    const resolved = resolveParts(authored, OVERRIDES);
    expect(authored[0].pos).toEqual([0, 0, 0]);
    expect(resolved[0].pos).toEqual(DRAGGED_TO);
  });

  it('rests a lamp on the desk where the desk actually IS', () => {
    const resolved = resolveParts([DESK_AUTHORED], OVERRIDES);
    const { pos } = placeLampAt(resolved, DRAGGED_TO[0], DRAGGED_TO[2]);
    expect(pos[1], 'a lamp dropped on the desk should sit on the desk').toBeCloseTo(DESK_TOP, 6);
  });

  it('and does NOT rest it in mid-air where the desk USED to be', () => {
    // The defect, stated as its symptom. Aiming at the origin — which the authored
    // array still calls a desk and the room no longer does — must give the floor.
    const resolved = resolveParts([DESK_AUTHORED], OVERRIDES);
    const { pos } = placeLampAt(resolved, 0, 0);
    expect(pos[1], 'nothing is at the origin any more, so the lamp belongs on the floor').toBeCloseTo(
      LAMP_ON_FLOOR,
      6,
    );
  });

  it('which is the opposite of both answers the AUTHORED array gives', () => {
    // Not a restatement of the two above: it pins that the old reading was wrong in
    // BOTH directions rather than merely different. A one-directional check would
    // pass against a fix that only ever refuses to stack.
    const authored = [DESK_AUTHORED];

    const atOldSpot = placeLampAt(authored, 0, 0).pos[1];
    expect(atOldSpot, 'the authored array floats the lamp where the desk no longer is').toBeCloseTo(DESK_TOP, 6);

    const atNewSpot = placeLampAt(authored, DRAGGED_TO[0], DRAGGED_TO[2]).pos[1];
    expect(atNewSpot, 'and drops it through the desk that is really there').toBeCloseTo(LAMP_ON_FLOOR, 6);

    // The gap the user would see. Named as a number so a shrinking one is visible
    // rather than merely still-failing.
    expect(Math.abs(atOldSpot - LAMP_ON_FLOOR)).toBeGreaterThan(0.7);
  });

  it('and the ring search steps around where a piece stands, not where it was authored', () => {
    // The half the finding was originally filed as. A second piece asks for an open
    // spot; with the desk resolved to (2, 1.5) the origin is clear, so the search may
    // use it. Reading the AUTHORED array it believes the origin is taken.
    //
    // **A CHAIR, not a plant.** The first draft asked for a plant and got `undefined`
    // from both readings, which would have read as "the two agree" — a false green in
    // the reassuring direction. `plant` is in `TABLETOP_PRONE_CATEGORIES`, so it
    // STACKS on the desk instead of colliding with it, and a piece that can stack can
    // always take the home spot. The search this test is about is the collision one,
    // so the fixture has to be something that cannot rest on furniture.
    const CHAIR: [Category, Shape, [number, number, number]] = ['chair', 'chair-dining', [450, 500, 900]];
    const resolved = resolveParts([DESK_AUTHORED], OVERRIDES);
    const aimResolved = openSpotForNewPart(CHAIR[0], CHAIR[1], CHAIR[2], ROOM, resolved);
    const aimAuthored = openSpotForNewPart(CHAIR[0], CHAIR[1], CHAIR[2], ROOM, [DESK_AUTHORED]);

    // Not asserting a coordinate: the ring's step is the piece's own diagonal and
    // pinning where it lands would be pinning the search's parameters. What must
    // hold is that the two readings disagree, and that the resolved one is not
    // avoiding a desk that is 2.5 m away.
    expect(aimResolved).not.toEqual(aimAuthored);
    if (aimResolved) {
      expect(Math.hypot(aimResolved[0] - DRAGGED_TO[0], aimResolved[1] - DRAGGED_TO[2])).toBeGreaterThan(0.4);
    }
  });
});
