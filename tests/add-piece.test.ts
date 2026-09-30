// @vitest-environment jsdom
//
// `addPieceToRoom` is the single path all three add-a-piece triggers go through, so
// it is the only place where the 3D drop's behaviour is reachable by a test at all:
// `components/three/Room.tsx` renders an R3F tree, this repo deliberately has no R3F
// shim, and CLAUDE.md says not to add one. Before the extraction the 3D drop's seven
// steps were written out inside that component and nothing could see them.
//
// That is the argument for the extraction as much as the de-duplication is. Two of
// the six findings filed against § H.3 lived in the copies:
//
//  · **finding 5** — all three passed the AUTHORED `parts`, so a piece was placed
//    against the room as it was built rather than as it stands;
//  · **finding 6** — the 2D drop announced and the 3D drop did not.
//
// jsdom, because the subject reads two zustand stores and calls `announce`, which
// writes into a live region in the document. Nothing here renders a component.

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { footprintForLayout } from '@/lib/footprint';
import { groundY, verticalExtent } from '@/lib/physics';
import { riderYs } from '@/lib/rider-height';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { addPieceToRoom as addOutcome, type NewPiece } from '@/lib/add-piece';
import { PART_LIBRARY } from '@/lib/scene-spec';
import * as announceModule from '@/lib/announce';

const DESK_DIM: [number, number, number] = [1400, 700, 750];
const LAMP_DIM: [number, number, number] = [250, 250, 500];

const LAMP = { label: 'Table lamp', category: 'lamp', shape: 'lamp-table', dimMM: LAMP_DIM } as const;

const DESK_TOP = verticalExtent('desk', 'desk-standard', DESK_DIM, 0)[1];

let said: string[] = [];

beforeEach(() => {
  said = [];
  vi.spyOn(announceModule, 'announce').mockImplementation((m: string) => {
    said.push(m);
  });
  useScene.setState({
    parts: [],
    room: {
      ...useScene.getState().room,
      width: 6, depth: 5, height: 2.5,
      footprint: footprintForLayout('rect', 6, 5), layoutId: 'rect',
    },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {}, hidden: {}, selection: [], selectedPartId: null });
});

afterEach(() => vi.restoreAllMocks());

/** The id of a piece that WAS added. Every fixture below fits its room, so a refusal
 *  here is a failure of the fixture, said as one rather than as `undefined` somewhere
 *  further down. */
function addPieceToRoom(...args: Parameters<typeof addOutcome>): string {
  const out = addOutcome(...args);
  if ('refused' in out) throw new Error(`refused: ${out.refused}`);
  return out.id;
}

/** Seed one desk, authored at the origin. */
function seedDesk() {
  useScene.setState({
    parts: [
      {
        id: 'desk-1', name: 'Desk', category: 'desk', shape: 'desk-standard',
        dimMM: DESK_DIM, pos: [0, 0, 0], rot: 0, locked: false,
      },
    ],
  });
}

describe('addPieceToRoom places against the room as it stands', () => {
  it('rests a piece on a support that has been DRAGGED, at its new spot', () => {
    seedDesk();
    // The drag. Only the override map, because that is all a drag ever writes.
    useStudio.setState({ positions: { 'desk-1': [2, 0, 1.5] } });

    addPieceToRoom(LAMP, [2, 1.5]);
    const lamp = useScene.getState().parts.find((p) => p.category === 'lamp')!;
    expect(lamp.pos[1], 'the lamp should sit on the desk that is really there').toBeCloseTo(DESK_TOP, 6);
  });

  it('and does not rest one in mid-air where that support USED to be', () => {
    seedDesk();
    useStudio.setState({ positions: { 'desk-1': [2, 0, 1.5] } });

    addPieceToRoom(LAMP, [0, 0]);
    const lamp = useScene.getState().parts.find((p) => p.category === 'lamp')!;
    const floor = groundY('lamp', 'lamp-table', LAMP_DIM, 2.5);
    expect(lamp.pos[1], `lamp at ${lamp.pos[1]}, desk top ${DESK_TOP}, floor ${floor}`).toBeCloseTo(floor, 6);
    // Both ends. "On the floor" alone would also pass for a path that consults no
    // supports at all, which is a different bug with the same reading.
    expect(Math.abs(lamp.pos[1] - DESK_TOP)).toBeGreaterThan(0.5);
  });

  it('still stacks on a support nobody has moved, so the fix did not just disable stacking', () => {
    // The control for the two above. Without it, `currentRoomScene()` returning an
    // empty array — or the support lookup being removed outright — would satisfy
    // every "not in mid-air" assertion in this file.
    seedDesk();
    addPieceToRoom(LAMP, [0, 0]);
    const lamp = useScene.getState().parts.find((p) => p.category === 'lamp')!;
    expect(lamp.pos[1], 'an unmoved desk must still hold a lamp up').toBeCloseTo(DESK_TOP, 6);
  });
});

describe('addPieceToRoom says what it added', () => {
  it('names the piece, which is what the 3D drop never did', () => {
    addPieceToRoom(LAMP, [0, 0]);
    expect(said).toEqual(['Table lamp added.']);
  });

  it('is quiet when the caller is going to say something better', () => {
    // `spawnMany` adds several for one press and announces a count. Seven separate
    // announcements for one gesture is worse than none, which is the only reason
    // this option exists.
    addPieceToRoom(LAMP, [0, 0], { silent: true });
    expect(said).toEqual([]);
  });

  it('announces once per piece, not once per call site', () => {
    addPieceToRoom(LAMP, [0, 0]);
    addPieceToRoom({ ...LAMP, label: 'Floor lamp', shape: 'lamp-floor' }, [1, 1]);
    expect(said).toEqual(['Table lamp added.', 'Floor lamp added.']);
  });
});

describe('addPieceToRoom, the parts nobody should have to remember', () => {
  it('selects what it just added', () => {
    const id = addPieceToRoom(LAMP, [0, 0]);
    expect(useStudio.getState().selectedPartId).toBe(id);
  });

  it('returns the id it actually used, and mints a fresh one each time', () => {
    const a = addPieceToRoom(LAMP, [0, 0]);
    const b = addPieceToRoom(LAMP, [1, 1]);
    expect(a).not.toBe(b);
    const ids = useScene.getState().parts.map((p) => p.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).toHaveLength(2);
  });

  it('with NO aim, finds its own spot rather than stacking at the origin', () => {
    // The Library-click path. Three pieces, no aim, three distinct spots — the
    // original § H.3 complaint, asserted here on the shared function rather than
    // only through the panel that calls it.
    // Annotated, NOT `as const`: `as const` makes `dimMM` a readonly tuple, which is
    // not assignable to `NewPiece`'s mutable one. `pnpm test` cannot see that and
    // `pnpm typecheck` can — the same split that let `shape: 'desk'` through earlier
    // in this branch, and it reached CI because the suite was re-run after this file
    // was added and typecheck was not.
    const BED: NewPiece = { label: 'Double bed', category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 500] };
    addPieceToRoom(BED);
    addPieceToRoom(BED);
    addPieceToRoom(BED);
    const beds = useScene.getState().parts.filter((p) => p.category === 'bed');
    expect(beds).toHaveLength(3);
    const spots = new Set(beds.map((b) => `${b.pos[0].toFixed(3)},${b.pos[2].toFixed(3)}`));
    expect(spots.size, `three beds on ${spots.size} spot(s): ${[...spots].join(' | ')}`).toBe(3);
  });
});


describe('a piece dropped onto something RIDES it, and the edge is recorded', () => {
  // § H.3 finding 5's second half, which the first version of this file could not see.
  //
  // `addPieceToRoom` reads `currentRoomScene()` — resolved parts PLUS the rider-height
  // correction — and writes the resulting `pos[1]` into the AUTHORED layer, while
  // `ridingParents` infers who rides what from the AUTHORED array within 50 mm. The two
  // disagree the moment anything overrides the support, and nothing recorded the edge.
  //
  // **Why the earlier fixture could not express it:** it set only `positions`, and built
  // its "resolved" array with `resolveParts` — one layer short of the `resolveScene` the
  // subject actually calls — so the whole correction layer this lives in was unexercised.
  // These set `dims`, which is what makes authored and effective tops differ, and they
  // read the recorded EDGE rather than a coordinate.

  /** The desk, resized by the user. 900 mm is inside `desk-standard`'s legal 600–900
   *  range, so this is a room a person can really make. */
  const RESIZED: [number, number, number] = [1400, 700, 900];

  it('records the riding edge, so the lamp is not merely at the right height once', () => {
    seedDesk();
    useStudio.setState({ dims: { 'desk-1': RESIZED } });

    const id = addPieceToRoom(LAMP, [0, 0]);

    // The edge itself. Asserting the Y alone would pass on the broken build too — it was
    // correct at the moment of the drop and only went wrong later.
    expect(useStudio.getState().parentIds[id], 'the lamp rides nothing').toBe('desk-1');
  });

  it('and follows the desk back down when the desk is resized again', () => {
    // The symptom a person would see. On the broken build the lamp is stored at 0.90
    // against an authored top of 0.75 and stays there, 150 mm in the air.
    seedDesk();
    useStudio.setState({ dims: { 'desk-1': RESIZED } });
    const id = addPieceToRoom(LAMP, [0, 0]);

    useStudio.setState({ dims: {} });

    const s = useStudio.getState();
    const ys = riderYs(useScene.getState().parts, s.positions, s.rotations, s.dims, s.parentIds, 2.5);
    const authoredTop = verticalExtent('desk', 'desk-standard', DESK_DIM, 0)[1];
    expect(ys[id], `lamp at ${ys[id]}, desk top now ${authoredTop}`).toBeCloseTo(authoredTop, 6);
  });

  it('records NOTHING for a support too LOW to seat anything', () => {
    // The control — and the first version of it was decoration. It used an EMPTY room, so
    // `findSupportDetailed` returned null and the 0.3 m bar, the thing the control is
    // named for, was never reached.
    //
    // It matters because `deriveRiderYs` rule 2 honours a recorded edge UNCONDITIONALLY,
    // so an edge to something the piece is not standing on is worse than no edge: it
    // LIFTS the piece rather than being ignored.
    //
    // **A coffee table at 250 mm, and the fixture took three tries.** An EMPTY room was
    // the first, and it was decoration: the probe returns null and the bar is never
    // reached. A RUG was the second, and it is not a support candidate at all — the
    // probe returns null for it too, so both mutations decoupling the id from the bar
    // survived a second time. Instrumenting rather than reasoning is what settled it:
    // printed against the catalogue, 15 pieces can legally reach a top of 0.3 m or
    // below and 18 cannot, and a coffee table at its own minimum height is one of the
    // 15. The bar is reachable; the first two fixtures simply could not reach it.
    useScene.setState({
      parts: [
        {
          id: 'coffee-1', name: 'Coffee table', category: 'table', shape: 'coffee-table',
          dimMM: [1100, 600, 250], pos: [0, 0, 0], rot: 0, locked: false,
        },
      ],
    });
    const id = addPieceToRoom(LAMP, [0, 0]);
    expect(useScene.getState().parts.find((p) => p.id === id)!.pos[1]).toBeCloseTo(
      groundY('lamp', 'lamp-table', LAMP_DIM, 2.5),
      6,
    );
    expect(useStudio.getState().parentIds[id], 'a floored piece rides nothing').toBeUndefined();
  });

  it('records nothing for a wall piece OR a ceiling piece — two different branches', () => {
    // Both, because they are two separate `return` statements in `placeNewPart`, and the
    // first version of this test reached only one: hard-coding a support id into the
    // CEILING branch survived it, since a mirror rides a wall and never gets there.
    seedDesk();
    const onWall = addPieceToRoom(
      { label: 'Wall mirror', category: 'mirror', shape: 'mirror', dimMM: [600, 30, 900] },
      [0, 0],
    );
    expect(useStudio.getState().parentIds[onWall], 'a wall piece rides no furniture').toBeUndefined();

    const onCeiling = addPieceToRoom(
      { label: 'Ceiling fan', category: 'fan', shape: 'fan', dimMM: [1000, 1000, 200] },
      [0, 0],
    );
    expect(useStudio.getState().parentIds[onCeiling], 'a ceiling piece rides no furniture').toBeUndefined();
  });
});

describe('a piece wider than the space it would have is refused, not resized', () => {
  // The user's ruling (2026-09-30): "Don't allow if it's wider than the available
  // space." These read the OUTCOME, not the pose, because a refusal adds nothing.
  const CURTAIN = (w: number): NewPiece => ({ label: 'Curtain', category: 'curtain', shape: 'curtain', dimMM: [w, 80, 2200] });

  function room(w: number, d: number) {
    useScene.setState({
      parts: [],
      room: { ...useScene.getState().room, width: w, depth: d, height: 2.5, footprint: footprintForLayout('rect', w, d), layoutId: 'rect' },
    });
  }

  it('an unaimed curtain too long for the wall it was given goes to the longest wall', () => {
    // A U, because in a rectangle the unaimed spot is ALREADY a long wall and the retry
    // is never reached — the first fixture here was a 4.5 × 3 rectangle and survived the
    // retry being deleted. Probed rather than reasoned: in the U-Shape preset (6 × 5) an
    // unaimed wall piece is offered the notch's inner wall first, which is shorter than
    // 4 m, and the 6 m south wall (z = +2.5) is the longest.
    useScene.setState({
      parts: [],
      room: { ...useScene.getState().room, width: 6, depth: 5, height: 2.5, footprint: footprintForLayout('u', 6, 5), layoutId: 'u' },
    });
    const out = addOutcome(CURTAIN(4000));
    expect('id' in out, JSON.stringify(out)).toBe(true);
    const c = useScene.getState().parts[0];
    expect(c.pos[2], `curtain at ${c.pos}`).toBeGreaterThan(2.3);
    expect(Math.abs(c.pos[0])).toBeLessThan(1e-6);
  });

  it('longer than every wall: refused, with the sentence, and nothing added', () => {
    room(4.5, 3);
    const out = addOutcome(CURTAIN(4800));
    expect(out).toEqual({ refused: expect.stringMatching(/^Curtain can be at most 4\.50 m wide here\. That is the whole length of the wall it hangs on\.$/) });
    expect(useScene.getState().parts).toHaveLength(0);
    expect(said, 'a refusal is not announced as an add').toEqual([]);
  });

  it('an AIMED one is not moved to a wall it was not aimed at', () => {
    room(4.5, 3);
    // Aimed at the east wall, which is 3 m. 4 m fits the room's long walls and not this.
    const out = addOutcome(CURTAIN(4000), [2.2, 0]);
    expect(out).toEqual({ refused: expect.stringContaining('at most 3.00 m wide') });
    expect(useScene.getState().parts).toHaveLength(0);
  });

  it('a floor piece wider than the room is refused against the room', () => {
    room(3, 3);
    const out = addOutcome({ label: 'Sofa', category: 'sofa', shape: 'sofa', dimMM: [3400, 950, 880] });
    expect(out).toEqual({ refused: expect.stringContaining('as far as the room reaches') });
  });

  it('and NOTHING in the Library at its own size is refused in any preset room', () => {
    // The control. A bound that refused ordinary pieces would pass every test above.
    // The rooms and sizes are the layout picker's own (app/onboarding/layout-pick).
    const PRESETS = [
      ['rect', 6, 4], ['l', 6, 4.7], ['t', 5.5, 4.7], ['u', 6, 5], ['open', 7.5, 5.6],
    ] as const;
    let tried = 0;
    for (const [id, w, d] of PRESETS) {
      for (const item of PART_LIBRARY) {
        useScene.setState({
          parts: [],
          room: { ...useScene.getState().room, width: w, depth: d, height: 2.7, footprint: footprintForLayout(id, w, d), layoutId: id },
        });
        const out = addOutcome({ label: item.label, category: item.category, shape: item.shape, dimMM: [...item.dimMM] });
        expect('refused' in out ? out.refused : null, `${item.label} in ${id}`).toBeNull();
        tried++;
      }
    }
    expect(tried).toBe(PRESETS.length * PART_LIBRARY.length);
  });
});

describe('"Use my own size" — the old Will it fit, asked from the Library', () => {
  const SOFA = (w: number, d = 950, h = 880): NewPiece => ({ label: 'Sofa', category: 'sofa', shape: 'sofa', dimMM: [w, d, h] });

  it('a size that fits lands where the fit check put it, inside the room', () => {
    const id = addPieceToRoom(SOFA(2400), undefined, { ownSize: true });
    const s = useScene.getState().parts.find((p) => p.id === id)!;
    expect(s.dimMM, 'the size typed is the size kept').toEqual([2400, 950, 880]);
    expect(Math.abs(s.pos[0])).toBeLessThan(3);
    expect(Math.abs(s.pos[2])).toBeLessThan(2.5);
    expect(s.pos[1]).toBeCloseTo(groundY('sofa', 'sofa', [2400, 950, 880], 2.5), 6);
  });

  it('taller than the ceiling: refused, naming both heights', () => {
    const out = addOutcome({ label: 'Wardrobe', category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2900] }, undefined, { ownSize: true });
    expect(out).toEqual({ refused: expect.stringMatching(/2\.90 m tall, and the ceiling here is 2\.50 m/) });
    expect(useScene.getState().parts).toHaveLength(0);
  });

  it('nowhere clear with what is already here: refused, with the biggest stretch', () => {
    // A 3 × 3 room with a bed filling most of it; a second big piece has nowhere to go.
    useScene.setState({
      room: { ...useScene.getState().room, width: 3, depth: 3, height: 2.5, footprint: footprintForLayout('rect', 3, 3), layoutId: 'rect' },
      parts: [{ id: 'bed-1', name: 'Bed', category: 'bed', shape: 'bed-double', dimMM: [2000, 2200, 500], pos: [0, 0, 0], rot: 0, locked: false }],
    });
    const out = addOutcome(SOFA(2600), undefined, { ownSize: true });
    expect(out).toEqual({
      refused:
        'There is nowhere clear for a 2.60 × 0.95 m sofa with what is already here. It would fit this room empty, so it is the other pieces in the way. Fix or Ideas may make room by moving them.',
    });
    expect(useScene.getState().parts).toHaveLength(1);
  });

  it('and does not tell someone to move things when the room itself is the limit', () => {
    // An L's biggest rectangle is smaller than its bounding box: a piece the space bound
    // lets through (it reaches) can still have no rectangle to stand in, empty room or not.
    const L = footprintForLayout('l', 6, 4.7);
    useScene.setState({ parts: [], room: { ...useScene.getState().room, width: 6, depth: 4.7, height: 2.5, footprint: L, layoutId: 'l' } });
    const out = addOutcome({ label: 'Table', category: 'desk', shape: 'desk-standard', dimMM: [4000, 4000, 750] }, undefined, { ownSize: true });
    expect('refused' in out ? out.refused : '', JSON.stringify(out)).toMatch(/The largest rectangle of floor this room has is/);
    expect('refused' in out ? out.refused : '').not.toMatch(/moving/);
  });

  it('without the flag, the same press is an ordinary add — no fit check, no refusal for crowding', () => {
    useScene.setState({
      room: { ...useScene.getState().room, width: 3, depth: 3, height: 2.5, footprint: footprintForLayout('rect', 3, 3), layoutId: 'rect' },
      parts: [{ id: 'bed-1', name: 'Bed', category: 'bed', shape: 'bed-double', dimMM: [2000, 2200, 500], pos: [0, 0, 0], rot: 0, locked: false }],
    });
    expect('id' in addOutcome(SOFA(2600))).toBe(true);
  });
});
