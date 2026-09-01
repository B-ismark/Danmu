import { describe, it, expect } from 'vitest';
import { resolvePlacement, refusalCause } from '@/lib/drag-resolve';
import { footprintForLayout } from '@/lib/footprint';
import {
  PART_LIBRARY,
  CATEGORIES,
  SHAPES,
  type Category,
  type ScenePart,
  type Shape,
} from '@/lib/scene-spec';
import { ridesWall } from '@/lib/physics';
import { dimRangeFor } from '@/lib/dimension-ranges';

// § H.16 — "models are still going through walls in 2d plan mode".
//
// It was not the plan. Both tabs end in `resolvePlacement`, and `resolvePlacement`
// exempted every wall-mounted piece from the polygon test outright, on the stated
// grounds that `snapToWall` had "just placed it exactly on an edge". `snapToWall`
// says in its own comment that it does no such thing when the piece is wider than
// the wall it landed on — it CENTRES it and lets both ends hang past the corners,
// deliberately, because shrinking it is what rule 2 forbids. On a rectangle those
// ends hang over the next wall's floor. On an L, a T or a U they hang into the
// missing quadrant, and the drag committed `valid` with no red and nothing said.
//
// This is a SWEEP rather than examples, because choosing examples is exactly how
// the first version missed it: the piece that fails is whichever one happens to be
// wider than the shortest wall of the room it is in, which is a property of the
// pair and not of either.

// ─── What is swept, and why it is derived rather than listed ────────────────
//
// **The catalogue enumerates itself.** The first version of this file looped over
// `CATEGORIES` and picked one shape per category from a hand-written `alt` map,
// and that is the drift CLAUDE.md § 3 forbids, in the one direction nobody
// notices. `anchorFor` is `ANCHOR_BY_SHAPE[shape] ?? ANCHOR_BY_CATEGORY[category]`,
// so riding a wall is a property of the **shape** first — and a category-keyed
// sweep cannot see a wall-riding shape whose category does not ride. Three did:
// `mirror/mirror-oval`, `tv/soundbar`, and worst `other/window`, which is in the
// Library, is emitted by `local-detect` and `room-openings`, and turned out to be
// the SECOND largest escaper in the room. `ac` was worse than missing —
// `shapeFor('ac')` fell through to `'box'`, so the row this file reported as "`ac`
// passes on its own merits" was measured on a box wearing the `ac` category, at a
// box's dimensions.
//
// Reading `PART_LIBRARY` fixes it permanently: a rider added to the catalogue
// tomorrow enters the sweep with no edit here, and `PAIRS` / `RIDERS` below go red
// until someone re-measures rather than staying quietly green.
const PAIRS: Array<{ c: Category; s: Shape }> = (() => {
  // Deduped: `tv/tv` has three Library entries (three default sizes, one pair), and
  // three copies of a pair is three times the runtime for no extra coverage — and
  // it silently trebled that pair's weight in every total.
  const seen = new Set<string>();
  const out: Array<{ c: Category; s: Shape }> = [];
  for (const item of PART_LIBRARY) {
    const key = `${item.category}/${item.shape}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ c: item.category, s: item.shape });
  }
  return out;
})();

const RIDERS = PAIRS.filter((p) => ridesWall(p.c, p.s));
const LAYOUTS = ['rect', 'l', 't', 'u', 'open'] as const;
const ROTS = [0, Math.PI / 4, Math.PI / 2];
const XS = [-4, -2, -1, 0, 1, 2, 4];
const ZS = [-3, -1.5, 0, 1.5, 3];
const H = 2.5;

/** The pipeline's containment test insets the footprint by 10 mm of *dimension*
 *  before asking — which is **5 mm on each of the four faces**, since `obbFromPart`
 *  computes `hw = dimMM[0] / 2000`. Four documents used to call it "a 10 mm shrink"
 *  and stop there; anyone sizing a future tolerance against a wall gap would have
 *  been out by 2×.
 *
 *  Matching it here is not optional. Asking a STRICTER question than the code asks
 *  is how the first run of this sweep produced 11,890 findings, none of them real —
 *  the clamp parks a piece exactly on the wall, and a corner on the boundary is not
 *  "outside". */
const SLACK_MM = 10;

// ─── The oracle, which is deliberately not the code it audits ───────────────
//
// The previous version asked `footInsidePoly(footFromPart(pos, rot, shrunk))`. That
// reduces to `obbInsidePoly(obbFromPart(pos, rot, shrunk))` **exactly**:
// `footCorners` returns `obbCorners` verbatim when `circle` is falsy, and both end
// in the same `pointInPoly`. So `valid ⇒ inside` was a theorem about function
// identity, not a measurement — replacing `pointInPoly` with `return true` turns
// containment off entirely, and the escape assertion stayed green with zero
// escapes.
//
// What that version COULD detect is a piece BYPASSING the predicate, which is
// exactly the defect here, so it was the right instrument by luck. It could never
// detect the predicate being wrong. These two functions are a second
// implementation so that it can — and they are honestly only that: a
// crossing-number ray cast is still a crossing-number ray cast, and an error in
// the *algorithm* would be invisible to both. What they buy is independence from
// the repo's copy, and the control cases below pin them.

/** The four world-space corners, from the one thing this file takes on trust: the
 *  rotation convention, which CLAUDE.md states is three.js's — a part's front
 *  (local +Z) is `(sin rot, cos rot)`. Local +X is that turned a quarter clockwise
 *  in the same handedness, `(cos rot, −sin rot)`. Derived from the stated rule
 *  rather than read off `obbCorners`. */
function cornersOf(
  pos: [number, number, number],
  rot: number,
  dimMM: [number, number, number],
): Array<[number, number]> {
  const hw = (dimMM[0] - SLACK_MM) / 2000;
  const hd = (dimMM[1] - SLACK_MM) / 2000;
  const rightX = Math.cos(rot);
  const rightZ = -Math.sin(rot);
  const frontX = Math.sin(rot);
  const frontZ = Math.cos(rot);
  return (
    [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as Array<[number, number]>
  ).map(([lx, lz]): [number, number] => [
    pos[0] + lx * rightX + lz * frontX,
    pos[2] + lx * rightZ + lz * frontZ,
  ]);
}

/** Crossing-number point-in-polygon, written out here rather than imported. */
function isInside(x: number, z: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function mk(c: Category, s: Shape, dim: [number, number, number]): ScenePart {
  return {
    id: 'sub',
    name: s,
    category: c,
    shape: s,
    pos: [0, 0, 0],
    rot: 0,
    dimMM: dim,
    locked: false,
  } as ScenePart;
}

function sizesFor(c: Category, s: Shape): Array<[string, [number, number, number]]> {
  const r = dimRangeFor(c, s);
  return [
    ['min', [...r.min] as [number, number, number]],
    [
      'mid',
      [
        Math.round((r.min[0] + r.max[0]) / 2),
        Math.round((r.min[1] + r.max[1]) / 2),
        Math.round((r.min[2] + r.max[2]) / 2),
      ] as [number, number, number],
    ],
    ['max', [...r.max] as [number, number, number]],
  ];
}

/** One pass of the whole catalogue, measuring BOTH builds at once.
 *
 *  The pre-fix column is simulated as `valid || ridesWall`, and that is exact
 *  rather than approximate: the old `inRoom` was `ridesAWall || <the clause that
 *  survives>`, and `parts: [p]` puts the piece alone in the room, so `collidesAt`
 *  never fires and `valid ≡ inRoom` on both sides. It was validated against the
 *  real thing as well — the exemption was restored in the source and the sweep
 *  re-run, and the simulated column reproduced it exactly. */
function sweep() {
  const escapes: string[] = [];
  const accepts = new Map<string, number>();
  const acceptedWithExemption = new Map<string, number>();
  const lossByRot = new Map<number, number>();
  let considered = 0;
  for (const layout of LAYOUTS) {
    const poly = footprintForLayout(layout, 6, 5);
    for (const { c, s } of PAIRS) {
      const key = `${c}/${s}`;
      const rides = ridesWall(c, s);
      for (const [label, dim] of sizesFor(c, s)) {
        const p = mk(c, s, dim);
        for (const rot of ROTS) {
          for (const x of XS) {
            for (const z of ZS) {
              considered++;
              const r = resolvePlacement({
                part: p,
                rawX: x,
                rawZ: z,
                rot,
                dim,
                parts: [p],
                footprint: poly,
                roomHeight: H,
                snapMode: 'off',
              });
              const wasValid = r.valid || rides;
              if (wasValid) {
                acceptedWithExemption.set(key, (acceptedWithExemption.get(key) ?? 0) + 1);
              }
              if (!r.valid) {
                if (wasValid) lossByRot.set(rot, (lossByRot.get(rot) ?? 0) + 1);
                continue;
              }
              accepts.set(key, (accepts.get(key) ?? 0) + 1);
              // A rug is exempt from the corner test ON PURPOSE — it belongs under
              // the furniture, up to the skirting and across an L's missing corner —
              // so it is held to what the code actually promises for it: its CENTRE
              // is over real floor. Skipping rugs outright would make a rug
              // regression invisible here, which is the same defect one level up.
              //
              // Everything else is held to BOTH halves of the pipeline's question.
              // The corner half alone is looser, and measurably so: dozens of these
              // samples have four inset corners inside the polygon and their CENTRE
              // in the void — an L's removed quadrant reached diagonally, a max-size
              // sofa at 45° being the clearest. Against a mutation deleting
              // `&& pointInFootprint(x, z, footprint)` from the source, a
              // corner-only oracle calls every one of them "inside" and this
              // assertion — the one the file is named for — stays green.
              const ok =
                c === 'rug'
                  ? isInside(r.pos[0], r.pos[2], poly)
                  : cornersOf(r.pos, r.rot, dim).every(([cx, cz]) => isInside(cx, cz, poly)) &&
                    isInside(r.pos[0], r.pos[2], poly);
              if (!ok) {
                escapes.push(
                  `${layout} ${key} ${label} rot=${rot.toFixed(2)} to=(${x},${z}) -> (${r.pos[0].toFixed(3)},${r.pos[2].toFixed(3)}) rides=${rides}`,
                );
              }
            }
          }
        }
      }
    }
  }
  return { escapes, accepts, acceptedWithExemption, considered, lossByRot };
}

describe('a placement the pipeline calls VALID is inside the room', () => {
  const { escapes, accepts, acceptedWithExemption, considered, lossByRot } = sweep();
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const acceptedNow = total(accepts);
  const acceptedBefore = total(acceptedWithExemption);

  // The oracle is only worth having if it is right, and it is trigonometry written
  // from a stated convention rather than copied from the code it audits. These pin
  // it, and the turned cases are the point: a 2 × 1 m box given a quarter turn must
  // stick out along the OTHER axis. Every rectangle is symmetric in ±x and ±z, so a
  // handedness error is invisible here by construction — what is NOT invisible is
  // swapping which local axis carries the width, and a square fixture could never
  // have caught that.
  it('the oracle itself is right, including in the asymmetric case', () => {
    const room: Array<[number, number]> = [
      [-3, -2.5],
      [3, -2.5],
      [3, 2.5],
      [-3, 2.5],
    ];
    const at = (x: number, z: number, rot: number, dim: [number, number, number]) =>
      cornersOf([x, 0, z], rot, dim).every(([cx, cz]) => isInside(cx, cz, room));

    const box: [number, number, number] = [2000, 1000, 500];
    expect(at(0, 0, 0, box), 'centred and square-on').toBe(true);
    expect(at(0, 0, Math.PI / 2, box), 'centred and turned').toBe(true);
    // 2 m wide, centred at x = 2.5, reaches x = 3.495 — past the 3 m wall.
    expect(at(2.5, 0, 0, box), 'width sticking out east').toBe(false);
    // The same piece turned a quarter turn puts its 1 m DEPTH on that axis and
    // reaches only x = 2.995, so it fits. Swap which local axis carries width and
    // this reads false.
    expect(at(2.5, 0, Math.PI / 2, box), 'turned, so it is the depth facing east').toBe(true);
    // The mirror image on z, so neither axis is right by accident. z = 2.0 is the
    // value that separates them: the 1 m depth reaches 2.495 and fits inside the
    // 2.5 m wall, the 2 m width reaches 2.995 and does not. (Written first at 2.2,
    // where BOTH overshoot and the pair proves nothing — the oracle caught the
    // control rather than the other way round, which is the only reason to write
    // controls with real arithmetic in them.)
    expect(at(0, 2.0, Math.PI / 2, box), 'width sticking out south after the turn').toBe(false);
    expect(at(0, 2.0, 0, box), 'depth facing south, so it fits').toBe(true);
    // And the crossing-number test itself, on the notch a bounding box cannot see.
    const ell = footprintForLayout('l', 6, 5) as Array<[number, number]>;
    expect(isInside(-2, 2, ell), 'inside the L').toBe(true);
    expect(isInside(2, 2, ell), 'in the quadrant the L removes').toBe(false);
  });

  it('holds for every catalogue pair, at min / mid / max size, in every layout', () => {
    // Printed on every green run, not only on a red one: this is the measurement,
    // and a number nobody reads is not a check. `--disableConsoleIntercept` in
    // `pnpm test` is what makes it visible.
    console.log(
      `wall-rider containment: ${considered} considered, ${acceptedBefore} accepted with the exemption, ${acceptedNow} without, ${acceptedBefore - acceptedNow} withdrawn, ${escapes.length} accepted-but-outside`,
    );
    console.log(
      `   withdrawn by input rot: ${[...lossByRot.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => `${k.toFixed(2)}=${v}`)
        .join(' ')}`,
    );
    for (const e of escapes.slice(0, 20)) console.log('   ' + e);
    expect(escapes).toEqual([]);
    // **The anti-vacuity guard, and it belongs HERE.** It used to sit two blocks
    // down under a comment claiming the block above it was what needed defending,
    // which was backwards: `valid = false` for all 59,850 samples leaves `escapes`
    // empty and this assertion vacuously green, and nothing in the coverage block
    // touches `accepts` either. One line, in the block that needs it.
    expect(accepts.size, 'the sweep accepted nothing at all for some pair').toBe(PAIRS.length);
  });

  it('swept the shipping catalogue rather than whatever it happened to find', () => {
    // **LITERALS, not `PAIRS.length * ROTS.length * …`.** The derived version was
    // the first thing written here and it is an assertion that measures its own
    // subject: cut `LAYOUTS` down to the rectangular rooms and the expectation
    // shrinks with it and the file stays green — while the sweep can no longer
    // reach a single one of the placements this test exists for, all of which are
    // in an L, a T or a U.
    //
    // 42 catalogue pairs × 3 sizes × 3 angles × 7 x-targets × 5 z-targets ×
    // 5 layout ids.
    expect(PAIRS.length).toBe(42);
    expect(considered).toBe(66150);

    // …and the coverage that matters is named rather than counted, because the
    // number above is satisfiable by any five layout ids — five copies of the
    // rectangle included. Making `footprintForLayout` ignore its argument passed
    // every other assertion in this block.
    for (const layout of ['l', 't', 'u'] as const) expect(LAYOUTS).toContain(layout);
    const rooms = new Set(LAYOUTS.map((l) => JSON.stringify(footprintForLayout(l, 6, 5))));
    // FOUR, not five: `rect`, `open` and `custom` all fall through to the same
    // rectangle in `footprintForLayout`. "Five layouts" overstated the coverage by
    // a room and spent a fifth of the sample budget on a repeat — and the repeat is
    // the shape that produces zero escapes.
    expect(rooms.size, 'the five layout ids are not five distinct rooms').toBe(4);

    // Angles are NOT part of that argument, and the comment here used to claim they
    // were — that cutting `ROTS` to zero degrees would reach none of the escapes,
    // "all of which were in an L, a T or a U at an angle". Measured, the withdrawn
    // placements are spread almost evenly across the three input angles, so a
    // zero-degree sweep still reaches a large share of them. The literal above is
    // still right; half the reason written beside it was not, and a wrong scar is
    // worse than none. What the angles genuinely buy is the asymmetric case: a
    // square-on sweep cannot tell width from depth.
    expect(ROTS.some((r) => r > 0.1 && Math.abs(r - Math.PI / 2) > 0.1)).toBe(true);
    expect(lossByRot.size, 'the withdrawals came from a single angle').toBe(ROTS.length);

    // Every rider the app can produce is in the sweep. This is the assertion the
    // category-keyed version could not make, and `other/window` is the proof it was
    // needed: a wall-riding SHAPE under a category that does not ride.
    expect(RIDERS.length, 'the catalogue grew or lost a wall rider').toBe(9);
    for (const pair of ['other/window', 'tv/soundbar', 'mirror/mirror-oval', 'ac/ac-unit']) {
      expect(RIDERS.map((r) => `${r.c}/${r.s}`)).toContain(pair);
    }
    // Nothing rides a wall outside the Library. The four shapes it cannot add —
    // `closet`, `box`, `cylinder`, `plane` — carry no wall anchor of their own, and
    // every category is represented, so the catalogue is the whole population and
    // not merely a large sample of it.
    const inLibrary = new Set(PAIRS.map((p) => p.s));
    for (const s of SHAPES.filter((x) => !inLibrary.has(x))) {
      expect(ridesWall('other' as Category, s), `${s} rides a wall and is not swept`).toBe(false);
    }
    expect(CATEGORIES.every((c) => PAIRS.some((p) => p.c === c))).toBe(true);
  });

  // The positive half, and it is the half that makes the negative half mean
  // anything: `valid = false` for everything would satisfy the sweep above.
  it('still accepts wall-mounted pieces everywhere they fit', () => {
    // Both columns of the A/B, in one run. `every` is the ceiling a rider sat at
    // with the exemption — necessarily, since it made `inRoom` unconditionally true
    // for them: 3 sizes × 3 angles × 7 x-targets × 5 z-targets × 5 layout ids.
    const every = 1575;
    for (const r of RIDERS) {
      expect(acceptedWithExemption.get(`${r.c}/${r.s}`), `${r.c}/${r.s} pre-fix`).toBe(every);
    }

    // Five of the nine sit in or on the plaster and are precisely the case an
    // exemption from the polygon test would have been written for. They keep every
    // placement they had WITHOUT it: the 5 mm-per-face inset was already doing that
    // job, and a snapped rider's back is `WALL_GAP` = 20 mm off the plaster anyway.
    for (const pair of [
      'door/door',
      'ac/ac-unit',
      'mirror/mirror',
      'mirror/mirror-oval',
      'tv/soundbar',
    ] as const) {
      expect(accepts.get(pair), `${pair} lost placements it used to have`).toBe(every);
    }

    // The four that DID escape, pinned at their exact post-fix counts rather than a
    // loose floor. The floor was the weaker assertion in both directions: `> 70%`
    // passes on the unfixed build too, where all nine sit at 1575, so it could not
    // tell the two columns apart at all.
    const KEPT = {
      'curtain/curtain': 1264,
      'other/window': 1379,
      'painting/painting': 1530,
      'tv/tv': 1557,
    } as const;
    for (const [pair, n] of Object.entries(KEPT)) {
      expect(accepts.get(pair), `${pair} moved`).toBe(n);
    }

    // …and the sentence the fix is actually defended with, as two numbers measured
    // in the same run. Deleting the exemption withdraws 570 placements — 311
    // curtain, 196 window, 45 painting, 18 TV — and the point is the SECOND half:
    // **not one placement besides**. A non-rider that gains or loses a placement
    // moves these even though no line above names it, and so does a rider losing
    // one it should have kept.
    //
    // Not hypothetical: breaking the rug exemption — which touches no wall rider at
    // all — leaves the escape sweep and every per-rider pin green, and is caught by
    // these two alone.
    expect(acceptedBefore, 'the pre-fix column moved').toBe(55528);
    expect(acceptedNow, 'the fix moved something outside the nine wall riders').toBe(54958);

    // Arithmetic over the pins above, and deliberately not more than that: no source
    // mutation can reach it, because a wrong `KEPT` fails its own loop first. What
    // it guards is the PROSE — 570 is quoted in `Design.md`, in
    // `docs/what-is-still-open.md` and in `drag-resolve.ts`'s own comment, and this
    // is the line that goes red when someone re-measures the pins and leaves those
    // three saying the old number.
    expect(acceptedBefore - acceptedNow).toBe(570);
    expect(
      every * 4 -
        (KEPT['curtain/curtain'] +
          KEPT['other/window'] +
          KEPT['painting/painting'] +
          KEPT['tv/tv']),
    ).toBe(570);
  });
});

// ─── The user-visible half ──────────────────────────────────────────────────
//
// Deleting the exemption gave `valid: false` a SECOND cause, and both surfaces
// were hard-coding the sentence for the only one it used to have. For a wall rider
// `valid: false` could previously mean nothing but a collision, so "something is in
// the way" was true by construction; afterwards a curtain wider than every wall in
// the room is refused in an EMPTY room and told that something is in the way. That
// is not a missing message, it is a wrong one — it sends the user looking for an
// obstruction that does not exist — and it is reachable in three clicks, because
// `dimRangeFor('curtain','curtain').max[0]` is 5000 mm and the Inspector will put
// that in a 3 m room without a word.
describe('a refusal says which kind of refusal it is', () => {
  const rect = footprintForLayout('rect', 3, 3) as Array<[number, number]>;
  const ell = footprintForLayout('l', 6, 5) as Array<[number, number]>;
  const put = (
    part: ScenePart,
    x: number,
    z: number,
    poly: Array<[number, number]>,
    world: ScenePart[] = [part],
    rot = 0,
  ) =>
    resolvePlacement({
      part,
      rawX: x,
      rawZ: z,
      rot,
      dim: part.dimMM,
      parts: world,
      footprint: poly,
      roomHeight: H,
      snapMode: 'off',
    });

  it('names the wall when a rider is wider than the wall it landed on', () => {
    // 4 m of curtain in a 3 m room: every wall is too short, so there is nowhere
    // legal at all and the old sentence was false at every one of them.
    const curtain = mk('curtain', 'curtain', [4000, 120, 2200]);
    const r = put(curtain, 0.5, 1.2, rect);
    expect(r.valid).toBe(false);
    expect(r.refusal).toBe('wall');
    expect(refusalCause(r)).toBe('it is wider than that wall.');
  });

  it('says the room, not the wall, for a piece that does not ride one', () => {
    // The quadrant an L removes, reached diagonally: a max-size sofa whose four
    // inset corners are inside the polygon and whose CENTRE is over the void.
    const sofa = mk('sofa', 'sofa', [...dimRangeFor('sofa', 'sofa').max] as [number, number, number]);
    const r = put(sofa, 1, 1.5, ell, [sofa], Math.PI / 4);
    expect(r.valid).toBe(false);
    expect(r.refusal).toBe('room');
    expect(refusalCause(r)).toBe('it would stick out of the room.');
  });

  it('still says "in the way" when something actually is', () => {
    // The blocker is a WARDROBE, not a second sofa. A sofa dragged onto a sofa is
    // not a collision — `findSupport` stands it on top, which is legal and left this
    // assertion green against a `refusal` that never said 'blocked' at all. A 2.2 m
    // wardrobe plus an 0.8 m sofa is 3.0 m in a 2.5 m room, so there is no stacking
    // answer and the two must genuinely overlap.
    const sofa = mk('sofa', 'sofa', [2000, 900, 800]);
    const blocker = { ...mk('wardrobe', 'wardrobe', [2000, 600, 2200]), id: 'blocker', pos: [0, 0, 0] } as ScenePart;
    const r = put(sofa, 0, 0, rect, [sofa, blocker]);
    expect(r.valid).toBe(false);
    expect(r.refusal).toBe('blocked');
    expect(refusalCause(r)).toBe('something is in the way.');
  });

  it('says nothing when the placement is fine', () => {
    const chair = mk('chair', 'chair-dining', [500, 500, 850]);
    const r = put(chair, 0, 0, rect);
    expect(r.valid).toBe(true);
    expect(r.refusal).toBeUndefined();
  });

  it('prefers the room over the obstruction when both are true', () => {
    // Because leaving the room is the one the user cannot solve by moving something
    // ELSE out of the way — naming the obstruction sends them to shift a piece that
    // was never the problem.
    //
    // **The blocker's position is DERIVED, and the first version's was guessed.**
    // That version parked a sofa at a plausible-looking (0, 1.4); the curtain snaps
    // to whichever wall is nearest and went somewhere else entirely, so `collides`
    // was false and only one of the two causes ever held. It passed against a
    // mutation that reversed the precedence — a fixture that cannot express the
    // defect it guards, which is the whole reason for the two control assertions
    // below rather than a bare expectation.
    const curtain = mk('curtain', 'curtain', [4000, 120, 2200]);
    const alone = put(curtain, 0.5, 1.2, rect);
    expect(alone.refusal, 'control: the room cause holds here').toBe('wall');

    const inTheWay = {
      ...mk('wardrobe', 'wardrobe', [1200, 600, 2200]),
      id: 'blocker',
      pos: [alone.pos[0], 0, alone.pos[2]],
    } as ScenePart;
    // …and that the collision cause holds at that same spot, shown on a piece for
    // which the room cause does NOT hold, so the two are independently established
    // before their precedence is asserted.
    const chair = mk('chair', 'chair-dining', [500, 500, 850]);
    expect(
      put(chair, alone.pos[0], alone.pos[2], rect, [chair, inTheWay]).refusal,
      'control: the collision cause holds here',
    ).toBe('blocked');

    const both = put(curtain, 0.5, 1.2, rect, [curtain, inTheWay]);
    expect(both.valid).toBe(false);
    expect(both.refusal).toBe('wall');
  });
});
