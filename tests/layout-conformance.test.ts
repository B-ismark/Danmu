// Does the room report agree with the arrangement solver?
//
// `lib/layout-rules.ts` is read by two consumers that say different kinds of thing
// about the same table. `lib/clearance.ts` turns it into CHECKS — findings a user
// reads. `lib/layout-score.ts` turns it into COSTS — a number the annealer descends.
// `costBreakdown`'s own docstring states the goal ("a room report that agrees with
// the solver is worth more than one that merely runs beside it") and until now
// nothing held it to that.
//
// The failure this exists to catch has already shipped once: "Suggest" parked a bed
// across a doorway and then Room check reported the doorway as blocked. Both were
// reading `layout-rules`; only one of them was reading the part that mattered. A bug
// like that cannot be caught by testing either module alone, because neither is
// wrong on its own terms — they are wrong *relative to each other*.
//
// So the property here is a relation between the two:
//
//   For a pair of layouts over the SAME pieces, differing only in placement, where
//   the checker flags rule R in one and not the other, the solver's cost for the
//   term implementing R must be strictly higher in the flagged one.
//
// The per-term assertion is the point. Comparing totals would pass on a layout that
// is worse for unrelated reasons — a sofa 7° off square costs something too — and
// would not prove the two modules agree about WHICH rule was broken.
//
// `CLASSIFIED` below is the single table this file works from. An earlier draft let
// each fixture carry its own cost term as well, which is the same
// duplication-that-drifts this test exists to police: pointing the door rule at a
// taste weight left all 28 assertions green. The fixtures name a row in `CLASSIFIED`
// and nothing else, so there is one place to be wrong.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeRoom } from '@/lib/clearance';
import {
  costBreakdown,
  prepare,
  type CostBreakdown,
  type LayoutContext,
  type Placement,
  type ScoreWeights,
} from '@/lib/layout-score';
import { routeWidth, WALK_MIN } from '@/lib/layout-rules';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const ROOM = { footprint: RECT, height: 2.8 };
const ROUTE = routeWidth(RECT);

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `${p.category}-${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

/** Where a part already is, as a placement — the identity arrangement. */
const here = (p: ScenePart): Placement => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot });

/** Apply placements to parts, so the checker sees exactly what the scorer scored.
 *  Y is left alone: the solver works in the XZ plane and has no opinion about it. */
function moved(parts: ScenePart[], at: Placement[]): ScenePart[] {
  return parts.map((p, i) => ({
    ...p,
    pos: [at[i].x, p.pos[1], at[i].z] as [number, number, number],
    rot: at[i].yaw,
  }));
}

const issuesAt = (parts: ScenePart[], at: Placement[]) => analyzeRoom(moved(parts, at), ROOM).issues;

function costAt(parts: ScenePart[], at: Placement[]): CostBreakdown {
  const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: RECT };
  return costBreakdown(prepare(ctx), at);
}

const flagged = (parts: ScenePart[], at: Placement[], family: string) =>
  issuesAt(parts, at).some((i) => i.id.startsWith(family));

// ─── The one table ──────────────────────────────────────────────────────────

/** Every issue family `clearance.ts` can emit, and what the solver does about it.
 *
 *  `term` names the cost that implements the same rule. `unpriced` carries the
 *  REASON, because those are decisions rather than omissions and the next person to
 *  read the list should not have to re-derive them. */
const CLASSIFIED = {
  door: { term: 'door' },
  entry: { term: 'door' },
  clash: { term: 'overlap' },
  walk: { term: 'walkway' },
  window: { term: 'window' },
  tv: { term: 'relation' },
  // The zone families, written through ZONE_ISSUE_ID: front / bed / seats / seat /
  // push-back all come out of one loop over `accessRules`, so they are one row.
  zone: { term: 'access' },

  tall: {
    unpriced:
      'a fact about the piece’s SIZE, not its placement. The solver moves and turns, ' +
      'and the type it works in has no field a dimension could travel in, so no ' +
      'arrangement it can reach would fix this. Reported, never optimised.',
  },
  crowding: {
    unpriced:
      'a property of the whole room — too much furniture for the floor. No ' +
      'rearrangement removes a piece, so there is nothing for a cost to descend.',
  },
  reach: {
    unpriced:
      'connectivity, priced by `navigabilityCost` rather than a scoreLayout term — it ' +
      'needs the clearance field, which is too expensive per proposal and is run over ' +
      'the finalists instead.',
  },
  'cut-off': { unpriced: 'as `reach` — a connected-component question, priced by `navigabilityCost`.' },
  turning: {
    unpriced:
      'accessibility-only and off by default (`AnalyzeOptions.accessibility`). Costing ' +
      'it unasked would move furniture to satisfy a rule the user never opted into.',
  },
} satisfies Record<string, { term: keyof ScoreWeights } | { unpriced: string }>;

type Family = keyof typeof CLASSIFIED;

/** The cost term for a family, or null when the solver deliberately does not price it. */
function termFor(family: Family): keyof ScoreWeights | null {
  const how = CLASSIFIED[family];
  return 'term' in how ? how.term : null;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const chair = () => part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0] });
const sofa = () => part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
const wardrobe = () => part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0] });
const tv = () => part({ category: 'tv', shape: 'tv', dimMM: [1450, 60, 830], pos: [0, 1.2, -1.95], wallMounted: true });
const door = () => part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true });
// On the NORTH wall, so it faces the room down -Z and carries `rot: π` to say so.
// A window's zone is a sightline out of its own front, and left at rot 0 the whole
// band points through the wall into the garden — where nothing can ever block it,
// which is exactly how a fixture ends up proving nothing.
const window_ = () =>
  part({ category: 'other', shape: 'window', dimMM: [1200, 50, 1200], pos: [0, 1.1, 1.95], rot: Math.PI, wallMounted: true });

/** Half the depth of a part, metres — what a face-to-face gap is measured from. */
const halfDepth = (p: ScenePart) => p.dimMM[1] / 2000;

type Case = {
  /** The row in `CLASSIFIED` this pair exercises. The cost term comes from there. */
  family: Family;
  /** Prefix of the `ClearanceIssue.id` the checker reports it under. Usually the
   *  family name, but the zone row reports under each rule's own id. */
  reportedAs: string;
  what: string;
  parts: ScenePart[];
  bad: Placement[];
  good: Placement[];
};

function cases(): Case[] {
  const out: Case[] = [];

  // ── A door's swing ────────────────────────────────────────────────────────
  {
    const d = door();
    const c = chair();
    out.push({
      family: 'door',
      reportedAs: 'door-',
      what: 'a chair standing in the door’s swing',
      parts: [d, c],
      bad: [here(d), { x: 0.3, z: -1.5, yaw: 0 }],
      good: [here(d), { x: 2.4, z: 1.5, yaw: 0 }],
    });
  }

  // ── The way in from a door ────────────────────────────────────────────────
  // Past the leaf's own sweep, but across the route someone walks in along — a
  // separate finding from `door-`, priced by the same term.
  {
    const d = door();
    const s = sofa();
    out.push({
      family: 'entry',
      reportedAs: 'entry-',
      what: 'a sofa across the way in from the door',
      parts: [d, s],
      bad: [here(d), { x: 0, z: -0.75, yaw: 0 }],
      good: [here(d), { x: 0, z: 1.5, yaw: 0 }],
    });
  }

  // ── Two pieces in the same place ──────────────────────────────────────────
  {
    const s = sofa();
    const w = wardrobe();
    out.push({
      family: 'clash',
      reportedAs: 'clash-',
      what: 'a sofa and a wardrobe in the same place',
      parts: [s, w],
      bad: [
        { x: 0, z: 0, yaw: 0 },
        { x: 0, z: 0, yaw: 0 },
      ],
      good: [
        { x: -2, z: 1.4, yaw: 0 },
        { x: 2, z: -1.6, yaw: 0 },
      ],
    });
  }

  // ── A walkway too narrow to use ───────────────────────────────────────────
  // Gaps are derived from the rule rather than typed: a bad gap well under WALK_MIN
  // even after the field's quantisation band, a good one past the route width this
  // room is big enough to be asked for.
  {
    const s = sofa();
    const w = wardrobe();
    const faces = halfDepth(s) + halfDepth(w);
    const tight = faces + WALK_MIN * 0.4;
    const clear = faces + ROUTE + 0.5;
    out.push({
      family: 'walk',
      reportedAs: 'walk-',
      what: `a ${Math.round(WALK_MIN * 0.4 * 100)} cm gap between two bulky pieces`,
      parts: [s, w],
      bad: [
        { x: 0, z: -tight / 2, yaw: 0 },
        { x: 0, z: tight / 2, yaw: 0 },
      ],
      good: [
        { x: 0, z: -clear / 2, yaw: 0 },
        { x: 0, z: clear / 2, yaw: 0 },
      ],
    });
  }

  // ── A functional zone with something standing in it ───────────────────────
  // The wardrobe backs onto the north wall and faces the room, so a π turn points
  // its doors at -z; the chair stands where they open.
  {
    const w = wardrobe();
    const c = chair();
    out.push({
      family: 'zone',
      reportedAs: 'front-',
      what: 'a chair parked where the wardrobe doors open',
      parts: [w, c],
      bad: [
        { x: 0, z: 1.68, yaw: Math.PI },
        { x: 0, z: 1.0, yaw: 0 },
      ],
      good: [
        { x: 0, z: 1.68, yaw: Math.PI },
        { x: 2.5, z: -1.5, yaw: 0 },
      ],
    });
  }

  // ── Something tall in front of a window ───────────────────────────────────
  {
    const win = window_();
    const w = wardrobe();
    out.push({
      family: 'window',
      reportedAs: 'window-',
      what: 'a wardrobe standing in front of the window',
      parts: [win, w],
      bad: [here(win), { x: 0, z: 1.6, yaw: 0 }],
      good: [here(win), { x: 0, z: -1.6, yaw: 0 }],
    });
  }

  // ── A seat too close to the screen ────────────────────────────────────────
  // The relation table carries this one as a multiple of the screen diagonal rather
  // than a constant, which is why it belongs in the same sweep as the fixed
  // thresholds: a multiple is exactly the kind of rule two consumers restate
  // differently.
  {
    const t = tv();
    const s = sofa();
    out.push({
      family: 'tv',
      reportedAs: 'tv-',
      what: 'a sofa closer to the screen than the diagonal allows',
      parts: [t, s],
      bad: [here(t), { x: 0, z: -1.0, yaw: 0 }],
      good: [here(t), { x: 0, z: 0.6, yaw: 0 }],
    });
  }

  return out;
}

describe('layout-rules · the checker and the solver agree', () => {
  for (const c of cases()) {
    const term = termFor(c.family);

    describe(`${c.reportedAs} ↔ ${term}`, () => {
      it('is a rule the solver claims to price', () => {
        expect(term, `${c.family} is classified unpriced, so this pair should not exist`).not.toBeNull();
      });

      it(`the room report flags ${c.what}`, () => {
        expect(flagged(c.parts, c.bad, c.reportedAs)).toBe(true);
      });

      it('the room report is quiet about the same pieces placed well', () => {
        // Without this the pair proves nothing: a rule that fires on every layout
        // would satisfy the assertion above and discriminate nothing.
        expect(flagged(c.parts, c.good, c.reportedAs)).toBe(false);
      });

      it(`the solver charges ${term} for it`, () => {
        const bad = costAt(c.parts, c.bad);
        const good = costAt(c.parts, c.good);
        expect(
          bad[term!],
          `clearance flags ${c.reportedAs} but layout-score's ${term} does not rise: ` +
            `${good[term!].toFixed(3)} → ${bad[term!].toFixed(3)}`,
        ).toBeGreaterThan(good[term!]);
      });

      it('and prefers the layout the report is happy with', () => {
        // The weights are a hierarchy, so a fault should also dominate whatever
        // taste terms the two layouts happen to differ on.
        expect(costAt(c.parts, c.good).total).toBeLessThan(costAt(c.parts, c.bad).total);
      });
    });
  }
});

// ─── The anti-drift guard ───────────────────────────────────────────────────

/** The families `clearance.ts` actually emits, read out of its source.
 *
 *  Reading the file is deliberate, and the same trick `color-tokens.test.ts` uses on
 *  `globals.css`: the point is to fail when someone ADDS a finding, which a test
 *  that only exercised the current ones could never do. */
function emittedFamilies(): Set<string> {
  const src = readFileSync(join(process.cwd(), 'lib', 'clearance.ts'), 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/^\s*id: (['`])(.*?)\1,$/gm)) {
    const body = m[2];
    // `${ZONE_ISSUE_ID[rule.id] ?? rule.id}-${p.id}` — the family is computed, so
    // the whole access-zone group is classified under one name.
    if (body.startsWith('${')) {
      out.add('zone');
      continue;
    }
    // `door-${door.id}` → door; 'crowding' → crowding.
    out.add(body.split('${')[0].replace(/-+$/, ''));
  }
  return out;
}

describe('layout-rules · nothing is reported without a decision about the solver', () => {
  it('reads the families out of clearance.ts at all', () => {
    // If the regex ever stops matching, every assertion below passes vacuously.
    const found = emittedFamilies();
    expect(found.size).toBeGreaterThanOrEqual(10);
    expect(found).toContain('door');
    expect(found).toContain('crowding');
    expect(found).toContain('zone');
  });

  it('classifies every family clearance.ts can emit', () => {
    const unclassified = [...emittedFamilies()].filter((f) => !(f in CLASSIFIED)).sort();
    expect(
      unclassified,
      `clearance.ts emits ${unclassified.join(', ')}, which the solver neither prices nor ` +
        'declines. Add it to CLASSIFIED with a cost term, or with the reason a cost ' +
        'cannot express it.',
    ).toEqual([]);
  });

  it('classifies nothing that clearance.ts no longer emits', () => {
    // The other direction: a stale entry would let a real family go unnoticed by
    // making the list look complete.
    const emitted = emittedFamilies();
    const stale = Object.keys(CLASSIFIED).filter((f) => !emitted.has(f)).sort();
    expect(stale, `CLASSIFIED still lists ${stale.join(', ')} — clearance.ts no longer emits it.`).toEqual([]);
  });

  it('exercises every family it claims the solver prices', () => {
    // Closes the last way this file could lie: a row could name a cost term with no
    // pair of layouts proving the two modules move together on it.
    const covered = new Set(cases().map((c) => c.family));
    const priced = (Object.keys(CLASSIFIED) as Family[]).filter((f) => termFor(f) !== null);
    const untested = priced.filter((f) => !covered.has(f)).sort();
    expect(
      untested,
      `${untested.join(', ')} claim a cost term with no layout pair holding the two ` +
        'modules to it. Add a case, or reclassify.',
    ).toEqual([]);
  });
});
