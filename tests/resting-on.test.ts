import { describe, expect, it } from 'vitest';
import { findSupportDetailed, restingOn, verticalExtent, RESTING_TOL } from '@/lib/physics';
import type { ScenePart } from '@/lib/scene-spec';

// § 37 — "is this piece resting on anything" was a question nothing in this repo could
// answer, and an Inspector banner shipped asking `findSupportDetailed` instead.
//
// That function takes **x and z only**. It answers "what is under here" — the question
// a DROP asks — and never compares the mover's own `y` to the top it returns. Read as
// "is this resting", it says yes to a lamp a metre above a desk and then names the
// desk. The banner read "On Table — Supported by Table" about a piece in mid-air.
//
// So every clause here is written as a PAIR: what the old question answers, and what
// the new one does. A test that only asserted the new answer would pass against a
// `restingOn` that had quietly become an alias for the old one.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

const part = (o: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ name: o.id, rot: 0, locked: false, ...o }) as ScenePart;

/** A 1400 × 700 × 750 desk standing on the floor at the origin. */
const desk = part({ id: 'desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
/** …whose top is therefore at 0.75. */
const DESK_TOP = 0.75;

const lampAt = (y: number) =>
  part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, y, 0] });

const ask = (p: ScenePart, world: ScenePart[]) =>
  restingOn(world, p.id, p.pos, p.rot, p.dimMM, p.category, p.shape, p.circle);

describe('restingOn — the question findSupportDetailed does not answer', () => {
  it('the desk really is under the lamp at every height, which is the premise', () => {
    // Asserted rather than assumed: if the footprints stopped overlapping, every
    // "floating" clause below would pass for the wrong reason.
    for (const y of [DESK_TOP, DESK_TOP + 0.35, DESK_TOP + 1]) {
      const under = findSupportDetailed([desk], 'lamp', 0, 0, lampAt(y).dimMM, 0, undefined);
      expect(under?.id, `at y=${y}`).toBe('desk');
      expect(under?.y).toBeCloseTo(DESK_TOP, 9);
    }
  });

  it('says a lamp ON the desk is on the desk', () => {
    const r = ask(lampAt(DESK_TOP), [desk]);
    expect(r).not.toBeNull();
    expect(r!.on).toBe('part');
    expect(r!.id).toBe('desk');
    expect(r!.gap).toBeCloseTo(0, 9);
  });

  it('says a lamp HOVERING over the desk is on nothing — the § 37 defect', () => {
    // 350 mm is not an arbitrary height: it is what § 12 measures a rider floating by
    // when `settleHeights` has settled it against the AUTHORED size of a support the
    // user has since resized. The old banner named the desk here.
    const lamp = lampAt(DESK_TOP + 0.35);
    expect(
      findSupportDetailed([desk], 'lamp', 0, 0, lamp.dimMM, 0, undefined)?.id,
      'the old question still says "desk", which is why this test is a pair',
    ).toBe('desk');
    expect(ask(lamp, [desk]), 'and the new one says nothing holds it up').toBeNull();
  });

  it('says a piece on the floor is on the floor, not on nothing', () => {
    // Two different answers, and a caller that cannot tell them apart is the defect.
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [3, 0, 3] });
    const r = ask(chair, [desk, chair]);
    expect(r).not.toBeNull();
    expect(r!.on).toBe('floor');
    expect(r!.id).toBeNull();
  });

  it('says a piece hovering over bare floor is on nothing', () => {
    const chair = part({ id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [3, 0.4, 3] });
    expect(ask(chair, [desk, chair])).toBeNull();
  });

  it('holds at the tolerance and lets go one step past it', () => {
    // The band itself, from both sides. `RESTING_TOL` is under the 10 mm grid snap, so
    // a piece deliberately lifted by one step reads as floating rather than resting.
    const just = ask(lampAt(DESK_TOP + RESTING_TOL * 0.99), [desk]);
    expect(just?.id, `${RESTING_TOL * 1000} mm above the desk`).toBe('desk');
    const past = ask(lampAt(DESK_TOP + RESTING_TOL * 1.01), [desk]);
    expect(past, 'a hair past the tolerance is not resting').toBeNull();
    expect(RESTING_TOL, 'and the tolerance stays under one grid step').toBeLessThan(0.01);
  });

  it('holds from BELOW the surface too, which a one-sided test would miss', () => {
    // A piece slightly INSIDE its support is still resting on it — and a `bottom - top`
    // comparison without an absolute value calls that a float, in the direction nobody
    // looks. The asymmetric case, per CLAUDE.md.
    const sunk = ask(lampAt(DESK_TOP - RESTING_TOL * 0.99), [desk]);
    expect(sunk?.id).toBe('desk');
    expect(sunk!.gap).toBeLessThan(0);
  });

  it('reads a wall-mounted piece as resting on nothing, and that is truthful', () => {
    // A TV rests on nothing. Whether that is worth SAYING is the caller's judgement —
    // `Inspector` reports "Wall-mounted" from the flag rather than from this null.
    const tv = part({ id: 'tv', category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.4, -2], wallMounted: true });
    expect(ask(tv, [desk, tv])).toBeNull();
  });

  it('measures the piece’s own underside, not its origin', () => {
    // `verticalExtent` is the whole reason this cannot be `pos[1]`: a wall-mid anchor's
    // `pos[1]` is its CENTRE. Reading the origin instead would make a 820 mm television
    // at y = 0.41 look like it was standing on the floor.
    const tv = part({ id: 'tv', category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 0.41, -2] });
    const [bottom] = verticalExtent(tv.category, tv.shape, tv.dimMM, tv.pos[1]);
    expect(bottom, 'a centred anchor puts its underside half a height below its origin').toBeCloseTo(0, 9);
    expect(ask(tv, [tv])?.on, 'so it IS on the floor').toBe('floor');
  });

  it('prefers the thing it is touching over the thing that is merely under it', () => {
    // A lamp on a desk that is itself standing on the floor: both are below, and only
    // one is in contact. Without the height test the answer is whichever the old
    // function ranks highest, which is why that function's answer alone cannot serve.
    const r = ask(lampAt(DESK_TOP), [desk]);
    expect(r!.on).toBe('part');
    expect(r!.id).toBe('desk');
  });

  it('ignores a support whose footprint the piece barely overlaps', () => {
    // Inherited from `findSupportDetailed`'s `MIN_SUPPORT_SHARE`, and asserted here so
    // that a future `restingOn` written without it goes red: a lamp perched on the very
    // lip of a desk is not on the desk, and at the desk's own height it is in mid-air.
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0.78, DESK_TOP, 0] });
    expect(findSupportDetailed([desk], 'lamp', 0.78, 0, lamp.dimMM, 0, undefined)).toBeNull();
    expect(ask(lamp, [desk])).toBeNull();
  });
});
