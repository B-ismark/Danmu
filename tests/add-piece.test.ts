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
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { addPieceToRoom } from '@/lib/add-piece';
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
    const BED = { label: 'Double bed', category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 500] } as const;
    addPieceToRoom(BED);
    addPieceToRoom(BED);
    addPieceToRoom(BED);
    const beds = useScene.getState().parts.filter((p) => p.category === 'bed');
    expect(beds).toHaveLength(3);
    const spots = new Set(beds.map((b) => `${b.pos[0].toFixed(3)},${b.pos[2].toFixed(3)}`));
    expect(spots.size, `three beds on ${spots.size} spot(s): ${[...spots].join(' | ')}`).toBe(3);
  });
});
