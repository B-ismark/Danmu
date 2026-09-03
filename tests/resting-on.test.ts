import { describe, expect, it } from 'vitest';
import { findSupportDetailed, restingOn, verticalExtent, SUPPORT_Y_EPS } from '@/lib/physics';
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
  it('the desk really is under the lamp, and the old question cannot tell how high', () => {
    // The premise AND the point, in one clause. The first version looped over three
    // heights — which could not vary, because `y` only ever reached `dimMM` and
    // `findSupportDetailed` takes no height at all. Three byte-identical calls under a
    // title claiming "at every height", against a function with no height parameter.
    //
    // Written the honest way, that absence IS the finding: one call, no `y` anywhere in
    // it, and the answer is the desk regardless of where the lamp is.
    const under = findSupportDetailed([desk], 'lamp', 0, 0, [250, 250, 500], 0, undefined);
    expect(under?.id).toBe('desk');
    expect(under?.y).toBeCloseTo(DESK_TOP, 9);
    // …so if the footprints ever stopped overlapping, every "floating" clause below
    // would pass for the wrong reason. This is what stops that.
    expect(findSupportDetailed([], 'lamp', 0, 0, [250, 250, 500], 0, undefined)).toBeNull();
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

  it('is the SHARED tolerance, at an absolute height rather than a multiple of itself', () => {
    // The first version probed at `TOL * 0.99` and `TOL * 1.01`, which scale with the
    // constant — so every positive value passed both, and `RESTING_TOL = 5e-12` kept
    // the file green while making a legitimately-placed rider read "Floating" in the
    // app. An assertion that measures its own subject, which is the `module-tiling`
    // shape CLAUDE.md names.
    //
    // Absolute heights now, and they are chosen against the two things that actually
    // land here: `isPhysicallySupported` carries a rigid child at 30 mm, so 30 mm must
    // be RESTING or the drag code and this report disagree about the same piece; and
    // § 12's rider floats 350 mm, which must not be.
    expect(SUPPORT_Y_EPS, 'the one tolerance, not a second literal').toBe(0.05);
    expect(ask(lampAt(DESK_TOP + 0.03), [desk])?.id, '30 mm is settle noise, and the drag code says supported').toBe('desk');
    expect(ask(lampAt(DESK_TOP + 0.35), [desk]), '350 mm is § 12 and is not resting').toBeNull();
    expect(ask(lampAt(DESK_TOP + 0.06), [desk]), 'just past the shared tolerance').toBeNull();
  });

  it('agrees with the rigid-parent edge test, which is why it shares that constant', () => {
    // The failure `SUPPORT_Y_EPS`'s own docblock predicted, asserted so it cannot come
    // back: "a report using a threshold of its own could call something airborne while
    // the drag code is still carrying it as a rigid child". Any gap the drag code
    // forgives, this must forgive.
    // Strictly inside and strictly outside, and the exact boundary is deliberately not
    // sampled: `0.75 + 0.05` is 0.8000000000000001, so `|bottom - top|` at the nominal
    // tolerance is 0.05000000000000004 and which side of `<=` it lands on is float
    // noise rather than behaviour. `isPhysicallySupported` compares the same two
    // numbers with the same operator and inherits the same noise, so pinning the
    // boundary would pin the noise and call it agreement.
    for (const gap of [-0.03, 0, 0.01, 0.03, 0.049]) {
      expect(ask(lampAt(DESK_TOP + gap), [desk])?.id, `${gap * 1000} mm is settle noise`).toBe('desk');
    }
    for (const gap of [0.051, 0.1, 0.35]) {
      expect(ask(lampAt(DESK_TOP + gap), [desk]), `${gap * 1000} mm is a real gap`).toBeNull();
    }
  });

  it('holds from BELOW the surface too, which a one-sided test would miss', () => {
    // A piece slightly INSIDE its support is still resting on it — and a `bottom - top`
    // comparison without an absolute value calls that a float, in the direction nobody
    // looks. The asymmetric case, per CLAUDE.md.
    const sunk = ask(lampAt(DESK_TOP - 0.03), [desk]);
    expect(sunk?.id).toBe('desk');
    expect(sunk!.gap).toBeLessThan(0);
  });

  it('has no opinion about wall-mounting, which is why the caller must have one', () => {
    // `restingOn` takes no `wallMounted` and reads none: a TV on a wall returns null
    // for exactly the same reason a chair in mid-air does — nothing is under it. The
    // first version of this clause set `wallMounted: true` on the fixture and asserted
    // null, which passes identically with the flag REMOVED and so tested nothing.
    //
    // Stated as the property it actually is: the flag makes no difference here, and
    // `Inspector` is where the difference gets made.
    const at = (extra: Partial<ScenePart>) =>
      part({ id: 'tv', category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.4, -2], ...extra });
    expect(ask(at({ wallMounted: true }), [desk])).toBeNull();
    expect(ask(at({}), [desk]), 'the flag changes nothing in this function').toBeNull();
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

  it('is not fooled by a TALLER piece overlapping the one it is actually on', () => {
    // The first version of this clause passed ONE candidate, so there was no preference
    // to express and it was input-identical to the clause four above it. With two, it
    // is the real finding: `findSupportDetailed` maximises `top`, so a monitor standing
    // over the same patch of desk answers "monitor" and a caller comparing the lamp's
    // underside against 1.25 concludes the lamp is airborne — without the lamp moving.
    const monitor = part({
      id: 'monitor', category: 'monitor', shape: 'monitor', dimMM: [600, 200, 500], pos: [0, DESK_TOP, 0],
    });
    const lamp = lampAt(DESK_TOP);
    // The old question, and it is the wrong answer for this purpose:
    const naive = findSupportDetailed([desk, monitor], 'lamp', 0, 0, lamp.dimMM, 0, undefined);
    expect(naive?.id, 'the highest top wins, which is the monitor').toBe('monitor');
    // …and the new one, which asks for a support the piece could be resting ON.
    const r = ask(lamp, [desk, monitor]);
    expect(r?.on).toBe('part');
    expect(r?.id, 'the lamp is on the desk, and still is').toBe('desk');
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
