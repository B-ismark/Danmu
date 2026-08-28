// What a suggestion looks like when it comes back, as distinct from what it scores.
//
// The complaint that produced this file was "clicking Suggest feels like randomising
// — items get rotated at odd angles for no reason". The score was not the problem;
// the *finish* was. Two passes run on the answer after the search, and both had a
// hole in them:
//
//   · `snapYaws` squares up anything within `SNAP_TOL` of true, and then asked the
//     full cost function for permission. Measured per degree, wall-facing costs
//     `alignment × FACING_GAIN / 180` = 0.089 while the relation term's own facing
//     gradient on the same piece is 0.10 — within 12 % of each other, so whichever
//     way a sofa's partner happened to land decided whether the sofa came back
//     square. Over twelve seeds of an eighteen-piece room, 6 of 51 moved pieces were
//     handed back at 1°, 3°, 4°, 7° and 8° off. Nobody chose those angles and nobody
//     can see why they are there.
//
//   · `openRoutes` ran AFTER the tidy and is a search like any other, so on the only
//     rooms it runs on — the ones with floor cut off from the door — the yaws the
//     user saw were the untidied ones.
//
// The property below is the one a person actually checks by looking at the room: a
// piece is square, or it is at an angle big enough to read as a decision. Nothing
// comes back three degrees off.

import { describe, it, expect } from 'vitest';
import { openRoutes, solveLayout, snapYaws } from '@/lib/layout-solve';
import {
  angleDelta,
  costBreakdown,
  navigabilityCost,
  DEFAULT_WEIGHTS,
  NAV_CELL,
  prepare,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout, footprintBounds } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

/** `SNAP_TOL` in lib/layout-solve — the band inside which an angle is not a choice.
 *  Restated rather than exported: the constant is that module's business, and a test
 *  that imported it would move whenever it moved instead of holding it to something. */
const SNAP_TOL = 0.21; // 12°

/** How far this yaw is from the nearest quarter turn, radians. */
function offSquare(yaw: number): number {
  const q = Math.PI / 2;
  const r = ((yaw % q) + q) % q;
  return Math.min(r, q - r);
}

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `p${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

/** A room with enough in it that the solver has real work to do — the seeded presets
 *  are already at a local minimum and move nothing, which would make this vacuous. */
function busyRoom(): { poly: Footprint; parts: ScenePart[] } {
  const poly = footprintForLayout('rect', 7.5, 5.6);
  const seeded = defaultScene('rect', 7.5, 5.6, { footprint: poly });
  const added: ScenePart[] = [
    part({ category: 'chair', shape: 'chair-armchair', dimMM: [800, 850, 900], pos: [-2.4, 0, 1.0], rot: Math.PI / 2, name: 'Armchair' }),
    part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 320, 1800], pos: [-3.4, 0, -1.0], rot: Math.PI / 2, name: 'Bookcase' }),
    part({ category: 'table', shape: 'side-table', dimMM: [450, 450, 550], pos: [-1.6, 0, 1.4], name: 'Side table' }),
    part({ category: 'table', shape: 'desk-standard', dimMM: [1500, 900, 750], pos: [2.3, 0, -1.2], name: 'Dining table' }),
    part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 480, 900], pos: [2.3, 0, -0.4], rot: Math.PI, name: 'Chair A' }),
    part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 480, 900], pos: [2.3, 0, -2.0], name: 'Chair B' }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1600, 600, 2100], pos: [-3.5, 0, 0.6], rot: Math.PI / 2, name: 'Wardrobe' }),
  ];
  return { poly, parts: [...seeded, ...added] };
}

describe('a suggestion never hands back a piece a few degrees off square', () => {
  const { poly, parts } = busyRoom();
  const locked = parts.map(() => false);

  it('over twelve seeds, every moved piece is square or deliberately angled', { timeout: 120_000 }, () => {
    const crooked: string[] = [];
    let movedTotal = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = solveLayout(parts, poly, locked, { seed });
      for (const i of r.moved) {
        movedTotal++;
        const off = offSquare(r.placements[i].yaw);
        // 1e-3 rad ≈ 0.06°, i.e. floating-point rather than an angle.
        if (off > 1e-3 && off < SNAP_TOL) {
          crooked.push(`seed ${seed}: ${parts[i].name} at ${((off * 180) / Math.PI).toFixed(1)}° off square`);
        }
      }
    }
    // The room has to actually be worked on, or this passes by moving nothing.
    expect(movedTotal, 'the fixture must give the solver something to do').toBeGreaterThan(20);
    expect(crooked, crooked.join('\n')).toEqual([]);
  });

  it('still allows an angle big enough to be a decision', { timeout: 60_000 }, () => {
    // The tidy must not be a blanket quantiser: `SNAP_TOL` is the whole distinction
    // between residue and intent, and a pass that squared everything would be just
    // as wrong in the other direction. A chair angled 45° toward a sofa is a thing a
    // person does, and nothing here may undo it.
    const r = solveLayout(parts, poly, locked, { seed: 4 });
    // Every other sweep in this file counts what it examined; this one did not, so
    // an empty `moved` would have run the loop zero times and passed having
    // asserted nothing at all. The sibling guard above covers seeds 1–12
    // collectively, which says nothing about seed 4 on its own.
    expect(r.moved.length, 'seed 4 must actually move something').toBeGreaterThan(0);
    for (const i of r.moved) {
      const off = offSquare(r.placements[i].yaw);
      expect(off === 0 || off <= 1e-3 || off >= SNAP_TOL, `${parts[i].name}`).toBe(true);
    }
  });
});

// ─── A route-opening move can say that is what it did ───────────────────────
//
// `navigation` was missing from `TERMS`, and `explain` scored with the term switched
// off — `costBreakdown` defaults it off for the annealer's sake, and nobody passed a
// cell. So its gain was zero for every move and the term could never be credited even
// after it was listed. The one pass that exists solely to reconnect a stranded part
// of the room could not name what it had done, and the sentence the user reads named
// whichever taste term happened to shift instead.
//
// The fixture is a room with a NECK, and that is deliberate rather than convenient.
// `explain` works by putting one piece back and asking which term got worse, so a
// move is only creditable to navigation when that single piece is the plug. Seven
// chairs strung across an open rectangle also cut the room, but no one of them
// re-seals it on its own — the credit is collective and this method cannot see it,
// which is a real limit of the explanation and not a bug in it.
const ALCOVE: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 0],
  [0.7, 0],
  [0.7, 2],
  [-0.7, 2],
  [-0.7, 0],
  [-3, 0],
];

/** A chest parked across the 1.4 m neck, sealing the alcove off from the only door. */
function pluggedRoom(): ScenePart[] {
  return [
    part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true, name: 'Door' }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1300, 500, 900], pos: [0, 0, 0.3], name: 'Chest' }),
  ];
}

describe('a route-opening move can say that is what it did', () => {
  const navOf = (parts: ScenePart[], at: Placement[]) => {
    const ctx: LayoutContext = { parts, movable: parts.map((p) => !p.wallMounted), footprint: ALCOVE };
    return navigabilityCost(prepare(ctx), at, NAV_CELL);
  };
  const at = (parts: ScenePart[]) => parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));

  it('scores the room as cut before it starts', () => {
    const parts = pluggedRoom();
    expect(navOf(parts, at(parts)), 'the fixture must actually strand some floor').toBeGreaterThan(0);
  });

  it('credits the move to navigation rather than to a taste term', () => {
    const parts = pluggedRoom();
    const r = solveLayout(parts, ALCOVE, parts.map((p) => !!p.wallMounted), { seed: 1 });
    expect(r.moved.length, 'a sealed alcove is worth rearranging').toBeGreaterThan(0);
    expect(r.moves.some((m) => m.term === 'navigation')).toBe(true);
  });

  it('and the answer is genuinely less cut than what it was given', () => {
    const parts = pluggedRoom();
    const r = solveLayout(parts, ALCOVE, parts.map((p) => !!p.wallMounted), { seed: 1 });
    expect(navOf(parts, r.placements)).toBeLessThan(navOf(parts, at(parts)));
    // …on the FINE grid. `openRoutes` optimises a coarse proxy because it is paid per
    // proposal, and its own doc comment claimed the answer was re-checked against the
    // real grid before being kept. It was not: it returned whatever the proxy found,
    // so it could spend the search and hand back something the fine grid scores worse.
    const ctx: LayoutContext = { parts, movable: parts.map((p) => !p.wallMounted), footprint: ALCOVE };
    expect(costBreakdown(prepare(ctx), r.placements, undefined, NAV_CELL).total).toBeLessThanOrEqual(r.before);
  });
});

// ─── …and it does not tidy furniture the user angled themselves ─────────────
//
// The fix above put a second `snapYaws` after `pruneMoves`, and that inverted which
// pass has the last word. `SNAP_TOL` is 12°, `TURN_EPSILON` is 2.9°, and the band
// between them is a real one: 8° is what a rotate drag leaves, it is inside the
// tidy's reach, and it is outside "unchanged". The prune deliberately hands such a
// piece back at the user's own angle — zero displacement makes it the cheapest
// revert it can buy — and an unscoped tidy squared it again on the way out.
//
// Measured on the preset below at 8°, over eight seeds: `moved` reported 7 pieces
// where 2 had moved. The other five stood exactly where the user left them with
// their angle normalised, and `explain` gave each of them a sentence about the space
// it had freed up. So the property is not "nothing is squared" — the tidy still has
// work to do on what the search moved — it is that a piece which did not move is not
// reported as having moved.
describe('a suggestion leaves alone what it did not move', () => {
  const TURN_EPSILON = 0.05; // lib/layout-solve — 2.9°, the angle below which a turn is not a turn.
  const TILT = (8 * Math.PI) / 180; // inside SNAP_TOL, outside TURN_EPSILON: a user's own tilt.

  /** The busy room with every piece nudged off square, as a rotate drag leaves it.
   *  Busy rather than the bare preset because the preset is already at a local
   *  minimum and reports one move a seed — too few for the absence of a phantom to
   *  mean much. Here the solver has real work, and the phantoms had room to appear. */
  function tiltedRoom(): { poly: Footprint; parts: ScenePart[] } {
    const { poly, parts } = busyRoom();
    return { poly, parts: parts.map((p) => (p.wallMounted ? p : { ...p, rot: p.rot + TILT })) };
  }

  it('over eight seeds, nothing is reported as moved that only got squared up', { timeout: 120_000 }, () => {
    const { poly, parts } = tiltedRoom();
    const locked = parts.map(() => false);
    const phantom: string[] = [];
    let movedTotal = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = solveLayout(parts, poly, locked, { seed });
      for (const i of r.moved) {
        movedTotal++;
        const from = { x: parts[i].pos[0], z: parts[i].pos[2], yaw: parts[i].rot };
        const to = r.placements[i];
        const d = Math.hypot(to.x - from.x, to.z - from.z);
        const turn = Math.abs(((to.yaw - from.yaw + Math.PI) % (2 * Math.PI)) - Math.PI);
        // Stayed put, and the only thing that changed is that its tilt is gone.
        if (d <= 0.02 && turn > TURN_EPSILON && offSquare(to.yaw) <= 1e-3) {
          phantom.push(
            `seed ${seed}: ${parts[i].name} stayed put (${(d * 1000).toFixed(0)} mm) and was turned ` +
              `${((turn * 180) / Math.PI).toFixed(1)}° onto square`,
          );
        }
      }
    }
    expect(movedTotal, 'the fixture must give the solver something to report').toBeGreaterThan(8);
    expect(phantom, phantom.join('\n')).toEqual([]);
  });

  it('and the user’s own tilt survives on a piece the solve left where it was', { timeout: 120_000 }, () => {
    // The other half of the same property, and the one that fails if the fix is
    // written as "skip the second tidy entirely": a piece the search did not move
    // must come back at the angle it went in at, not at the nearest right angle.
    const { poly, parts } = tiltedRoom();
    const locked = parts.map(() => false);
    const r = solveLayout(parts, poly, locked, { seed: 1 });
    const untouched = parts
      .map((_, i) => i)
      .filter((i) => !parts[i].wallMounted && !r.moved.includes(i));
    expect(untouched.length, 'some piece must be left alone for this to say anything').toBeGreaterThan(0);
    for (const i of untouched) {
      expect(
        Math.abs(offSquare(r.placements[i].yaw) - TILT),
        `${parts[i].name} came back at ${((offSquare(r.placements[i].yaw) * 180) / Math.PI).toFixed(1)}° off square`,
      ).toBeLessThan(1e-6);
    }
  });
});

// ─── The finish passes, on a room that actually needs them ──────────────────
//
// Everything above runs on a tidy room. A mutation battery over the whole suite —
// 227 tests, run by a second reviewer against this commit — found four changes to
// the finish passes that nothing went red for, and all four share a cause: the rooms
// under test were never cut, so `openRoutes` never ran, and the passes that exist to
// clean up after it were being asked to prove themselves on their day off.
//
// The fixture below is a U with every movable piece thrown into the bounding box at
// a random angle by a fixed LCG. It is deliberately not a solve seed: the scramble
// has to be identical on every branch for a number measured here to mean anything,
// and `solveLayout`'s own rng is an implementation detail. On it, `openRoutes` runs
// on all 24 seeds.
function scrambledU(): { poly: Footprint; parts: ScenePart[] } {
  const poly = footprintForLayout('u', 7.5, 5.6);
  const b = footprintBounds(poly);
  const r = lcg(99);
  const parts = defaultScene('u', 7.5, 5.6, { footprint: poly }).map((p) =>
    p.wallMounted
      ? p
      : {
          ...p,
          pos: [b.minX + r() * (b.maxX - b.minX), 0, b.minZ + r() * (b.maxZ - b.minZ)] as [number, number, number],
          rot: r() * Math.PI * 2,
        },
  );
  return { poly, parts };
}

/** A generator of its own, so the scramble is a property of this file rather than of
 *  whatever `solveLayout` happens to use. Numerical Recipes' LCG constants. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('the finish passes on a room that was cut', () => {
  const { poly, parts } = scrambledU();
  const locked = parts.map(() => false);
  const results = Array.from({ length: 24 }, (_, k) => solveLayout(parts, poly, locked, { seed: k + 1 }));

  it('runs the repair pass on every seed — otherwise the rest of this says nothing', () => {
    // `openRoutes` is gated on the room being cut before it starts. If this fixture
    // stopped being cut, the three assertions below would go green by never
    // exercising the code they name, which is the exact failure they were written
    // for.
    expect(results.every((r) => r.breakdownBefore.navigation > 0)).toBe(true);
    expect(results.reduce((n, r) => n + r.moved.length, 0)).toBeGreaterThan(100);
  });

  it('still hands back nothing a few degrees off square that it could have squared', () => {
    // The tidy after the repair. Deleting that second pass leaves 12 crooked pieces
    // across these 24 seeds — the residue of a search that runs after the first tidy
    // has already gone. A room that is never cut cannot show this at all.
    //
    // ── Why this is not simply "nothing comes back crooked" ────────────────────
    //
    // Because the tidy is allowed to fail, and refusing is sometimes the right
    // answer: `snapYaws` will not take a snap that makes a hard term worse, so a bed
    // 11° off square whose square position would push it through a wall is supposed
    // to stay at 11°. The first version of this assertion could not tell that apart
    // from the pass not running, and went red the first time an unrelated change
    // moved the fixture by a few centimetres — which is a test reporting on its
    // fixture rather than on the code.
    //
    // So each crooked survivor is re-judged here against the same veto, rebuilt from
    // the public cost function rather than by calling back into the pass being
    // tested. A piece is a finding only if squaring it would have cost nothing.
    const HARD = ['overlap', 'outside', 'door', 'access', 'navigation'] as const;
    const ctx: LayoutContext = { parts, movable: parts.map((p) => !p.wallMounted), footprint: poly };
    const model = prepare(ctx);
    const crooked: string[] = [];
    for (let k = 0; k < results.length; k++) {
      const at = results[k].placements;
      for (const i of results[k].moved) {
        const off = offSquare(at[i].yaw);
        if (off <= 1e-3 || off >= SNAP_TOL) continue;
        const q = Math.PI / 2;
        const squared = at.map((pl, j) => (j === i ? { ...pl, yaw: Math.round(pl.yaw / q) * q } : pl));
        const before = costBreakdown(model, at, DEFAULT_WEIGHTS, NAV_CELL);
        const after = costBreakdown(model, squared, DEFAULT_WEIGHTS, NAV_CELL);
        const refused = HARD.find((t) => after[t] > before[t] + 1e-6);
        if (!refused) {
          crooked.push(`seed ${k + 1}: ${parts[i].name} at ${((off * 180) / Math.PI).toFixed(1)}° off square, for nothing`);
        }
      }
    }
    expect(crooked, crooked.join('\n')).toEqual([]);
  });

  it('and does not square up the pieces it was right to leave angled', () => {
    // The other direction: "still allows an angle big enough to be a decision"
    // asserts *square or ≥ SNAP_TOL*, which a pass that squared everything also
    // satisfies, so it cannot see a blanket quantiser. This counts the other side of
    // the band — that some real angle SURVIVED a solve.
    //
    // Be honest about its reach, because the comment here used to overclaim: this
    // did NOT go red when `|| off > SNAP_TOL` was deleted from `snapYaws`. Over
    // eight seeds the solver still hands back some piece at a deliberate angle it
    // never had the chance to square, so the count stays above zero. What actually
    // kills that mutation is `a piece turned 45° off square comes back at 45°` in
    // the last describe, which calls `snapYaws` directly on a piece it MUST leave
    // alone. Both are worth having — this one covers the end-to-end path — but the
    // mutation guarantee belongs to the direct test, and saying otherwise here is
    // how a decoration assertion gets believed.
    const angled = results.flatMap((r, k) =>
      r.moved.filter((i) => offSquare(r.placements[i].yaw) >= SNAP_TOL).map((i) => `seed ${k + 1}: ${parts[i].name}`),
    );
    expect(angled.length, 'the tidy must leave real angles alone').toBeGreaterThan(0);
  });
});

// ─── The tidy's veto, held to what it claims ────────────────────────────────
//
// `snapYaws` refuses a snap that makes any hard term worse, and `navigation` is in
// that set because squaring a piece can close the gap its tilt was leaving open —
// cutting part of the room off from the door in the name of neatness. Two mutations
// of that machinery were green across 227 tests: dropping `'navigation'` from
// `HARD_TERMS`, and passing `guardRoutes: false`. Neither is observable through
// `solveLayout`, which reports one total for a layout three passes downstream, so
// the pass is called directly here.
//
// Measured over the 400 scrambles below: without the guard, 63 of them come out of
// the tidy with *more* of the room cut off than went in. The largest single step is
// 0.25 → 0.31. Small in cost units and not small in meaning — that is floor with no
// route to the door, created by a pass whose entire remit is cosmetic.
describe('squaring a piece up never cuts the room off', () => {
  const poly = footprintForLayout('u', 7.5, 5.6);
  const b = footprintBounds(poly);
  const base = defaultScene('u', 7.5, 5.6, { footprint: poly });
  const ctx: LayoutContext = { parts: base, movable: base.map((p) => !p.wallMounted), footprint: poly };
  const model = prepare(ctx);

  /** Scattered, but with yaws near a right angle — `snapYaws` only acts inside
   *  `SNAP_TOL`, so a uniformly random angle would leave it with nothing to do. */
  function scatter(seed: number): Placement[] {
    const r = lcg(seed);
    return base.map((p) =>
      p.wallMounted
        ? { x: p.pos[0], z: p.pos[2], yaw: p.rot }
        : {
            x: b.minX + r() * (b.maxX - b.minX),
            z: b.minZ + r() * (b.maxZ - b.minZ),
            yaw: Math.round(r() * 4) * (Math.PI / 2) + (r() - 0.5) * 0.36,
          },
    );
  }

  it('over 400 scattered layouts, the tidy never leaves more floor stranded', { timeout: 300_000 }, () => {
    const worse: string[] = [];
    let acted = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const before = scatter(seed);
      const after = snapYaws(model, before, DEFAULT_WEIGHTS, true, null);
      if (after.some((p, i) => Math.abs(angleDelta(p.yaw, before[i].yaw)) > 1e-9)) acted++;
      const n0 = navigabilityCost(model, before, NAV_CELL);
      const n1 = navigabilityCost(model, after, NAV_CELL);
      if (n1 > n0 + 1e-6) worse.push(`seed ${seed}: ${n0.toFixed(2)} -> ${n1.toFixed(2)}`);
    }
    expect(acted, 'the tidy must actually be squaring things up here').toBeGreaterThan(200);
    expect(worse, worse.join('\n')).toEqual([]);
  });
});

// ─── The repair pass does not spend the search and hand back something worse ──
//
// `openRoutes` optimises a COARSE proxy (`REPAIR_CELL`, 0.1 m) because navigation is
// paid per proposal, and its own doc comment claimed the answer was re-checked on the
// real grid before being kept. It was not — it returned whatever the proxy found. The
// only guard downstream is `after >= before`, which compares against the layout the
// USER had, not against the good answer this pass was handed, so a repair could
// regress and nothing would notice.
//
// The property is `openRoutes`' own — *its answer is never worse on the fine grid
// than its input* — and it is invisible from `solveLayout`, which reports one total
// for a layout two passes downstream. So the pass is called directly, which is why it
// is exported.
//
// The fixture had to be hunted for. The two grids agree almost always: over 1512 cut
// layouts (three room shapes × three sizes × 60 scrambles × 6 repair seeds) the
// re-check refused the proxy's answer exactly once. That once is the fixture below.
// A version of this test written without the search was green against a build with
// the re-check deleted, which is the failure this one exists not to repeat.
describe('the repair pass is re-checked on the grid the room report reads', () => {
  const poly = footprintForLayout('u', 7.5, 5.6);
  const b = footprintBounds(poly);
  const base = defaultScene('u', 7.5, 5.6, { footprint: poly });
  const ctx: LayoutContext = { parts: base, movable: base.map((p) => !p.wallMounted), footprint: poly };
  const model = prepare(ctx);
  const bounds = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
  const fine = (p: Placement[]) => costBreakdown(model, p, DEFAULT_WEIGHTS, NAV_CELL).total;

  /** The one layout in 1512 where the coarse proxy and the fine grid disagree.
   *
   *  Found by search, and the search is the point: three room shapes × three sizes ×
   *  60 scrambles × 6 repair seeds, keeping only the cut ones, and the guard rejected
   *  the proxy's answer exactly once. Both constants below are that search's
   *  coordinates and neither is meaningful on its own. */
  const LAYOUT_SEED = 35 * 2654435761;
  const REPAIR_SEED = 35 * 31 + 6;

  function scattered(): Placement[] {
    const r = lcg(LAYOUT_SEED);
    return base.map((p) =>
      p.wallMounted
        ? { x: p.pos[0], z: p.pos[2], yaw: p.rot }
        : {
            x: b.minX + r() * (b.maxX - b.minX),
            z: b.minZ + r() * (b.maxZ - b.minZ),
            yaw: r() * Math.PI * 2,
          },
    );
  }

  it('this fixture is one the repair pass actually runs on', () => {
    // Gated on the room being cut on the FINE grid before it starts, so a fixture
    // that stopped being cut would make the assertion below vacuous rather than red.
    expect(navigabilityCost(model, scattered(), NAV_CELL)).toBeGreaterThan(0);
  });

  it('and its answer is never worse on the fine grid than what it was given', () => {
    const at = scattered();
    const out = openRoutes(model, at, DEFAULT_WEIGHTS, bounds, lcg(REPAIR_SEED));
    expect(fine(out)).toBeLessThanOrEqual(fine(at));
  });

  it('…on a fixture where the proxy really does hand back something worse', () => {
    // Without this, the test above passes on any input the proxy happens to improve,
    // which is 1511 of the 1512 searched. What makes this one worth freezing is that
    // the coarse answer is *rejected* here: `openRoutes` returns its input by
    // identity, and the only path that does so after the search has run is the
    // fine-grid re-check. Delete that re-check and this is the assertion that goes
    // red — the whole reason the search was run.
    const at = scattered();
    const out = openRoutes(model, at, DEFAULT_WEIGHTS, bounds, lcg(REPAIR_SEED));
    expect(out, 'the proxy’s answer must be the one being refused here').toBe(at);
  });
});

// ─── An angle big enough to be a decision is not the tidy's to remove ────────
//
// `SNAP_TOL` is the entire distinction between an annealer's residue and a choice: a
// chair turned 45° toward a sofa is a thing a person does. Deleting `|| off > SNAP_TOL`
// makes the pass a blanket quantiser, and that mutation was green across 227 tests —
// including the test named *"still allows an angle big enough to be a decision"*,
// which asserts *square or ≥ SNAP_TOL* and so is satisfied by squaring everything.
//
// Counting angled survivors of a solve does not catch it either: the hard-term veto
// refuses enough of the blanket's snaps that a handful still come back angled. So the
// pass is called directly, on one piece, at an angle nothing could mistake for noise.
describe('the tidy leaves a deliberate angle alone', () => {
  // One small piece, alone in the middle of a big room, with a door on the far wall.
  // Deliberately minimal: a preset fixture let the mutation survive, because the
  // hard-term veto refused the blanket snap on its own account and the test could not
  // tell that apart from `SNAP_TOL` doing its job. Here nothing else is close enough
  // for any hard term to have an opinion, so the only thing that can preserve the
  // angle is the band.
  const poly = footprintForLayout('rect', 8, 6);
  const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -3], wallMounted: true, name: 'Door' });
  const stool = part({ category: 'chair', shape: 'ottoman', dimMM: [400, 400, 450], pos: [0, 0, 0], name: 'Ottoman' });
  const parts = [door, stool];
  const ctx: LayoutContext = { parts, movable: parts.map((p) => !p.wallMounted), footprint: poly };
  const model = prepare(ctx);
  const at = (yaw: number): Placement[] => [
    { x: 0, z: -3, yaw: 0 },
    { x: 0, z: 0, yaw },
  ];

  it('a piece turned 45° off square comes back at 45°', () => {
    const out = snapYaws(model, at(Math.PI / 4), DEFAULT_WEIGHTS, true, null);
    expect(
      offSquare(out[1].yaw),
      `the ottoman came back ${((offSquare(out[1].yaw) * 180) / Math.PI).toFixed(1)}° off square`,
    ).toBeCloseTo(Math.PI / 4, 9);
  });

  it('…and one a few degrees off still gets squared up', () => {
    // The other half, so the test above cannot be satisfied by a pass that does
    // nothing at all — which is the shape of over-correction that would follow from
    // reading it alone. Same fixture, same call: the only difference is the angle.
    const out = snapYaws(model, at(0.14), DEFAULT_WEIGHTS, true, null); // 8°
    expect(offSquare(out[1].yaw)).toBeLessThan(1e-9);
  });
});
