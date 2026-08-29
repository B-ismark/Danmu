import { describe, it, expect } from 'vitest';
import {
  costBreakdown,
  scoreLayout,
  navigabilityCost,
  NAV_CELL,
  prepare,
  relationParents,
  DEFAULT_WEIGHTS,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { HARD_TERMS, isWorthOffering, lockedForSolve, solveLayout } from '@/lib/layout-solve';
import { analyzeRoom } from '@/lib/clearance';
import { footprintBounds } from '@/lib/footprint';
import { footprintForLayout } from '@/lib/footprint';
import { defaultScene } from '@/lib/scene-spec';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

const at = (parts: ScenePart[]): Placement[] =>
  parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));

function ctxOf(parts: ScenePart[], locked: boolean[] = []): LayoutContext {
  return { parts, movable: parts.map((_, i) => !locked[i]), footprint: RECT };
}

const sofa = () => part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
const table = () => part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [0, 0, 0] });
const diningTable = () => part({ category: 'table', shape: 'coffee-table', dimMM: [1400, 800, 750], pos: [0, 0, 0] });
const wardrobe = () => part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0] });

describe('scoreLayout', () => {
  it('costs two pieces in the same place more than anything else', () => {
    const parts = [sofa(), wardrobe()];
    const ctx = ctxOf(parts);
    const apart = scoreLayout(ctx, [
      { x: -2, z: 1.4, yaw: 0 },
      { x: 2, z: -1.6, yaw: 0 },
    ]);
    const same = scoreLayout(ctx, [
      { x: 0, z: 0, yaw: 0 },
      { x: 0, z: 0, yaw: 0 },
    ]);
    expect(same).toBeGreaterThan(apart * 10);
  });

  it('costs a piece hanging out of the room', () => {
    const parts = [sofa()];
    const ctx = ctxOf(parts);
    const inside = scoreLayout(ctx, [{ x: 0, z: 1.4, yaw: 0 }]);
    const half = scoreLayout(ctx, [{ x: 3, z: 1.4, yaw: 0 }]);
    expect(half).toBeGreaterThan(inside + DEFAULT_WEIGHTS.outside * 0.3);
  });

  it('prefers a wardrobe against a wall, facing into the room', () => {
    const parts = [wardrobe()];
    const ctx = ctxOf(parts);
    // North wall is at z = −2 and its inward normal points to +z, so yaw 0 faces
    // in. Compare against the same spot turned to face the plaster.
    const facingIn = scoreLayout(ctx, [{ x: 0, z: -1.7, yaw: 0 }]);
    const facingWall = scoreLayout(ctx, [{ x: 0, z: -1.7, yaw: Math.PI }]);
    const marooned = scoreLayout(ctx, [{ x: 0, z: 0, yaw: 0 }]);
    expect(facingIn).toBeLessThan(facingWall);
    expect(facingIn).toBeLessThan(marooned);
  });

  it('prefers a table nearer the middle than jammed against a wall', () => {
    const parts = [table()];
    const ctx = ctxOf(parts);
    expect(scoreLayout(ctx, [{ x: 0, z: 0, yaw: 0 }])).toBeLessThan(
      scoreLayout(ctx, [{ x: 0, z: -1.6, yaw: 0 }]),
    );
  });

  it('does not fine a chair for being tucked under a table', () => {
    // A DINING table — 750 mm high, which is what "tucked under" means. A dining
    // chair standing in a 420 mm coffee table is a collision, and the rules now
    // tell the two apart by height rather than treating every table alike.
    const t = diningTable();
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850], pos: [0, 0, 0] });
    const ctx = ctxOf([t, chair]);
    const tucked = scoreLayout(ctx, [
      { x: 0, z: 0, yaw: 0 },
      { x: 0, z: 0.35, yaw: Math.PI },
    ]);
    // Which it certainly would be if the overlap term applied: the same overlap
    // between two pieces that do NOT tuck is orders of magnitude dearer.
    const w = wardrobe();
    const clash = scoreLayout(ctxOf([t, w]), [
      { x: 0, z: 0, yaw: 0 },
      { x: 0, z: 0.35, yaw: Math.PI },
    ]);
    expect(clash).toBeGreaterThan(tucked * 5);
  });

  it('costs a gap you cannot walk through, and neither a flush one nor a clear one', () => {
    const a = sofa();
    const b = wardrobe();
    const m = prepare(ctxOf([a, b]));
    // Wardrobe back at z −2, front at −1.4. The sofa's back edge is 475 mm behind
    // its centre, so z −0.925 is flush against the wardrobe, −0.7 leaves 225 mm,
    // and 0.5 leaves well over a walkway.
    const walkwayAt = (z: number) =>
      costBreakdown(m, [
        { x: 0, z, yaw: 0 },
        { x: 0, z: -1.7, yaw: 0 },
      ]).walkway;

    // On the TERM, not on the total. Two pieces flush is also a wardrobe whose doors
    // are completely blocked, and the access term says so far more loudly than the
    // walkway term ever could — so a total-based comparison here was measuring the
    // wrong rule, and only passed while the solver policed a wider walkway (900 mm)
    // than the room report ever reports (600 mm). Those two are one number now.
    expect(walkwayAt(-0.925)).toBe(0); // flush is deliberate composition
    expect(walkwayAt(-0.7)).toBeGreaterThan(0); // 225 mm is the pinch
    expect(walkwayAt(0.5)).toBe(0); // and past a walkway there is nothing to say
  });

  it('wants seating to face the television, at a sensible distance', () => {
    const tv = part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.3, -1.95], wallMounted: true });
    const s = sofa();
    const ctx = ctxOf([tv, s]);
    const facing = scoreLayout(ctx, [
      { x: 0, z: -1.95, yaw: 0 },
      { x: 0, z: 1.2, yaw: Math.PI },
    ]);
    const backTurned = scoreLayout(ctx, [
      { x: 0, z: -1.95, yaw: 0 },
      { x: 0, z: 1.2, yaw: 0 },
    ]);
    expect(facing).toBeLessThan(backTurned);
  });
});

describe('solveLayout', () => {
  /** A deliberately bad room: everything piled in one corner. */
  function messyRoom() {
    return [
      part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [-1.8, 0, -1.3], rot: 0.4 }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [-1.4, 0, -1.0], rot: 1.1 }),
      part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [-1.6, 0, -1.5], rot: 0.2 }),
      part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [-1.2, 0, -1.6], rot: 0.9 }),
    ];
  }

  it('improves the arrangement it was given', () => {
    const parts = messyRoom();
    const r = solveLayout(parts, RECT, parts.map(() => false), { seed: 3, steps: 2500 });
    expect(r.after).toBeLessThan(r.before);
    // A pile of four pieces in one corner is nearly all overlap cost, so the
    // improvement should be dramatic rather than marginal.
    expect(r.after).toBeLessThan(r.before * 0.5);
    expect(r.moved.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = solveLayout(messyRoom(), RECT, [false, false, false, false], { seed: 11, steps: 1200 });
    const b = solveLayout(messyRoom(), RECT, [false, false, false, false], { seed: 11, steps: 1200 });
    expect(b.placements).toEqual(a.placements);
    expect(b.after).toBe(a.after);
  });

  it('gives a different arrangement for a different seed', () => {
    const a = solveLayout(messyRoom(), RECT, [false, false, false, false], { seed: 1, steps: 1200 });
    const b = solveLayout(messyRoom(), RECT, [false, false, false, false], { seed: 2, steps: 1200 });
    expect(b.placements).not.toEqual(a.placements);
  });

  it('never touches a locked piece', () => {
    const parts = messyRoom();
    const locked = [true, false, false, false];
    const r = solveLayout(parts, RECT, locked, { seed: 5, steps: 1200 });
    expect(r.placements[0]).toEqual({ x: parts[0].pos[0], z: parts[0].pos[2], yaw: parts[0].rot });
    expect(r.moved).not.toContain(0);
  });

  it('never touches a wall-mounted piece', () => {
    const parts = [
      part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.3, -1.95], wallMounted: true }),
      ...messyRoom(),
    ];
    const r = solveLayout(parts, RECT, parts.map(() => false), { seed: 7, steps: 1200 });
    expect(r.placements[0]).toEqual({ x: 0, z: -1.95, yaw: 0 });
  });

  it('never changes a dimension', () => {
    // The invariant that keeps this inside the trust boundary. The result carries
    // positions and yaws and has no field a size could travel in — this asserts
    // the input objects are not mutated either.
    const parts = messyRoom();
    const before = parts.map((p) => [...p.dimMM]);
    solveLayout(parts, RECT, parts.map(() => false), { seed: 9, steps: 800 });
    expect(parts.map((p) => [...p.dimMM])).toEqual(before);
  });

  it('leaves a room with nothing movable alone', () => {
    const parts = messyRoom();
    const r = solveLayout(parts, RECT, parts.map(() => true), { seed: 4, steps: 800 });
    expect(r.moved).toEqual([]);
    expect(r.after).toBe(r.before);
    expect(r.placements).toEqual(at(parts));
  });

  it('pulls furniture out of a wall it was overlapping', () => {
    const parts = [
      part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [2.8, 0, 0], rot: 0 }),
    ];
    const r = solveLayout(parts, RECT, [false], { seed: 2, steps: 2000 });
    const p = r.placements[0];
    // Half a 2.2 m sofa is 1.1 m, so its centre cannot be past 1.9 m from the
    // middle on x without hanging out of a 6 m room.
    expect(Math.abs(p.x)).toBeLessThan(2.6);
  });
});

// ─── What "Suggest" was accused of, as tests ────────────────────────────────
//
// The complaint was that it moved things at random. Three separate causes, each
// pinned here: doors were invisible to the cost function, the functional zones the
// room report checks were not in it either, and nothing charged for movement — so
// every run returned a different local minimum whether or not it was better.

const RECT_ROOM = { footprint: RECT, height: 2.6 };

const doorPart = (x = 0, z = -1.975, rot = 0) =>
  part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [x, 1.05, z], rot, wallMounted: true });

/** A deliberately bad room: everything piled in one corner. */
function messy() {
  return [
    part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [-1.8, 0, -1.3], rot: 0.4 }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [-1.4, 0, -1.0], rot: 1.1 }),
    part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [-1.6, 0, -1.5], rot: 0.2 }),
    part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [-1.2, 0, -1.6], rot: 0.9 }),
  ];
}

describe('doors are part of the room', () => {
  it('will not leave a bed across the doorway', () => {
    const d = doorPart();
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, -0.9] });
    const r = solveLayout([d, bed], RECT, [false, false], { seed: 1, steps: 3000 });
    const moved = {
      ...bed,
      pos: [r.placements[1].x, 0, r.placements[1].z] as [number, number, number],
      rot: r.placements[1].yaw,
    };
    // The room report is the independent judge here: it was raising this error on
    // the solver's own output, which is what made the two disagreeing a bug rather
    // than a matter of taste.
    const issues = analyzeRoom([d, moved], RECT_ROOM).issues;
    expect(issues.find((i) => i.id.startsWith('door-'))).toBeUndefined();
    expect(r.after).toBeLessThan(r.before);
  });

  it('costs a blocked door in the same tier as a collision', () => {
    const d = doorPart();
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, 0] });
    const ctx = ctxOf([d, bed]);
    const across = scoreLayout(ctx, [at([d])[0], { x: 0, z: -0.9, yaw: 0 }]);
    const clear = scoreLayout(ctx, [at([d])[0], { x: 0, z: 1.0, yaw: 0 }]);
    expect(across).toBeGreaterThan(clear + DEFAULT_WEIGHTS.door * 0.2);
  });

  it('keeps the way in clear, not just the swing', () => {
    // A sofa a metre inside the door leaves the leaf free to swing and still means
    // you cannot walk in. No pairwise gap rule can see that.
    const d = doorPart();
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
    const ctx = ctxOf([d, sofa]);
    const blocking = scoreLayout(ctx, [at([d])[0], { x: 0, z: -1.0, yaw: 0 }]);
    const aside = scoreLayout(ctx, [at([d])[0], { x: 0, z: 1.5, yaw: Math.PI }]);
    expect(blocking).toBeGreaterThan(aside);
  });

  it('does not move the door itself', () => {
    const d = doorPart();
    const parts = [d, ...messy()];
    const r = solveLayout(parts, RECT, parts.map(() => false), { seed: 6, steps: 1200 });
    expect(r.placements[0]).toEqual({ x: d.pos[0], z: d.pos[2], yaw: 0 });
  });
});

describe('functional zones', () => {
  it('wants a wardrobe’s doors to be openable', () => {
    const w = wardrobe();
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, 0] });
    const ctx = ctxOf([w, bed]);
    // Wardrobe back to the north wall, front at z = −1.4.
    const blocked = scoreLayout(ctx, [{ x: 0, z: -1.7, yaw: 0 }, { x: 0, z: -0.5, yaw: 0 }]);
    const clear = scoreLayout(ctx, [{ x: 0, z: -1.7, yaw: 0 }, { x: 0, z: 0.9, yaw: 0 }]);
    expect(blocked).toBeGreaterThan(clear);
  });

  it('wants a double bed to have both sides, and forgives a single one side', () => {
    const dbl = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, 0] });
    const sgl = part({ category: 'bed', shape: 'bed-single', dimMM: [900, 2000, 600], pos: [0, 0, 0] });
    // Hard into the west wall, so the left side is gone in both cases.
    const cornered = (p: ScenePart) => scoreLayout(ctxOf([p]), [{ x: -3 + p.dimMM[0] / 2000, z: 0, yaw: 0 }]);
    const middle = (p: ScenePart) => scoreLayout(ctxOf([p]), [{ x: 0, z: 0, yaw: 0 }]);
    expect(cornered(dbl) - middle(dbl)).toBeGreaterThan(cornered(sgl) - middle(sgl));
  });

  it('does not fine a nightstand for being where a nightstand goes', () => {
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, 0] });
    const stand = part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0] });
    const ctx = ctxOf([bed, stand]);
    const beside = scoreLayout(ctx, [{ x: 0, z: 0, yaw: 0 }, { x: 1.03, z: -0.7, yaw: 0 }]);
    const marooned = scoreLayout(ctx, [{ x: 0, z: 0, yaw: 0 }, { x: 2.5, z: 1.6, yaw: 0 }]);
    expect(beside).toBeLessThan(marooned);
  });

  it('keeps something tall out of a window and lets something low stay', () => {
    const win = part({
      category: 'other',
      shape: 'window',
      dimMM: [1400, 60, 1200],
      pos: [0, 1.5, -1.98],
      wallMounted: true,
    });
    const tall = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2100], pos: [0, 0, 0] });
    const low = part({ category: 'ottoman', shape: 'ottoman', dimMM: [1200, 600, 420], pos: [0, 0, 0] });
    // Both placements are against a wall and facing into the room, so the only
    // thing that differs between them is which wall — the one with the window in
    // it, or the one opposite.
    const inFront = (p: ScenePart) => scoreLayout(ctxOf([win, p]), [at([win])[0], { x: 0, z: -1.68, yaw: 0 }]);
    const away = (p: ScenePart) => scoreLayout(ctxOf([win, p]), [at([win])[0], { x: 0, z: 1.68, yaw: Math.PI }]);
    // The sill is at 0.9 m: the wardrobe crosses it, the ottoman does not.
    expect(inFront(tall)).toBeGreaterThan(away(tall));
    expect(inFront(low) - away(low)).toBeLessThan(inFront(tall) - away(tall));
  });
});

describe('it leaves alone what was already right', () => {
  it('barely touches a room that is already sensible', () => {
    // Bed head to the north wall, nightstand touching it at the head end, wardrobe
    // back to the south wall with its doors into the room, door clear of all three.
    const parts = [
      doorPart(-2),
      part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0.9, 0, -1.0], rot: 0 }),
      part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [-0.15, 0, -1.7] }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1400, 600, 2100], pos: [-2, 0, 1.68], rot: Math.PI }),
    ];
    const r = solveLayout(parts, RECT, parts.map(() => false), { seed: 2, steps: 2500 });
    // Not "nothing moved" — the solver is allowed to find something better. But it
    // must not rearrange a working room wholesale for a rounding error, which is
    // precisely what it did before the inertia term existed.
    expect(r.moved.length).toBeLessThan(3);
  });

  it('charges for movement, so a pointless move is not free', () => {
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.5] });
    const origin = at([sofa]);
    const ctx: LayoutContext = { parts: [sofa], movable: [true], footprint: RECT, origin };
    expect(scoreLayout(ctx, [{ x: 0.6, z: 1.5, yaw: 0 }])).toBeGreaterThan(scoreLayout(ctx, origin));
  });

  it('hands back yaws a person could read', () => {
    // `propose` used to ADD quarter turns to an already-snapped yaw, so a few
    // thousand steps left parts stored at ~600 radians — the same angle, and junk
    // in the inspector, the saved layout and every readout that shows it.
    const parts = messy();
    const r = solveLayout(parts, RECT, parts.map(() => false), { seed: 8, steps: 1500 });
    for (const p of r.placements) {
      expect(p.yaw).toBeGreaterThan(-Math.PI - 1e-9);
      expect(p.yaw).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

// ─── Every move has to pay for itself ───────────────────────────────────────
//
// The annealer accepts uphill moves on purpose, and never goes back to ask whether
// each one was worth it — so what shipped was whatever its best snapshot happened to
// hold, noise included. Measured over the five presets at three seeds, offering each
// moved piece its old place back reverted 40–63 % of the moves and left the total
// cost equal or LOWER in eight of the twelve runs.

describe('a suggestion is only the moves that bought something', () => {
  it('never returns a layout worse than the one it was given', () => {
    // The invariant every caller downstream assumes, and the one the prune's slack
    // budget could otherwise spend: better, or unchanged, never worse.
    for (let seed = 1; seed <= 8; seed++) {
      const parts = messy();
      const r = solveLayout(parts, RECT, parts.map(() => false), { seed });
      expect(r.after).toBeLessThanOrEqual(r.before);
      if (r.moved.length === 0) expect(r.after).toBe(r.before);
    }
  });

  it('says what each move bought, and never blames the moving', () => {
    const parts = messy();
    const r = solveLayout(parts, RECT, parts.map(() => false), { seed: 3, steps: 2500 });
    expect(r.moves.map((m) => m.index)).toEqual(r.moved);
    for (const m of r.moves) {
      // `inertia` measures the move itself, so it is always the term that got worse;
      // crediting a move to it would have every explanation read "because it moved".
      expect(m.term).not.toBe('inertia');
      expect(m.gain).toBeGreaterThan(0);
      expect(m.distance > MOVE_MIN || m.turn > TURN_MIN).toBe(true);
    }
  });

  it('does not count a piece that only wobbled as moved', () => {
    // `MOVE_EPSILON` guarded translation and had no sibling for yaw, so 0.02 rad —
    // 1.1°, invisible — counted as a moved piece and inflated every "moved N pieces".
    const parts = messy();
    for (let seed = 1; seed <= 6; seed++) {
      const r = solveLayout(parts, RECT, parts.map(() => false), { seed });
      for (const i of r.moved) {
        const d = Math.hypot(r.placements[i].x - parts[i].pos[0], r.placements[i].z - parts[i].pos[2]);
        const turn = Math.abs(r.placements[i].yaw - parts[i].rot);
        expect(d > MOVE_MIN || turn > TURN_MIN).toBe(true);
      }
    }
  });

  it('is not worth offering for a rounding error', () => {
    // A solve that trims 3.1 to 2.4 by sliding a sofa 10 cm and a rug 10 cm has found
    // a real improvement and is still not an answer to "give me an idea".
    expect(isWorthOffering(3.1, 2.4)).toBe(false);
    expect(isWorthOffering(85.5, 18.2)).toBe(true);
    expect(isWorthOffering(4.0, 4.0)).toBe(false);
  });
});

// ─── Circulation is a term, not a tiebreak ──────────────────────────────────
//
// `navigabilityCost` was applied only to the handful of finalists, which helps only
// when the pool holds a candidate that is better. When the arrangement is already a
// local minimum on every other term the annealer never leaves it, the pool holds ONE
// candidate, and ranking one candidate is a no-op. So `RULE_HANDLING` claimed the
// solver could fix `reach` and `cut-off` — the room report reads that to decide
// whether to offer a **Try a fix** button — and the button did nothing.

describe('the solver can open a route', () => {
  /** Seven dining chairs strung across a 6 × 4 room, and a door on the north wall.
   *  Nothing overlaps, no zone is blocked, the door swings freely and its route in is
   *  clear — and chairs are not route-formers, so the walkway term is blind to them.
   *  Every pairwise term is happy; half the floor has no way to it. */
  function barricade(): ScenePart[] {
    const out = [doorPart(-2)];
    for (let i = 0; i < 7; i++) {
      out.push(part({ category: 'chair', shape: 'chair-dining', dimMM: [480, 520, 850], pos: [-2.7 + i * 0.9, 0, 0.2] }));
    }
    return out;
  }

  it('sees floor that nothing connects to the door', () => {
    const parts = barricade();
    const m = prepare(ctxOf(parts));
    const at = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
    // Every OTHER term calls this a near-perfect room. That is the trap.
    const plain = costBreakdown(m, at, DEFAULT_WEIGHTS);
    expect(plain.total).toBeLessThan(2);
    expect(navigabilityCost(m, at, NAV_CELL)).toBeGreaterThan(4);
    expect(costBreakdown(m, at, DEFAULT_WEIGHTS, NAV_CELL).navigation).toBeGreaterThan(400);
  });

  it('opens it, at every seed', () => {
    // Was 0 of 6 before the repair pass existed: the annealer had no reason to leave
    // the arrangement, so the finalist pool held one candidate and ranking it changed
    // nothing. The room report raised `cut-off` on the solver's own output.
    const parts = barricade();
    const m = prepare(ctxOf(parts));
    for (let seed = 1; seed <= 6; seed++) {
      const r = solveLayout(parts, RECT, parts.map(() => false), { seed });
      expect(navigabilityCost(m, r.placements, NAV_CELL), `seed ${seed} left the room cut`).toBeLessThan(0.5);
      expect(r.breakdownAfter.navigation).toBeLessThan(r.breakdownBefore.navigation);
    }
  });

  it('costs a clean room almost nothing to check', () => {
    // The repair pass runs only on a room that is actually cut. A clean one pays for
    // one coarse field to find that out, and the search itself is untouched.
    const parts = [doorPart(-2), sofa(), wardrobe(), table()];
    const at: Placement[] = [
      { x: -2, z: -1.975, yaw: 0 },
      { x: 0, z: 1.5, yaw: Math.PI },
      { x: 2.4, z: -1.7, yaw: 0 },
      { x: 0, z: 0.4, yaw: 0 },
    ];
    const m = prepare(ctxOf(parts));
    expect(navigabilityCost(m, at, NAV_CELL)).toBe(0);
  });
});

/** The thresholds the solver reports a move at — a couple of centimetres, and about
 *  three degrees. Spelled here because the tests above assert against them and a
 *  number typed twice is a number that drifts. */
const MOVE_MIN = 0.02;
const TURN_MIN = 0.05;

describe('re-fitting after a change', () => {
  /** A working bedroom whose wardrobe has been made much wider — which is exactly
   *  what happens when someone types a real product's size in. */
  function grownWardrobe() {
    return [
      part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [1.0, 0, -0.9], rot: Math.PI }),
      part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [-0.1, 0, -1.7] }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2600, 600, 2100], pos: [-1.6, 0, 1.68], rot: Math.PI }),
    ];
  }

  it('moves no more than a full rearrange would, and still improves things', () => {
    const parts = grownWardrobe();
    const locked = parts.map(() => false);
    const refit = solveLayout(parts, RECT, locked, { seed: 3, steps: 2500, mode: 'refit' });
    const arrange = solveLayout(parts, RECT, locked, { seed: 3, steps: 2500 });
    expect(refit.moved.length).toBeLessThanOrEqual(arrange.moved.length);
    // Compared on the SAME terms — a refit scored with the ordinary weights must
    // still be an improvement, or "smallest change" would just mean "no change".
    const plain = ctxOf(parts);
    expect(scoreLayout(plain, refit.placements)).toBeLessThanOrEqual(scoreLayout(plain, at(parts)));
  });

  it('recalibrates when the ROOM shrinks, without being told what changed', () => {
    const parts = grownWardrobe();
    const small: Footprint = [
      [-2, -1.6],
      [2, -1.6],
      [2, 1.6],
      [-2, 1.6],
    ];
    const r = solveLayout(parts, small, parts.map(() => false), { seed: 4, steps: 3000, mode: 'refit' });
    const b = footprintBounds(small);
    for (const p of r.placements) {
      expect(p.x).toBeGreaterThan(b.minX - 0.01);
      expect(p.x).toBeLessThan(b.maxX + 0.01);
    }
    expect(r.breakdownAfter.outside).toBeLessThanOrEqual(r.breakdownBefore.outside);
  });
});

describe('the solver and the room report agree', () => {
  // The bug this whole thing turns on. `lib/layout-rules` exists so that the
  // checker and the solver read ONE table; this is the test that they do. A room the
  // solver has finished with must not still be one the report calls broken — if it
  // is, the two are optimising different rules again, and the user gets a
  // suggestion followed immediately by a complaint about it.
  function randomRoom(seed: number): ScenePart[] {
    let s = seed * 2654435761;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length) % xs.length];
    const room: ScenePart[] = [doorPart(rnd() * 4 - 2)];
    const kinds: Array<() => ScenePart> = [
      () => part({ category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 600], pos: [0, 0, 0] }),
      () => part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1400, 600, 2100], pos: [0, 0, 0] }),
      () => part({ category: 'sofa', shape: 'sofa', dimMM: [1900, 900, 880], pos: [0, 0, 0] }),
      () => part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [0, 0, 0] }),
      () => part({ category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0] }),
      () => part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [0, 0, 0] }),
    ];
    for (let i = 0; i < 4; i++) {
      const p = pick(kinds)();
      // Dropped anywhere, at any angle — the state a detected room can genuinely
      // arrive in, and the state the solver has to be able to get out of.
      room.push({ ...p, pos: [rnd() * 4 - 2, 0, rnd() * 3 - 1.5], rot: rnd() * Math.PI * 2 });
    }
    return room;
  }

  it('leaves no blocked door and no two pieces in the same place', () => {
    const complaints: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const parts = randomRoom(seed);
      const r = solveLayout(parts, RECT, parts.map(() => false), { seed });
      const after = parts.map((p, i) => ({
        ...p,
        pos: [r.placements[i].x, p.pos[1], r.placements[i].z] as [number, number, number],
        rot: r.placements[i].yaw,
      }));
      for (const issue of analyzeRoom(after, RECT_ROOM).issues) {
        if (issue.severity !== 'error') continue;
        complaints.push(`seed ${seed}: ${issue.id} — ${issue.title}`);
      }
    }
    expect(complaints).toEqual([]);
  });
});

describe('cost of a solve', () => {
  /** A furnished room of `count` pieces, the size of thing this runs on for real. */
  function furnished(count: number): ScenePart[] {
    const out = [
      doorPart(-2),
      part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.2] }),
      part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], pos: [0, 1.3, -1.95], wallMounted: true }),
      part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [0.2, 0, 0.2] }),
      part({ category: 'rug', shape: 'rug', dimMM: [2400, 1600, 5], pos: [0, 0, 0.4] }),
      part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [-2.6, 0, 0] }),
      part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [2.5, 0, 1] }),
      part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [-1.5, 0, -1.6] }),
      part({ category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1000], pos: [-1.5, 0, -0.8] }),
    ];
    while (out.length < count) {
      const i = out.length;
      out.push(
        i % 2
          ? part({ category: 'plant', shape: 'plant', dimMM: [400, 400, 1600], pos: [(i % 5) - 2, 0, 1.7], circle: true })
          : part({ category: 'ottoman', shape: 'ottoman', dimMM: [550, 400, 420], pos: [(i % 5) - 2, 0, -0.6] }),
      );
    }
    return out;
  }

  // This runs on the main thread while somebody waits for a button, so its cost is
  // a feature and not an implementation detail. It was 8.4 SECONDS for twenty
  // pieces before the model hoisted the static work out of the annealer's loop;
  // measured at ~270 ms after, on the machine this was written on. The bar is set
  // well above that so a slower CI box does not fail it, and far below the old
  // number so a regression that reinstates per-proposal rule-table rebuilding does.
  it('stays inside a second for a room of twenty pieces', () => {
    const parts = furnished(20);
    const t0 = performance.now();
    solveLayout(parts, RECT, parts.map(() => false), { seed: 1 });
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('scales with the room rather than exploding', () => {
    // Every term is pairwise, so the honest expectation is quadratic. Anything much
    // worse than that means something inside the loop is rebuilding per-part state.
    const time = (n: number) => {
      const parts = furnished(n);
      const t0 = performance.now();
      solveLayout(parts, RECT, parts.map(() => false), { seed: 1 });
      return performance.now() - t0;
    };
    time(10); // warm the JIT, so the first measurement is not the compile
    const small = time(10);
    const large = time(30);
    expect(large / Math.max(1, small)).toBeLessThan(12);
  });
});

describe('navigability', () => {
  // A 4 m box, so two 2 m wardrobes side by side genuinely reach wall to wall. In
  // the 6 m room they would leave 900 mm at each end and the floor would still be
  // one piece — which is the point of asking the field rather than the pairs.
  const BOX: Footprint = [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ];
  const boxCtx = (parts: ScenePart[]): LayoutContext => ({
    parts,
    movable: parts.map(() => true),
    footprint: BOX,
  });
  const wardrobes = () => [
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0] }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0] }),
  ];
  const ACROSS: Placement[] = [
    { x: -1, z: 0.2, yaw: 0 },
    { x: 1, z: 0.2, yaw: 0 },
  ];
  const ALONG: Placement[] = [
    { x: -1, z: 1.68, yaw: Math.PI },
    { x: 1, z: 1.68, yaw: Math.PI },
  ];

  it('prefers an arrangement you can walk through', () => {
    const d = doorPart(0, -1.975);
    const model = prepare(boxCtx([d, ...wardrobes()]));
    const door = { x: d.pos[0], z: d.pos[2], yaw: d.rot };
    const walled = navigabilityCost(model, [door, ...ACROSS]);
    const open = navigabilityCost(model, [door, ...ALONG]);
    // Everything past the barrier is floor the door cannot reach.
    expect(walled).toBeGreaterThan(2);
    expect(open).toBe(0);
  });

  it('says nothing about a room with no door to reason from', () => {
    // Without one there is no telling which side anybody arrives from, and every
    // "you cannot get to this" claim would be a guess dressed as a measurement.
    const model = prepare(boxCtx(wardrobes()));
    expect(navigabilityCost(model, ACROSS)).toBe(0);
  });
});

describe('which anchor an obligation is discharged by', () => {
  // `relationParents` is the argmin `costBreakdown` computes and used to throw away.
  // Part III of §3.10.3 builds a group forest out of it, so it has to answer the same
  // way twice — and a band costs ZERO everywhere inside it, so equal-cost anchors are
  // the common case rather than the exotic one.
  const lamp = () =>
    part({ category: 'lamp', shape: 'lamp-floor', dimMM: [400, 400, 1500], pos: [0, 0, 0] });
  const armchair = () =>
    part({ category: 'chair', shape: 'chair-armchair', dimMM: [700, 700, 900], pos: [0, 0, 0] });

  const parentOf = (parts: ScenePart[], places: Placement[], childIdx: number): string => {
    const m = prepare(ctxOf(parts));
    const edge = relationParents(m, places).find((e) => e.child === childIdx)!;
    return parts[edge.parent].id;
  };

  it('gives a lamp to the nearer of two seats it is equally close enough to', () => {
    // Both gaps are inside `lamp-seat`'s 0–0.7 m band, so both cost exactly 0 and
    // the argmin is a dead heat on cost alone. A lamp belongs to the chair it is
    // actually beside.
    // The FAR chair is listed first on purpose: with array order deciding, this is
    // the case that comes back wrong, and a fixture that listed the near one first
    // would pass either way.
    const l = lamp();
    const far = armchair();
    const near = armchair();
    const parts = [l, far, near];
    const places: Placement[] = [
      { x: 0, z: 0, yaw: 0 },
      { x: -1.05, z: 0, yaw: 0 }, // gap 0.50 m
      { x: 0.75, z: 0, yaw: 0 }, // gap 0.20 m
    ];
    const m = prepare(ctxOf(parts));
    const edge = relationParents(m, places).find((e) => e.child === 0)!;
    expect(edge.cost).toBe(0);
    expect(parts[edge.parent].id).toBe(near.id);
  });

  it('answers the same when the two seats are listed the other way round', () => {
    // The regression this exists for: before the tie-break the winner was whichever
    // came first in `parts`, and `parts` order changes whenever a piece is added or
    // deleted anywhere in the room.
    const l = lamp();
    const near = armchair();
    const far = armchair();
    const nearAt: Placement = { x: 0.75, z: 0, yaw: 0 };
    const farAt: Placement = { x: -1.05, z: 0, yaw: 0 };
    const lampAt: Placement = { x: 0, z: 0, yaw: 0 };
    expect(parentOf([l, near, far], [lampAt, nearAt, farAt], 0)).toBe(near.id);
    expect(parentOf([l, far, near], [lampAt, farAt, nearAt], 0)).toBe(near.id);
  });

  it('still decides an exactly symmetric room, and decides it the same way twice', () => {
    // Mirrored seeding produces exact ties on cost AND distance — the one place
    // floating point will not separate them for us. The id is the last rung, and it
    // is stable across every reordering because it does not depend on position.
    const l = lamp();
    const a = armchair();
    const b = armchair();
    const lampAt: Placement = { x: 0, z: 0, yaw: 0 };
    const left: Placement = { x: -0.75, z: 0, yaw: 0 };
    const right: Placement = { x: 0.75, z: 0, yaw: 0 };
    const one = parentOf([l, a, b], [lampAt, left, right], 0);
    const other = parentOf([l, b, a], [lampAt, right, left], 0);
    expect(one).toBe(other);
    expect([a.id, b.id]).toContain(one);
  });
});

describe('the solver moves groups, not only pieces', () => {
  // §3.10.3 part III, and the one case the flat search provably cannot do. Two groups,
  // each internally correct, standing where the other one belongs: taking any single
  // piece out of a coherent group makes the room worse, so every single-piece move is
  // uphill and the annealer stays where it is. Measured on the open plan before the
  // group pass existed — 0–1 pieces moved of eleven, at every seed.
  const LIVING = new Set(['sofa', 'coffee-table', 'rug', 'lamp-floor']);
  const DINING = new Set(['desk-standard', 'chair-dining']);

  /** A seeded preset with its two groups exchanged bodily. Nothing inside a group has
   *  moved relative to its own members — only the groups are in the wrong places. */
  function groupsExchanged(id: 't' | 'open', w: number, d: number) {
    const poly = footprintForLayout(id, w, d);
    const seeded = defaultScene(id, w, d, { footprint: poly, height: 2.8 });
    const mid = (set: Set<string>) => {
      const g = seeded.filter((p) => set.has(p.shape) && !p.wallMounted);
      return [
        g.reduce((s, p) => s + p.pos[0], 0) / g.length,
        g.reduce((s, p) => s + p.pos[2], 0) / g.length,
      ];
    };
    const [lx, lz] = mid(LIVING);
    const [dx, dz] = mid(DINING);
    const parts = seeded.map((p) => {
      if (p.wallMounted) return { ...p };
      const set = LIVING.has(p.shape) ? LIVING : DINING.has(p.shape) ? DINING : null;
      if (!set) return { ...p };
      const [ox, oz] = set === LIVING ? [dx - lx, dz - lz] : [lx - dx, lz - dz];
      return { ...p, pos: [p.pos[0] + ox, p.pos[1], p.pos[2] + oz] as [number, number, number] };
    });
    const sctx: LayoutContext = { parts: seeded, movable: seeded.map(() => true), footprint: poly };
    const target = costBreakdown(prepare(sctx), at(seeded), DEFAULT_WEIGHTS, NAV_CELL).total;
    return { parts, poly, target };
  }

  it('carries two exchanged groups back where they belong', () => {
    const { parts, poly, target } = groupsExchanged('t', 5.5, 4.7);
    const model = prepare({ parts, movable: parts.map((p) => !p.wallMounted), footprint: poly });

    // Nine seeds, because one run of a stochastic search proves nothing either way,
    // and on the MEDIAN, because this fixture's mean is dominated by a couple of seeds
    // that end badly with the pass on or off. Measured, group pass off → on:
    //
    //   median  30.2 → 1.6      best  11.8 → 0.6      worst of nine  39.7 → 25.4
    //
    // The whole distribution moves: even the worst run with the pass beats the median
    // without it. Both bars below are checked by mutation — setting `GROUP_STEPS = 0`
    // fails each of them, which an earlier version of this test did not.
    const costs = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((seed) => solveLayout(parts, poly, parts.map(() => false), { seed }))
      .map((r) => costBreakdown(model, r.placements, DEFAULT_WEIGHTS, NAV_CELL).total)
      .sort((a, b) => a - b);

    expect(costs[4]).toBeLessThan(10);
    // …and the best run gets under the room it was built from, which no run does
    // without the pass: the flat search's best of nine is 11.8 against a 5.5 target.
    expect(costs[0]).toBeLessThan(target);
    // Nine anneals on a sixteen-piece room. Nothing here is a timing assertion — the
    // explicit budget exists because vitest's 5 s default is not one either, and this
    // test sat just under it: green run after run, then red the first time the whole
    // suite ran on a busier machine. A test whose result depends on what else is using
    // the CPU is a flaky test even when every number it checks is deterministic.
  }, 60_000);

  it('finds the swap in an open plan the flat search sits still in', () => {
    // The gentler case — the two halves are similar enough that exchanging the groups
    // breaks no wall, so the room is merely worse rather than invalid, and every single
    // piece move out of it is uphill. Off → on, over nine seeds: median 19.9 → 16.0.
    const { parts, poly } = groupsExchanged('open', 7.5, 5.6);
    const model = prepare({ parts, movable: parts.map((p) => !p.wallMounted), footprint: poly });
    const costs = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((seed) => solveLayout(parts, poly, parts.map(() => false), { seed }))
      .map((r) => costBreakdown(model, r.placements, DEFAULT_WEIGHTS, NAV_CELL).total)
      .sort((a, b) => a - b);
    expect(costs[4]).toBeLessThan(19);
  }, 60_000);

  it('finds no group in a room nobody has arranged', () => {
    // The complement, and why `intactGroups` reads the arrangement rather than the
    // relation table: where nothing is currently grouped there is nothing to carry, the
    // pass finds nothing and is skipped, and the flat search does the work — which is
    // measurably the right answer there (363.7 → 6.8 over six seeds).
    const parts = [
      part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [1.6, 0.44, 1.6], rot: 0.4 }),
      part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [-2.4, 0.21, -1.5], rot: 1.1 }),
      part({ category: 'lamp', shape: 'lamp-floor', dimMM: [400, 400, 1500], pos: [2.5, 0.75, -1.6], rot: 0, circle: true }),
    ];
    const model = prepare(ctxOf(parts));
    expect(relationParents(model, at(parts)).every((e) => e.cost > 0.25)).toBe(true);
  });
});

describe('the room’s anchor is settled first', () => {
  // `RoomProfile.anchor` was computed by `roomProfile` and read by NOTHING, while its
  // own doc comment claimed "settling it first is what makes a hierarchical solve
  // behave". Two tests in layout-rules asserted its value, which made it look alive.
  // A field that asserts a behaviour the code does not have is worse than an absent
  // one, because the next reader believes it.
  //
  // What the pass buys, re-measured at `4be144c` by emptying `anchorIdx` and running
  // twelve seeds per preset on a scrambled room — every preset at 6 × 5, which the
  // table this replaces did not say of itself:
  //
  //   preset   n      worst  without → with       median  without → with
  //   rect    11              16.17 →  12.60               8.77 →  6.83
  //   l       14              33.68 →  35.38              17.68 → 17.87
  //   t       18             490.10 → 277.78              84.22 → 39.43
  //   u       12              36.24 →  38.53              12.08 → 10.46
  //   open    17              36.60 → 253.31              11.49 → 15.22
  //
  // It used to say `u 155 → 6.9`, `open 37 → 22`, and that the disasters stop
  // happening. On this tree the pass rescues the T, helps the rectangle, is a wash on
  // the L and the U, and makes `open` five times worse in the tail. Since the old
  // table named no room size, this is not that experiment re-run and the difference is
  // not evidence of a regression — it is evidence that a measurement whose fixture was
  // never written down cannot be checked, only replaced.
  //
  // One honest limit on the ablation: skipping a pass also shifts the RNG stream every
  // later pass draws from, so "without" is a different trajectory rather than this one
  // minus a pass. `passSteps` is computed per pool and never reads `anchorIdx`, so the
  // other two passes do get identical budgets.
  //
  // What the pass demonstrably still buys HERE is the number of seeds that end SAFE:
  // 12 of 12 shipped, 9 of 12 with the pool emptied. That is the first test below, and
  // it is the only assertion in the file that can see this pass at all.
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // One solve set, shared by the three tests that read it. Twelve solves of a
  // twelve-piece room is ~1.5 s and each test below asserts one fact about the same
  // run, so re-solving per test would be three times the wall clock for the same
  // numbers — and, worse, three separate runs to reconcile if they ever disagreed.
  let cached: { rows: ReturnType<typeof costBreakdown>[]; unsolved: ReturnType<typeof costBreakdown> } | null = null;
  function scrambledU() {
    if (cached) return cached;
    const poly = footprintForLayout('u', 6, 5);
    const base = defaultScene('u', 6, 5, { footprint: poly, height: 2.8 });
    const messy = base.map((q, i) =>
      q.wallMounted
        ? { ...q }
        : {
            ...q,
            pos: [-q.pos[0] * 0.8 + (i % 3) * 0.4, q.pos[1], -q.pos[2] * 0.7] as [number, number, number],
            rot: q.rot + 0.6,
          },
    );
    const model = prepare({
      parts: messy,
      movable: messy.map((q) => !q.wallMounted),
      footprint: poly,
    } as LayoutContext);
    const rows = SEEDS.map((seed) =>
      costBreakdown(
        model,
        solveLayout(messy, poly, messy.map(() => false), { seed }).placements,
        DEFAULT_WEIGHTS,
        NAV_CELL,
      ),
    );
    cached = { rows, unsolved: costBreakdown(model, at(messy), DEFAULT_WEIGHTS, NAV_CELL) };
    return cached;
  }

  it('stops a scrambled bedroom from ending in the occasional disaster', () => {
    const { rows } = scrambledU();
    const clean = rows.filter((r) => HARD_TERMS.every((k) => r[k] === 0)).length;

    // A COUNT of seeds that end with nothing on any hard term, never a sum.
    // `HARD_TERMS` is the solver's own exported list and this reads it term by term
    // the way `hardCosts` does, because four terms added together means any of them
    // buys any other: reclaiming 0.05 m² of stranded floor is worth 6 units, which
    // would pay for 60 cm² of overlap.
    //
    // 12 of 12 measured. The bar is 11 — one seed of slack, deliberately, because a
    // seeded solver fixture is a canary for chaos rather than a ratchet, and pinning
    // one to its exact current value is how `main` stayed red across nine merges.
    //
    // Two mutations were watched failing it, which is the whole reason the number
    // moved from the 7 it used to be:
    //
    //  · `anchorIdx = []` → 9 of 12. That is the pass this describe block is named
    //    for, and nothing else in the file notices its absence: the total-cost bar in
    //    the next test comes back 36.24, comfortably inside its own 60.
    //  · `DEFAULT_WEIGHTS.outside = 0` → 8 of 12. This mutation SURVIVED at a bar of
    //    7, and the note recording that drew the wrong conclusion from it — that the
    //    predicate is blind to the term it is named for. It is blind to it: a weight
    //    of zero zeroes the READING as well as the solver's incentive, so `r.outside`
    //    is 0 with a piece through the plaster. What catches the mutation is that a
    //    solver no longer paying for walls wrecks three other terms as well.
    //
    // And one that survives, which is the smaller claim this line can honestly make:
    // `steps = 1` still ends 12 of 12. Not because containment is free, but because
    // `passSteps` has a floor of 120 per pool — `steps = 1` still spends 360
    // proposals, 15% of the ~2400 a default solve does, and containment is the
    // cheapest thing the anneal buys. This note used to explain that survival with
    // "`clampIntoFootprint` runs regardless of step count", which is no longer true of
    // anything: `c9fe1a4` took that call out of the solver.
    expect(clean).toBeGreaterThanOrEqual(11);
  }, 120_000);

  it('keeps the untidiest seed bounded, which is a different claim from safe', () => {
    const { rows } = scrambledU();
    const costs = rows.map((r) => r.total);

    // Twelve seeds spread 1.38 … 38.53, median 10.46. This is a bar on TIDINESS and it
    // says so: at 12 of 12 clean there is no hard term left in any of these totals, so
    // all 38.53 of the worst one is `alignment` 10.78 + `relation` 24.60 + `balance`
    // 3.15 on seed 8. A total-cost bar cannot fail on danger here even in principle —
    // which is what the previous version of this comment had backwards, when it read
    // `sorted(costs)[6] < 10` and called that the safety check. It also claimed seven
    // terms sit at 0.00 on every seed: `HARD_TERMS` is five, `walkway` and `window` are
    // not in it, and seed 7 carries `window` 1.37.
    //
    // 60 rather than the 40 it was. 40 passed by 3.7% on a chaotic solver, which is a
    // future red that costs a session to diagnose and buys nothing — both mutations
    // that reach this line are caught at 60 too: `DEFAULT_WEIGHTS.outside = 0` (66.76)
    // and `HARD_TERMS = []` (144.50, because that list is also the solver's own veto,
    // so emptying it lets the anneal ship a layout it would have refused).
    //
    // THERE IS NO ASSERTION ON THE MEDIAN, and that is the finding rather than an
    // omission. Seven mutations were measured — anchor pool emptied, `steps = 1`,
    // `snapYaws` removed, `HARD_TERMS = []`, and the `outside` / `alignment` weights
    // zeroed — and the medians they produce are 12.08, 13.22, 10.30, 11.57, 14.13 and
    // 5.24 against a baseline of 10.46. Every bar that any of them crosses is inside
    // the noise of the baseline, so a median assertion here could be green or red for
    // reasons unrelated to what it claims to watch. The line that used to sit here was
    // decoration in exactly that way. What actually watches the median is the table in
    // this describe block's comment, re-derived when the fixture moves.
    expect(Math.max(...costs)).toBeLessThan(60);
  }, 120_000);

  it('can tell the solved room from the scrambled one it started from', () => {
    const { unsolved } = scrambledU();

    // The negative control, and it is not decoration. `HARD_TERMS.every(...)` over an
    // EMPTY list is vacuously true, so emptying that array would take the count in the
    // first test to 12 and leave it green having checked nothing. Scoring the same
    // scrambled room WITHOUT solving is what closes that: it carries `outside`
    // **1555.56**, `overlap` 167.38, `navigation` 26.40, `door` 25.26 and `access`
    // 20.00, so the predicate has to be able to say no. Confirmed by replacing
    // `HARD_TERMS` with `[]`, which fails this line and nothing else.
    //
    // The `outside 3000.00` / `access 180.00` this used to quote was stale before the
    // branch opened, and stale in the way that is hardest to notice: no solver runs in
    // this line at all, so both numbers are pure geometry over a fixed fixture and
    // could only ever have come from a different room.
    expect(HARD_TERMS.some((k) => unsolved[k] > 0)).toBe(true);
  }, 120_000);

  it('is the piece the room is named after', () => {
    // The tie between the field and this pass: if `roomProfile` ever stopped picking
    // the bed, the pass above would still run and would be settling a nightstand.
    const poly = footprintForLayout('u', 6, 5);
    const parts = defaultScene('u', 6, 5, { footprint: poly, height: 2.8 });
    const model = prepare({ parts, movable: parts.map(() => true), footprint: poly } as LayoutContext);
    expect(model.profile.anchor).not.toBeNull();
    expect(parts[model.profile.anchor!].category).toBe('bed');
  });
});

describe('the wall term measures along the wall, not to its corner', () => {
  // `nearestEdge` clamps to the SEGMENT, so a piece standing off the end of a wall
  // gets back a DIAGONAL distance to that wall's endpoint — while `halfDepthToward`
  // returns an AXIAL half-extent along the same wall's normal. Subtracting one from
  // the other is not a gap, and nothing in the room report contradicts it because no
  // `RuleKind` maps to `wall`: this term has exactly one consumer and no second
  // opinion.
  //
  // Measured on the L, whose notch runs x 0.48→3.00 at z 0.38. A sofa centred at
  // x = 0 sits in that corner's shadow: its back was 24 mm off the plane and it was
  // charged 0.215 — 0.690 diagonal minus 0.475 axial — which was 91% of the preset's
  // whole wall term. The solver collected it by sliding the sofa 200 mm PAST a wall
  // that does not reach that far, at every seed, on a brand-new room.
  const L = footprintForLayout('l', 6.0, 4.7);

  /** The wall term alone, for one sofa backed onto the notch at `x`. */
  const wallCostAt = (x: number) => {
    const parts = [sofa()];
    const ctx: LayoutContext = { parts, movable: [true], footprint: L };
    // yaw π puts its back to the notch, whose inward normal is −z.
    return costBreakdown(prepare(ctx), [{ x, z: -0.119, yaw: Math.PI }], DEFAULT_WEIGHTS).wall;
  };

  it('charges the same for the same gap, on and off the end of the wall', () => {
    // Both sofas have their backs an identical distance from the plane z = 0.38.
    // The only difference is that one's perpendicular foot lands ON the notch
    // segment and the other's clamps to its corner — which is a fact about the
    // polygon's vertex list, not about the room, and must not change the price.
    //
    // Stated as an invariance rather than against a literal: a number here would
    // pass a term that had drifted, so long as it drifted to the number.
    expect(wallCostAt(1.8)).toBeCloseTo(wallCostAt(0), 6);
  });

  it('still charges a sofa that is genuinely off its wall', () => {
    // The other direction, or the fix above would pass by charging nothing at all.
    // Same corner shadow, pulled a third of a metre into the room.
    const parts = [sofa()];
    const ctx: LayoutContext = { parts, movable: [true], footprint: L };
    const flush = costBreakdown(prepare(ctx), [{ x: 0, z: -0.119, yaw: Math.PI }], DEFAULT_WEIGHTS).wall;
    const adrift = costBreakdown(prepare(ctx), [{ x: 0, z: -0.45, yaw: Math.PI }], DEFAULT_WEIGHTS).wall;
    expect(adrift).toBeGreaterThan(flush + DEFAULT_WEIGHTS.wall * 0.2);
  });
});

// The Lock button in `PartTree` — "don't let Suggest move this one". The button
// writes `useStudio.pinned`; this is the arithmetic between that map and the
// solver's `locked` parameter, and it lives in `lib/` rather than in the `.map()`
// it came from precisely so these cases can exist at all.
describe('lockedForSolve', () => {
  const room = () => [
    part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [-1.8, 0, -1.3], rot: 0.4 }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [-1.4, 0, -1.0], rot: 1.1 }),
    part({ category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420], pos: [-1.6, 0, -1.5], rot: 0.2 }),
  ];

  it('locks the piece the user locked, and only that one', () => {
    const parts = room();
    expect(lockedForSolve(parts, { [parts[1].id]: true }, null)).toEqual([false, true, false]);
  });

  it('treats a released lock as absent', () => {
    // `togglePinned` writes `false` rather than deleting the key, so a piece the
    // user locked and then released is still IN the map. Reading it truthily is
    // the difference between releasing a lock working and a lock that cannot be
    // undone without a reload.
    const parts = room();
    expect(lockedForSolve(parts, { [parts[1].id]: false }, null)).toEqual([false, false, false]);
  });

  it('locks everything a confined fix was not asked about', () => {
    const parts = room();
    const only = new Set([parts[2].id]);
    expect(lockedForSolve(parts, {}, only)).toEqual([true, true, false]);
  });

  it('keeps the user lock when a confined fix names that very piece', () => {
    // The composition that fails silently. **Try a fix** unlocks the pieces it
    // wants to move; if that overrode the user's lock, pressing it on a finding
    // about a locked sofa would move the sofa the user had locked — and the only
    // symptom is a piece moving, which is what the button does anyway.
    const parts = room();
    const only = new Set([parts[0].id, parts[2].id]);
    expect(lockedForSolve(parts, { [parts[0].id]: true }, only)).toEqual([true, true, false]);
  });

  it('still reports a from-photo piece as locked', () => {
    // Documents rather than endorses. `ScenePart.locked` means "came out of your
    // photo" — its own comment says the name is wrong — and it has always been fed
    // to the solver as a lock, so Suggest does not move detected furniture and the
    // Lock button cannot release it. Changing that alters every detected room and
    // is a product decision; this is here so the next reader finds it stated
    // rather than deducing it from a bug report.
    const parts = room();
    parts[1] = { ...parts[1], locked: true };
    expect(lockedForSolve(parts, {}, null)).toEqual([false, true, false]);
  });

  it('stops the solver moving a locked piece, where it would otherwise move it', () => {
    // Both halves, because the second assertion alone would also pass if
    // `lockedForSolve` returned all-true — and a lock that locks everything is not
    // a working lock, it is a broken Suggest.
    const free = room();
    const loose = solveLayout(free, RECT, lockedForSolve(free, {}, null), { seed: 5, steps: 1200 });
    expect(loose.moved).toContain(1);

    const held = room();
    const pinned = solveLayout(held, RECT, lockedForSolve(held, { [held[1].id]: true }, null), {
      seed: 5,
      steps: 1200,
    });
    expect(pinned.moved).not.toContain(1);
    expect(pinned.placements[1]).toEqual({ x: held[1].pos[0], z: held[1].pos[2], yaw: held[1].rot });
  });
});
