import { describe, expect, it } from 'vitest';
import { defaultScene, PART_LIBRARY } from '../lib/scene-spec';
import { footprintForLayout, offsetWall, pointInFootprint, type Footprint, type LayoutId } from '../lib/footprint';
import { footFromPart, footInsidePoly, footIntersectionArea, footArea, distToBoundary, obbGap } from '../lib/geometry';
import { isObstacle, roleOf, sharesFloor, WALK_MIN } from '../lib/layout-rules';
import { analyzeRoom } from '../lib/clearance';
import {
  costBreakdown,
  navigabilityCost,
  prepare,
  DEFAULT_WEIGHTS,
  NAV_CELL,
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

  it('puts every wall-mounted part on a wall', () => {
    for (const p of parts.filter((x) => x.wallMounted)) {
      expect(pointInFootprint(p.pos[0], p.pos[2], poly)).toBe(true);
      expect(distToBoundary(poly, p.pos[0], p.pos[2])).toBeLessThan(0.2);
    }
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
    // 4.9, 13.4.
    const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
    const cost = costBreakdown(prepare(ctx), parts.map(here), DEFAULT_WEIGHTS, NAV_CELL);
    expect(cost.total).toBeLessThan(40);
  });

  it('seeds a room you can walk all of', () => {
    // Read on the room report's OWN grid, so this and rule 9 cannot disagree. They
    // did: at a coarser cell the T read 2.02 m² stranded and the report read none.
    const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: poly };
    expect(navigabilityCost(prepare(ctx), parts.map(here), NAV_CELL)).toBe(0);
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

  it('pushes a shallow room’s dining table to the wall and seats three at it', () => {
    // 900 mm of pull-back on both long sides needs 2.6 m of depth; the T's bar has
    // 2.1. One end against the wall and three sides that work is what `layout-rules`
    // means by `atLeast: 3`, and the fourth chair is not placed rather than being
    // wedged into the plaster.
    const parts = seed('t', 5.5, 4.7);
    expect(parts.filter((p) => p.shape === 'chair-dining')).toHaveLength(3);
  });

  it('a U is a bedroom', () => {
    const parts = seed('u', 6, 5);
    expect(parts.some((p) => p.category === 'bed')).toBe(true);
    expect(parts.filter((p) => p.category === 'nightstand')).toHaveLength(2);
    expect(parts.some((p) => p.category === 'wardrobe')).toBe(true);
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
