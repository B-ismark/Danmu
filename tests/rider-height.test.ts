// § 12 — a rider follows the piece it was put on when that piece changes height.
//
// This gate exists in the shape it does because the fix was built twice and reverted
// twice with CI green over nine defects, none of which any test in either branch
// could reach (`docs/what-is-still-open.md` § 12). The negative controls are the
// point: three of the nine RESTORE the defect the change was written to fix, so a
// suite that only checks "the lamp went up" passes over all three.
//
// **Seven of the nine have a case; two do not, and saying which is the whole value of
// the sentence.** Defects 1, 2, 3, 4 and 8 are here and 6 and 7 are in
// `tests/rider-settle-hooks.test.tsx`. Defect 5 — "a mid-drag convoy write can yank
// the dragged piece back to its pre-drag x/z" — has no case anywhere and belongs to
// the drag lane; defect 9 was a fast path that no longer exists in this shape. The
// first version of this header claimed all nine, which is the same defect one layer
// up from the code: a claim nobody can check against the file it sits in.
//
// A second round of five review lenses found twenty-five more. Where a case below is
// named for one of those, it says so.
//
// Expected heights are computed from the FIXTURE's own dimensions — `dimMM[2] / 1000`
// added to a support's Y — and never from `lib/rider-height.ts`. `MOUNT_PAD` is
// imported because the ceiling clamp must agree with `settleHeights`' constant rather
// than with a literal typed beside it, and a literal here would pass a mutation that
// changed the constant.

import { describe, it, expect } from 'vitest';
import { deriveRiderYs, riderRelation, riderYs, resolveScene } from '@/lib/rider-height';
import { resolveParts, type TransformOverrides } from '@/lib/transforms';
import { MOUNT_PAD } from '@/lib/physics';
import type { ScenePart } from '@/lib/scene-spec';

const ROOM_H = 2.5;

function part(over: Partial<ScenePart> & Pick<ScenePart, 'id' | 'pos' | 'dimMM'>): ScenePart {
  return {
    category: 'desk',
    name: 'part',
    shape: 'desk-standard',
    rot: 0,
    locked: false,
    ...over,
  };
}

/** A desk 750 mm tall standing on the floor: top at 0.75. */
const desk = (h = 750) => part({ id: 'desk', pos: [0, 0, 0], dimMM: [1400, 700, h] });
/** A table lamp on the desk's top. `lamp` is a floor anchor, so `pos[1]` IS its
 *  underside — which is why "put it on the top" is `y = top` and nothing else. */
const lamp = (y: number, h = 400) =>
  part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [0, y, 0], dimMM: [300, 300, h] });

const NO_OV = {} as const;

describe('deriveRiderYs — the thing it is for', () => {
  it('raises a lamp when the desk under it is made taller', () => {
    const parts = [desk(), lamp(0.75)];
    // 1400 → unchanged width, 900 → the new HEIGHT. Top moves 0.75 → 0.90.
    const ys = deriveRiderYs(parts, { dims: { desk: [1400, 700, 900] } }, {}, ROOM_H);
    expect(ys).toEqual({ lamp: 0.9 });
  });

  it('lowers it when the desk is made shorter', () => {
    const parts = [desk(), lamp(0.75)];
    const ys = deriveRiderYs(parts, { dims: { desk: [1400, 700, 600] } }, {}, ROOM_H);
    expect(ys).toEqual({ lamp: 0.6 });
  });

  it('leaves an untouched room alone', () => {
    expect(deriveRiderYs([desk(), lamp(0.75)], NO_OV, {}, ROOM_H)).toEqual({});
  });

  it('omits a rider whose height did not actually change', () => {
    // The support is resized in x/z only, and separately: a rider already sitting at
    // the answer must not be written back. `regradeForNewCeiling` gives the reason —
    // a no-op write to the override layer still CREATES an override, which pins the
    // piece against a re-detect and gets persisted.
    const parts = [desk(), lamp(0.75)];
    expect(deriveRiderYs(parts, { dims: { desk: [2000, 900, 750] } }, {}, ROOM_H)).toEqual({});
  });

  it('omits a rider a cascade has ALREADY put at the answer', () => {
    // The support's top genuinely moved — so the pass runs — and the rider is already
    // there, because the drag that resized it cascaded. The previous case never
    // reaches this line: a width-only resize fails the gate first, so removing the
    // "unchanged is omitted" check passed it. The consequence is not cosmetic: a
    // consumer turning this map into overrides would stamp one on a piece the user
    // never moved, which pins it against a re-detect and is then persisted.
    const parts = [desk(), lamp(0.75)];
    const o: Partial<TransformOverrides> = { positions: { lamp: [0, 0.9, 0] }, dims: { desk: [1400, 700, 900] } };
    expect(deriveRiderYs(parts, o, {}, ROOM_H)).toEqual({});
  });

  it('does not fire on a width-only resize', () => {
    // The gate is "the support's TOP moved", not "the support carries a dims
    // override". Gating on the override's existence passes the two tests above and
    // fails here.
    const parts = [desk(), lamp(0.75)];
    expect(deriveRiderYs(parts, { dims: { desk: [2600, 700, 750] } }, {}, ROOM_H)).toEqual({});
  });
});

// ─── Defect 1 · the relation is REMEMBERED, not re-derived from live geometry ──

describe('the riding relation survives a consumer writing a resolved position back', () => {
  it('still follows the desk after the lamp has been given an override at the derived Y', () => {
    // The state `moveWallCarrying`, `duplicateSelection` and Suggest all reach with no
    // gesture on the lamp at all: the lamp's STORED Y is a previously-derived value,
    // 0.90, while its AUTHORED Y is still 0.75. Reading the relation off the live
    // geometry compares 0.90 against the desk's live top of 1.05 — 0.15 apart, past
    // SUPPORT_Y_EPS — and concludes the lamp rides nothing, permanently.
    const parts = [desk(), lamp(0.75)];
    const o: Partial<TransformOverrides> = { positions: { lamp: [0, 0.9, 0] }, dims: { desk: [1400, 700, 1050] } };
    expect(deriveRiderYs(parts, o, {}, ROOM_H)).toEqual({ lamp: 1.05 });
  });

  it('follows a support the user DRAGGED it onto, which authored geometry knows nothing about', () => {
    // `parentIds` is the durable half of the union. Here the lamp was authored on the
    // floor across the room and dragged onto the desk, so `ridingParents(authored)`
    // has no edge to offer and the drag's record is the only source.
    const parts = [desk(), lamp(0, 400)];
    const o: Partial<TransformOverrides> = { positions: { lamp: [0, 0.75, 0] }, dims: { desk: [1400, 700, 900] } };
    expect(deriveRiderYs(parts, o, { lamp: 'desk' }, ROOM_H)).toEqual({ lamp: 0.9 });
  });

  it('reads both sources, with parentIds winning a disagreement', () => {
    const parts = [desk(), lamp(0.75)];
    expect(riderRelation(parts, {})).toEqual({ lamp: 'desk' }); // authored geometry alone
    expect(riderRelation([], { lamp: 'shelf' })).toEqual({ lamp: 'shelf' }); // the record alone
    expect(riderRelation(parts, { lamp: 'shelf' })).toEqual({ lamp: 'shelf' }); // the record wins
  });
});

// ─── Defect 2 · land on the NAMED support, not on whatever is highest ─────────

describe('a rider lands on the piece it rides, not the tallest thing near it', () => {
  it('ignores a taller piece overlapping the same footprint', () => {
    // `findSupportDetailed` maximises `top` and has no below-test, so asking it "what
    // is under this lamp" returns the wardrobe. Measured on the reverted branch: the
    // lamp jumped 0.75 → 1.80, onto a piece it was never on.
    const wardrobe = part({ id: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', pos: [0, 0, 0], dimMM: [1200, 600, 1800] });
    const parts = [desk(), wardrobe, lamp(0.75)];
    const ys = deriveRiderYs(parts, { dims: { desk: [1400, 700, 900] } }, { lamp: 'desk' }, ROOM_H);
    expect(ys).toEqual({ lamp: 0.9 });
  });
});

// ─── Defect 3 · the `> 0.3` support bar is NOT wired in ──────────────────────

describe('a support shorter than settleHeights’ table bar still carries its rider', () => {
  it('follows a 400 mm ottoman down to exactly 300 mm', () => {
    // `settleHeights` has a `support.y > 0.3` bar to decide which of the surfaces it
    // FINDS counts as a table rather than a rug. This function finds nothing — it
    // follows a support already chosen — so applying that bar would overrule the
    // choice. 0.30 is the catalogue's minimum ottoman and the exact value the two
    // thresholds disagree on, which is why it is the fixture rather than 0.28.
    const ottoman = part({ id: 'ottoman', category: 'ottoman', shape: 'ottoman', pos: [0, 0, 0], dimMM: [500, 500, 400] });
    const parts = [ottoman, lamp(0.4)];
    const ys = deriveRiderYs(parts, { dims: { ottoman: [500, 500, 300] } }, { lamp: 'ottoman' }, ROOM_H);
    expect(ys).toEqual({ lamp: 0.3 });
  });
});

// ─── Defect 4 · the ceiling clamp ────────────────────────────────────────────

describe('the ceiling clamp, and it agrees with settleHeights rather than a literal', () => {
  it('holds a rider under the slab when its support grows past it', () => {
    const cap = ROOM_H - MOUNT_PAD;
    const riderH = 0.4;
    const parts = [desk(), lamp(0.75, riderH * 1000)];
    // Desk top → 2.30. 2.30 + 0.40 = 2.70, well past the 2.48 cap.
    const ys = deriveRiderYs(parts, { dims: { desk: [1400, 700, 2300] } }, {}, ROOM_H);
    expect(ys.lamp).toBeCloseTo(cap - riderH, 10);
    expect(ys.lamp).toBeLessThan(2.3);
  });

  it('puts a rider too tall for the room ON the floor rather than under it', () => {
    // The low guard, `Math.max(0, ...)`, which `settleHeights` also carries. A 2.4 m
    // wardrobe in a 1.8 m room — both legal, both at a `clampDims` extreme — gives a
    // cap of 1.78 and `cap - h` of −0.62. Without the guard the piece is placed
    // BELOW the floor, where `lib/apertures.ts` cuts light holes into the ground.
    // A piece too tall for the room keeps its height and pokes through the top;
    // `lib/clearance.ts` reports `tall`. It is not shrunk to fit.
    const tall = part({ id: 'lamp', category: 'wardrobe', shape: 'wardrobe', pos: [0, 0.75, 0], dimMM: [1200, 600, 2400] });
    const ys = deriveRiderYs([desk(), tall], { dims: { desk: [1400, 700, 900] } }, { lamp: 'desk' }, 1.8);
    expect(ys.lamp).toBe(0);
  });

  it('does not clamp a rider that still fits', () => {
    const parts = [desk(), lamp(0.75, 400)];
    // Top → 2.00; 2.00 + 0.40 = 2.40, under the 2.48 cap. Untouched.
    expect(deriveRiderYs(parts, { dims: { desk: [1400, 700, 2000] } }, {}, ROOM_H)).toEqual({ lamp: 2 });
  });

  it('reads the room height it is given rather than a default', () => {
    const parts = [desk(), lamp(0.75, 400)];
    const o = { dims: { desk: [1400, 700, 2000] as [number, number, number] } };
    expect(deriveRiderYs(parts, o, {}, ROOM_H).lamp).toBe(2);
    // Same resize, shorter room: now it does not fit and the clamp bites.
    expect(deriveRiderYs(parts, o, {}, 2.2).lamp).toBeCloseTo(2.2 - MOUNT_PAD - 0.4, 10);
  });
});

// ─── Defect 8 · a chain resolves parent-first, whatever order the array is in ─

describe('a chain resolves from the root down', () => {
  const chain = () => {
    const nightstand = part({ id: 'nightstand', category: 'nightstand', shape: 'nightstand', pos: [0, 0.75, 0], dimMM: [450, 400, 550] });
    // Deliberately DESCENDING: the only chain fixture anyone writes by hand is in
    // ascending Y, where array order and dependency order coincide — which is what
    // let the reverted version's sort-by-Y be deleted with the whole suite green.
    return [lamp(1.3), nightstand, desk()];
  };

  it('carries the grandchild by the child’s CORRECTED top, not its authored one', () => {
    // desk 0.75 → 0.90. nightstand 0.75 → 0.90, top 0.90 + 0.55 = 1.45. lamp → 1.45.
    // Using the nightstand's authored top (1.30) instead would leave the lamp 150 mm
    // inside the nightstand and is the failure the walk-from-roots exists to prevent.
    const ys = deriveRiderYs(chain(), { dims: { desk: [1400, 700, 900] } }, {}, ROOM_H);
    expect(Object.keys(ys).sort()).toEqual(['lamp', 'nightstand']);
    expect(ys.nightstand).toBeCloseTo(0.9, 10);
    expect(ys.lamp).toBeCloseTo(1.45, 10); // 0.90 + 0.55, and NOT 1.30 + 0.55
  });

  it('carries a grandchild when the child’s two changes CANCEL at its top', () => {
    // The `out[supportId] !== undefined` half of the gate, and the only case that can
    // reach it. The nightstand is corrected — it moves 0.75 → 0.85 — and is
    // simultaneously 100 mm shorter, so its top lands back on 1.30, exactly its
    // authored value. "Has the top moved" is false for it, and only "was it corrected
    // by this pass" keeps the lamp attached. The lamp is at a stale 1.50 (the state
    // defect 1 describes, a resolved Y written back by some other consumer), so
    // dropping the disjunct leaves it 200 mm in the air with the whole suite green.
    const o: Partial<TransformOverrides> = {
      positions: { lamp: [0, 1.5, 0] },
      dims: { desk: [1400, 700, 850], nightstand: [450, 400, 450] },
    };
    const ys = deriveRiderYs(chain(), o, {}, ROOM_H);
    expect(ys.nightstand).toBeCloseTo(0.85, 10);
    expect(ys.lamp).toBeCloseTo(1.3, 10); // 0.85 + 0.45, and NOT left at 1.50
  });

  it('moves only the part of the chain above the piece that changed', () => {
    const ys = deriveRiderYs(chain(), { dims: { nightstand: [450, 400, 700] } }, {}, ROOM_H);
    expect(Object.keys(ys)).toEqual(['lamp']);
    expect(ys.lamp).toBeCloseTo(1.45, 10); // 0.75 + 0.70
  });
});

// ─── The refusals ────────────────────────────────────────────────────────────

describe('what it declines to move', () => {
  it('drops a rider that is no longer over its support', () => {
    // The plan-view half of "is this resting on that" is asked against LIVE
    // footprints; the Y half deliberately is not. Drag the lamp onto bare floor and
    // resizing the desk must not reach across the room for it.
    const parts = [desk(), lamp(0.75)];
    const o: Partial<TransformOverrides> = { positions: { lamp: [4, 0, 4] }, dims: { desk: [1400, 700, 900] } };
    expect(deriveRiderYs(parts, o, { lamp: 'desk' }, ROOM_H)).toEqual({});
  });

  it('leaves a wall-mounted piece alone even when parentIds names a support', () => {
    // A television's `pos[1]` is a mesh CENTRE, so "put its bottom on the top" is not
    // the right arithmetic for one — and it rides its wall, not the desk beneath it.
    const tv = part({ id: 'tv', category: 'tv', shape: 'tv', pos: [0, 1.2, 0], dimMM: [1200, 80, 700], wallMounted: true });
    const parts = [desk(), tv];
    expect(deriveRiderYs(parts, { dims: { desk: [1400, 700, 900] } }, { tv: 'desk' }, ROOM_H)).toEqual({});
  });

  it('terminates on a cycle in the relation rather than correcting anything', () => {
    // `wouldCreateCycle` guards the parentIds side and strictly-increasing Y guards
    // the ridingParents side, but the UNION of two acyclic maps need not be acyclic.
    const a = part({ id: 'a', pos: [0, 0, 0], dimMM: [800, 800, 400] });
    const b = part({ id: 'b', pos: [0, 0.4, 0], dimMM: [800, 800, 400] });
    const ys = deriveRiderYs([a, b], { dims: { a: [800, 800, 600] } }, { a: 'b', b: 'a' }, ROOM_H);
    expect(ys).toEqual({});
  });

  it('survives a relation naming a part that is not in the room', () => {
    expect(deriveRiderYs([desk()], { dims: { desk: [1400, 700, 900] } }, { ghost: 'desk' }, ROOM_H)).toEqual({});
    expect(deriveRiderYs([lamp(0.75)], {}, { lamp: 'ghost' }, ROOM_H)).toEqual({});
  });
});

// ─── The two rules that replaced the single "has the support moved" gate ─────

describe('a piece standing on the floor rides nothing', () => {
  it('stays on the floor after the support it used to be on is resized', () => {
    // The Inspector's **Floor** button: `setPosition(id, [x, 0, z])` + `clearParent`.
    // `clearParent` DELETES a key — it cannot record "rides nothing" — so for a
    // seeded rider, which never had a `parentIds` entry to delete, the authored-
    // geometry edge is re-inferred on the next read. Resize the nightstand first and
    // the old gate is satisfied, so the lamp went to the floor and came straight back.
    // Two clicks, and no lens found it; it turned up while refuting a simpler fix.
    const parts = [desk(), lamp(0.75)];
    const o: Partial<TransformOverrides> = { positions: { lamp: [0, 0, 0] }, dims: { desk: [1400, 700, 900] } };
    expect(deriveRiderYs(parts, o, {}, ROOM_H)).toEqual({});
    // …and the same for an edge a drag DID record, which `groundToFloor` also clears.
    expect(deriveRiderYs(parts, o, { lamp: 'desk' }, ROOM_H)).toEqual({});
  });
});

describe('a RECORDED edge is honoured whatever the support has done', () => {
  it('takes back a Y another consumer baked, once the support is at its authored height again', () => {
    // Suggest, Shuffle, `carryAttached` and `PlanView.moveTo` all move a piece in x/z
    // by copying `pos[1]` verbatim out of the RESOLVED scene, so each of them stores
    // this pass's own answer. Set the support's height back to exactly what it was
    // authored at and the old gate said "nothing moved" — measured 450 mm in the air,
    // persisted, and it followed every height except the one it started at.
    const parts = [desk(), lamp(0.75)];
    const o: Partial<TransformOverrides> = { positions: { lamp: [0, 0.9, 0] } };
    expect(deriveRiderYs(parts, o, { lamp: 'desk' }, ROOM_H)).toEqual({ lamp: 0.75 });
  });

  it('leaves an INFERRED edge gated, so a piece left floating over a table keeps floating', () => {
    // The other direction, and the one that broke three `placement-banner` assertions
    // in the first attempt. Nothing in the app can RECORD an edge for a piece that is
    // not resting — `Draggable.commit` only calls `setParent` from a support the drop
    // actually found — and an inferred edge needs the rider within SUPPORT_Y_EPS of
    // the top, which 350 mm is not. So a floating piece has no relation at all.
    const floating = [desk(), lamp(0.75 + 0.35)];
    expect(riderRelation(floating, {})).toEqual({});
    expect(deriveRiderYs(floating, {}, {}, ROOM_H)).toEqual({});
    // Even with the support resized under it.
    expect(deriveRiderYs(floating, { dims: { desk: [1400, 700, 900] } }, {}, ROOM_H)).toEqual({});
  });
});

describe('what may hold a piece up', () => {
  it('refuses a rug named as a support by an imported file', () => {
    // `findSupportDetailed`'s own two skips, asked here as well because a `parentId`
    // out of a scene file is the one door that reaches this without passing through
    // it — `lib/scene-file.ts` checks that edge for cycles and id-remapping, not for
    // whether the piece can hold anything up. Measured before the skip: a rug
    // thickened from 20 mm to 60 mm lifted its rider.
    const rug = part({ id: 'rug', category: 'rug', shape: 'rug', pos: [0, 0, 0], dimMM: [2000, 1400, 20] });
    const parts = [rug, lamp(0.02)];
    expect(deriveRiderYs(parts, { dims: { rug: [2000, 1400, 60] } }, { lamp: 'rug' }, ROOM_H)).toEqual({});
  });

  it('refuses a ceiling fixture named as a support, on its ANCHOR rather than its footprint', () => {
    // A television is refused by area anyway — 80 mm deep — so it cannot tell the
    // anchor test from the share test. A ceiling fan is 1000 x 1000 and covers the
    // lamp completely, so only the anchor can decline it.
    const fan = part({ id: 'fan', category: 'fan', shape: 'fan', pos: [0, 2.2, 0], dimMM: [1000, 1000, 300] });
    const parts = [fan, lamp(1.0)];
    expect(deriveRiderYs(parts, { dims: { fan: [1000, 1000, 400] } }, { lamp: 'fan' }, ROOM_H)).toEqual({});
  });
});

describe('authored and live are read where each belongs', () => {
  it('measures "has it moved" against the AUTHORED position, not the live one', () => {
    // The support is raised without being resized. Computing `authoredTop` from the
    // LIVE pos makes the comparison `x !== x`, so it reports "nothing changed" and
    // drops every rider it carries — with the whole suite green, because no other
    // fixture gives a support a `positions` override.
    const parts = [desk(), lamp(0.75)];
    const o: Partial<TransformOverrides> = { positions: { desk: [0, 0.3, 0] } };
    expect(deriveRiderYs(parts, o, {}, ROOM_H)).toEqual({ lamp: 1.05 });
  });

  it('tests "still over it" against the LIVE footprint', () => {
    // Every other resize in this file is height-only or leaves the rider fully
    // covered, so `stillOver(rider, authoredSupport)` passed the suite. Here the desk
    // narrows from 1400 to 400 under a lamp sitting 500 mm off centre: over the
    // authored desk, clear of the live one.
    const off = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', pos: [0.5, 0.75, 0], dimMM: [300, 300, 400] });
    const o: Partial<TransformOverrides> = { dims: { desk: [400, 700, 900] } };
    expect(deriveRiderYs([desk(), off], o, { lamp: 'desk' }, ROOM_H)).toEqual({});
    // The control: the same resize with the width left alone does move it.
    expect(deriveRiderYs([desk(), off], { dims: { desk: [1400, 700, 900] } }, { lamp: 'desk' }, ROOM_H))
      .toEqual({ lamp: 0.9 });
  });

  it('clamps by the rider’s EFFECTIVE height, not the size it shipped as', () => {
    // A rider the user has also resized is a legal combination and no other case
    // makes it. Authored 400 mm fits under the cap at a top of 2.00; the 800 mm the
    // user made it does not.
    const parts = [desk(), lamp(0.75, 400)];
    const o: Partial<TransformOverrides> = { dims: { desk: [1400, 700, 2000], lamp: [300, 300, 800] } };
    expect(deriveRiderYs(parts, o, {}, ROOM_H).lamp).toBeCloseTo(ROOM_H - MOUNT_PAD - 0.8, 10);
  });
});

// ─── riderYs — one derivation per store change ───────────────────────────────

describe('riderYs shares one derivation between every subscriber', () => {
  const parts = [desk(), lamp(0.75)];
  const dims = { desk: [1400, 700, 900] } as Record<string, [number, number, number]>;
  const positions = {} as Record<string, [number, number, number]>;
  const rotations = {} as Record<string, number>;
  const parentIds = {} as Record<string, string>;

  it('returns the very same object for the same references', () => {
    // What collapses `2N + 8` subscribers onto one computation. Uncached this cost
    // 14.3 ms per drag frame at 60 parts, against a 16.7 ms budget.
    const a = riderYs(parts, positions, rotations, dims, parentIds, ROOM_H);
    const b = riderYs(parts, positions, rotations, dims, parentIds, ROOM_H);
    expect(a).toEqual({ lamp: 0.9 });
    expect(b).toBe(a);
  });

  it('misses when ANY ONE of the six changes', () => {
    // Every argument, not a chosen few: a key missing one input returns a stale
    // answer for exactly the store write that input represents, and half a table
    // pinned is the same defect as none.
    const base = () => riderYs(parts, positions, rotations, dims, parentIds, ROOM_H);
    const variants: Array<[string, () => Record<string, number>]> = [
      ['parts', () => riderYs([...parts], positions, rotations, dims, parentIds, ROOM_H)],
      ['positions', () => riderYs(parts, { ...positions }, rotations, dims, parentIds, ROOM_H)],
      ['rotations', () => riderYs(parts, positions, { ...rotations }, dims, parentIds, ROOM_H)],
      ['dims', () => riderYs(parts, positions, rotations, { ...dims }, parentIds, ROOM_H)],
      ['parentIds', () => riderYs(parts, positions, rotations, dims, { ...parentIds }, ROOM_H)],
      ['roomHeight', () => riderYs(parts, positions, rotations, dims, parentIds, ROOM_H + 1)],
    ];
    for (const [name, call] of variants) {
      const first = base();
      expect(call(), `changing ${name} must not return the cached object`).not.toBe(first);
    }
  });

  it('recomputes rather than returning a stale answer', () => {
    riderYs(parts, positions, rotations, dims, parentIds, ROOM_H);
    expect(riderYs(parts, positions, rotations, { desk: [1400, 700, 600] }, parentIds, ROOM_H))
      .toEqual({ lamp: 0.6 });
  });
});

// ─── resolveScene ────────────────────────────────────────────────────────────

describe('resolveScene', () => {
  const ctx = { parentIds: {}, roomHeight: ROOM_H };

  it('is resolveParts plus the correction', () => {
    const parts = [desk(), lamp(0.75)];
    const o = { dims: { desk: [1400, 700, 900] as [number, number, number] } };
    const scene = resolveScene(parts, o, ctx);
    expect(scene.find((p) => p.id === 'lamp')!.pos).toEqual([0, 0.9, 0]);
    // And the lamp's Y is the ONLY thing that differs from the plain merge — compared
    // by VALUE, not by object identity: the desk carries a `dims` override, so
    // `resolvePart` builds it a fresh object on both calls and an identity comparison
    // would name the desk too, for a reason that has nothing to do with this pass.
    const plain = resolveParts(parts, o);
    expect(scene.map((p) => p.dimMM)).toEqual(plain.map((p) => p.dimMM));
    expect(scene.map((p) => p.rot)).toEqual(plain.map((p) => p.rot));
    const movedIds = scene.filter((p, i) => p.pos.some((v, a) => v !== plain[i].pos[a])).map((p) => p.id);
    expect(movedIds).toEqual(['lamp']);
  });

  it('keeps referential identity for every part when nothing rides anything', () => {
    // What makes memoising downstream pay, and what lets a consumer compare by
    // identity to see what moved.
    const parts = [desk(), part({ id: 'chair', pos: [2, 0, 2], dimMM: [500, 500, 900] })];
    const scene = resolveScene(parts, {}, ctx);
    expect(scene[0]).toBe(parts[0]);
    expect(scene[1]).toBe(parts[1]);
  });

  it('does not mutate the parts it was given', () => {
    const parts = [desk(), lamp(0.75)];
    resolveScene(parts, { dims: { desk: [1400, 700, 900] } }, ctx);
    expect(parts[1].pos).toEqual([0, 0.75, 0]);
  });

  it('carries parentIds through from the context', () => {
    const parts = [desk(), lamp(0, 400)];
    const o: Partial<TransformOverrides> = { positions: { lamp: [0, 0.75, 0] }, dims: { desk: [1400, 700, 900] } };
    expect(resolveScene(parts, o, { parentIds: { lamp: 'desk' }, roomHeight: ROOM_H }).find((p) => p.id === 'lamp')!.pos)
      .toEqual([0, 0.9, 0]);
    // …and without it, authored geometry has no edge to offer, so nothing moves.
    expect(resolveScene(parts, o, ctx).find((p) => p.id === 'lamp')!.pos).toEqual([0, 0.75, 0]);
  });
});
