import { describe, expect, it } from 'vitest';
import { defaultScene, PART_LIBRARY } from '../lib/scene-spec';
import { footprintForLayout, offsetWall, pointInFootprint, type Footprint, type LayoutId } from '../lib/footprint';
import { LAYOUT_IDS } from '../lib/storage';
import { footFromPart, footInsidePoly, footIntersectionArea, footArea, distToBoundary, nearestEdge, obbGap } from '../lib/geometry';
import { isObstacle, relationFor, roleOf, sharesFloor, WALK_MIN } from '../lib/layout-rules';
import { analyzeRoom } from '../lib/clearance';
import { anchorFor, ridesWall, verticalExtent } from '../lib/physics';
import { solveLayout } from '../lib/layout-solve';
import {
  costBreakdown,
  navigabilityCost,
  prepare,
  DEFAULT_WEIGHTS,
  NAV_CELL,
  angleDelta,
  type LayoutContext,
  type Placement,
} from '../lib/layout-score';
import type { ScenePart } from '../lib/scene-spec';

/** Where a part already is, as a placement. */
const here = (p: ScenePart): Placement => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot });

// The starter furniture a brand-new room opens with. It is the FIRST thing anyone
// sees of this product, and until this file existed it was hand-authored against the
// bounding rectangle while the room is a polygon — so the L-shape's whole reading
// nook (armchair, side table) and its floor lamp were placed in the quadrant the L
// cuts away, i.e. standing outside the room in mid-air. Five of nine pieces. The U
// put the bed and both nightstands in its north notch; the T put the sofa, coffee
// table and rug off the side of its stem.
//
// The presets are the ones app/onboarding/layout-pick offers, dimensions included: a
// seed that is only correct at ROOM's default size is not correct.
const PRESETS: Array<{ id: LayoutId; w: number; d: number }> = [
  { id: 'rect', w: 6.0, d: 4.0 },
  { id: 'l', w: 6.0, d: 4.7 },
  { id: 't', w: 5.5, d: 4.7 },
  { id: 'u', w: 6.0, d: 5.0 },
  { id: 'open', w: 7.5, d: 5.6 },
];

const HEIGHT = 2.8;

/** Every part whose footprint is not wholly inside the room, named.
 *
 *  Corner-exact (`footInsidePoly`), NOT `outsideShare`. This test used to ask the
 *  sampled question and passed while the T-shape's coffee table stood 20 mm inside
 *  the plaster: the share's outermost samples sit 10% in from the edges, so a small
 *  overhang is invisible to it. A containment test that cannot see a 20 mm overhang
 *  is not a containment test. */
function escaped(parts: ReturnType<typeof defaultScene>, poly: Footprint): string[] {
  return parts
    .filter((p) => !p.wallMounted)
    .filter((p) => !footInsidePoly(footFromPart(p.pos, p.rot, p.dimMM, p.circle), poly))
    .map((p) => `${p.name} @ ${p.pos[0].toFixed(2)},${p.pos[2].toFixed(2)}`);
}

/** Pairs sharing floor they have no business sharing. */
function clashes(parts: ReturnType<typeof defaultScene>): string[] {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (!isObstacle(parts[i])) continue;
    for (let j = i + 1; j < parts.length; j++) {
      if (!isObstacle(parts[j])) continue;
      if (sharesFloor(roleOf(parts[i]), roleOf(parts[j]))) continue;
      const a = footFromPart(parts[i].pos, parts[i].rot, parts[i].dimMM, parts[i].circle);
      const b = footFromPart(parts[j].pos, parts[j].rot, parts[j].dimMM, parts[j].circle);
      if (footIntersectionArea(a, b) / Math.min(footArea(a), footArea(b)) > 0.02) {
        out.push(`${parts[i].name} × ${parts[j].name}`);
      }
    }
  }
  return out;
}

/** The top of every ceiling-anchored piece each preset seeds, measured at HEIGHT = 2.8.
 *
 *  **A defect written down, not a specification.** `t` and `open` seed a 400 mm pendant
 *  and its top is 2.850 in a 2.8 m room — 50 mm through the slab. `groundY`'s `ceiling`
 *  branch is `max(roomHeight - 0.15, h)`, which hangs the CENTRE 150 mm below the
 *  ceiling, so anything taller than 300 mm passes through it.
 *
 *  Same defect `ANCHOR_BY_CATEGORY` already records for curtains — a 2.6 m curtain's
 *  centre at 2.55 m put most of the cloth through the ceiling, which is why a curtain is
 *  `wall-high` and not `ceiling`. A 400 mm pendant is a smaller instance, 50 mm rather
 *  than most of it.
 *
 *  Invisible until the mount flag was derived: the seeder set the pendant
 *  `wallMounted: false` by hand, so nothing measured it as centred geometry at all.
 *  `buildSceneFromRoom` does not have this problem — it ends on `settleHeights`, whose
 *  ceiling clamp catches exactly this — so it is `defaultScene` alone.
 *
 *  Not fixed with the flag: `groundY` is read by the add path, the detection builder,
 *  the Inspector and `heightForNewCeiling`, and `tests/scene-build.test.ts` pins two of
 *  those against each other on a fan's height. That is a change with its own
 *  measurements. */
const CEILING_TOPS: Record<string, string[]> = {
  rect: [],
  l: [],
  t: ['Pendant=2.850'],
  u: [],
  open: ['Pendant=2.850'],
};

describe.each(PRESETS)('starter scene · $id', ({ id, w, d }) => {
  const poly = footprintForLayout(id, w, d);
  const parts = defaultScene(id, w, d, { footprint: poly, height: HEIGHT });

  it('furnishes the room', () => {
    expect(parts.length).toBeGreaterThan(3);
    expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
    expect(parts.every((p) => p.locked === false)).toBe(true);
  });

  it('keeps every part inside the room', () => {
    expect(escaped(parts, poly)).toEqual([]);
  });

  it('puts every WALL RIDER on a wall', () => {
    // **`ridesWall`, not `wallMounted`, and the old title was the tell.** It said
    // "wall-mounted" while the assertion said "on a wall", which are two different
    // questions: `wallMounted` is "is this piece's geometry centred on its origin"
    // (`anchorFor(...) !== 'floor'`) and it is TRUE for a ceiling fan and a pendant,
    // which ride no wall and belong in the middle of the ceiling. `ridesWall` is the
    // narrow one — the `wall-*` anchors and only those — and it is what "on a wall"
    // means. `lib/physics.ts` documents the distinction and this filter had not read it.
    //
    // It passed because the seeder set the pendant `wallMounted: false` by hand, which
    // was itself the defect: its `pos[1]` was a mesh centre while its flag said
    // floor-standing. Deriving the flag turned the pendant mounted and this test red on
    // exactly the two presets that seed one — `t` and `open`. The test was right to go
    // red and its predicate was the thing that was wrong.
    const riders = parts.filter((x) => ridesWall(x.category, x.shape));
    expect(riders.length, 'a starter room has doors and windows, so there are riders').toBeGreaterThan(0);
    for (const p of riders) {
      expect(pointInFootprint(p.pos[0], p.pos[2], poly)).toBe(true);
      expect(distToBoundary(poly, p.pos[0], p.pos[2])).toBeLessThan(0.2);
    }
  });

  it('hangs every ceiling piece inside the room, and does NOT ask it to touch a wall', () => {
    // The other half, so narrowing the filter above loses nothing. A fan or a pendant
    // still has to be over real floor — `placeNewPart`'s `ceilingSpot` tests the bounds
    // midpoint against the polygon precisely because the middle of an L's bounding box
    // is the corner it cuts away — but requiring it near a wall is what the old
    // predicate accidentally did, and it is wrong for this family.
    for (const p of parts.filter((x) => anchorFor(x.category, x.shape) === 'ceiling')) {
      expect(pointInFootprint(p.pos[0], p.pos[2], poly), `${p.name} hangs outside the room`).toBe(true);
    }
  });

  // FOUND BY THE ASSERTION BELOW, WHICH IS PARKED RATHER THAN WEAKENED.
  //
  // The starter scene's pendant pokes **50 mm through the ceiling**: `groundY`'s
  // `ceiling` branch is `max(roomHeight - 0.15, h)`, which hangs the piece's CENTRE
  // 150 mm below the slab, so anything taller than 300 mm has its top above it. The
  // pendant is 400 mm, giving `[2.45, 2.85]` in a 2.8 m room.
  //
  // It is the same defect `ANCHOR_BY_CATEGORY` already records for curtains — "that
  // branch hangs a small thing just under the slab, which for a 2.6 m curtain put its
  // CENTRE at 2.55 m and most of the cloth through the ceiling" — which is why a
  // curtain is `wall-high` and not `ceiling`. A 400 mm pendant is a smaller instance of
  // it, 50 mm rather than most of the cloth.
  //
  // Invisible until now because the seeder set the pendant `wallMounted: false` by
  // hand, so nothing measured it as centred geometry at all; deriving the flag is what
  // exposed it. `buildSceneFromRoom` does NOT have this problem — it ends on
  // `settleHeights`, whose ceiling clamp catches exactly this — so it is `defaultScene`
  // alone, and the fix is either `groundY`'s ceiling branch or a settle pass on the
  // preset path.
  //
  // NOT fixed here on purpose: `groundY` is read by the add path, the detection
  // builder, the Inspector and `heightForNewCeiling`, and `tests/scene-build.test.ts`
  // pins two paths against each other on a fan's height. That is a change with its own
  // measurements, not a line to slip into this one. `it.fails` so it retires itself the
  // moment someone fixes it.
  it('records the ceiling overhang each preset has TODAY — baseline, not a specification', () => {
    // Pinned exactly and in BOTH directions rather than as a `<=` bar, so fixing
    // `groundY` turns this red and whoever does it comes back and deletes the baseline.
    // A bar would sit green through the fix and nobody would re-derive.
    //
    // Not `it.fails`: only `t` and `open` seed a pendant, so on the other three presets
    // the strict assertion PASSES and `it.fails` then reports a failure of its own. A
    // per-preset literal says which presets have the defect, which is more than the
    // strict form could.
    const tops = parts
      .filter((x) => anchorFor(x.category, x.shape) === 'ceiling')
      .map((p) => `${p.name}=${verticalExtent(p.category, p.shape, p.dimMM, p.pos[1])[1].toFixed(3)}`);
    expect(tops).toEqual(CEILING_TOPS[id]);
    // …and the room's own ceiling, so the numbers above can be read against something.
    expect(HEIGHT).toBe(2.8);
  });

  it('does not put two pieces in the same place', () => {
    expect(clashes(parts)).toEqual([]);
  });

  it('opens with a room the report finds no fault in', () => {
    // Every preset seeds clean — no errors AND no warnings. This is stricter than it
    // has to be on purpose: a starter room is the app arguing that its own rules are
    // satisfiable, and the way a shallow preset gets there is by choosing DIFFERENT
    // furniture (a 43″ set, a table against the wall seating three), never by
    // shrinking a piece. If a change here has to accept a warning, that is a trade-off
    // worth making deliberately rather than discovering in the panel.
    const { issues } = analyzeRoom(parts, { footprint: poly, height: HEIGHT });
    expect(issues.map((i) => `${i.severity}: ${i.detail}`)).toEqual([]);
  });

  it('puts every piece within the band of the thing it belongs to', () => {
    // Read through `relationFor`, so the bar is whatever `layout-rules` currently says
    // rather than a number copied next to it — the same reason `clearance.ts` and
    // `layout-score.ts` both read that table instead of restating it.
    //
    // The regression this exists for was one piece and two cost terms. The living
    // group's floor lamp listed the ENDS OF THE WALL before the spots beside the sofa,
    // and the end fit, so the lamp took it: 2.75 m from the seat it lights, against a
    // 0–0.7 m band. On the L that was 3.7–5.0 of a 6.63 relation cost AND the whole of
    // a 2.34 window cost, because the far end of that wall is where the window is. It
    // made the biggest single move Suggest could offer on a brand-new room — which is
    // the app shipping a room and then immediately offering to fix it.
    const solid = parts.filter((q) => !q.wallMounted);
    const bad: string[] = [];
    for (const a of solid) {
      for (const b of solid) {
        if (a === b) continue;
        const rel = relationFor(a, b);
        // Only the bands that mean "beside" — a `faces` band across a room is a
        // viewing distance, and its far end is a legitimate place to be.
        if (!rel || rel.kind !== 'beside' || rel.max > 1) continue;
        const gap = obbGap(
          footFromPart(a.pos, a.rot, a.dimMM, a.circle),
          footFromPart(b.pos, b.rot, b.dimMM, b.circle),
        );
        // Discharged by its BEST anchor, so one in range is enough — see
        // `relationOptions`. Collect, then check for any that found none.
        if (gap <= rel.max) bad.push(`OK:${a.id}:${rel.specId}`);
        else bad.push(`MISS:${a.id}:${rel.specId}:${gap.toFixed(2)}m>${rel.max}m`);
      }
    }
    const owed = new Set(bad.map((e) => e.split(':').slice(1, 3).join(':')));
    const met = new Set(bad.filter((e) => e.startsWith('OK')).map((e) => e.split(':').slice(1, 3).join(':')));
    expect([...owed].filter((k) => !met.has(k))).toEqual([]);
  });

  it('leaves most of the floor free to walk on', () => {
    const { freeFloorShare } = analyzeRoom(parts, { footprint: poly, height: HEIGHT });
    expect(freeFloorShare).toBeGreaterThan(0.6);
  });

  it('seeds an arrangement the solver also thinks is good', () => {
    // The report being quiet is necessary and not sufficient: it says nothing about
    // the gradients — a rug owing a group it is nowhere near, a sofa off its wall, a
    // piece facing the plaster — and those are what a user sees when Suggest then
    // moves eight pieces on a brand-new room. The seeder never called `costBreakdown`,
    // so it could not know: the shipped costs were 43.1 for the L and 85.5 for the T,
    // which is a starter room the app's own solver considers broken.
    //
    // A ceiling rather than an exact figure, so ordinary tuning does not fail it and a
    // regression of that size cannot pass. Measured after the fixes: 4.8, 24.7, 16.9,
    // 4.9, 13.4 — and after the seeder started SEARCHING (§3.10.3 part VI): 4.8, 14.7,
    // 5.5, 4.9, 13.4, with the T gaining a piece as well as losing two thirds of its
    // cost. The ceiling comes down with them; 40 would now pass a room that had lost
    // everything the search buys.
    //
    // …and again after `wallDebt` stopped charging a finished back for a gap that is
    // a route: 2.2, 10.8, 1.6, 4.9, 8.8. The open plan was 13.1 of which 11.5 was one
    // sofa standing where the seeder had deliberately put it.
    //
    // …and again once a seeded seat was TURNED toward its group and not merely put at
    // the right distance from it: 2.2, 4.4, 1.6, 4.9, 8.8. Only the L moved, because
    // only the L seeds a second seat, and 5.1 of its 10.8 was that one chair's heading.
    const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
    const cost = costBreakdown(prepare(ctx), parts.map(here), DEFAULT_WEIGHTS, NAV_CELL);
    expect(cost.total).toBeLessThan(10);
  });

  it('seeds an arrangement the solver then leaves alone', () => {
    // The strongest form of the test above, and the one a user actually performs:
    // open a brand-new room, press Suggest, and see whether the app immediately
    // rearranges what it just gave you. A cost ceiling permits a room that is cheap
    // overall and still has one piece the solver can obviously improve — which is
    // what every preset but `rect` had, and what `open` got its own describe block
    // for before all five could pass this.
    //
    // Not `moves.length` — the moves themselves, so a failure names the piece.
    for (let seed = 1; seed <= 6; seed++) {
      const r = solveLayout(parts, poly, parts.map(() => false), { seed });
      expect(
        r.moves.map((m) => `${parts[m.index].name} ${(m.distance * 1000).toFixed(0)}mm via ${m.term}`),
        `${id} seed ${seed}`,
      ).toEqual([]);
    }
  }, 60_000);

  it('seeds a room you can walk all of', () => {
    // Read on the room report's OWN grid, so this and rule 9 cannot disagree. They
    // did: at a coarser cell the T read 2.02 m² stranded and the report read none.
    const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
    expect(navigabilityCost(prepare(ctx), parts.map(here), NAV_CELL)).toBe(0);
  });

  it('states every rotation in the principal range', () => {
    // `place` composes a rotation as `frame.yaw + turn`, and a frame on the −π wall
    // plus any turn away from the room leaves that range: the L's armchair came out
    // at −188°, which is the right rotation written wrong and which `PlanChrome`
    // would have printed at the user as it stood.
    for (const part of parts) {
      expect(Math.abs(part.rot), `${part.name} rot`).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it('seeds the same room every time it is asked', () => {
    // The seeder now BUILDS SEVERAL ROOMS and keeps the best (§3.10.3 part VI), so
    // "deterministic" stopped being free the moment the answer came out of a search:
    // an unstable sort, a `Map` iterated for its keys, or a tie broken by insertion
    // order would each show up here and nowhere else. A room that reseeds differently
    // on its second open is not a room the user can trust.
    const key = (ps: ScenePart[]) =>
      ps.map((p) => `${p.id}@${p.pos.map((v) => v.toFixed(6)).join(',')}/${p.rot.toFixed(6)}`).join('|');
    const again = defaultScene(id, w, d, { footprint: poly, height: HEIGHT });
    expect(key(again)).toBe(key(parts));
  });
});

// Each preset promises something on the layout-pick screen ("Starts as a bedroom").
// Keeping the furniture inside the room by placing less of it would pass every test
// above, so the promise gets its own.
describe('starter scene keeps the preset’s promise', () => {
  const seed = (id: LayoutId, w: number, d: number) =>
    defaultScene(id, w, d, { footprint: footprintForLayout(id, w, d), height: HEIGHT });

  it('a rectangle is a living room', () => {
    const cats = seed('rect', 6, 4).map((p) => p.category);
    expect(cats).toContain('sofa');
    expect(cats).toContain('tv');
    expect(cats).toContain('table');
  });

  it('an L gets its reading nook in the wing', () => {
    const parts = seed('l', 6, 4.7);
    const nook = parts.find((p) => p.shape === 'chair-armchair');
    expect(nook).toBeDefined();
    // The wing is the south-west of this footprint; the living group is the north
    // band. The armchair belongs in the wing, not tucked behind the sofa.
    expect(nook!.pos[2]).toBeGreaterThan(0);
    expect(parts.some((p) => p.shape === 'bookshelf')).toBe(true);
  });

  it('keeps a reading nook out of the route into it', () => {
    // The L's wing opens off the leg, so the nook's default end was the shared edge
    // and the armchair landed 250 mm behind the sofa's back — across the only way
    // from one half of the room to the other. It was invisible because the pinch rule
    // exempted every RELATED pair, and an armchair facing a sofa is a relation.
    const parts = seed('l', 6, 4.7);
    const sofa = parts.find((p) => p.category === 'sofa')!;
    const chair = parts.find((p) => p.shape === 'chair-armchair')!;
    const gap = obbGap(
      footFromPart(sofa.pos, sofa.rot, sofa.dimMM, sofa.circle),
      footFromPart(chair.pos, chair.rot, chair.dimMM, chair.circle),
    );
    expect(gap).toBeGreaterThanOrEqual(WALK_MIN);
  });

  it('a T and an open plan both get a dining set', () => {
    for (const [id, w, d] of [
      ['t', 5.5, 4.7],
      ['open', 7.5, 5.6],
    ] as const) {
      const parts = seed(id, w, d);
      expect(parts.filter((p) => p.shape === 'chair-dining').length).toBeGreaterThanOrEqual(2);
      expect(parts.some((p) => p.shape === 'sofa')).toBe(true);
    }
  });

  it('seats the sofa inside its screen’s comfortable viewing band', () => {
    // Derived from the screen, not asserted as a distance: `layout-rules` puts
    // comfortable viewing at 1.2–2.5 × the diagonal, and this is the seed agreeing
    // with the room report by construction rather than by luck.
    for (const { id, w, d } of PRESETS) {
      const parts = seed(id, w, d);
      const tv = parts.find((p) => p.category === 'tv');
      const sofa = parts.find((p) => p.category === 'sofa');
      if (!tv || !sofa) continue;
      const diag = Math.hypot(tv.dimMM[0], tv.dimMM[2]) / 1000;
      const dist = Math.hypot(tv.pos[0] - sofa.pos[0], tv.pos[2] - sofa.pos[2]);
      expect(dist).toBeGreaterThanOrEqual(diag * 1.2 - 0.05);
      expect(dist).toBeLessThanOrEqual(diag * 2.5 + 0.05);
    }
  });

  it('chooses a smaller catalog screen for a shallow room, never a scaled one', () => {
    const shallow = seed('t', 5.5, 4.7).find((p) => p.category === 'tv')!;
    const roomy = seed('rect', 6, 4).find((p) => p.category === 'tv')!;
    // The T's living bay is 2.6 m deep and cannot seat anyone 2 m from a 65″ panel.
    expect(shallow.dimMM[0]).toBeLessThan(roomy.dimMM[0]);
    // Both are real products the catalog offers — the whole distinction between
    // choosing a smaller SET and drawing a big one small.
    for (const screen of [shallow, roomy]) {
      expect(PART_LIBRARY.some((l) => l.shape === 'tv' && l.dimMM.join() === screen.dimMM.join())).toBe(true);
    }
  });

  it('gives the living group the bay with the viewing depth, not the biggest one', () => {
    // The T's bar is the larger bay (11.6 m² against 6.3) and the shallower one
    // (2.1 m against 2.6). Assigning by area put the sofa 1.6 m from the screen while
    // the deeper stem — which needs no viewing distance to seat people at a table —
    // got the dining set. The bar is north of the origin's z, the stem south.
    const parts = seed('t', 5.5, 4.7);
    expect(parts.find((p) => p.category === 'sofa')!.pos[2]).toBeGreaterThan(0);
    expect(parts.filter((p) => p.shape === 'chair-dining').every((c) => c.pos[2] < 0)).toBe(true);
  });

  it('seats four at the dining table by choosing a wall that can, not by wedging one in', () => {
    // This test used to assert THREE, and the reasoning was sound as far as it went:
    // 900 mm of pull-back on both long sides needs 2.6 m of depth, the T's bar has
    // 2.1, so a table centred there leaves 630 mm on each side. Against one wall with
    // three sides that work is what `layout-rules` means by `atLeast: 3`, and the
    // fourth chair was refused rather than wedged into the plaster — which is rule 2,
    // and still is.
    //
    // What was wrong was treating that as the end of the matter. The seeder was
    // choosing the wall greedily and then making the best of it; once `enumeratePlans`
    // could try the bay's fourth side too (`PLAN_RANKS`), it found a plan that seats
    // four with the table clear of every wall — and that plan also scores 1.6 against
    // the three-chair one's 5.5, with a sixteenth piece placed and no clearance
    // finding. Four chairs was the right answer all along; the way to get there was a
    // better plan, never a laxer fit test.
    const parts = seed('t', 5.5, 4.7);
    expect(parts.filter((p) => p.shape === 'chair-dining')).toHaveLength(4);
    // …and all four sit AT it — one per side, which is what four chairs means.
    const table = parts.find((p) => p.name === 'Dining table')!;
    for (const c of parts.filter((p) => p.shape === 'chair-dining')) {
      expect(Math.hypot(c.pos[0] - table.pos[0], c.pos[2] - table.pos[2])).toBeLessThan(1.1);
    }
  });

  it('a U is a bedroom', () => {
    const parts = seed('u', 6, 5);
    expect(parts.some((p) => p.category === 'bed')).toBe(true);
    expect(parts.filter((p) => p.category === 'nightstand')).toHaveLength(2);
    expect(parts.some((p) => p.category === 'wardrobe')).toBe(true);
  });
});

// ─── What the seed looks like to the room report ────────────────────────────
//
// `escaped()` above filters `!p.wallMounted`, so the one class of piece it cannot
// see is the one that hangs ON a wall — and a wall-rider wider than its wall is
// exactly how § H.16 got written. `clearance.ts`'s `outside` rule has no such
// exemption, so this sweep sees what that helper is blind to.
//
// Run over every layout id at four sizes, which is the measurement that decided
// whether the rule was safe to ship: it fires on pieces nobody dragged, so it
// re-judges every seeded room in existence the moment it lands.

describe('no preset opens with a piece outside its own room', () => {
  const SIZES: Array<[number, number]> = [
    [3.0, 2.4],
    [4.5, 3.6],
    [6.0, 4.0],
    [7.5, 5.6],
  ];

  function sweep() {
    const rows: Array<{ where: string; severity: string; what: string }> = [];
    let rooms = 0;
    let parts = 0;
    for (const id of LAYOUT_IDS) {
      for (const [w, d] of SIZES) {
        const room = { footprint: footprintForLayout(id, w, d), height: HEIGHT };
        const ps = defaultScene(id, w, d, room);
        rooms++;
        parts += ps.length;
        for (const i of analyzeRoom(ps, room).issues) {
          if (i.rule !== 'outside') continue;
          const p = ps.find((q) => q.id === i.partIds[0])!;
          rows.push({
            where: `${id} ${w}×${d}`,
            severity: i.severity,
            what: `${p.category}/${p.shape} ${p.dimMM[0]} mm @ ${p.pos[0].toFixed(2)},${p.pos[2].toFixed(2)}`,
          });
        }
      }
    }
    return { rows, rooms, parts };
  }

  it('never stands one off the floor plan altogether', () => {
    const { rows, rooms, parts } = sweep();
    // Printed on every green run, which is what `--disableConsoleIntercept` is for:
    // a drifting baseline should be visible without reading a diff.
    console.log(`
  seeded rooms ${rooms}, parts ${parts}, outside findings ${rows.length}`);
    for (const r of rows) console.log(`    ${r.where.padEnd(12)} ${r.severity.padEnd(5)} ${r.what}`);

    expect(rooms, 'the sweep found no rooms to judge').toBe(LAYOUT_IDS.length * SIZES.length);
    expect(parts, 'the sweep found no furniture to judge').toBeGreaterThan(200);
    // `error` is centre-out: no floor under the middle of the piece. A shipped
    // preset may never do that at any size, and nothing here does.
    expect(rows.filter((r) => r.severity === 'error')).toEqual([]);
  });

  it('and the two that overhang are the ones already measured', () => {
    // Pinned as a DECISION rather than left to a floor, because both directions
    // matter. These two are real — a 1450 mm TV on the 1.2 m wall of a 3.0 × 2.4 L
    // and of the same T, overhanging both ends — so the rule's first act is to
    // report a defect the SEEDER still creates. § H.16 fixed dragging a rider past
    // the end of its wall; it did not fix seeding one, and `placeNewPart` has no
    // legality test at all.
    //
    // A red here in the LOW direction is the good news, and the fix is to delete the
    // row rather than to widen the bar: it means somebody taught the seeder to pick
    // a screen that fits the wall it chose, the way it already picks a smaller one
    // for a shallow room.
    const { rows } = sweep();
    expect(rows.map((r) => `${r.where} ${r.severity} ${r.what.split(' @ ')[0]}`)).toEqual([
      'l 3×2.4 warn tv/tv 1450 mm',
      't 3×2.4 warn tv/tv 1450 mm',
    ]);
  });
});

describe('starter scene in a room that is not a preset', () => {
  it('follows a wall the user has dragged', () => {
    // `moveWall` leaves the room OFF-CENTRE, which is exactly what the old
    // `±width/2` seed could not express: it furnished a rectangle centred on the
    // origin that the room no longer was.
    const poly = offsetWall(footprintForLayout('rect', 5, 4), 1, 2.5);
    const parts = defaultScene('custom', 7.5, 4, { footprint: poly, height: HEIGHT });
    expect(parts.length).toBeGreaterThan(3);
    expect(escaped(parts, poly)).toEqual([]);
    expect(clashes(parts)).toEqual([]);
  });

  it('places less rather than resizing anything, in a room too small for a sofa', () => {
    // 1.6 × 1.4 m. A 2.2 m sofa does not fit and is not shrunk to fit — this is the
    // dimension-trust rule stated as a layout: fewer pieces, all of them real.
    const poly = footprintForLayout('rect', 1.6, 1.4);
    const parts = defaultScene('rect', 1.6, 1.4, { footprint: poly, height: HEIGHT });
    expect(escaped(parts, poly)).toEqual([]);
    expect(clashes(parts)).toEqual([]);
    expect(parts.some((p) => p.shape === 'sofa')).toBe(false);
    for (const p of parts) {
      // Nothing has been quietly scaled to fit. A smaller room may get a smaller
      // SCREEN — a different product — but every piece placed carries the exact
      // dimensions of a catalog entry, to the millimetre.
      if (p.shape === 'plant') expect(p.dimMM).toEqual([400, 400, 1600]);
      if (p.shape === 'tv') {
        expect(PART_LIBRARY.some((l) => l.shape === 'tv' && l.dimMM.join() === p.dimMM.join())).toBe(true);
      }
    }
  });

  it('survives a degenerate footprint', () => {
    expect(defaultScene('custom', 1, 1, { footprint: [[0, 0], [0.1, 0]] as Footprint })).toEqual([]);
  });
});

describe('the open plan keeps the route it was seeded with', () => {
  // The one preset `Suggest` would not leave alone. `living()` puts a walkway rather
  // than a wall gap behind the sofa when another group sits on the far side of that
  // edge — that is what an open plan IS — and says so. `layout-score`'s wall term then
  // charged 12 per metre for the same gap, which was 11.53 of the preset's whole 13.08.
  // So the solver pulled the sofa 0.27-0.53 m back in at every seed and stopped there,
  // leaving a route too tight to walk down and too wide to read as flush.
  //
  // Two consumers of one rule, each with its own copy — CLAUDE.md rule 3 — so the
  // number moved to `wallDebt` in `layout-rules` and both read it.
  const W = 7.5;
  const D = 5.6;
  const poly = footprintForLayout('open', W, D);
  const parts = defaultScene('open', W, D);

  /** Gap between a piece's back and the wall behind it, metres. */
  function backGap(p: ScenePart, at: Placement): number {
    const f = footFromPart([at.x, p.pos[1], at.z], at.yaw, p.dimMM, p.circle);
    const e = nearestEdge(poly, f.cx, f.cz);
    if (!e) return Infinity;
    const c = Math.cos(f.rot);
    const sn = Math.sin(f.rot);
    return e.dist - (Math.abs(c * e.nx - sn * e.nz) * f.hw + Math.abs(sn * e.nx + c * e.nz) * f.hd);
  }

  const sofaIdx = parts.findIndex((p) => roleOf(p) === 'sofa');

  it('seeds a walkway behind the sofa, not a wall gap', () => {
    expect(sofaIdx).toBeGreaterThanOrEqual(0);
    expect(backGap(parts[sofaIdx], here(parts[sofaIdx]))).toBeGreaterThanOrEqual(WALK_MIN);
  });

  it('is left alone by the solver, at every seed', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = solveLayout(parts, poly, parts.map(() => false), { seed });
      // Not just 'the sofa did not move' — nothing in the room did. A starter room
      // the app's own solver immediately rearranges is a starter room that was wrong.
      expect(r.moves, `seed ${seed}`).toEqual([]);
      expect(backGap(parts[sofaIdx], r.placements[sofaIdx]), `seed ${seed}`).toBeGreaterThanOrEqual(
        WALK_MIN,
      );
    }
  }, 60_000);
});

describe('a seeded seat is turned toward the group it belongs to', () => {
  // `relationCost` charges a `faces` relation TWICE — once for the gap, once for the
  // heading, `2 × angleCost` — and the seeder only ever answered the first. On the L
  // that was the WHOLE of its relation cost: the armchair sat 2.355 m from the sofa
  // inside a 1.2–2.6 m band, i.e. dead centre, and was still charged 0.479 for sitting
  // square to its own wall with the sofa 43° off its nose. `Suggest` could then only
  // answer the way it did — by shoving a chair that was already in the right place, up
  // to 735 mm, on every seed — because distance was the only lever the seed had left it.
  //
  // Asserted as GEOMETRY, not by recomputing the cost here. A test carrying its own
  // copy of `relationCost` is the second consumer CLAUDE.md rule 3 is about, and it
  // would pass a seeder that had drifted in exactly the same direction.
  const W = 6.0;
  const D = 4.7;
  const poly = footprintForLayout('l', W, D);
  const parts = defaultScene('l', W, D, { footprint: poly, height: HEIGHT });
  const chairIdx = parts.findIndex((p) => roleOf(p) === 'armchair');
  const sofaIdx = parts.findIndex((p) => roleOf(p) === 'sofa');

  it('seeds the L with both a reading chair and a sofa', () => {
    // The premise of everything below. A preset that stopped placing one of them would
    // otherwise make the rest of this file vacuously green.
    expect(chairIdx).toBeGreaterThanOrEqual(0);
    expect(sofaIdx).toBeGreaterThanOrEqual(0);
  });

  it('aims the chair at the sofa, not at whatever its own wall faced', () => {
    const chair = parts[chairIdx];
    const sofa = parts[sofaIdx];
    // three.js' convention, the one `lib/geometry` states: a part's front is
    // (sin rot, cos rot), so the heading that points at a target is atan2(dx, dz).
    const bearing = Math.atan2(sofa.pos[0] - chair.pos[0], sofa.pos[2] - chair.pos[2]);
    // 15°, not 0: `placeSomewhere` takes the first spot that FITS, and the turn it
    // carries aims at the group from THAT spot, so a chair nudged by `settleParts`
    // ends a few degrees off. 43° is the failure this exists for.
    expect(Math.abs(angleDelta(chair.rot, bearing))).toBeLessThan((15 * Math.PI) / 180);
  });

  it('is a chair the solver leaves alone, at every seed', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = solveLayout(parts, poly, parts.map(() => false), { seed });
      expect(
        r.moves.map((m) => m.index),
        `seed ${seed}`,
      ).not.toContain(chairIdx);
    }
  }, 60_000);
});
