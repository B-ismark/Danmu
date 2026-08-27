// What a zone finding SAYS, and which rectangle it measured to say it.
//
// Two bugs lived here, both of them silent, and both of them read from the outside
// as the arithmetic being wrong when the arithmetic was fine.
//
// 1. **A headline keyed on a React key.** `AccessRule.id` is deliberately shared —
//    seven roles want their front clear and all of them key their finding on
//    `'front'` — and `lib/clearance.ts` looked the *headline* up in a table keyed on
//    that same id. So a sofa's seat clearance inherited the wardrobe's caption, and a
//    sofa 4 cm off the wall was reported as **"Doors can't open"** above a sentence
//    about standing up out of a sofa.
//
// 2. **A measurement wider than the rule.** A rule's `span` is the share of the face
//    its zone claims, and `lib/layout-score.ts` costs exactly that rectangle.
//    `faceClearance` took no span, so the report probed the whole face. A neighbour
//    standing off the end of a sofa — inside the outer tenth, outside the zone —
//    made the report say "0 cm in front" about floor the solver scored as completely
//    clear, and the finding then carried a **Try a fix** button that could not move
//    anything, because nothing it was allowed to move was costing anything.
//
// Neither could be caught by testing either module alone. The first is a caption
// against a rule; the second is a report against a cost.

import { describe, it, expect } from 'vitest';
import { analyzeRoom } from '@/lib/clearance';
import { faceClearance, type OBB } from '@/lib/geometry';
import { accessRules } from '@/lib/layout-rules';
import { costBreakdown, prepare, type LayoutContext } from '@/lib/layout-score';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const ROOM = { footprint: RECT, height: 2.8 };

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

const sofa = (pos: [number, number, number], rot = 0) =>
  part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos, rot, name: 'Sofa' });

/** One sample per role that has an access rule, so the sweep below covers the whole
 *  table rather than the two entries someone remembered. */
const ROLE_SAMPLES: Array<[string, Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>]> = [
  ['wardrobe', { category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0] }],
  ['fridge', { category: 'fridge', shape: 'fridge', dimMM: [600, 650, 1800], pos: [0, 0, 0] }],
  ['bookshelf', { category: 'shelf', shape: 'bookshelf', dimMM: [900, 320, 1800], pos: [0, 0, 0] }],
  ['shoe-rack', { category: 'shelf', shape: 'shoe-rack', dimMM: [800, 300, 500], pos: [0, 0, 0] }],
  ['appliance', { category: 'other', shape: 'washing-machine', dimMM: [600, 600, 850], pos: [0, 0, 0] }],
  ['sofa', { category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] }],
  ['armchair', { category: 'chair', shape: 'chair-armchair', dimMM: [800, 850, 900], pos: [0, 0, 0] }],
  ['bed', { category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 500], pos: [0, 0, 0] }],
  ['dining-table', { category: 'table', shape: 'desk-standard', dimMM: [1400, 800, 750], pos: [0, 0, 0] }],
  ['desk', { category: 'desk', shape: 'desk-l', dimMM: [1400, 700, 750], pos: [0, 0, 0] }],
  ['office-chair', { category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1000], pos: [0, 0, 0] }],
  ['door', { category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, 0] }],
  ['window', { category: 'other', shape: 'window', dimMM: [1200, 50, 1200], pos: [0, 1.1, 0] }],
];

describe('every access rule states its own headline', () => {
  it('gives every rule a title worth reading', () => {
    let seen = 0;
    for (const [label, p] of ROLE_SAMPLES) {
      for (const r of accessRules(p)) {
        seen++;
        expect(r.title, label).toBeTruthy();
        expect(r.title.length, label).toBeGreaterThan(3);
      }
    }
    // The sweep has to actually sweep: a sample list that stopped resolving to roles
    // would pass every assertion above by making none of them.
    expect(seen).toBeGreaterThanOrEqual(ROLE_SAMPLES.length);
  });

  it('never lets two different requirements share one sentence', () => {
    // Keyed by what the rule ASKS FOR — its depth and its reason. Two roles that
    // genuinely want the same thing may share a headline; two that want different
    // things may not, and that is precisely what the old id-keyed table did.
    const byTitle = new Map<string, Set<string>>();
    for (const [, p] of ROLE_SAMPLES) {
      for (const r of accessRules(p)) {
        const want = `${r.depth}|${r.reason}`;
        const seen = byTitle.get(r.title) ?? new Set<string>();
        seen.add(want);
        byTitle.set(r.title, seen);
      }
    }
    for (const [title, wants] of byTitle) {
      expect([...wants], `"${title}" is the headline for more than one requirement`).toHaveLength(1);
    }
  });

  it('does not title a sofa’s finding after a wardrobe’s doors', () => {
    // The reported bug as a room: a sofa facing the south wall from 40 mm away.
    const report = analyzeRoom([sofa([0, 0, 1.485])], ROOM);
    const zone = report.issues.find((i) => i.rule === 'zone');
    expect(zone, 'a sofa 4 cm off the wall it faces is a finding').toBeDefined();
    expect(zone!.detail).toContain('Sofa');
    expect(zone!.title.toLowerCase()).not.toContain('door');
    expect(zone!.title).toBe('No room to get out of the sofa');
  });

  it('says the measurement it actually took', () => {
    // 40 mm, derived — not a number typed next to the thing it describes.
    const zone = analyzeRoom([sofa([0, 0, 1.485])], ROOM).issues.find((i) => i.rule === 'zone');
    expect(zone!.detail).toMatch(/has 4 cm in front/);
    expect(zone!.detail).toMatch(/needs 35 cm/);
  });
});

describe('a zone finding and its cost read the same rectangle', () => {
  /** The solver's access cost for this arrangement. */
  const accessCost = (parts: ScenePart[]) => {
    const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: RECT };
    return costBreakdown(
      prepare(ctx),
      parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot })),
    ).access;
  };

  // The measurement itself, at the level the bug lived. A 2.2 m sofa's front face is
  // ±1.10 m and its rule's span of 0.9 claims ±0.99 m; an obstacle sitting in the
  // outer tenth is inside the face and outside the zone. Asserted on `faceClearance`
  // directly because that is the function that took no span, and a room-level
  // fixture would prove it only through whichever role the catalog happened to give
  // a 300 mm box.
  const face: OBB = { cx: 0, cz: 0, hw: 1.1, hd: 0.475, rot: 0 };
  const inTheOuterTenth: OBB = { cx: 1.05, cz: 0.6, hw: 0.05, hd: 0.15, rot: 0 };
  const squarelyInFront: OBB = { cx: 0.3, cz: 0.6, hw: 0.15, hd: 0.15, rot: 0 };

  it('does not measure the part of the face the rule does not claim', () => {
    expect(faceClearance(face, '+z', [inTheOuterTenth], RECT, 0.7, 0.9)).toBeGreaterThan(0.35);
  });

  it('…and does measure it when the rule claims the whole face', () => {
    expect(faceClearance(face, '+z', [inTheOuterTenth], RECT, 0.7, 1)).toBeLessThan(0.35);
  });

  it('sees an obstacle inside the span at any span', () => {
    for (const span of [0.8, 0.9, 1]) {
      expect(faceClearance(face, '+z', [squarelyInFront], RECT, 0.7, span), `span ${span}`).toBeLessThan(0.35);
    }
  });

  // The property the span bug broke, stated where a user meets it: something
  // squarely in front of a sofa is both a finding and a cost, and moving it away is
  // both no finding and no cost. A plant, because the catalog reads a 300 mm box as
  // a side table — and a side table in front of a sofa is the arrangement working,
  // not a fault (see `ZONE_GUESTS`).
  const plantAt = (x: number) =>
    part({ category: 'plant', shape: 'plant', dimMM: [400, 400, 1200], pos: [x, 0, 0.6], name: 'Plant' });
  const blocked = () => [sofa([0, 0, 0]), plantAt(0.3)];
  const clear = () => [sofa([0, 0, 0]), plantAt(2.4)];

  it('flags the blocked one and costs it', () => {
    const room = blocked();
    const flagged = analyzeRoom(room, ROOM).issues.filter((i) => i.rule === 'zone');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].partIds).toContain(room[0].id);
    expect(accessCost(room)).toBeGreaterThan(0);
  });

  it('flags nothing on the clear one, and costs nothing either', () => {
    expect(analyzeRoom(clear(), ROOM).issues.filter((i) => i.rule === 'zone')).toHaveLength(0);
    expect(accessCost(clear())).toBe(0);
  });
});

// ─── A fixed probe count is a sampling rate in disguise ─────────────────────
//
// `faceClearance` cast five rays whatever the face was, so on a 2.2 m sofa they stood
// 0.49 m apart and a 300 mm object could sit squarely in front of the seat, between
// two of them, and be reported as not there. It is the exact failure the function's
// own doc comment calls "the worst kind of wrong" — a silent false negative in the
// module the product describes as reproducible math you can plan a room around.
describe('nothing narrow can hide between two probes', () => {
  const wide: OBB = { cx: 0, cz: 0, hw: 1.1, hd: 0.475, rot: 0 };

  it('finds a 300 mm obstacle wherever it stands across a 2.2 m face', () => {
    // Every 25 mm across the claimed span, so no offset is a lucky one.
    for (let x = -0.9; x <= 0.9; x += 0.025) {
      const blocker: OBB = { cx: x, cz: 0.62, hw: 0.15, hd: 0.15, rot: 0 };
      expect(faceClearance(wide, '+z', [blocker], RECT, 0.7, 0.9), `at x=${x.toFixed(3)}`).toBeLessThan(0.35);
    }
  });

  it('and still reports a genuinely empty face as empty', () => {
    expect(faceClearance(wide, '+z', [], RECT, 0.7, 0.9)).toBeCloseTo(0.7, 5);
  });
});
