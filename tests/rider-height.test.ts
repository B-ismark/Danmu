// § 12 — a rider keeps the size the room was BUILT at.
//
// The defect: `settleHeights` seats every rider once, inside `buildSceneFromRoom`, against
// the AUTHORED dims; `loadTransforms` then applies the user's saved `dims` over the top and
// nothing settles again. Shrink a desk and the lamp on it hangs at the old top. `setDim`
// settles nothing either, so it floats in-session as well as after a reload.
//
// The repair the user chose (§ B.16) is to DERIVE the height when the piece is read and
// write nothing, so `resolveParts` does it and `lib/transforms.ts`'s `deriveRiderYs` is
// the rule. This file is that rule's gate, and most of it is about the rule's SCOPE
// rather than its arithmetic: a first version settled everything that floated, which is
// a general read-time gravity pass and would have deleted § 37's *Floating* report.
//
// `resetSettleMemo()` before every read, because the derivation is memoised on the
// identity of the four slices and a fixture reused across cases would otherwise be
// answered from the previous case's slot. Without it, three of the assertions below pass
// for the wrong reason.

import { beforeEach, describe, expect, it } from 'vitest';
import { resetSettleMemo, resolveParts, settledY } from '../lib/transforms';
import { verticalExtent } from '../lib/physics';
import type { ScenePart } from '../lib/scene-spec';

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return {
    category: 'desk',
    name: over.id,
    shape: 'desk-standard',
    pos: [0, 0, 0],
    rot: 0,
    dimMM: [1400, 700, 750],
    locked: false,
    ...over,
  } as ScenePart;
}

const desk = (mm = 750, id = 'desk') =>
  part({ id, category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, mm], pos: [0, 0, 0] });
/** Seated on a 750 mm desk, which is where `settleHeights` would have left it. */
const lamp = (y = 0.75, id = 'lamp') =>
  part({ id, category: 'lamp', shape: 'lamp-table', dimMM: [300, 300, 400], pos: [0, y, 0] });

const topOf = (p: ScenePart) => verticalExtent(p.category, p.shape, p.dimMM, p.pos[1])[1];

beforeEach(resetSettleMemo);

describe('a rider follows the piece under it when that piece is resized', () => {
  // The headline, both ways. A one-sided version is satisfied by a derivation that only
  // ever lowers a rider — and the raising half is the one that looks like nothing on
  // screen, because the lamp ends up inside the desk rather than above it.
  it.each([
    [400, 0.4, 'shrunk'],
    [1100, 1.1, 'grown'],
  ])('a desk %i mm puts the lamp at %f (%s)', (mm, y) => {
    const parts = [desk(), lamp()];
    const [, rLamp] = resolveParts(parts, { dims: { desk: [1400, 700, mm] } });
    expect(rLamp.pos[1]).toBeCloseTo(y, 9);
  });

  it('leaves the gap at zero, which is the property rather than the number', () => {
    const parts = [desk(), lamp()];
    const [rDesk, rLamp] = resolveParts(parts, { dims: { desk: [1400, 700, 400] } });
    expect(rLamp.pos[1] - topOf(rDesk)).toBeCloseTo(0, 9);
  });

  // The chain, and it needs the ascending-Y walk: resize the armchair and BOTH the
  // nightstand on it and the lamp on that have to come down. Fixing one edge leaves the
  // lamp hanging where the nightstand used to be, which is the same defect one level up.
  it('carries a two-edge chain, not just the first edge', () => {
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-armchair', dimMM: [900, 900, 800], pos: [0, 0, 0] });
    const stand = part({ id: 'stand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0.8, 0] });
    const out = resolveParts([chair, stand, lamp(1.35)], { dims: { chair: [900, 900, 400] } });
    const byId = new Map(out.map((p) => [p.id, p]));
    expect(byId.get('stand')!.pos[1], 'the nightstand comes down to the shrunk chair').toBeCloseTo(0.4, 9);
    expect(byId.get('lamp')!.pos[1], 'and the lamp comes down with the nightstand').toBeCloseTo(0.95, 9);
  });

  // A desk that shrank in x and z may not be under the lamp at all any more, so the
  // answer is `findSupportDetailed` against the CURRENT sizes and not "the resized
  // support's new top". Here the desk keeps its height and loses its width, and the
  // right answer is the floor.
  it('drops a rider whose support shrank out from under it', () => {
    const parts = [desk(), lamp()];
    // The lamp sits 600 mm along a 1400 mm desk; a 400 mm desk no longer reaches it.
    parts[1] = lamp(0.75);
    parts[1].pos[0] = 0.6;
    const [, rLamp] = resolveParts(parts, { dims: { desk: [400, 400, 750] } });
    expect(rLamp.pos[1], 'nothing is under it now, so it is on the floor').toBe(0);
  });
});

describe('the 0.3 m support bar, which is settleHeights’ and not a fresh one', () => {
  // `settleHeights` refuses anything at or under 0.30 m as a surface — a rug is not a
  // table — and this derivation mirrors it, because the build path and the read path
  // must not answer differently about one piece and make it jump the moment a scene
  // snapshot is written.
  //
  // It DISAGREES with `ridingParents`' own `> 0` on exactly this pair, and that
  // disagreement is inherited: `settleHeights`' docblock names a lamp on a 300 mm
  // ottoman as the case where the two thresholds part company. Pinned at BOTH ends,
  // because a bar asserted from one side only is free on the other.
  const ottoman = (mm: number) =>
    part({ id: 'ottoman', category: 'ottoman', shape: 'ottoman', dimMM: [550, 400, mm], pos: [0, 0, 0] });

  it.each([
    [280, 0, 'below the bar, so the floor'],
    [350, 0.35, 'above the bar, so the ottoman'],
  ])('an ottoman resized to %i mm puts the lamp at %f (%s)', (mm, y) => {
    const parts = [ottoman(300), lamp(0.3)];
    const out = resolveParts(parts, { dims: { ottoman: [550, 400, mm] } });
    expect(out.find((p) => p.id === 'lamp')!.pos[1]).toBeCloseTo(y, 9);
  });
});

describe('what the derivation deliberately does NOT touch', () => {
  // § 37's report is the reason this scope is narrow. A piece resting on nothing is
  // *Floating* in the Inspector's placement banner, and a derivation that seated
  // whatever floated would make that state unreachable — three assertions in
  // `tests/placement-banner.test.tsx` said so when the first version of this did.
  it('leaves a piece that rests on nothing where it is, even mid-air', () => {
    const floating = lamp(1.2);
    const [r] = resolveParts([desk(), floating], { dims: { desk: [1400, 700, 400] } })
      .filter((p) => p.id === 'lamp');
    expect(r.pos[1], 'it was never riding the desk, so nothing corrects it').toBeCloseTo(1.2, 9);
  });

  // Nothing resized, nothing derived — and the early exit is what makes the derivation
  // free in a room the user has only moved things in. Asserted through the returned
  // OBJECT identity rather than the number, because `resolveParts` hands back the part
  // itself when no override touches it and that referential equality is what makes
  // memoising the list pay.
  it('does no work at all when no piece carries a dims override', () => {
    const parts = [desk(), lamp()];
    const out = resolveParts(parts, { positions: { lamp: [0.2, 0.75, 0] } });
    expect(out[0], 'the untouched desk is the same object').toBe(parts[0]);
    expect(settledY(parts, { positions: { lamp: [0.2, 0.75, 0] } }, 'lamp')).toBeUndefined();
  });

  // A resize somewhere else in the room must not become a licence to settle everything.
  // The lamp rides the desk; the WARDROBE is what was resized; the lamp does not move.
  it('ignores a rider whose own support was not the piece resized', () => {
    const wardrobe = part({ id: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2100], pos: [3, 0, 3] });
    const parts = [desk(), lamp(), wardrobe];
    expect(settledY(parts, { dims: { wardrobe: [1200, 600, 1800] } }, 'lamp')).toBeUndefined();
  });

  // The ceiling belongs to `regradeForNewCeiling` in the WRITE layer. A read-time clamp
  // would be a second owner of one rule, and it would make `clearance.ts`'s `tall`
  // finding unreachable while the piece looked fitted on screen — which is the one lie
  // this codebase exists to avoid. The derivation is not even given a room height.
  it('keeps a piece taller than any ceiling at its real height', () => {
    const tall = part({ id: 'tall', category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2400], pos: [0, 0.75, 0] });
    const [, r] = resolveParts([desk(), tall], { dims: { desk: [1400, 700, 400] } });
    expect(r.pos[1], 'it was riding the desk, so it comes down to 0.40').toBeCloseTo(0.4, 9);
    expect(topOf(r), 'and its top is still 2.40 m above that, through any ceiling').toBeCloseTo(2.8, 9);
  });
});

describe('the memo', () => {
  // The derivation is O(parts²) footprint tests and `settledY` is called once per
  // `Draggable` on every store change, so the memo is the difference between one pass
  // and N. Keyed on the identity of the four slices, which is sound because the override
  // maps are replaced wholesale by their setters.
  //
  // Asserted by handing the SAME arrays back and mutating the answer underneath: a
  // second call that recomputed would see the mutation. That is the only way to observe
  // a cache from outside, and it is why `resetSettleMemo` exists.
  it('answers a repeat call from the slot rather than recomputing', () => {
    const parts = [desk(), lamp()];
    const o = { dims: { desk: [1400, 700, 400] as [number, number, number] } };
    expect(settledY(parts, o, 'lamp')).toBeCloseTo(0.4, 9);
    // Move the desk's authored height under the memo's feet. The memo still answers 0.40
    // because none of the four keys changed.
    parts[0].dimMM = [1400, 700, 1100];
    expect(settledY(parts, o, 'lamp')).toBeCloseTo(0.4, 9);
    // And after a reset it genuinely re-derives, to a DIFFERENT answer: `ridingParents`
    // reads the authored 1100 mm desk, the lamp's 0.75 is 350 mm off that top, so it was
    // never seated and there is no edge to correct. Which is the point — the second call
    // above was serving the first call's world, not re-deriving and agreeing.
    resetSettleMemo();
    expect(settledY(parts, o, 'lamp'), 'no longer a rider at the authored size').toBeUndefined();
  });

  it('re-derives when the dims slice is replaced', () => {
    const parts = [desk(), lamp()];
    expect(settledY(parts, { dims: { desk: [1400, 700, 400] } }, 'lamp')).toBeCloseTo(0.4, 9);
    expect(settledY(parts, { dims: { desk: [1400, 700, 1100] } }, 'lamp')).toBeCloseTo(1.1, 9);
  });
});
