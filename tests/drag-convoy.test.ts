import { describe, it, expect } from 'vitest';
import { planConvoy, resolveConvoy, convoyRestore, travellingWorld, type Convoy } from '@/lib/drag-convoy';
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
) {
  return resolveConvoy({
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
  });
}

function plan(draggedId: string, world: ScenePart[], selection: string[] = [], parentIds: Record<string, string> = {}) {
  return planConvoy({ draggedId, parts: world, selection, parentIds, footprint: ROOM });
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
      expect(selectionForPick(world, 'side-l').sort()).toEqual(['side-l', 'side-r']);
      expect(selectionForPick(world, 'side-r').sort()).toEqual(['side-l', 'side-r']);
    });

    it('takes just the piece when it is in no group', () => {
      expect(selectionForPick(world, 'chair')).toEqual(['chair']);
    });

    it('takes just the piece when its group has no one else left in it', () => {
      // `deletePart` does not scrub a surviving member's `groupId` (see
      // lib/part-rows.ts), so a lone part carrying a dead group id is a real state
      // and must not select something that is not there.
      expect(selectionForPick(world, 'lone')).toEqual(['lone']);
    });

    it('never returns a piece that is not in the world', () => {
      expect(selectionForPick(world, 'ghost')).toEqual(['ghost']);
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
    const mine = travellingWorld(c, w, 3, 0);
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
    const mine = travellingWorld(c, w, 1, 0);
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
    const mine = travellingWorld(c, w, 1, 0);
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

  it('moves nobody when the gesture moved nothing', () => {
    const world = three();
    const c = plan('a', world, ['a', 'b', 'c']);
    const r = carry(c, 'a', world, [1, 0, 1], [1, 0, 1]);
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

    const back = convoyRestore(c, 'sofa', [3, 0, 2], 0);
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
    const back = convoyRestore(c, 'sofa', [3, 0, 2], 1.1, true);
    expect(back.find((x) => x.id === 'sofa')!.rot).toBe(1.1);
  });

  it('leaves a wall rider alone when it has no rotation override to put back', () => {
    // A wall rider CAN be re-aimed by `snapToWall`, but only one that actually was
    // has an override — the resolve writes `rot` for nothing else. Restoring the
    // start angle to a piece with no override creates the pin one piece over from
    // the dragged one, which is the bug above wearing a different hat.
    const sofa = part({ id: 'sofa', pos: [3, 0, 2], dimMM: [2000, 900, 800], category: 'sofa', shape: 'sofa' });
    const art = part({ id: 'art', pos: [2, 1.4, 0.05], dimMM: [900, 40, 600], category: 'painting', shape: 'painting', rot: 2 });
    const c = plan('sofa', [sofa, art], ['sofa', 'art']);

    const none = convoyRestore(c, 'sofa', [3, 0, 2], 0, false, () => false);
    expect('rot' in none.find((x) => x.id === 'art')!).toBe(false);

    const some = convoyRestore(c, 'sofa', [3, 0, 2], 0, false, (id) => id === 'art');
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
  const chair = () =>
    part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 900], pos: [2, 0, 2] });

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
    const world = [tv(), chair()];
    const c = plan('chair', world, ['chair', 'tv']);
    expect(c.members.map((m) => [m.part.id, m.edge])).toEqual([['tv', 0]]);

    // Drag the chair 2 m south — a delta that is almost entirely wall-normal for
    // the TV, and enough to make the south wall the nearer one.
    const co = carry(c, 'chair', world, [2, 0, 2], [2, 0, 3.7]);
    const mv = co.moves.find((m) => m.id === 'tv');
    expect(mv).toBeDefined();
    expect(mv!.rot).toBeUndefined(); // no rotation written, so no override created
    expect(mv!.pos[2]).toBeCloseTo(0.07, 5);
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
