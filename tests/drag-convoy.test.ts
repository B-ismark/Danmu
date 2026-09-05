import { describe, it, expect } from 'vitest';
import { planConvoy, resolveConvoy, convoyRestore, gestureFor, travellingWorld, type Convoy } from '@/lib/drag-convoy';
import { resolvePlacement } from '@/lib/drag-resolve';
import { selectionForPick, type ScenePart } from '@/lib/scene-spec';
import type { Poly } from '@/lib/geometry';

// The rule this pins is "what else moves when you move this", and it is here
// because the answer used to be three different answers in three places: a rigid
// cascade in both drag paths, a merged-group loop written twice, and — for the
// multi-selection — nothing at all. Shift-clicking four chairs and dragging one
// moved that one chair. It read as intermittent because a MERGED set does move as
// one and looks identical on screen to a selected one.
//
// So these assertions are the contract both surfaces share. A change that suits
// only the plan, or only the 3D tab, fails here first.

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

/** 6 × 4 m, corner at the origin. Big enough to slide a set across. */
const ROOM: Poly = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
];
const H = 2.5;

function carry(
  convoy: Convoy,
  draggedId: string,
  world: ScenePart[],
  from: [number, number, number],
  to: [number, number, number],
  rot = 0,
  /** Which members already carry a position override. Defaults to NONE, which is
   *  what a fresh fixture room actually looks like — nothing has been dragged, so
   *  `useStudio.positions` is empty. Only the zero-delta path reads it. */
  memberHasPosOverride: (id: string) => boolean = () => false,
  /** What the user is doing. `'move'` for almost every test here; the ones that
   *  care pass `'turn'` and assert the company stays put. */
  gesture: 'move' | 'turn' = 'move',
) {
  return resolveConvoy({
    gesture,
    convoy,
    draggedId,
    pos: to,
    rot,
    // The WHOLE world. Subtracting the convoy here was the first version of this
    // helper, and it hid a live bug in the module for one test run: `collidesAt`
    // returns false when the mover is not in the list it is given, so a member
    // resolved against a world with itself filtered out reported every position as
    // clear. `travellingWorld` is the fix and `resolveConvoy` calls it, so a
    // caller must hand over everything.
    parts: world,
    startPos: from,
    footprint: ROOM,
    roomHeight: H,
    memberHasPosOverride,
  });
}

function plan(draggedId: string, world: ScenePart[], selection: string[] = [], parentIds: Record<string, string> = {}) {
  return planConvoy({ draggedId, parts: world, selection, parentIds, footprint: ROOM, roomHeight: H });
}

const posOf = (moves: Array<{ id: string; pos: [number, number, number] }>, id: string) =>
  moves.find((m) => m.id === id)?.pos;

describe('planConvoy — who travels', () => {
  it('carries nothing when one piece is selected on its own', () => {
    const world = [part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }), part({ id: 'b', pos: [4, 0, 1], dimMM: [800, 800, 400] })];
    const c = plan('a', world, ['a']);
    expect(c.members).toEqual([]);
    expect(c.own).toEqual([]);
    expect([...c.travelling]).toEqual(['a']);
  });

  it('carries the rest of the multi-selection, from where each piece STARTED', () => {
    // The whole reported bug, in one assertion.
    const world = [
      part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'b', pos: [3, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'c', pos: [5, 0, 1], dimMM: [800, 800, 400] }),
    ];
    const c = plan('a', world, ['a', 'b', 'c']);
    expect(c.members.map((m) => m.part.id).sort()).toEqual(['b', 'c']);
    expect(c.members.find((m) => m.part.id === 'b')!.startPos).toEqual([3, 0, 1]);
  });

  it('does NOT carry a selection the dragged piece is not part of', () => {
    // The inverse mistake, and the more dangerous one: dragging a chair must not
    // haul away the three pieces someone selected a minute ago and forgot about.
    const world = [
      part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'b', pos: [3, 0, 1], dimMM: [800, 800, 400] }),
    ];
    expect(plan('a', world, ['b']).members).toEqual([]);
    // …and the empty selection is the same case, not a special one.
    expect(plan('a', world, []).members).toEqual([]);
  });

  // ─── `groupId` is not a travel rule ────────────────────────────────────
  //
  // It used to be: `planConvoy` closed the travelling set over the merged group
  // after taking the selection, so dragging one member moved all of them whatever
  // was selected. Rotation never did that, and the user's verdict is that rotation
  // is the correct one — the selection is the unit. What "merged" still decides is
  // what a CLICK selects (`selectionForPick`), so the ordinary gesture of clicking
  // a merged set and dragging it is unchanged; the tests below are about the case
  // only the layer tree can reach.
  it('drags ONE member of a merged set when that is all that is selected', () => {
    const world = [
      part({ id: 'l', pos: [2, 0, 1], dimMM: [800, 400, 700], groupId: 'g' }),
      part({ id: 'r', pos: [2.9, 0, 1], dimMM: [800, 400, 700], groupId: 'g' }),
    ];
    expect(plan('l', world, ['l']).members.map((m) => m.part.id)).toEqual([]);
    // …and with no selection at all, which is the same question asked the other way.
    expect(plan('l', world, []).members.map((m) => m.part.id)).toEqual([]);
  });

  it('drags the whole merged set when the whole set is selected', () => {
    // Which is what a click gives you — see `selectionForPick`. This is the path
    // the ordinary gesture takes, and it must not have got worse.
    const world = [
      part({ id: 'l', pos: [2, 0, 1], dimMM: [800, 400, 700], groupId: 'g' }),
      part({ id: 'r', pos: [2.9, 0, 1], dimMM: [800, 400, 700], groupId: 'g' }),
    ];
    expect(plan('l', world, ['l', 'r']).members.map((m) => m.part.id)).toEqual(['r']);
  });

  it('carries exactly what is selected out of a mixed selection', () => {
    // A chair plus ONE half of a merged pair. The unselected half stays: the case
    // nobody had ruled on, settled the same way as the rest — whatever is
    // selected moves, and nothing else joins.
    const world = [
      part({ id: 'chair', pos: [1, 0, 1], dimMM: [500, 500, 900] }),
      part({ id: 'side-l', pos: [3, 0, 1], dimMM: [800, 400, 700], groupId: 'g1' }),
      part({ id: 'side-r', pos: [3.9, 0, 1], dimMM: [800, 400, 700], groupId: 'g1' }),
      part({ id: 'bystander', pos: [5.5, 0, 3], dimMM: [400, 400, 400] }),
    ];
    const c = plan('chair', world, ['chair', 'side-l']);
    expect(c.members.map((m) => m.part.id)).toEqual(['side-l']);
    expect(c.travelling.has('side-r')).toBe(false);
    expect(c.travelling.has('bystander')).toBe(false);
  });

  it('leaves a piece resting on the dragged one to the cascade, even when it is also selected', () => {
    // A piece that is BOTH a selection member and a rigid child must be carried
    // once, by the rotation-correct path. The translate-only one would move it
    // without turning it, and whichever ran second would win.
    const desk = part({ id: 'desk', pos: [2, 0, 2], dimMM: [1400, 700, 750] });
    const lamp = part({ id: 'lamp', pos: [2, 0.75, 2], dimMM: [200, 200, 400], category: 'lamp', shape: 'lamp-table' });
    const c = plan('desk', [desk, lamp], ['desk', 'lamp'], { lamp: 'desk' });
    expect(c.own.map((d) => d.id)).toEqual(['lamp']);
    expect(c.members).toEqual([]);
    expect(c.travelling.has('lamp')).toBe(true);
  });

  it('keeps a merged pair together when only a MEMBER is carrying half of it', () => {
    // danmu-62, reviewing the commit before this one. The group closure covered the
    // dragged piece's rigid children and not a member's, so the danmu-39 defect
    // reproduced one layer out. P and Q are merged but rest on different supports —
    // P on the desk, Q on the floor beside it — so `snapshotDescendants(desk)`
    // returns P alone and Q was never offered to the closure.
    //
    // The asymmetry is the tell: dragging the DESK worked, because then P is in
    // `own`. Same feature, two answers, depending on which piece of the selection
    // was under the hand.
    const world = [
      part({ id: 'chair', pos: [0.5, 0, 0.5], dimMM: [500, 500, 900] }),
      part({ id: 'desk', pos: [2, 0, 2], dimMM: [1400, 700, 750] }),
      part({ id: 'p', pos: [2, 0.75, 2], dimMM: [300, 300, 300], groupId: 'g' }),
      part({ id: 'q', pos: [3.2, 0, 2], dimMM: [300, 300, 300], groupId: 'g' }),
    ];
    const c = plan('chair', world, ['chair', 'desk'], { p: 'desk' });
    // The fixture only means something if P really is carried and Q really is not a
    // rigid child of the desk — otherwise this passes for the wrong reason.
    expect(c.members.map((m) => m.part.id)).toContain('desk');
    expect(c.members.find((m) => m.part.id === 'desk')!.descendants.map((d) => d.id)).toEqual(['p']);
    expect(c.travelling.has('q')).toBe(true);
  });

  it('closes merged groups to a FIXED POINT, not one hop', () => {
    // The wrinkle in the fix above: a sibling pulled in becomes a member, that member
    // has rigid children of its own, and those can belong to a third group. Here P
    // (on the desk) pulls in Q, Q carries R, and R pulls in S. A single pass reaches
    // Q and stops, leaving S behind — the same bug with a longer fixture.
    const world = [
      part({ id: 'chair', pos: [0.5, 0, 0.5], dimMM: [500, 500, 900] }),
      part({ id: 'desk', pos: [2, 0, 2], dimMM: [1400, 700, 750] }),
      part({ id: 'p', pos: [2, 0.75, 2], dimMM: [300, 300, 300], groupId: 'g1' }),
      part({ id: 'q', pos: [3.2, 0, 2], dimMM: [300, 300, 300], groupId: 'g1' }),
      part({ id: 'r', pos: [3.2, 0.3, 2], dimMM: [200, 200, 200], groupId: 'g2' }),
      part({ id: 's', pos: [4.2, 0, 2], dimMM: [200, 200, 200], groupId: 'g2' }),
    ];
    const c = plan('chair', world, ['chair', 'desk'], { p: 'desk', r: 'q' });
    expect(c.travelling.has('q')).toBe(true); // first hop
    expect(c.members.find((m) => m.part.id === 'q')!.descendants.map((d) => d.id)).toEqual(['r']);
    expect(c.travelling.has('s')).toBe(true); // second hop — the fixed point
  });

  // ─── The other half: what a click selects ───────────────────────────────
  //
  // `selectionForPick` lives in lib/scene-spec.ts and is tested here rather than
  // beside the placement tests, because it and the missing closure above are one
  // change: merge stopped deciding what a drag CARRIES and now decides only what a
  // click SELECTS. Split across two files, a reader finds one and not the other.
  describe('what a plain click or press selects', () => {
    const world = [
      part({ id: 'chair', pos: [1, 0, 1], dimMM: [500, 500, 900] }),
      part({ id: 'side-l', pos: [3, 0, 1], dimMM: [800, 400, 700], groupId: 'g1' }),
      part({ id: 'side-r', pos: [3.9, 0, 1], dimMM: [800, 400, 700], groupId: 'g1' }),
      part({ id: 'lone', pos: [5.5, 0, 3], dimMM: [400, 400, 400], groupId: 'gone' }),
    ];

    it('takes a merged set whole', () => {
      expect(selectionForPick(world, 'side-l', []).sort()).toEqual(['side-l', 'side-r']);
      expect(selectionForPick(world, 'side-r', []).sort()).toEqual(['side-l', 'side-r']);
    });

    it('takes just the piece when it is in no group', () => {
      expect(selectionForPick(world, 'chair', [])).toEqual(['chair']);
    });

    it('takes just the piece when its group has no one else left in it', () => {
      // `deletePart` does not scrub a surviving member's `groupId` (see
      // lib/part-rows.ts), so a lone part carrying a dead group id is a real state
      // and must not select something that is not there.
      expect(selectionForPick(world, 'lone', [])).toEqual(['lone']);
    });

    it('never returns a piece that is not in the world', () => {
      expect(selectionForPick(world, 'ghost', [])).toEqual(['ghost']);
    });

    // ── Drill-in ──
    //
    // Click a merged set, get the set; click again inside it, get the piece. The
    // rule is a question about the SELECTION — "is it entirely inside this group" —
    // rather than a count of clicks, which is what makes the sibling case below come
    // out right instead of bouncing back to the whole set.
    it('drills in to the one piece on a pick made from inside the set', () => {
      const whole = ['side-l', 'side-r'];
      expect(selectionForPick(world, 'side-r', whole)).toEqual(['side-r']);
      expect(selectionForPick(world, 'side-l', whole)).toEqual(['side-l']);
    });

    it('stays at the member level when the next pick is a SIBLING', () => {
      // The case a click counter gets wrong: drilled in to one sideboard, pointing
      // at the other must give you that other one, not throw you back out to the
      // pair. Reads as the drill-in forgetting itself otherwise.
      expect(selectionForPick(world, 'side-l', ['side-r'])).toEqual(['side-l']);
    });

    it('takes the set whole again once the selection has left the group', () => {
      // How you climb out: Escape or a click on empty floor clears the selection,
      // and an empty selection is outside every group. No new gesture needed — which
      // is only true because `every` over an empty list is deliberately not treated
      // as "inside".
      expect(selectionForPick(world, 'side-l', []).sort()).toEqual(['side-l', 'side-r']);
      expect(selectionForPick(world, 'side-l', ['chair']).sort()).toEqual(['side-l', 'side-r']);
    });

    it('takes the set whole when the selection reaches outside the group', () => {
      // A multi-selection spanning the group and something else is not "inside" it,
      // so clicking the set collapses to the set rather than to one piece.
      expect(selectionForPick(world, 'side-l', ['side-l', 'side-r', 'chair']).sort()).toEqual([
        'side-l',
        'side-r',
      ]);
    });

    it('is unmoved by drill-in for a piece in no group', () => {
      expect(selectionForPick(world, 'chair', ['chair'])).toEqual(['chair']);
      expect(selectionForPick(world, 'lone', ['lone'])).toEqual(['lone']);
    });
  });

  it('carries what is resting on a MEMBER too, and counts nothing twice', () => {
    const deskA = part({ id: 'deskA', pos: [1.2, 0, 2], dimMM: [1400, 700, 750] });
    const deskB = part({ id: 'deskB', pos: [4, 0, 2], dimMM: [1400, 700, 750] });
    const lampB = part({ id: 'lampB', pos: [4, 0.75, 2], dimMM: [200, 200, 400], category: 'lamp', shape: 'lamp-table' });
    const c = plan('deskA', [deskA, deskB, lampB], ['deskA', 'deskB'], { lampB: 'deskB' });
    expect(c.members.map((m) => m.part.id)).toEqual(['deskB']);
    expect(c.members[0].descendants.map((d) => d.id)).toEqual(['lampB']);
    expect([...c.travelling].sort()).toEqual(['deskA', 'deskB', 'lampB']);
  });
});

describe('travellingWorld — the world any travelling piece resolves against', () => {
  // What both surfaces call for the DRAGGED piece's own resolve, and what
  // `resolveConvoy` calls for each member's. It was two functions with two
  // different answers: members got their company SHIFTED to where it is going,
  // while the dragged piece got its company DELETED — so the gravity fix below was
  // live for a member and absent for the piece under the hand.
  //
  // Asserted through `resolvePlacement`, not by looking at the array: the trap is
  // that `collidesAt` looks the mover up in the list it is handed and returns
  // *false* when it is absent, so getting this wrong does not throw or warn — it
  // turns collision detection off and every position reads as clear.
  const world = () => [
    part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
    part({ id: 'mate', pos: [2, 0, 1], dimMM: [800, 800, 400] }),
    part({ id: 'column', pos: [4, 0, 1], dimMM: [300, 1800, 2000], category: 'wardrobe', shape: 'wardrobe' }),
  ];

  it('keeps the piece itself, so its own collisions are still seen', () => {
    const w = world();
    const c = plan('a', w, ['a', 'mate']);
    const mine = travellingWorld(c, w, 3, 0, c.own);
    expect(mine.some((p) => p.id === 'a')).toBe(true);
    // Straight into the column, which is not travelling and so did not move.
    const r = resolvePlacement({
      part: w[0], rawX: 4, rawZ: 1, rot: 0, dim: w[0].dimMM,
      parts: mine, footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    expect(r.valid).toBe(false);
  });

  it('moves the company out of the way rather than deleting it', () => {
    const w = world();
    const c = plan('a', w, ['a', 'mate']);
    // Sliding 1 m east: `mate` travels too, so it is no longer at x = 2 — it is at
    // x = 3, and that is where it must be seen, not nowhere.
    const mine = travellingWorld(c, w, 1, 0, c.own);
    expect(mine.find((p) => p.id === 'mate')!.pos[0]).toBeCloseTo(3, 6);
    const ok = resolvePlacement({
      part: w[0], rawX: 2, rawZ: 1, rot: 0, dim: w[0].dimMM,
      parts: mine, footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    expect(ok.valid).toBe(true);
  });

  it('keeps the DRAGGED piece on a support that is travelling with it', () => {
    // The regression this function exists to close, and the direction that was
    // still broken after the members were fixed. Select a desk and the lamp on it
    // and drag THE LAMP: the desk travels, so a world with the desk deleted has
    // nothing under the lamp — it resolved to y = 0, reported valid (the desk was
    // invisible to `collidesAt` too), had its rigid parent cleared by `commit()`,
    // and was persisted. Ctrl+A then dragging any tabletop item did it.
    const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1200, 800, 750], pos: [2, 0, 2] });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [200, 200, 400], pos: [2, 0.75, 2] });
    const w = [desk, lamp];
    const c = plan('lamp', w, ['lamp', 'desk']);
    // A full metre, not a nudge: at 10 mm an UNSHIFTED desk is still under the
    // lamp, so a short drag cannot tell shifting from doing nothing.
    const mine = travellingWorld(c, w, 1, 0, c.own);
    const r = resolvePlacement({
      part: lamp, rawX: 3, rawZ: 2, rot: 0, dim: lamp.dimMM,
      parts: mine, footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    expect(r.valid).toBe(true);
    expect(r.pos[1]).toBeCloseTo(0.75, 6);
    expect(r.supportId).toBe('desk');
  });
});

describe('resolveConvoy — where the company lands', () => {
  const three = () => [
    part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
    part({ id: 'b', pos: [2, 0, 1], dimMM: [800, 800, 400] }),
    part({ id: 'c', pos: [3, 0, 1], dimMM: [800, 800, 400] }),
  ];

  it('translates every member by the delta the dragged piece accepted', () => {
    const world = three();
    const c = plan('a', world, ['a', 'b', 'c']);
    const r = carry(c, 'a', world, [1, 0, 1], [1.4, 0, 2.1]);
    expect(r.valid).toBe(true);
    expect(posOf(r.moves, 'b')).toEqual([2.4, 0, 2.1]);
    expect(posOf(r.moves, 'c')).toEqual([3.4, 0, 2.1]);
  });

  it('lets a set slide along its own line without members blocking each other', () => {
    // Three pieces 1 m apart, dragged 0.4 m sideways: every new position overlaps
    // a neighbour's OLD one. Filtering `travelling` out of the world is what makes
    // this legal, and forgetting to do it is why dragging two selected chairs
    // refused on the first pixel.
    const world = three();
    const c = plan('a', world, ['a', 'b', 'c']);
    expect(carry(c, 'a', world, [1, 0, 1], [1.4, 0, 1]).valid).toBe(true);
  });

  it('does not let a member snap to a neighbour of its own', () => {
    // The set keeps its shape. `b` arrives 60 mm short of flush with a piece that
    // is staying put — inside the 100 mm magnetic range — and must NOT be pulled
    // the rest of the way: it would land somewhere the dragged piece's delta does
    // not describe, and the formation would arrive bent. Members resolve with the
    // snap off for exactly this, which also stops the grid re-rounding a delta the
    // dragged piece has already committed to.
    const world = [
      part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'b', pos: [2, 0, 1], dimMM: [800, 800, 400] }),
      // Left edge at 3.66; `b` sent to 2.8 puts its right edge at 3.2 … 0.46 away.
      // Sent to 3.2 instead: right edge 3.6, so 60 mm short of flush.
      part({ id: 'fixed', pos: [4.06, 0, 1], dimMM: [800, 800, 400] }),
    ];
    const c = plan('a', world, ['a', 'b']);
    const r = carry(c, 'a', world, [1, 0, 1], [2.2, 0, 1]);
    expect(r.valid).toBe(true);
    expect(posOf(r.moves, 'b')![0]).toBeCloseTo(3.2, 6);
  });

  it('refuses as a UNIT when a member cannot follow, and names that member', () => {
    // `c` is 0.4 m from the far wall in a 6 m room; asking the set to go 1 m right
    // puts it through the plaster. The piece under the hand has room to spare, so
    // the honest answer is the set's, not its.
    const world = [
      part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'far', pos: [5.5, 0, 1], dimMM: [800, 800, 400] }),
    ];
    const c = plan('a', world, ['a', 'far']);
    const r = carry(c, 'a', world, [1, 0, 1], [2, 0, 1]);
    expect(r.valid).toBe(false);
    expect(r.blocked?.id).toBe('far');
  });

  it('refuses when a member would land in something that is staying put', () => {
    // A tall NARROW obstacle on purpose: a member arriving over a wide low one
    // climbs onto it (see the next test), which is gravity doing its job and not a
    // collision. Under half the member's footprint is supported here, so there is
    // nothing to stand on and the piece is simply in the way.
    const world = [
      part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'b', pos: [2, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'column', pos: [3.6, 0, 1], dimMM: [300, 1800, 2000], category: 'wardrobe', shape: 'wardrobe' }),
    ];
    const c = plan('a', world, ['a', 'b']);
    // `b` would go from 2.0 to 3.6 — exactly where `column` is.
    const r = carry(c, 'a', world, [1, 0, 1], [2.6, 0, 1]);
    expect(r.valid).toBe(false);
    expect(r.blocked?.id).toBe('b');
  });

  it('lets a member climb onto what it lands on, the way one dragged piece does', () => {
    // Deliberate, and the alternative was considered: refusing here would make a
    // set almost immovable in a furnished room, and a single dragged chair already
    // rides up onto a table it is pulled over. A set behaving like its own members
    // is the consistent answer — vertical rigidity is not a promise this makes, and
    // `resolveConvoy`'s gravity is what keeps the piece off thin air either way.
    const world = [
      part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'b', pos: [2, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'wide', pos: [3.6, 0, 1], dimMM: [1400, 1400, 500] }),
    ];
    const c = plan('a', world, ['a', 'b']);
    const r = carry(c, 'a', world, [1, 0, 1], [2.6, 0, 1]);
    expect(r.valid).toBe(true);
    expect(posOf(r.moves, 'b')).toEqual([3.6, 0.5, 1]);
  });

  it('re-gravitates a member instead of carrying its height', () => {
    // A vase translated off the table it stood on lands on the floor. Carrying the
    // Y instead would leave it at table height with nothing under it — the exact
    // floating-vase scar the plan's old two-step drag left, and invisible from
    // directly above, which is the tab where you would be doing this.
    const table = part({ id: 'table', pos: [4, 0, 2], dimMM: [1200, 1200, 500] });
    const vase = part({ id: 'vase', pos: [4, 0.5, 2], dimMM: [200, 200, 300], category: 'plant', shape: 'plant' });
    const anchor = part({ id: 'anchor', pos: [1, 0, 1], dimMM: [600, 600, 400] });
    const world = [table, vase, anchor];
    // `vase` travels as a MEMBER (selected alongside `anchor`), not as the table's
    // child, so nothing is holding its height for it.
    const c = plan('anchor', world, ['anchor', 'vase']);
    expect(c.members.map((m) => m.part.id)).toEqual(['vase']);
    const r = carry(c, 'anchor', world, [1, 0, 1], [1, 0, 2]);
    expect(r.valid).toBe(true);
    // Off the table (its z reaches 2.6) and onto the floor.
    expect(posOf(r.moves, 'vase')).toEqual([4, 0, 3]);
  });

  it('turns the dragged piece’s children with it and leaves members square', () => {
    const desk = part({ id: 'desk', pos: [2, 0, 2], dimMM: [1400, 700, 750] });
    const lamp = part({ id: 'lamp', pos: [2.5, 0.75, 2], dimMM: [200, 200, 400], category: 'lamp', shape: 'lamp-table' });
    const mate = part({ id: 'mate', pos: [4.5, 0, 2], dimMM: [600, 600, 400] });
    const world = [desk, lamp, mate];
    const c = plan('desk', world, ['desk', 'mate'], { lamp: 'desk' });
    // Quarter turn about the desk's own pivot, no translation.
    const r = carry(c, 'desk', world, [2, 0, 2], [2, 0, 2], Math.PI / 2);
    const lampPos = posOf(r.moves, 'lamp')!;
    expect(lampPos[0]).toBeCloseTo(2);
    expect(lampPos[2]).toBeCloseTo(1.5);
    expect(r.moves.find((m) => m.id === 'lamp')!.rot).toBeCloseTo(Math.PI / 2);
    // The set does not pivot around the piece being turned — a rotate moves
    // nothing sideways, so the company has nothing to do.
    expect(r.moves.some((m) => m.id === 'mate')).toBe(false);
  });

  it('writes nothing back for a gesture that never wrote anything', () => {
    // Zero delta with no member overrides in the store: the gesture has not moved
    // the company, so there is nothing to put back and a move here would be a pin
    // on every selected piece. The other half — zero delta AFTER a frame that DID
    // move — is asserted below, and it is the half that was missing.
    const world = three();
    const c = plan('a', world, ['a', 'b', 'c']);
    const r = carry(c, 'a', world, [1, 0, 1], [1, 0, 1], 0, () => false);
    expect(r.moves).toEqual([]);
    expect(r.valid).toBe(true);
  });
});

describe('convoyRestore — what Escape puts back', () => {
  it('restores the dragged piece, its children, the members and theirs', () => {
    const deskA = part({ id: 'deskA', pos: [1.2, 0, 2], dimMM: [1400, 700, 750], rot: 0.3 });
    const lampA = part({ id: 'lampA', pos: [1.2, 0.75, 2], dimMM: [200, 200, 400], category: 'lamp', shape: 'lamp-table' });
    const deskB = part({ id: 'deskB', pos: [4, 0, 2], dimMM: [1400, 700, 750] });
    const lampB = part({ id: 'lampB', pos: [4, 0.75, 2], dimMM: [200, 200, 400], category: 'lamp', shape: 'lamp-table' });
    const world = [deskA, lampA, deskB, lampB];
    const c = plan('deskA', world, ['deskA', 'deskB'], { lampA: 'deskA', lampB: 'deskB' });

    const back = convoyRestore(c, 'deskA', [1.2, 0, 2], 0.3);
    // Every travelling id is accounted for. A gesture that moved four pieces and
    // put back one is what left a lamp hanging in mid-air.
    expect(new Set(back.map((m) => m.id))).toEqual(c.travelling);
    expect(posOf(back, 'deskB')).toEqual([4, 0, 2]);
    expect(posOf(back, 'lampB')![1]).toBeCloseTo(0.75);
    expect(posOf(back, 'lampA')![0]).toBeCloseTo(1.2);
  });

  it('puts back a rotation only for a member the gesture could have turned', () => {
    // The mirror image of `resolveConvoy`'s omission. Escape must not leave behind
    // the very override the drag was careful not to create — so a member that only
    // slid gets its position back and nothing else, while a wall rider (whose
    // `snapToWall` really can have re-aimed it) gets both.
    const sofa = part({ id: 'sofa', pos: [3, 0, 2], dimMM: [2000, 900, 800], category: 'sofa', shape: 'sofa' });
    const stool = part({ id: 'stool', pos: [1, 0, 2], dimMM: [400, 400, 450], rot: 0.4 });
    const art = part({ id: 'art', pos: [2, 1.4, 0.05], dimMM: [900, 40, 600], category: 'painting', shape: 'painting', rot: 2 });
    const world = [sofa, stool, art];
    const c = plan('sofa', world, ['sofa', 'stool', 'art']);

    // Only the painting has been turned, so only the painting has a rotation
    // override; everything has a position override, because the gesture moved.
    const back = convoyRestore(c, 'sofa', [3, 0, 2], 0, () => true, (id) => id === 'art');
    const m = (id: string) => back.find((x) => x.id === id)!;
    expect('rot' in m('stool')).toBe(false);
    expect('rot' in m('art')).toBe(true);
    expect(m('art').rot).toBe(2);
    // And the piece under the hand obeys the same rule. It used to be exempt —
    // `{ id, pos, rot }` unconditionally — so cancelling an ordinary TRANSLATE
    // wrote a rotation override for a piece that had never turned, pinning its
    // angle against a re-detect and persisting it. A gesture the user cancelled
    // must leave nothing behind.
    expect('rot' in m('sofa')).toBe(false);
  });

  it('does put the dragged rotation back when the gesture really turned it', () => {
    // The other side of the same flag: a rotate gesture DID change the angle, so
    // the override exists and Escape has to write the start value into it.
    const sofa = part({ id: 'sofa', pos: [3, 0, 2], dimMM: [2000, 900, 800], category: 'sofa', shape: 'sofa', rot: 1.1 });
    const c = plan('sofa', [sofa], ['sofa']);
    const back = convoyRestore(c, 'sofa', [3, 0, 2], 1.1, () => true, () => true);
    expect(back.find((x) => x.id === 'sofa')!.rot).toBe(1.1);
  });

  it('leaves the DRAGGED piece alone when the gesture wrote nothing about it', () => {
    // In 3D nothing writes the dragged piece's own transform until `commit()`, so
    // an Escape mid-drag has nothing of its to undo — the object3D has already been
    // put back imperatively. This used to emit `{ id, pos, rot }` unconditionally,
    // which made cancelling a drag the one path in the app that could INVENT a
    // position override out of a gesture the user explicitly abandoned.
    const sofa = part({ id: 'sofa', pos: [3, 0, 2], dimMM: [2000, 900, 800], category: 'sofa', shape: 'sofa' });
    const stool = part({ id: 'stool', pos: [1, 0, 1], dimMM: [400, 400, 450], category: 'ottoman', shape: 'ottoman' });
    const c = plan('sofa', [sofa, stool], ['sofa', 'stool']);
    const none = convoyRestore(c, 'sofa', [3, 0, 2], 0, () => false, () => false);
    expect(none.some((x) => x.id === 'sofa')).toBe(false);
    expect(none.some((x) => x.id === 'stool')).toBe(false);
    // …and a single overridden axis is enough to bring the piece back.
    const some = convoyRestore(c, 'sofa', [3, 0, 2], 0, (id) => id === 'sofa', () => false);
    expect(some.find((x) => x.id === 'sofa')!.pos).toEqual([3, 0, 2]);
    expect(some.some((x) => x.id === 'stool')).toBe(false);
  });

  it('leaves a wall rider alone when it has no rotation override to put back', () => {
    // A wall rider CAN be re-aimed by `snapToWall`, but only one that actually was
    // has an override — the resolve writes `rot` for nothing else. Restoring the
    // start angle to a piece with no override creates the pin one piece over from
    // the dragged one, which is the bug above wearing a different hat.
    const sofa = part({ id: 'sofa', pos: [3, 0, 2], dimMM: [2000, 900, 800], category: 'sofa', shape: 'sofa' });
    const art = part({ id: 'art', pos: [2, 1.4, 0.05], dimMM: [900, 40, 600], category: 'painting', shape: 'painting', rot: 2 });
    const c = plan('sofa', [sofa, art], ['sofa', 'art']);

    const none = convoyRestore(c, 'sofa', [3, 0, 2], 0, () => true, () => false);
    expect('rot' in none.find((x) => x.id === 'art')!).toBe(false);

    const some = convoyRestore(c, 'sofa', [3, 0, 2], 0, () => true, (id) => id === 'art');
    expect(some.find((x) => x.id === 'art')!.rot).toBe(2);
  });
});

describe('resolveConvoy — what a move is allowed to write', () => {
  const moveOf = (moves: Array<{ id: string; pos: [number, number, number]; rot?: number }>, id: string) =>
    moves.find((m) => m.id === id);

  it('writes no rotation for a member that only translated', () => {
    // A set TRANSLATES; members never turn with it. Writing back the rotation
    // they already had is not a no-op — it materialises an override in
    // `useStudio.rotations`, which per lib/transforms.ts pins that value against a
    // re-detect and persists into IndexedDB and the scene file. So the field must
    // be ABSENT, not merely equal.
    const a = part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400], rot: 0.7 });
    const b = part({ id: 'b', pos: [3, 0, 1], dimMM: [800, 800, 400], rot: 0.7 });
    const world = [a, b];
    const c = plan('a', world, ['a', 'b']);
    const r = carry(c, 'a', world, [1, 0, 1], [1.5, 0, 1], 0.7);

    expect(r.valid).toBe(true);
    const m = moveOf(r.moves, 'b')!;
    expect(m.pos[0]).toBeCloseTo(3.5);
    expect('rot' in m).toBe(false);
  });

  it('writes the rotation a wall re-aimed, because that one really changed', () => {
    // The exception the omission above is carved around. A wall-mounted member is
    // turned by `snapToWall` inside its own resolve — `snapMode: 'off'` does not
    // reach that branch — so its rotation genuinely is the gesture's output and
    // dropping it would leave the piece facing the wrong way.
    const sofa = part({ id: 'sofa', pos: [3, 0, 2], dimMM: [2000, 900, 800], category: 'sofa', shape: 'sofa' });
    const art = part({
      id: 'art',
      pos: [2, 1.4, 0.05],
      dimMM: [900, 40, 600],
      category: 'painting',
      shape: 'painting',
      // Deliberately not what the north wall implies, so the snap has to correct it.
      rot: 1,
    });
    const world = [sofa, art];
    const c = plan('sofa', world, ['sofa', 'art']);
    const r = carry(c, 'sofa', world, [3, 0, 2], [3.4, 0, 2]);

    const m = moveOf(r.moves, 'art')!;
    expect('rot' in m).toBe(true);
    expect(m.rot).not.toBe(1);
  });

  it('asks the world nothing when no company is coming', () => {
    // The dragged piece's own legality belongs to the caller, so an empty convoy is
    // valid by definition — and must reach that answer without walking the room.
    // Every single-piece drag in the app takes this path at input rate.
    const a = part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] });
    const wall = part({ id: 'wall', pos: [2, 0, 1], dimMM: [800, 800, 2000], category: 'wardrobe', shape: 'wardrobe' });
    const world = [a, wall];
    const c = plan('a', world, ['a']);

    const r = carry(c, 'a', world, [1, 0, 1], [2, 0, 1]);
    expect(r.valid).toBe(true);
    expect(r.moves).toEqual([]);
    expect(r.blocked).toBeUndefined();
  });
});

describe('a wall rider leading a set', () => {
  // Measured before it was fixed, in a 6 x 4 m room: a pointer move of 0.4 m took
  // the TV from (5.000, 0.070) facing 0 deg to (5.930, 1.400) facing -90 deg — the
  // north wall to the east wall, 1.6 m in one frame. The chair in the selection
  // translated by that same 1.6 m, and the set then refused and named the CHAIR as
  // the piece that would not fit. Three wrongs from one flip: the jump, the
  // divergent rotation, and a message about the wrong piece.
  const tv = () =>
    part({ id: 'tv', category: 'tv', shape: 'tv', dimMM: [1200, 100, 700], pos: [2, 1.4, 0.07] });
  const chair = (z = 2) =>
    part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [2, 0, z] });

  /** The dragged piece's own resolve, exactly as either surface performs it. */
  function lead(p: ScenePart, world: ScenePart[], rawX: number, rawZ: number, wallEdge: number | null) {
    return resolvePlacement({
      part: p,
      rawX,
      rawZ,
      rot: p.rot,
      dim: p.dimMM,
      parts: world,
      footprint: ROOM,
      roomHeight: H,
      snapMode: 'off',
      currentY: p.pos[1],
      wallEdge,
    });
  }

  it('keeps the wall it started on, so the set is never handed a corner jump', () => {
    const world = [tv(), chair()];
    const c = plan('tv', world, ['tv', 'chair']);
    expect(c.leadEdge).toBe(0); // the z = 0 edge, [0,0] -> [6,0]

    const start: [number, number, number] = [2, 1.4, 0.07];
    // Pointer 1.4 m into the room — past the midline, where it used to flip.
    const r = lead(world[0], world, 5, 1.4, c.leadEdge);
    // toBeCloseTo, not toBe: the inward normal of the z = 0 edge is (-0, 1), so the
    // yaw is atan2(-0, 1) = -0. Pre-existing and harmless — three.js does not care
    // — but -0 is not +0 under Object.is.
    expect(r.rot).toBeCloseTo(0, 12);
    expect(r.pos[2]).toBeCloseTo(0.07, 5);
    expect(r.pos[0]).toBeCloseTo(5, 5);

    const co = carry(c, 'tv', world, start, r.pos, r.rot);
    expect(co.valid).toBe(true);
    expect(co.blocked).toBeUndefined();
    // The chair takes the along-wall delta and nothing else.
    expect(posOf(co.moves, 'chair')).toEqual([5, 0, 2]);
  });

  it('still lets a lone wall rider move to another wall', () => {
    // The flip is the feature when nothing is following — it is how a picture gets
    // moved from one wall to the next. Pinning unconditionally would have taken
    // that away, silently, to fix a multi-selection bug.
    const world = [tv(), chair()];
    const c = plan('tv', world, ['tv']);
    expect(c.leadEdge).toBeNull();
    const r = lead(world[0], world, 5, 1.4, c.leadEdge);
    expect(r.rot).toBeCloseTo(-Math.PI / 2, 5);
    expect(r.pos[0]).toBeGreaterThan(5.5);
  });

  it('pins a wall-riding MEMBER to its own wall too', () => {
    // Same flip, one seat over: a TV carried along by a chair is handed a delta
    // with a wall-normal component, which puts it nearer some other wall than its
    // own. Unpinned it rounded the corner and arrived facing a different way from
    // the set it left with — and the rigidity exemption for wall riders hid it,
    // because a flip is a "correction" of any size.
    // Far enough south that the TV's TARGET is nearer some other wall than its own,
    // which is the only condition under which the pin does anything. In this 6 x 4 m
    // room the TV sits at z = 0.07, so its target is 0.07 + DZ; the north wall is
    // that far away and the south wall 4 minus it, and the two cross at DZ = 1.93.
    // The previous version dragged 1.7 m — under a comment that said 2 m, which is
    // how it went unnoticed — so the north wall stayed nearest, no flip was on
    // offer, and the test passed just as well with the pin deleted.
    const DZ = 2.1;
    const from: [number, number, number] = [2, 0, 1.2];
    const world = [tv(), chair(from[2])];
    const c = plan('chair', world, ['chair', 'tv']);
    expect(c.members.map((m) => [m.part.id, m.edge])).toEqual([['tv', 0]]);

    const co = carry(c, 'chair', world, from, [from[0], 0, from[2] + DZ]);
    const mv = co.moves.find((m) => m.id === 'tv');
    expect(mv).toBeDefined();
    expect(mv!.rot).toBeUndefined(); // no rotation written, so no override created
    expect(mv!.pos[2]).toBeCloseTo(0.07, 5);

    // The control, and without it the assertion above claims nothing: handed the
    // SAME target with no pin, the TV crosses the room to the far wall and turns to
    // face back the other way. That is the jump the member is being spared.
    const loose = lead(world[0], world, from[0], tv().pos[2] + DZ, null);
    expect(loose.pos[2]).toBeGreaterThan(3.5);
    expect(Math.abs(loose.rot)).toBeCloseTo(Math.PI, 5);
  });

  it('holds a pinned lead at the end of its wall rather than past it', () => {
    // `edgeProjection` clamps to the segment, so the pin cannot walk a piece off
    // the end of its own wall and out of the room. In this room the containment
    // clamp bites first (a 1200 mm TV cannot pass x = 5.4), which is the belt to
    // the pin's braces — both are asserted because either alone is a silent floor.
    const world = [tv(), chair()];
    const c = plan('tv', world, ['tv', 'chair']);
    const r = lead(world[0], world, 99, 0.1, c.leadEdge);
    expect(r.pos[0]).toBeLessThanOrEqual(5.4 + 1e-9);
    expect(r.pos[2]).toBeCloseTo(0.07, 5);
    expect(r.rot).toBeCloseTo(0, 12);
  });
});

describe('a wall pin is only ever put on a piece that rides a wall', () => {
  // `resolvePlacement` reads `wallEdge` only inside its wall branch, so a pin on a
  // chair would change nothing today — which is exactly why it needs a test. A
  // non-null edge on a free-standing piece is a claim about that piece that is
  // false, and the next reader of `Convoy` would have to go and check.
  it('leaves a free-standing lead unpinned even with a set following', () => {
    const world = [
      part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [2, 0, 2] }),
      part({ id: 'table', dimMM: [900, 900, 450], pos: [3.5, 0, 2] }),
    ];
    const c = plan('chair', world, ['chair', 'table']);
    expect(c.members.length).toBe(1);
    expect(c.leadEdge).toBeNull();
    expect(c.members[0].edge).toBeNull();
  });
});

describe('a ceiling piece is not a wall rider', () => {
  // `isWallMountedPart` means "is this piece's geometry centred on its origin",
  // and it is true for a ceiling fan. `ridesWall` means "does it belong flat
  // against a wall", and it is not. The convoy asked the first question in three
  // places where it meant the second, and the rigidity exemption is the one that
  // mattered: a fan CAN take a delta in any horizontal direction, so "did it
  // arrive where the set sent it" has a real answer for it, and under the wider
  // predicate it was never asked.
  const FAN: [number, number, number] = [1000, 1000, 200];

  it("holds a fan member to real rigidity, not to a wall rider excuse", () => {
    const fan = part({ id: 'fan', category: 'fan', shape: 'fan', dimMM: FAN, pos: [1, 2.35, 1] });
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [1, 0, 2] });
    const world = [fan, chair];
    const c = plan('chair', world, ['chair', 'fan']);
    expect(c.members.map((m) => m.part.id)).toEqual(['fan']);
    // A fan rides no wall, so it must not be pinned to one either.
    expect(c.members[0].edge).toBeNull();

    // Push the set hard enough that the fan would have to leave the room. Under
    // the old predicate the fan was excused from arriving short AND excused from
    // the containment test, so this step was legal and the fan ended up outside.
    const co = carry(c, 'chair', world, [1, 0, 2], [5.9, 0, 2]);
    expect(co.valid).toBe(false);
    expect(co.blocked?.id).toBe('fan');
  });

  it('carries a fan member rigidly on a delta it can actually take', () => {
    const fan = part({ id: 'fan', category: 'fan', shape: 'fan', dimMM: FAN, pos: [1, 2.35, 1] });
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [1, 0, 2] });
    const world = [fan, chair];
    const c = plan('chair', world, ['chair', 'fan']);
    const co = carry(c, 'chair', world, [1, 0, 2], [2, 0, 2]);
    expect(co.valid).toBe(true);
    const mv = co.moves.find((m) => m.id === 'fan')!;
    expect(mv.pos[0]).toBeCloseTo(2, 6);
    expect(mv.pos[2]).toBeCloseTo(1, 6);
    // Its ceiling height is preserved, and no rotation override is created.
    expect(mv.pos[1]).toBeCloseTo(2.35, 6);
    expect(mv.rot).toBeUndefined();
  });
});

describe('the world a member resolves against', () => {
  // Four assertions that were missing, and the first is why: the module subtracted
  // every travelling piece from the world, and a member's GRAVITY reads that world.
  // A support that travelled was therefore invisible.
  const desk = () => part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1200, 800, 750], pos: [2, 0, 2] });
  const lamp = () => part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [200, 200, 400], pos: [2, 0.75, 2] });

  it('keeps a member on a support that is travelling with it', () => {
    // Select a desk and the lamp standing on it, drag the desk. The lamp used to be
    // written to y = 0 — the floor — and reported valid, because the desk was
    // subtracted from the world and `collidesAt` could not see it either. Ctrl+A
    // then dragging anything did this to every tabletop item in the room at once,
    // and both surfaces persist what the convoy returns.
    //
    // A full metre, deliberately. This drag was 10 mm, which is two orders of
    // magnitude smaller than the 1.2 m desk — so an UNSHIFTED desk was still under
    // the lamp and the test passed with the shift weakened to plain inclusion. It
    // proved the desk was PRESENT, never that it had MOVED.
    const world = [desk(), lamp()];
    const c = plan('desk', world, ['desk', 'lamp']);
    const co = carry(c, 'desk', world, [2, 0, 2], [3, 0, 2]);
    const mv = co.moves.find((m) => m.id === 'lamp')!;
    expect(mv.pos[1]).toBeCloseTo(0.75, 6);
    expect(mv.pos[0]).toBeCloseTo(3, 6);
    expect(co.valid).toBe(true);
  });

  it('still drops a member that leaves a support which is NOT travelling', () => {
    // The other direction, and it must survive the fix: the whole reason a member's
    // gravity is re-asked is that a piece translated off its table should land on
    // the floor rather than hang at table height. Here the desk stays put.
    const world = [desk(), lamp()];
    const c = plan('lamp', world, ['lamp']);
    // Nothing else travels, so the lamp is the dragged piece — resolve it directly,
    // which is what either surface does for the piece under the hand.
    const r = resolvePlacement({
      part: world[1], rawX: 4.5, rawZ: 2, rot: 0, dim: world[1].dimMM,
      parts: world, footprint: ROOM, roomHeight: H, snapMode: 'off', currentY: 0.75,
    });
    expect(r.pos[1]).toBe(0);
    expect(c.members).toEqual([]);
  });

  it('reads each member from where it STARTED, not from the live world', () => {
    // `ConvoyMember.startPos` exists because the per-frame version read each
    // sibling's current position out of a render memo, so two pointermoves between
    // two renders dropped a delta and a fast drag pulled the set apart. Mutating the
    // world after planning is the only way to tell the two apart, and no other
    // fixture does it — so `m.startPos[0] + dx` and `m.part.pos[0] + dx` were
    // indistinguishable, which is exactly the substitution this module exists to
    // prevent.
    const world = [desk(), part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [1, 0, 1] })];
    const c = plan('desk', world, ['desk', 'chair']);
    // Something else moves the chair mid-gesture.
    world[1].pos = [3, 0, 3];
    const co = carry(c, 'desk', world, [2, 0, 2], [2.5, 0, 2]);
    const mv = co.moves.find((m) => m.id === 'chair')!;
    expect(mv.pos[0]).toBeCloseTo(1.5, 6);
    expect(mv.pos[2]).toBeCloseTo(1, 6);
  });

  it('refuses a set clipped by tens of millimetres, not just by metres', () => {
    // RIGID_EPS is a micron: anything larger is a containment clamp or a wall snap,
    // and the set would arrive deformed. Every other fixture is either exact or out
    // by 0.4 m, so the constant could have been 50 mm and nothing would have said
    // so. This one is out by exactly 40 mm.
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [5, 0, 1] });
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 800], pos: [2, 0, 3] });
    const world = [sofa, chair];
    const c = plan('sofa', world, ['sofa', 'chair']);
    // maxX - halfWidth is 5.75 for the chair, so a target of 5.79 is clipped 40 mm.
    const co = carry(c, 'sofa', world, [2, 0, 3], [2.79, 0, 3]);
    expect(co.valid).toBe(false);
    expect(co.blocked?.id).toBe('chair');
  });

  it('pins a wall-riding member hard enough for the pin to matter', () => {
    // The earlier member-pin test asserted the edge was RECORDED; this one asserts
    // it is USED. The delta has to be big enough that the target is nearer a
    // different wall, or pinned and unpinned agree and `wallEdge: m.edge` could be
    // `null` with the suite still green.
    const tv = part({ id: 'tv', category: 'tv', shape: 'tv', dimMM: [1200, 100, 700], pos: [2, 1.4, 0.07] });
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [2, 0, 0.5] });
    const world = [tv, chair];
    const c = plan('chair', world, ['chair', 'tv']);
    expect(c.members[0].edge).toBe(0);
    // 3.0 m south: the TV's target is z = 3.07, which is nearer the z = 4 wall.
    const co = carry(c, 'chair', world, [2, 0, 0.5], [2, 0, 3.5]);
    const mv = co.moves.find((m) => m.id === 'tv')!;
    expect(mv.pos[2]).toBeCloseTo(0.07, 5);
    expect(mv.rot).toBeUndefined();
  });
});

describe('a piece is hidden from its own resolve — its children ride, they do not obstruct', () => {
  // `lib/drag-resolve.ts` documents the contract in as many words: `parts` arrives
  // "with this piece's own rigid descendants filtered out — a part must not resolve
  // its gravity against a child this same move is about to carry out from under
  // it." Both drag paths stopped honouring it when the world moved in here, and
  // nothing said so, because the two functions that read the list fail QUIETLY:
  // `findSupportDetailed` has no below-test at all (it takes the highest top
  // covering half the mover's footprint, above or below), and `collidesAt` returns
  // false for a mover it cannot find.
  const stand = () => part({ id: 'stand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [2, 0, 2] });
  const plant = () => part({ id: 'plant', category: 'plant', shape: 'plant', dimMM: [400, 400, 1600], pos: [2, 0.55, 2] });

  it('does not stand the DRAGGED piece on the plant it is carrying', () => {
    // Shifting the plant to where it is GOING puts it straight back on top of the
    // nightstand — at every delta, so no drag was long enough to escape it. The
    // stand resolved onto its own plant at y = 2.15, and 2.15 + 0.55 is through a
    // 2.5 m ceiling: the piece was simply undraggable, in both tabs, and the only
    // thing on screen was a red highlight that never went green.
    const [s0, p0] = [stand(), plant()];
    const w = [s0, p0];
    const c = plan('stand', w, ['stand'], { plant: 'stand' });
    expect(c.own.map((d) => d.id)).toEqual(['plant']);
    const mine = travellingWorld(c, w, 1, 0, c.own);
    expect(mine.some((p) => p.id === 'plant')).toBe(false);
    const r = resolvePlacement({
      part: s0, rawX: 3, rawZ: 2, rot: 0, dim: s0.dimMM,
      parts: mine, footprint: ROOM, roomHeight: H, snapMode: 'off',
    });
    expect(r.valid).toBe(true);
    expect(r.pos[1]).toBeCloseTo(0, 6);
    expect(r.supportId).toBeUndefined();
  });

  it('does not stand a MEMBER on the plant it is carrying either', () => {
    // Same defect one piece over, and the one that is invisible from the dragged
    // piece's side: `resolveConvoy` builds every member's world itself, so a member
    // with something on it was climbing its own child while the piece under the
    // hand behaved perfectly.
    const [s0, p0] = [stand(), plant()];
    const lead = part({ id: 'lead', pos: [0.6, 0, 2], dimMM: [800, 800, 400] });
    const w = [lead, s0, p0];
    const c = plan('lead', w, ['lead', 'stand'], { plant: 'stand' });
    expect(c.members.map((m) => m.part.id)).toEqual(['stand']);
    expect(c.members[0].descendants.map((d) => d.id)).toEqual(['plant']);
    const co = carry(c, 'lead', w, [0.6, 0, 2], [1.6, 0, 2]);
    expect(co.valid).toBe(true);
    expect(posOf(co.moves, 'stand')).toEqual([3, 0, 2]);
  });
});

describe('a member drops its whole subtree, not just the link', () => {
  // `lead` is dragged; a table M and the tray C standing on it are both in the
  // selection, and a book G stands on the tray. C is carried as a MEMBER, so it is
  // removed from M's descendant list — and the old filter removed only C, leaving G
  // behind with `parentId: 'C'` in a cascade that is not computing C.
  // `cascadeTransform` then dropped G with `if (!parent) continue`, silently, having
  // already put it in `travelling` so the world was shifting a phantom of it.
  //
  // Asserted in BOTH `parts` orders because the old behaviour depended on which
  // member `planConvoy` reached first — with the tray listed before the table it
  // worked. That is exactly why a single-order fixture would have shipped green.
  const scene = () => ({
    lead: part({ id: 'lead', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
    M: part({ id: 'M', pos: [3, 0, 1], dimMM: [1000, 1000, 700] }),
    C: part({ id: 'C', pos: [3, 0.7, 1], dimMM: [400, 400, 100] }),
    G: part({ id: 'G', pos: [3, 0.8, 1], dimMM: [200, 200, 50] }),
  });

  for (const order of ['table first', 'tray first'] as const) {
    it(`carries the grandchild — ${order}`, () => {
      const s = scene();
      const w = order === 'table first' ? [s.lead, s.M, s.C, s.G] : [s.lead, s.C, s.M, s.G];
      const c = plan('lead', w, ['lead', 'M', 'C'], { C: 'M', G: 'C' });
      // G travels either way; the question is whether anything actually moves it.
      expect(c.travelling.has('G')).toBe(true);
      const co = carry(c, 'lead', w, [1, 0, 1], [1.5, 0, 1]);
      expect(co.valid).toBe(true);
      expect(posOf(co.moves, 'C')).toEqual([3.5, 0.7, 1]);
      expect(posOf(co.moves, 'G')).toEqual([3.5, 0.8, 1]);
    });
  }
});

describe('a delta that comes back to zero still says where the company is', () => {
  it('returns every member at its start position when dx and dz are both 0', () => {
    // The company is written LIVE, frame by frame, by both surfaces. So a drag out
    // and back to the exact start — reachable, and likelier with the grid snap on —
    // left the members at the last non-zero delta and emitted nothing to put them
    // back: `commit()` then persisted the set 1 m out of formation, and the next
    // drag started from there.
    //
    // `Draggable.commit()` leans on this in writing: its invalid-drop fallback
    // slides to the pre-drag position "which makes the delta zero and the company's
    // answer 'stay'". That answer has to exist for the sentence to be true.
    const w = [
      part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'b', pos: [3, 0, 1], dimMM: [800, 800, 400] }),
    ];
    const c = plan('a', w, ['a', 'b']);
    const out = carry(c, 'a', w, [1, 0, 1], [2, 0, 1]);
    expect(posOf(out.moves, 'b')).toEqual([4, 0, 1]);
    // That frame wrote `positions.b`, which is exactly what the predicate reports
    // on the frame that comes home.
    const home = carry(c, 'a', w, [1, 0, 1], [1, 0, 1], 0, () => true);
    expect(home.valid).toBe(true);
    expect(posOf(home.moves, 'b')).toEqual([3, 0, 1]);
  });
});

describe('a turn is not a translation, whatever the clamp did', () => {
  // A 2.0 x 0.9 m sofa flat against the z = 0 wall, and a chair elsewhere in the
  // selection. Turning the sofa to 45° grows its z half-extent from 0.45 m to about
  // 1.025 m, and `resolvePlacement`'s containment clamp is a function of exactly
  // that — so the sofa MUST move, correctly, to stay inside the room.
  //
  // `resolveConvoy` used to infer "did the gesture translate" from
  // `pos - startPos`, so it read that clamp as a drag and translated the chair by
  // it: 575 mm across the room, reported valid, persisted. Found by danmu-39.
  const sofa = () => part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 800], pos: [3, 0, 0.45] });
  const chair = () => part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [3, 0, 3] });
  const turned = (w: ScenePart[]) =>
    resolvePlacement({
      part: w[0], rawX: 3, rawZ: 0.45, rot: Math.PI / 4, dim: w[0].dimMM,
      parts: w, footprint: ROOM, roomHeight: H, snapMode: 'off',
    });

  it('the clamp really does move a piece that only turned', () => {
    // Without this the two tests below would pass on a sofa that never moved, and
    // would be asserting nothing at all.
    const w = [sofa(), chair()];
    const r = turned(w);
    expect(r.pos[2]).toBeGreaterThan(1);
  });

  it('leaves the company where it is', () => {
    const w = [sofa(), chair()];
    const c = plan('sofa', w, ['sofa', 'chair']);
    const r = turned(w);
    const co = carry(c, 'sofa', w, [3, 0, 0.45], r.pos, Math.PI / 4, () => false, 'turn');
    expect(co.valid).toBe(true);
    expect(co.moves.some((m) => m.id === 'chair')).toBe(false);
  });

  it('…and carries it for the very same numbers when the gesture was a drag', () => {
    // The control. Identical delta, identical world — only the gesture differs, so
    // this pair fails if `gesture` is ignored in either direction.
    const w = [sofa(), chair()];
    const c = plan('sofa', w, ['sofa', 'chair']);
    const r = turned(w);
    const co = carry(c, 'sofa', w, [3, 0, 0.45], r.pos, Math.PI / 4, () => false, 'move');
    const moved = posOf(co.moves, 'chair');
    expect(moved).toBeDefined();
    expect(moved![2]).toBeGreaterThan(3.4);
  });
});

describe('every member that refused is reported, not just the first', () => {
  it('names one piece and outlines all of them', () => {
    // Two chairs at the east end of the 6 m room, dragged 2 m further east. Both are
    // pinned by the containment clamp, so neither arrives where the set sent it and
    // both refuse. `blocked` is deliberately still ONE piece — a sentence naming
    // four is a sentence nobody finishes — but the drawing has no such limit, and it
    // used to inherit one: a set stopped by several pieces outlined one, the user
    // moved it, tried again, and was stopped by the next.
    const w = [
      part({ id: 'lead', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'east1', pos: [5, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'east2', pos: [5, 0, 3], dimMM: [800, 800, 400] }),
    ];
    const c = plan('lead', w, ['lead', 'east1', 'east2']);
    const co = carry(c, 'lead', w, [1, 0, 1], [3, 0, 1]);
    expect(co.valid).toBe(false);
    expect(co.blocked?.id).toBe('east1');
    expect([...co.blockedIds].sort()).toEqual(['east1', 'east2']);
  });

  it('is empty when the set can go', () => {
    const w = [
      part({ id: 'lead', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
      part({ id: 'mate', pos: [3, 0, 1], dimMM: [800, 800, 400] }),
    ];
    const c = plan('lead', w, ['lead', 'mate']);
    expect(carry(c, 'lead', w, [1, 0, 1], [1.5, 0, 1]).blockedIds).toEqual([]);
  });
});

describe('a merged pair is not split by the rigid path', () => {
  it('carries the other half of a group the drag picked up as a child', () => {
    // Desk D with A standing on it; A and B are merged. Selection is just [D], so
    // the SELECTION path pulls in nobody — A comes along because it is physically
    // resting on the desk. The group closure was removed on the grounds that "a
    // merged set is already selected whole by a click", which is true of the
    // selection path and says nothing about this one: B stayed behind and the pair
    // came apart, from a gesture that never touched the selection. Found by
    // danmu-39.
    const desk = part({ id: 'D', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [2, 0, 2] });
    const a = part({ id: 'A', category: 'lamp', shape: 'lamp-table', dimMM: [200, 200, 400], pos: [2, 0.75, 2], groupId: 'g' });
    const b = part({ id: 'B', category: 'lamp', shape: 'lamp-table', dimMM: [200, 200, 400], pos: [4.5, 0, 1], groupId: 'g' });
    const w = [desk, a, b];
    const c = plan('D', w, ['D'], { A: 'D' });
    expect(c.own.map((d) => d.id)).toEqual(['A']);
    expect(c.members.map((m) => m.part.id)).toEqual(['B']);
    const co = carry(c, 'D', w, [2, 0, 2], [2.5, 0, 2]);
    expect(co.valid).toBe(true);
    expect(posOf(co.moves, 'A')).toEqual([2.5, 0.75, 2]);
    expect(posOf(co.moves, 'B')).toEqual([5, 0, 1]);
  });

  it('still lets a selection hold half a group on purpose', () => {
    // The verdict the closure removal was made for, unchanged: dragging one member
    // of a group that the SELECTION holds only half of moves that half. Only the
    // rigid path closes the group, and a rigid child is not a selection.
    const a = part({ id: 'A', pos: [1, 0, 1], dimMM: [800, 800, 400], groupId: 'g' });
    const b = part({ id: 'B', pos: [4, 0, 1], dimMM: [800, 800, 400], groupId: 'g' });
    const w = [a, b];
    expect(plan('A', w, ['A']).members).toEqual([]);
  });
});

describe('a turn leaves the company where it is standing', () => {
  const world = () => [
    part({ id: 'a', pos: [1, 0, 1], dimMM: [800, 800, 400] }),
    part({ id: 'b', pos: [3, 0, 1], dimMM: [800, 800, 400] }),
  ];

  it('does not haul members back to their start when the set has already travelled', () => {
    // A wheel notch is a turn, and it lands on whatever the drag has already done —
    // here a set that is 1 m out. Folding the turn into the zero-delta path made it
    // borrow that path's RESTORE, which is the right answer for a drag that came
    // home and the wrong one here: the piece under the hand turned, and its company
    // jumped back to where the gesture began.
    const w = world();
    const c = plan('a', w, ['a', 'b']);
    const turned = carry(c, 'a', w, [1, 0, 1], [2, 0, 1], 0.4, () => true, 'turn');
    expect(turned.valid).toBe(true);
    expect(turned.moves.some((m) => m.id === 'b')).toBe(false);
  });

  it('…while a MOVE that genuinely came home still puts them back', () => {
    // The control, and it is the whole reason the zero-delta restore exists: both
    // surfaces write members live, frame by frame, so a drag out and back leaves
    // them at the last non-zero delta unless something says "stay".
    const w = world();
    const c = plan('a', w, ['a', 'b']);
    const home = carry(c, 'a', w, [1, 0, 1], [1, 0, 1], 0, () => true, 'move');
    expect(posOf(home.moves, 'b')).toEqual([3, 0, 1]);
  });
});

describe('the zero-delta restore does not pin what it did not move', () => {
  it('leaves a rigid child alone when only its parent carries an override', () => {
    // A member's override is not its child's. A side table dragged at some point
    // carries one; the lamp standing on it may never have been touched. Writing the
    // lamp's unchanged position stamps it with a pin — against a re-detect, and
    // persisted — for the crime of standing on something that was selected.
    const lead = part({ id: 'lead', pos: [1, 0, 1], dimMM: [800, 800, 400] });
    const desk = part({ id: 'D', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [3, 0, 3] });
    const lamp = part({ id: 'L', category: 'lamp', shape: 'lamp-table', dimMM: [200, 200, 400], pos: [3, 0.75, 3] });
    const w = [lead, desk, lamp];
    const c = plan('lead', w, ['lead', 'D'], { L: 'D' });
    expect(c.members.map((m) => m.part.id)).toEqual(['D']);
    expect(c.members[0].descendants.map((d) => d.id)).toEqual(['L']);
    const out = carry(c, 'lead', w, [1, 0, 1], [1, 0, 1], 0, (id) => id === 'D', 'move');
    expect(out.moves.some((m) => m.id === 'D')).toBe(true);
    expect(out.moves.some((m) => m.id === 'L')).toBe(false);
  });
});

describe('gestureFor: while the gizmo is active it owns the whole answer', () => {
  // This decision lived inside `Draggable` where nothing could test it, and it
  // shipped a hole in exactly the place the component made invisible. The wheel and
  // the two-finger twist set a ref, because both turn a piece while the pointer
  // stands still; `Draggable`'s pointer-move handler clears that ref — and returns
  // early for the whole gizmo gesture, so for the gizmo's duration the one line
  // that clears it is unreachable. Found by danmu-cb in review.

  it('a gizmo TRANSLATE is a move even when the wheel has just been used', () => {
    // The defect, exactly: wheel-rotate mid-drag, release, then pull the translate
    // arrow. This returned 'turn', so the rest of the selection stayed behind —
    // silent, and indistinguishable from "sometimes only one moves".
    expect(gestureFor(true, 'translate', true)).toBe('move');
  });

  it('a gizmo ROTATE or SCALE is a turn, ref or no ref', () => {
    expect(gestureFor(true, 'rotate', false)).toBe('turn');
    expect(gestureFor(true, 'scale', false)).toBe('turn');
    expect(gestureFor(true, 'rotate', true)).toBe('turn');
  });

  it('with no gizmo, the ref is the answer', () => {
    // A plain pointer drag is a translation whatever `transformMode` says, which is
    // why the mode is not consulted on this path.
    expect(gestureFor(false, 'rotate', false)).toBe('move');
    expect(gestureFor(false, 'translate', true)).toBe('turn');
  });
});

describe("a member's veto is for what this gesture broke", () => {
  // The veto used to be absolute, so a member that was ALREADY illegal refused
  // every delta the set was ever offered and the whole thing was inert — in every
  // direction, forever, including the ones that would have fixed it. Reported from
  // a T-shaped room as "I merged the dining table and its chairs and now nothing
  // moves at all", which does not read as a refusal; it reads as the drag being
  // broken. Both fixtures below are ordinary rooms in ordinary use.

  /** A T: a 6 x 2 bar across the north, a 2 x 2 stem hanging south from the
   *  middle of it. The two south corners are inside the bounding box and are not
   *  floor, which is the only place this can be seen — in a rectangle the two
   *  coincide and every one of these assertions would pass with the fix deleted. */
  const TEE: Poly = [
    [0, 0],
    [6, 0],
    [6, 2],
    [4, 2],
    [4, 4],
    [2, 4],
    [2, 2],
    [0, 2],
  ];
  const chair = (id: string, x: number, z: number, gid = 'g1') =>
    part({ id, category: 'seating', shape: 'dining-chair', dimMM: [450, 500, 900], pos: [x, 0, z], groupId: gid } as never);
  const diner = (id: string, x: number, z: number, gid = 'g1') =>
    part({ id, category: 'table', shape: 'dining-table', dimMM: [1600, 900, 750], pos: [x, 0, z], groupId: gid } as never);

  function tee(draggedId: string, world: ScenePart[], selection: string[]) {
    return planConvoy({ draggedId, parts: world, selection, parentIds: {}, footprint: TEE, roomHeight: H });
  }
  function shove(convoy: Convoy, world: ScenePart[], from: [number, number, number], dx: number, dz: number) {
    return resolveConvoy({
      gesture: 'move',
      convoy,
      draggedId: 'table',
      pos: [from[0] + dx, from[1], from[2] + dz],
      rot: 0,
      startPos: from,
      parts: world,
      footprint: TEE,
      roomHeight: H,
      memberHasPosOverride: () => false,
    });
  }

  it('a chair standing in the notch is recorded as illegal at pointer-down', () => {
    const world = [diner('table', 3, 1), chair('stray', 5, 3)];
    expect(tee('table', world, ['table', 'stray']).members.map((m) => m.startValid)).toEqual([false]);
  });

  it('and the set still moves, in every direction', () => {
    const world = [diner('table', 3, 1), chair('stray', 5, 3)];
    const convoy = tee('table', world, ['table', 'stray']);
    for (const [dx, dz] of [
      [0.3, 0],
      [-0.3, 0],
      [0, 0.3],
      [0, -0.3],
    ] as const) {
      // All four, because a veto that only fires on one axis is a veto that a
      // single-direction fixture cannot tell from no veto at all.
      expect(shove(convoy, world, [3, 0, 1], dx, dz).valid, `delta ${dx},${dz}`).toBe(true);
    }
  });

  it('but a member THIS gesture pushes out still stops the set, and names itself', () => {
    // Both legal to begin with; the chair sits in the stem and the delta carries it
    // off the side of it. Without this the fix would read "members never veto".
    const world = [diner('table', 3, 1), chair('legal', 3, 2.5)];
    const convoy = tee('table', world, ['table', 'legal']);
    expect(convoy.members.map((m) => m.startValid)).toEqual([true]);
    const r = shove(convoy, world, [3, 0, 1], 2, 0);
    expect(r.valid).toBe(false);
    expect(r.blockedIds).toEqual(['legal']);
    expect(r.blocked?.id).toBe('legal');
  });

  it('a chair half-tucked under its own table does not freeze it either', () => {
    // No notch needed for this one. The chair overlaps the table but covers too
    // little of it to be SUPPORTED by it, so gravity leaves it on the floor and it
    // collides with the table it is standing under — where it already stood, before
    // anybody touched anything. A plain rectangular dining room does this.
    const world = [diner('t', 3, 2, 'g2'), chair('c', 3, 1.45, 'g2')];
    const convoy = planConvoy({ draggedId: 't', parts: world, selection: ['t', 'c'], parentIds: {}, footprint: ROOM, roomHeight: H });
    expect(convoy.members.map((m) => m.startValid)).toEqual([false]);
    const r = resolveConvoy({
      gesture: 'move',
      convoy,
      draggedId: 't',
      pos: [3.3, 0, 2],
      rot: 0,
      startPos: [3, 0, 2],
      parts: world,
      footprint: ROOM,
      roomHeight: H,
      memberHasPosOverride: () => false,
    });
    expect(r.valid).toBe(true);
  });
});

// § H.8's first report, and it is SETTLED here rather than in a browser.
//
// The user: *"dragging a merged bed with a nightstand on each side is blocked toward the
// side the nightstands are on."* The document filed two candidate mechanisms. The first —
// `travelWorld` shifting the company by the raw pointer delta while `resolvePlacement`
// accepts a snapped one — was measured and REFUTED: zero skew at all three snap settings.
// The second was left as *"the containment clamp bounding the LEAD by its own extent while
// a MEMBER is the piece that runs out of room ... Not settled. Needs a real drag."*
//
// It needed no drag. It is a `lib/` question and it reproduces here in milliseconds, which
// is the transferable part: the report arrived as a gesture and the mechanism is arithmetic,
// so the DOM was never on the path to it. **Confirmed, with numbers**, below.
//
// What this does NOT settle is whether it is a defect. The set genuinely cannot go further —
// `ns-r` would leave the room — so refusing is not wrong, it is just not what the user
// expects from a gesture that still has room under the hand. Sliding to the limit instead of
// refusing is a product decision and stays filed. These assertions pin the MECHANISM so that
// decision is made against a measurement rather than against the report.
describe('a set is bounded by its members, not by the piece under the hand (§ H.8)', () => {
  // Catalogue dims, read out of `lib/scene-spec.ts` rather than invented — `dimMM` is
  // [width, DEPTH, height], and getting that wrong is not a typo but a different fixture:
  // a first pass here used [450, 500, 400] for the nightstand, which is 500mm DEEP, put it
  // 50mm through the north wall, and produced a confident measurement of the containment
  // clamp correcting a defect the fixture had invented. The clamp was right and the room
  // was wrong.
  const BED_DIM: [number, number, number] = [1400, 2000, 600];
  const NS_DIM: [number, number, number] = [450, 400, 550];

  const bedHalfW = BED_DIM[0] / 2000;
  const nsHalfW = NS_DIM[0] / 2000;
  const BED_X = 3;
  // Flush to the north wall and flush to the bed, which is how the app's own bedroom seeds
  // them and how the user described the room.
  const NS_R_X = BED_X + bedHalfW + nsHalfW;

  const bed = () => part({ id: 'bed', category: 'bed', shape: 'bed-double', dimMM: BED_DIM, pos: [BED_X, 0, BED_DIM[1] / 2000] });
  const ns = (id: string, x: number) => part({ id, category: 'nightstand', shape: 'nightstand', dimMM: NS_DIM, pos: [x, 0, NS_DIM[1] / 2000] });
  const world = () => [bed(), ns('ns-l', BED_X - bedHalfW - nsHalfW), ns('ns-r', NS_R_X)];

  const MAX_X = Math.max(...ROOM.map(([x]) => x));
  /** How far east each piece may travel before its own east edge meets the wall. Derived
   *  from the room and the dims, so moving either moves the expectations with it. */
  const nsHeadroom = MAX_X - (NS_R_X + nsHalfW);
  const bedHeadroom = MAX_X - (BED_X + bedHalfW);

  function dragEastBy(dx: number) {
    const parts = world();
    const convoy = planConvoy({
      draggedId: 'bed', parts, selection: ['bed', 'ns-l', 'ns-r'], parentIds: {}, footprint: ROOM, roomHeight: H,
    });
    const lead = resolvePlacement({
      part: parts[0], rawX: BED_X + dx, rawZ: BED_DIM[1] / 2000, rot: 0, dim: BED_DIM,
      parts, footprint: ROOM, roomHeight: H, snapMode: 'off', currentY: 0, wallEdge: convoy.leadEdge,
    });
    const r = resolveConvoy({
      gesture: 'move', convoy, draggedId: 'bed', pos: lead.pos, rot: lead.rot,
      startPos: [BED_X, 0, BED_DIM[1] / 2000], parts, footprint: ROOM, roomHeight: H,
      memberHasPosOverride: () => false,
    });
    return { leadAccepted: lead.pos[0] - BED_X, ...r };
  }

  it('has a member that runs out of room first, which is the premise and not the finding', () => {
    // Without this the two assertions below are satisfied by a room where the BED binds, and
    // "the set stopped" would be the ordinary correct answer rather than the report.
    expect(nsHeadroom).toBeLessThan(bedHeadroom);
    expect(bedHeadroom - nsHeadroom).toBeCloseTo(nsHalfW * 2, 10);
  });

  it('carries the set while the binding member still fits', () => {
    const r = dragEastBy(nsHeadroom);
    expect(r.valid, `blocked by ${r.blockedIds.join(',')} at the nightstand's own limit`).toBe(true);
    expect(r.blockedIds).toEqual([]);
  });

  it('refuses one millimetre later, and names a piece that is not under the hand', () => {
    const r = dragEastBy(nsHeadroom + 0.001);
    expect(r.valid).toBe(false);
    expect(r.blocked?.id).toBe('ns-r');
    expect(r.blockedIds).toEqual(['ns-r']);
    // The half that makes it the reported defect rather than an ordinary wall stop: the
    // piece the user is dragging accepted the delta in full and has headroom left. Without
    // this the test passes in a room where everything ran out at once.
    expect(r.leadAccepted).toBeCloseTo(nsHeadroom + 0.001, 10);
    expect(bedHeadroom - nsHeadroom).toBeGreaterThan(0.4);
  });

  it('and the piece under the hand really can go that much further alone', () => {
    // Dragged on its own the bed reaches its own limit, so the 450mm is the set's cost and
    // not something about the bed. Asserted through the same path — a convoy of one — so a
    // difference here can only be the company.
    const parts = world();
    const convoy = planConvoy({
      draggedId: 'bed', parts, selection: ['bed'], parentIds: {}, footprint: ROOM, roomHeight: H,
    });
    expect(convoy.members).toEqual([]);
    const lead = resolvePlacement({
      part: parts[0], rawX: BED_X + bedHeadroom, rawZ: BED_DIM[1] / 2000, rot: 0, dim: BED_DIM,
      parts, footprint: ROOM, roomHeight: H, snapMode: 'off', currentY: 0, wallEdge: convoy.leadEdge,
    });
    expect(lead.pos[0] - BED_X).toBeCloseTo(bedHeadroom, 10);
    expect(lead.valid).toBe(true);
  });
});
