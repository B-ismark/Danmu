import { describe, it, expect } from 'vitest';
import {
  ANGLED_MIN,
  awkwardTurns,
  fixedFloor,
  HARD_TERMS,
  lockedForSolve,
  makeRng,
  movableFor,
  randomizeStart,
  snapYaws,
  solveLayout,
} from '@/lib/layout-solve';
import { isCleanShuffle, lockedForShuffle, shuffleBlockers, shuffleRoom } from '@/lib/layout-shuffle';
import { mayAngle, roleOf, type Role } from '@/lib/layout-rules';
import { DEFAULT_WEIGHTS, prepare, type LayoutContext, type Placement } from '@/lib/layout-score';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';

// Two complaints about Ideas, 2026-10-15, and the two answers to them.
//
// 1. "Pieces in suggested arrangements still have awkward rotations, roughly 10 or 15
//    degrees." Measured on `main` over eight rooms x three presses: a sofa, a rug, a
//    coffee table and a side table at 14–15° in both L rooms, a chair at 17° and 23°.
//    `SNAP_TOL` (12°) was the only line between noise and a choice, for every piece.
//    Now only a piece that `mayAngle` may stand at an angle, and only from `ANGLED_MIN`;
//    anything else the solver turned is squared, and Ideas refuses a candidate that
//    still has one (`awkwardTurns`).
// 2. "Ideas didn't suggest anything for a room I put together." Ideas asked every hard
//    term to be ZERO, so one kept piece at fault — pinned in a doorway — made every
//    candidate unclean. The gate is now the floor the kept pieces set (`fixedFloor`).

const deg = (d: number) => (d * Math.PI) / 180;
const offSquare = (yaw: number) => {
  const q = Math.PI / 2;
  const r = ((yaw % q) + q) % q;
  return Math.min(r, q - r);
};

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `a${++n}`, name: p.shape, rot: 0, locked: false, ...p } as ScenePart;
}

describe('which pieces may stand at an angle', () => {
  it('is the chairs and the ottoman, and nothing else', () => {
    // A literal, because the set IS the decision: a sofa added here would let a 14°
    // sofa back into Ideas with every other test green.
    const roles: Role[] = ['bed', 'sofa', 'armchair', 'dining-chair', 'office-chair', 'ottoman', 'dining-table',
      'coffee-table', 'side-table', 'nightstand', 'desk', 'wardrobe'];
    expect(roles.filter(mayAngle)).toEqual(['armchair', 'dining-chair', 'office-chair', 'ottoman']);
    expect((ANGLED_MIN * 180) / Math.PI).toBeCloseTo(20, 0);
  });
});

describe('awkwardTurns — the angle nobody chose', () => {
  const poly = footprintForLayout('rect', 8, 6);
  const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 850], pos: [0, 0, 0] });
  const chair = part({ category: 'chair', shape: 'chair-armchair', dimMM: [800, 800, 900], pos: [2, 0, 0] });
  const lamp = part({ category: 'lamp', shape: 'lamp-floor', dimMM: [400, 400, 1600], pos: [-2, 0, 0], circle: true });
  const parts = [sofa, chair, lamp];
  const at = (s: number, c: number, l = 0): Placement[] => [
    { x: 0, z: 0, yaw: deg(s) },
    { x: 2, z: 0, yaw: deg(c) },
    { x: -2, z: 0, yaw: deg(l) },
  ];
  const names = (pl: Placement[], ps = parts) => awkwardTurns(ps, poly, pl, [0, 1, 2]).map((i) => ps[i].shape);

  it('names a sofa at 14° and a chair at 14°', () => {
    expect(names(at(14, 14))).toEqual(['sofa', 'chair-armchair']);
  });
  it('names a sofa at 40°, which no band makes deliberate', () => {
    expect(names(at(40, 0))).toEqual(['sofa']);
  });
  it('leaves a chair at 30°, square pieces and a round one alone', () => {
    expect(names(at(0, 30, 17))).toEqual([]);
    expect(names(at(90, 180))).toEqual([]);
  });
  it('leaves a sofa at the angle the USER gave it', () => {
    const theirs = parts.map((p, i) => (i === 0 ? { ...p, rot: deg(14) } : p));
    expect(names(at(14, 0), theirs)).toEqual([]);
  });
  it('reads square from the wall, not the world, in a room turned off the axes', () => {
    const t = deg(25);
    const turned = poly.map(([x, z]) => [x * Math.cos(t) - z * Math.sin(t), x * Math.sin(t) + z * Math.cos(t)] as [number, number]);
    // Turning the floor by +t in x-z turns a heading by -t (yaw is three.js's, front =
    // (sin, cos)). Sofa square to the turned walls: fine. Square to the world: crooked.
    expect(awkwardTurns(parts, turned, at(-25, -25 + 90), [0, 1])).toEqual([]);
    // (The sofa starts at 45° so 0° is the SEARCH's angle, not the user's.)
    const moved = parts.map((p, i) => (i === 0 ? { ...p, rot: deg(45) } : p));
    expect(awkwardTurns(moved, turned, at(0, -25), [0])).toEqual([0]);
  });
});

describe('snapYaws squares a sofa the SOLVER turned, from any angle', () => {
  const poly = footprintForLayout('rect', 8, 6);
  const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -3], wallMounted: true });
  const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 850], pos: [0, 0, 0] });
  const chair = part({ category: 'chair', shape: 'chair-armchair', dimMM: [800, 800, 900], pos: [2.5, 0, 1] });
  const parts = [door, sofa, chair];
  const model = (origin?: Placement[]) =>
    prepare({ parts, movable: parts.map((p) => !p.wallMounted), footprint: poly, origin } as LayoutContext);
  const at = (s: number, c: number): Placement[] => [
    { x: 0, z: -3, yaw: 0 },
    { x: 0, z: 0, yaw: deg(s) },
    { x: 2.5, z: 1, yaw: deg(c) },
  ];

  it('a sofa at 30° comes back square; a chair at 30° keeps it', () => {
    const out = snapYaws(model(at(0, 0)), at(30, 30), DEFAULT_WEIGHTS, true, null);
    expect(offSquare(out[1].yaw)).toBeLessThan(1e-9);
    expect(offSquare(out[2].yaw)).toBeCloseTo(deg(30), 9);
  });
  it('a chair at 15° is squared: under ANGLED_MIN it reads as knocked', () => {
    const out = snapYaws(model(at(0, 0)), at(0, 15), DEFAULT_WEIGHTS, true, null);
    expect(offSquare(out[2].yaw)).toBeLessThan(1e-9);
  });
  it('a sofa the user left at 30° stays at 30°', () => {
    const out = snapYaws(model(at(30, 0)), at(30, 0), DEFAULT_WEIGHTS, true, null);
    expect(offSquare(out[1].yaw)).toBeCloseTo(deg(30), 9);
  });
});

describe('Ideas over the presets', () => {
  // An independent reading, not `awkwardTurns` again: every preset here is square to the
  // world axes, so off-square is a plain modulus. The guard and this measure the same
  // thing two ways, which is what lets this catch the guard being deleted.
  it('hands back no piece visibly off square unless it may angle, and then by 20° or more', { timeout: 300_000 }, () => {
    const crooked: string[] = [];
    let ideas = 0;
    for (const [id, w, d] of [['l', 6, 5], ['l', 4.5, 4], ['open', 6, 4]] as const) {
      const parts = defaultScene(id, w, d);
      const footprint = footprintForLayout(id, w, d);
      for (const attempt of [1, 2]) {
        const o = shuffleRoom(parts, { footprint, height: 2.4 }, lockedForSolve(parts, {}, null), { attempt });
        for (const r of o?.ideas ?? []) {
          ideas++;
          for (const i of r.moved) {
            if (parts[i].circle || parts[i].wallMounted) continue;
            const off = offSquare(r.placements[i].yaw);
            if (off < deg(3)) continue;
            if (mayAngle(roleOf(parts[i])) && off >= ANGLED_MIN) continue;
            crooked.push(`${id} ${w}x${d} #${attempt}: ${parts[i].name} at ${((off * 180) / Math.PI).toFixed(1)}°`);
          }
        }
      }
    }
    expect(ideas, 'the sweep has to offer something for this to mean anything').toBeGreaterThan(20);
    expect(crooked, crooked.join('\n')).toEqual([]);
  });
});

describe('the last word is the gallery\'s, because the tidy can be vetoed', () => {
  // `snapYaws` squares a piece only where that makes no hard term worse, so a sofa
  // whose square yaw would cost a clash keeps the search's angle. Measured over seven
  // presets x 24 shuffle solves (seeds 5000–5023): ONE of 128 clean solves did — this
  // one, a sofa at 6.1° off — which is why the sweep above passes with the gallery's
  // check deleted, and why this witness exists: it is the case only the check catches.
  // Re-swept 2026-10-15 after the slide move and `repairHard` moved every trajectory:
  // seed 5013 squares its sofa now, and over the same seven presets x 48 seeds from both
  // starts (5000–5047) 4 of 562 clean solves keep a crooked sofa — l 6 x 5 seeds 5002 and
  // 5019 from the scatter, 5033 built, and l 4.5 x 4 seed 5029 built. 5002 is the witness.
  it('l 6 x 5, seed 5002: a clean solve with a crooked sofa, which Ideas would refuse', { timeout: 60_000 }, () => {
    const parts = defaultScene('l', 6, 5);
    const fp = footprintForLayout('l', 6, 5);
    const locked = lockedForSolve(parts, {}, null);
    const r = solveLayout(parts, fp, locked, {
      seed: 5002,
      mode: 'shuffle',
      start: randomizeStart(parts, fp, movableFor(parts, locked), makeRng(5002)),
    });
    expect(isCleanShuffle(r), 'clean by every hard term — so only the angle check stands in its way').toBe(true);
    expect(awkwardTurns(parts, fp, r.placements, r.moved).map((i) => roleOf(parts[i]))).toEqual(['sofa']);
  });
});

describe('a kept piece at fault does not empty the gallery', () => {
  // The 4 x 3.5 preset with its first solid floor piece pulled toward the door and
  // pinned there: it blocks the door, pokes through the wall and crowds the entry.
  // On `main` two presses offered NOTHING (measured 2026-10-15); every candidate
  // carried the pinned piece's faults and the gate asked them to be zero.
  const w = 4;
  const d = 3.5;
  const base = defaultScene('rect', w, d);
  const footprint = footprintForLayout('rect', w, d);
  const door = base.find((p) => roleOf(p) === 'door')!;
  const f = base.findIndex((p) => !p.wallMounted && !['door', 'window', 'rug'].includes(roleOf(p)));
  const parts = base.map((p, i) =>
    i === f ? { ...p, pos: [door.pos[0] * 0.8, p.pos[1], door.pos[2] * 0.8] as [number, number, number] } : p,
  );
  const locked = lockedForSolve(parts, { [parts[f].id]: true }, null);

  it('the floor is what the kept pieces cost on their own', () => {
    const floor = fixedFloor(parts, footprint, movableFor(parts, locked));
    expect(floor).toHaveLength(HARD_TERMS.length);
    expect(floor.some((v) => v > 0), 'the pinned piece has to be at fault for this to test anything').toBe(true);
    const clean = lockedForSolve(base, {}, null);
    expect(fixedFloor(base, footprint, movableFor(base, clean)).every((v) => v === 0), 'and nothing, where nothing kept is').toBe(true);
  });

  it('offers ideas anyway, none of them worse than the floor', { timeout: 120_000 }, () => {
    const o = shuffleRoom(parts, { footprint, height: 2.4 }, locked, { attempt: 1 });
    expect(o?.ideas.length ?? 0).toBeGreaterThan(0);
    const floor = fixedFloor(parts, footprint, movableFor(parts, locked));
    for (const r of o!.ideas) {
      HARD_TERMS.forEach((k, t) => expect(r.breakdownAfter[k] as number).toBeLessThanOrEqual(floor[t] + 1e-9));
      expect(r.placements[f]).toEqual({ x: parts[f].pos[0], z: parts[f].pos[2], yaw: parts[f].rot });
    }
  });
});

describe('the refusal names only what the search could have moved', () => {
  it('a finding wholly among kept pieces is not a blocker; one touching a free piece is', () => {
    const issue = (rule: string, partIds: string[]) =>
      ({ rule, partIds, title: rule, severity: 'error' }) as unknown as Parameters<typeof shuffleBlockers>[0][number];
    const door = issue('door', ['door-1', 'chair-1']);
    expect(shuffleBlockers([door])).toHaveLength(1);
    expect(shuffleBlockers([door], new Set(['door-1', 'chair-1']))).toHaveLength(0);
    expect(shuffleBlockers([door], new Set(['door-1']))).toHaveLength(1);
  });

  // Review of 2026-10-15: `cut-off` is a room-level finding with no part ids, and
  // `[].every(...)` is true, so passing ANY `kept` set (the panel always does)
  // dropped it, and the refusal offered "Look again" instead of naming the cut-off
  // floor.
  it('a room-level finding still blocks whatever is kept', () => {
    const cutOff = { rule: 'cut-off', partIds: [], title: 'cut-off', severity: 'error' } as unknown as Parameters<typeof shuffleBlockers>[0][number];
    expect(shuffleBlockers([cutOff])).toHaveLength(1);
    expect(shuffleBlockers([cutOff], new Set())).toHaveLength(1);
    expect(shuffleBlockers([cutOff], new Set(['door-1']))).toHaveLength(1);
  });
});

// Reported 2026-10-15 on a real scanned bedroom: Ideas said "Nothing here can move"
// because every floor piece carried `locked: true`, which means "from your photo".
// This is that room's outline and floor pieces, from the user's own room file.
describe('a room built from photos still gets ideas', () => {
  const footprint: [number, number][] = [
    [-3, -2.191], [2.627, -2.191], [2.627, -0.185], [1.917, -0.185], [1.917, 1.56], [-3, 1.56],
  ];
  const scanned: ScenePart[] = [
    part({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [-0.048, 0, -1.84], dimMM: [1400, 700, 750], groupId: 'g' }),
    part({ id: 'chair', category: 'chair', shape: 'chair-office', pos: [-0.048, 0, -1.42], rot: Math.PI, dimMM: [600, 600, 1100], groupId: 'g' }),
    part({ id: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', pos: [-1.87, 0, -1.79], dimMM: [1800, 600, 2200] }),
    part({ id: 'fridge', category: 'fridge', shape: 'fridge', pos: [1.595, 0, 0.351], rot: -Math.PI / 2, dimMM: [600, 500, 800] }),
    part({ id: 'shoes', category: 'shelf', shape: 'shoe-rack', pos: [2.31, 0, -1.26], rot: -Math.PI / 2, dimMM: [800, 300, 900] }),
    part({ id: 'rail', category: 'wardrobe', shape: 'clothes-rack', pos: [1.02, 0, 1.23], rot: Math.PI, dimMM: [1200, 450, 1600] }),
    part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [-1.49, 0, 0.641], rot: Math.PI / 2, dimMM: [1520, 2000, 600] }),
    part({ id: 'door', category: 'door', shape: 'door', pos: [1.57, 1.07, -2.146], dimMM: [900, 50, 2100], wallMounted: true }),
  ].map((p) => ({ ...p, locked: true }));
  const room = { footprint, height: 2.8 };

  it('"from your photo" holds nothing in place; a Keep does', () => {
    expect(lockedForShuffle(scanned, {})).toEqual(scanned.map(() => false));
    expect(lockedForShuffle(scanned, { bed: true })).toEqual(scanned.map((p) => p.id === 'bed'));
    expect(movableFor(scanned, lockedForShuffle(scanned, {})).filter(Boolean)).toHaveLength(7);
  });

  it('offers ideas for it', () => {
    let ideas = 0;
    for (let attempt = 1; attempt <= 2 && ideas === 0; attempt++) {
      ideas += shuffleRoom(scanned, room, lockedForShuffle(scanned, {}), { attempt })?.ideas.length ?? 0;
    }
    expect(ideas).toBeGreaterThan(0);
  });
});
