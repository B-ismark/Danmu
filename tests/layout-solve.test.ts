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
import { isWorthOffering, solveLayout } from '@/lib/layout-solve';
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
  });

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
  });

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
