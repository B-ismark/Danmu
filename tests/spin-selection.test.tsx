// @vitest-environment jsdom
//
// § B.14: a turn that puts a corner through the wall — keep it and report it.
//
// Decided 2026-09-03, and the decision is narrower than the question sounded. The
// ANGLE is always taken; refusing it would make a piece in a tight corner unturnable.
// What may not happen is a turn succeeding in silence.
//
// `spinSelection` — the context menu's *Turn a quarter* — was the fourth way to turn a
// piece in this app and the only one that ran through no pipeline at all. It wrote
// `setRotation` raw, so it had no containment, no legality answer, and no cascade: a
// quarter turn on a nightstand left the lamp on it facing the old way. Its docblock
// defended that as rule 2's "never silently nudge furniture to make an action succeed",
// which is the right rule and the wrong half of it — the plan's turn handle, its two
// keyboard paths and the 3D gizmo all clamp AND report, so two documents in this repo
// had drifted into calling the same outcome the contract and the defect.
//
// jsdom rather than node because `announce` dispatches a window event, and the
// announcement is half of what this file is measuring. The other half is that the
// piece is a `[role]`-less module function, so no component is mounted.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { footprintForLayout } from '@/lib/footprint';
import { currentRoomScene } from '@/lib/room-scene';
import { ANNOUNCE_EVENT } from '@/lib/announce';
import { spinSelection } from '@/components/studio/KeyboardShortcuts';
import type { ScenePart } from '@/lib/scene-spec';

const QUARTER = Math.PI / 2;

/** Everything the live region said during one call. */
let spoken: string[] = [];
const listen = (e: Event) => spoken.push((e as CustomEvent<string>).detail);

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart =>
  ({
    name: 'Piece', category: 'other', shape: 'box', locked: false,
    dimMM: [600, 400, 700], pos: [0, 0, 0], rot: 0, wallMounted: false,
    ...over,
  }) as ScenePart;

/** A wardrobe long enough that a quarter turn cannot fit where it stands. */
const wardrobe = (pos: [number, number, number], rot = 0): ScenePart =>
  part({ id: 'wardrobe-1', name: 'Wardrobe', category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos, rot });

const nightstand = (pos: [number, number, number]): ScenePart =>
  part({ id: 'nightstand-1', name: 'Nightstand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos });

const lamp = (pos: [number, number, number]): ScenePart =>
  part({ id: 'lamp-1', name: 'Bedside lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos });

/** Long enough that a quarter turn against a wall must be clamped, and low enough
 *  that a lamp on it is nowhere near the ceiling. */
const desk = (pos: [number, number, number]): ScenePart =>
  part({ id: 'desk-1', name: 'Desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos });

function room(parts: ScenePart[], w = 6, d = 5) {
  useScene.setState({
    parts,
    room: { ...useScene.getState().room, width: w, depth: d, height: 2.5, footprint: footprintForLayout('rect', w, d), layoutId: 'rect' },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {}, hidden: {}, selection: [], selectedPartId: null });
}

const select = (...ids: string[]) => useStudio.setState({ selection: ids, selectedPartId: ids[ids.length - 1] });
const at = (id: string) => currentRoomScene().find((p) => p.id === id)!;

beforeEach(() => {
  spoken = [];
  // Restored per test, because two of them set it and a leaked `cm` would make every
  // later assertion in this file read a unit it did not choose.
  useSettings.setState({ dimUnit: 'm' });
  window.addEventListener(ANNOUNCE_EVENT, listen);
});
afterEach(() => window.removeEventListener(ANNOUNCE_EVENT, listen));

describe('spinSelection takes the angle', () => {
  it('turns a quarter, and a second press turns another quarter', () => {
    room([nightstand([0, 0, 0])]);
    select('nightstand-1');
    spinSelection(1);
    expect(at('nightstand-1').rot).toBeCloseTo(QUARTER, 10);
    // From where it EFFECTIVELY faces. Off the authored `rot` alone the second press
    // would start over from 0 and undo the first.
    spinSelection(1);
    expect(at('nightstand-1').rot).toBeCloseTo(2 * QUARTER, 10);
  });

  it('takes the angle even when the room will not have it', () => {
    // 2 m wide against the north wall of a 6 x 5 room: turned a quarter it is 2 m deep
    // and 600 mm wide, and it cannot stand at z = -2.2 without leaving the room.
    room([wardrobe([0, 0, -2.2])]);
    select('wardrobe-1');
    spinSelection(1);
    expect(at('wardrobe-1').rot).toBeCloseTo(QUARTER, 10);
  });
});

describe('spinSelection says when the piece no longer fits', () => {
  it('names the piece and the reason', () => {
    // Blocked rather than out of the room: `valid` is computed on the position the
    // clamp has ALREADY produced, so a wall alone cannot make it false — that is the
    // whole finding behind `turnNudge` below, and this case must not depend on it.
    room([nightstand([0, 0, 0]), { ...wardrobe([0, 0, 1.0]), id: 'wardrobe-1' }]);
    select('wardrobe-1');
    spinSelection(1);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toContain('Wardrobe does not fit at that angle');
    // The reason comes from `refusalCause`, so the two surfaces cannot drift on it.
    expect(spoken[0]).toMatch(/it would stick out of the room|something is in the way|wider than that wall/);
  });

  it('says nothing of the sort when it does fit', () => {
    room([nightstand([0, 0, 0])]);
    select('nightstand-1');
    spinSelection(1);
    expect(spoken).toEqual(['Turned a quarter turn.']);
  });

  it('names the FIRST refused piece and counts the rest', () => {
    room([
      { ...wardrobe([-1.5, 0, 1.0]), id: 'wardrobe-1', name: 'Wardrobe 1' },
      { ...wardrobe([1.5, 0, 1.0]), id: 'wardrobe-2', name: 'Wardrobe 2' },
      { ...nightstand([-1.5, 0, 0]), id: 'nightstand-1' },
      { ...nightstand([1.5, 0, 0]), id: 'nightstand-2' },
    ]);
    select('wardrobe-1', 'wardrobe-2');
    spinSelection(1);
    expect(spoken[0]).toContain('2 pieces turned a quarter turn.');
    expect(spoken[0]).toContain('Wardrobe 1 does not fit at that angle');
    // SINGULAR. An unconditional plural verb reads "1 more do not fit either" for a set
    // of exactly two, which is the commonest multi-select there is — and the first
    // version of this assertion pinned that exact wrong string, so it was green by
    // agreeing with the defect.
    expect(spoken[0]).toContain('1 more does not fit either.');
  });

  it('uses the plural verb once there is more than one of them', () => {
    // The other end of the same branch. Without this the singular fix could have been
    // an unconditional 'does' and nothing would have gone red.
    room([
      { ...wardrobe([-1.5, 0, 1.0]), id: 'wardrobe-1', name: 'Wardrobe 1' },
      { ...wardrobe([0, 0, 1.0]), id: 'wardrobe-2', name: 'Wardrobe 2' },
      { ...wardrobe([1.5, 0, 1.0]), id: 'wardrobe-3', name: 'Wardrobe 3' },
      { ...nightstand([-1.5, 0, 0]), id: 'nightstand-1' },
      { ...nightstand([0, 0, 0]), id: 'nightstand-2' },
      { ...nightstand([1.5, 0, 0]), id: 'nightstand-3' },
    ]);
    select('wardrobe-1', 'wardrobe-2', 'wardrobe-3');
    spinSelection(1);
    expect(spoken[0]).toContain('2 more do not fit either.');
  });
});

describe('a turn that had to SLIDE the piece says so — § B.14', () => {
  // The finding this whole item turned on. `resolvePlacement` computes
  // `valid = inRoom && !collides` against the position it has already clamped, so a
  // turn whose new footprint crossed a wall comes back VALID once the clamp has
  // pulled it back in — and the piece has moved somewhere the user never asked for,
  // with nothing saying so. `valid` cannot express it; `turnNudge` is what does.

  it('reports the slide, in the unit the user set', () => {
    // The unit is SET here, and that is the point of the test rather than decoration:
    // an earlier version asserted `0.7 m` while never touching `useSettings`, so it was
    // agreeing with the store's default and `dimUnit` → `'m'` was a free mutation.
    useSettings.setState({ dimUnit: 'cm' });
    room([wardrobe([0, 0, -2.2])]);
    select('wardrobe-1');
    spinSelection(1);
    expect(spoken).toHaveLength(1);
    // Turned, the wardrobe's depth half-extent is 1.0 m, so it may stand no further
    // north than z = -1.5 in a 5 m room: 0.7 m of slide.
    expect(spoken[0]).toContain('Wardrobe moved 70 cm to stay in the room.');
  });

  it('reports the same slide in metres when that is what the user set', () => {
    // The pair. One unit alone cannot tell a hard-coded unit from a read one.
    useSettings.setState({ dimUnit: 'm' });
    room([wardrobe([0, 0, -2.2])]);
    select('wardrobe-1');
    spinSelection(1);
    expect(spoken[0]).toContain('Wardrobe moved 0.7 m to stay in the room.');
  });

  it('is silent for a turn that happened where it stood', () => {
    room([nightstand([1, 0, 1])]);
    select('nightstand-1');
    spinSelection(1);
    expect(spoken[0]).not.toContain('to stay in the room');
  });

  it('does not double up on a piece that is already refused', () => {
    // A refused piece has a sentence of its own. Two sentences about one piece is
    // worse than one, so the slide is reported only for pieces that FIT.
    room([nightstand([0, 0, 0]), { ...wardrobe([0, 0, 1.0]), id: 'wardrobe-1' }]);
    select('wardrobe-1');
    spinSelection(1);
    expect(spoken[0]).toContain('does not fit at that angle');
    expect(spoken[0]).not.toContain('to stay in the room');
  });
});

describe('spinSelection is a placement, not a bare rotation write', () => {
  it('clamps a piece the turn would push out of the room', () => {
    room([wardrobe([0, 0, -2.2])]);
    select('wardrobe-1');
    const before = at('wardrobe-1').pos[2];
    spinSelection(1);
    const after = at('wardrobe-1').pos[2];
    // Turned, its depth half-extent is 1.0 m, so the furthest north it may stand in a
    // 5 m room is z = -1.5. It was at -2.2 and must have been pulled back in.
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(-1.5 - 1e-6);
  });

  it('leaves a piece that already fits exactly where it stands', () => {
    room([nightstand([1, 0, 1])]);
    select('nightstand-1');
    spinSelection(1);
    expect(at('nightstand-1').pos).toEqual([1, 0, 1]);
  });

  it('writes NO position override for a turn that did not move the piece', () => {
    // The assertion above reads the RESOLVED transform, which is `[1,0,1]` whether or
    // not an override was created — so making `setPosition` unconditional left it
    // green. This reads the override map itself, which is the only place the
    // difference exists. CLAUDE.md: "a transform write is never free — writing back an
    // unchanged rotation still CREATES an override, which `lib/transforms.ts` then pins
    // against a re-detect and persists."
    room([nightstand([1, 0, 1])]);
    select('nightstand-1');
    spinSelection(1);
    expect(useStudio.getState().positions['nightstand-1']).toBeUndefined();
  });

  it('writes one for a turn that DID move it, so the guard is not simply off', () => {
    // The negative control for the assertion above: without this, deleting the
    // `setPosition` call entirely would satisfy it.
    room([wardrobe([0, 0, -2.2])]);
    select('wardrobe-1');
    spinSelection(1);
    expect(useStudio.getState().positions['wardrobe-1']).toBeDefined();
  });
});

describe('spinSelection carries what is standing on the piece', () => {
  it('turns a rider about the piece it rides, not about its own centre', () => {
    // The lamp sits 150 mm forward of the nightstand's centre. A quarter turn about
    // the nightstand must swing it round to 150 mm to the side; leaving it where it
    // was is what the raw `setRotation` version did.
    room([nightstand([0, 0, 0]), lamp([0, 0.55, 0.15])]);
    useStudio.setState({ parentIds: { 'lamp-1': 'nightstand-1' } });
    select('nightstand-1');
    spinSelection(1);

    const l = at('lamp-1');
    // +Z rotated a quarter about +Y in three's convention lands on +X.
    expect(l.pos[0]).toBeCloseTo(0.15, 6);
    expect(l.pos[2]).toBeCloseTo(0, 6);
    expect(l.rot).toBeCloseTo(QUARTER, 6);
  });

  it('cascades about where the piece ENDED, not where it started', () => {
    // A DESK, deliberately, and the two fixtures this replaced are the reason:
    //
    //  · the lamp was first put 2.35 m away across the room, where it rides nothing,
    //    and the test measured a cascade that had correctly not happened;
    //  · moved onto a 2.1 m WARDROBE, it was then clamped to y = 1.98 by § 12's own
    //    ceiling rule (2.1 + 0.5 > 2.5), which left it 120 mm below the wardrobe's
    //    top — so `isPhysicallySupported` dropped the relation, rightly, and
    //    `snapshotDescendants` returned nothing. A support tall enough to reach the
    //    ceiling cannot carry a rider, and that is the app being correct.
    //
    // A desk at 750 mm carries a 500 mm lamp with a metre to spare, and it is long
    // enough that a quarter turn against the north wall still has to be clamped.
    room([desk([0, 0, -2.15]), lamp([0, 0.75, -2.0])]);
    useStudio.setState({ parentIds: { 'lamp-1': 'desk-1' } });
    select('desk-1');
    spinSelection(1);

    const w = at('desk-1');
    const l = at('lamp-1');
    expect(w.pos[2]).toBeGreaterThan(-2.15); // the clamp really did move the pivot

    // A DISTANCE, not a pair of coordinates. `turnInPlace` passes `wallEdge: null`,
    // so a piece the resolve decides rides a wall may be re-aimed by the wall it
    // lands on and the final angle is the wall's answer rather than `rot + 90`. The
    // case above pins the +x convention on a piece that stands free; this one is
    // about rigidity, which is true at whatever angle the desk ended on.
    //
    // A cascade off the PRE-clamp pivot puts the lamp 150 mm from where the desk
    // used to be, which is not 150 mm from where it is.
    expect(Math.hypot(l.pos[0] - w.pos[0], l.pos[2] - w.pos[2])).toBeCloseTo(0.15, 6);
    // …and it turned with it rather than merely being carried.
    expect(l.rot - w.rot).toBeCloseTo(0, 6);
  });
});

describe('a rider that is ALSO selected is turned once, not twice', () => {
  it('does not turn a selected rider on its own account as well', () => {
    // Ctrl+A reaches this in one press, so it is not an exotic selection. Iteration one
    // turns the nightstand and `cascadeTransform` writes the lamp to +90°; iteration two
    // re-read the scene, saw the override the cascade had just written, and took the
    // lamp to +180° — every rigid child in the set ending a quarter turn out of step
    // with the thing it stands on.
    room([nightstand([0, 0, 0]), lamp([0, 0.55, 0.15])]);
    useStudio.setState({ parentIds: { 'lamp-1': 'nightstand-1' } });
    select('nightstand-1', 'lamp-1');
    spinSelection(1);

    const n = at('nightstand-1');
    const l = at('lamp-1');
    expect(n.rot).toBeCloseTo(QUARTER, 6);
    // ONE quarter, and the rigid relation intact. Two turns would put it at 2·QUARTER.
    expect(l.rot).toBeCloseTo(QUARTER, 6);
    expect(l.rot - n.rot).toBeCloseTo(0, 6);
    expect(Math.hypot(l.pos[0] - n.pos[0], l.pos[2] - n.pos[2])).toBeCloseTo(0.15, 6);
  });

  it('is not order-dependent — the rider first gives the same answer', () => {
    // The filter runs UP FRONT for exactly this reason. Skipping as the loop went would
    // turn the lamp on its own account whenever it happened to come first.
    room([nightstand([0, 0, 0]), lamp([0, 0.55, 0.15])]);
    useStudio.setState({ parentIds: { 'lamp-1': 'nightstand-1' } });
    select('lamp-1', 'nightstand-1');
    spinSelection(1);
    const n = at('nightstand-1');
    const l = at('lamp-1');
    expect(l.rot).toBeCloseTo(QUARTER, 6);
    expect(l.rot - n.rot).toBeCloseTo(0, 6);
  });

  it('still turns a piece that rides something OUTSIDE the selection', () => {
    // The negative control. Without it, `carriedByAnother` returning `true` for every
    // piece with any parent at all would pass every assertion above.
    room([nightstand([0, 0, 0]), lamp([0, 0.55, 0.15])]);
    useStudio.setState({ parentIds: { 'lamp-1': 'nightstand-1' } });
    select('lamp-1');
    spinSelection(1);
    expect(at('lamp-1').rot).toBeCloseTo(QUARTER, 6);
    expect(at('nightstand-1').rot).toBeCloseTo(0, 6);
  });
});

describe('a turn the wall would not take says so, rather than claiming it happened', () => {
  const tv = (pos: [number, number, number]): ScenePart =>
    part({ id: 'tv-1', name: 'TV', category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos, wallMounted: true });

  it('names the wall instead of announcing a turn that did not occur', () => {
    // Measured across `PART_LIBRARY`: 11 of 11 `ridesWall` items come back at the angle
    // they started at, because `turnInPlace` passes `wallEdge: null` and `snapToWall`
    // returns the WALL's yaw. The app said "Turned a quarter turn." over a piece that
    // had not moved, which sends the user looking for what they broke.
    room([tv([0, 1.2, -2.4])]);
    select('tv-1');
    spinSelection(1);
    expect(spoken[0]).not.toContain('Turned a quarter turn.');
    expect(spoken[0]).toContain('held square to its wall');
  });

  it('still says a free-standing piece turned', () => {
    // The negative control: reporting EVERY piece as wall-held would pass the above.
    room([nightstand([0, 0, 0])]);
    select('nightstand-1');
    spinSelection(1);
    expect(spoken[0]).toContain('Turned a quarter turn.');
    expect(spoken[0]).not.toContain('held square');
  });
});

describe('a turn that drops the piece off its support says so', () => {
  it('reports the fall, which no other sentence can', () => {
    // A long piece resting on a smaller one: turned a quarter it no longer covers
    // enough of its support, `findSupportDetailed` finds nothing and the gravity branch
    // of the same resolve writes it to the floor. Swept over the catalogue this happens
    // 187 times, with a horizontal nudge of ZERO every time — so `turnNudge`'s sentence
    // is silent precisely where this one is needed.
    room([nightstand([0, 0, 0]), desk([0, 0.55, 0])]);
    select('desk-1');
    spinSelection(1);
    const d = at('desk-1');
    expect(d.pos[1]).toBeLessThan(0.55);
    expect(spoken[0]).toMatch(/dropped .* no longer standing on anything/);
  });

  it('says nothing of the sort for a turn that stayed at its height', () => {
    room([nightstand([1, 0, 1])]);
    select('nightstand-1');
    spinSelection(1);
    expect(spoken[0]).not.toContain('dropped');
    expect(spoken[0]).not.toContain('rose');
  });
});

describe('spinSelection turns each piece about its own centre', () => {
  it('does not pivot a multi-selection about the set', () => {
    // Two nightstands 2 m apart. A set does not pivot about one of its members --
    // that is the rule `resolveConvoy` states for 'turn' -- so both must stay put.
    room([
      { ...nightstand([-1, 0, 0]), id: 'nightstand-1' },
      { ...nightstand([1, 0, 0]), id: 'nightstand-2' },
    ]);
    select('nightstand-1', 'nightstand-2');
    spinSelection(1);
    expect(at('nightstand-1').pos).toEqual([-1, 0, 0]);
    expect(at('nightstand-2').pos).toEqual([1, 0, 0]);
    expect(at('nightstand-1').rot).toBeCloseTo(QUARTER, 10);
    expect(at('nightstand-2').rot).toBeCloseTo(QUARTER, 10);
  });
});
