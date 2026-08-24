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
// The mapping this file checks against is `RULE_HANDLING` in `lib/layout-score.ts`,
// which is production knowledge rather than a fixture: the room report reads the same
// rows to decide which findings to offer a fix for. Two earlier drafts got this wrong
// in the same way and are worth recording, because both bugs were the exact thing
// this file exists to catch, reproduced inside it. The first kept the mapping
// privately here, making the test a third restatement of the table. The second let
// each fixture carry its own cost term beside the classification — aiming the door
// rule at a taste weight left all 28 assertions green. A fixture now names a row and
// nothing else.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeRoom } from '@/lib/clearance';
import {
  costBreakdown,
  prepare,
  RULE_HANDLING,
  type CostBreakdown,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { RULE_KINDS, routeWidth, WALK_MIN, type RuleKind } from '@/lib/layout-rules';
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

/** Does the report raise this rule for this arrangement? Matched on the finding's
 *  `rule`, which is the contract — the id is built for React keys, and reading a
 *  type out of its prefix is what `RuleKind` exists to stop. */
const flagged = (parts: ScenePart[], at: Placement[], family: Family) =>
  issuesAt(parts, at).some((i) => i.rule === family);

// ─── The one table, which lives in the app ──────────────────────────────────
//
// `RULE_HANDLING` in `lib/layout-score.ts` is what this file checks against, and it
// is not a fixture: the room report reads the same rows to decide which findings to
// offer a fix for. An earlier draft of this test kept its own private copy of the
// mapping, which made the test the third restatement of a table whose duplication it
// exists to police. Checking production knowledge is the point — a wrong row here is
// a wrong button in the UI, not just a red test.

type Family = RuleKind;

const termFor = (family: Family) => RULE_HANDLING[family].costTerm;

// ─── Fixtures ───────────────────────────────────────────────────────────────

const chair = () => part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0] });
const sofa = () => part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
const wardrobe = () => part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0] });
const diningTable = () =>
  part({ category: 'table', shape: 'desk-standard', dimMM: [1400, 800, 750], pos: [0, 0, 0] });
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
  /** The `RULE_HANDLING` row this pair exercises. The cost term comes from there. */
  family: Family;
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
    // …and a dining table with two chairs beside each other, identical in both
    // layouts and 400 mm apart, which is what a laid table looks like. They are here
    // to hold the OTHER direction: the report does not count a chair-to-chair gap as
    // a walkway, and until `formsRoute` was shared the solver counted every obstacle
    // pair and charged this arrangement `walkway 40.4`. It then flung the dining set
    // across the room to fix a fault nothing had reported, and said so in the toast.
    // Without these three pieces the case below passes whether or not that is fixed.
    const t = diningTable();
    const c1 = chair();
    const c2 = chair();
    const seat = { z: 0.4 + halfDepth(c1) - 0.12, gap: 0.44 };
    const laid: Placement[] = [
      { x: 1.6, z: 0, yaw: 0 },
      { x: 1.6 - seat.gap, z: seat.z, yaw: Math.PI },
      { x: 1.6 + seat.gap, z: seat.z, yaw: Math.PI },
    ];
    out.push({
      family: 'walk',
      what: `a ${Math.round(WALK_MIN * 0.4 * 100)} cm gap between two bulky pieces`,
      parts: [s, w, t, c1, c2],
      bad: [{ x: -1.6, z: -tight / 2, yaw: 0 }, { x: -1.6, z: tight / 2, yaw: 0 }, ...laid],
      good: [{ x: -1.6, z: -clear / 2, yaw: 0 }, { x: -1.6, z: clear / 2, yaw: 0 }, ...laid],
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
      what: 'a sofa closer to the screen than the diagonal allows',
      parts: [t, s],
      // Both sofas face the screen on the north wall, so the pair differs in
      // DISTANCE and nothing else — which is the rule under test. The good one used
      // to be left at yaw 0, i.e. backed onto the screen it is supposed to be
      // watching and facing the south wall; that cost nothing while a backwards
      // piece was priced at four units, and became the more expensive of the two the
      // moment facing the wrong way started costing what it is worth.
      bad: [here(t), { x: 0, z: -1.0, yaw: Math.PI }],
      good: [here(t), { x: 0, z: 0.6, yaw: Math.PI }],
    });
  }

  return out;
}

describe('layout-rules · the checker and the solver agree', () => {
  for (const c of cases()) {
    const term = termFor(c.family);

    describe(`${c.family} ↔ ${term}`, () => {
      it('is a rule the solver claims to price', () => {
        expect(term, `${c.family} is classified unpriced, so this pair should not exist`).not.toBeNull();
      });

      it(`the room report flags ${c.what}`, () => {
        expect(flagged(c.parts, c.bad, c.family)).toBe(true);
      });

      it('the room report is quiet about the same pieces placed well', () => {
        // Without this the pair proves nothing: a rule that fires on every layout
        // would satisfy the assertion above and discriminate nothing.
        expect(flagged(c.parts, c.good, c.family)).toBe(false);
      });

      it(`the solver charges ${term} for it`, () => {
        const bad = costAt(c.parts, c.bad);
        const good = costAt(c.parts, c.good);
        expect(
          bad[term!],
          `clearance flags ${c.family} but layout-score's ${term} does not rise: ` +
            `${good[term!].toFixed(3)} → ${bad[term!].toFixed(3)}`,
        ).toBeGreaterThan(good[term!]);
      });

      it('and prefers the layout the report is happy with', () => {
        // The weights are a hierarchy, so a fault should also dominate whatever
        // taste terms the two layouts happen to differ on.
        expect(costAt(c.parts, c.good).total).toBeLessThan(costAt(c.parts, c.bad).total);
      });

      it('and charges nothing on that term for the layout it is happy with', () => {
        // The direction this file was missing, and the one that let 40 cost units
        // through. It held the solver to the report — no arrangement the solver
        // finishes with may still be one the report calls broken — but never the
        // report to the solver, so the solver was free to police rules the report
        // does not have. It did: it charged EVERY obstacle pair for a walkway,
        // against a route that widened to 900 mm in a large room, while the report
        // only ever counts bulky pairs at 600 mm. Three dining chairs 400 mm apart
        // around their own table cost `walkway 40.4` on a room `analyzeRoom` reported
        // nothing about — so "Suggest" flung the dining set across the floor and
        // announced that it had widened the walkways.
        //
        // A term may still be non-zero where the report is quiet: `wall`, `relation`
        // and the other taste terms are gradients with no finding behind them. This
        // holds only the terms that implement a REPORTED rule, which is exactly the
        // set `RULE_HANDLING` names.
        expect(
          costAt(c.parts, c.good)[term!],
          `the room report is quiet about this layout, but layout-score charges ${term} for it — ` +
            'the two are policing different rules again',
        ).toBe(0);
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
  for (const m of src.matchAll(/^\s*rule: '([a-z-]+)',$/gm)) out.add(m[1]);
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

  it('classifies every rule clearance.ts can emit', () => {
    // `RULE_HANDLING` is a Record over `RuleKind`, so the compiler already refuses a
    // kind that is declared and unhandled. This catches the step before that: a rule
    // string that never made it into `RULE_KINDS` at all.
    const unclassified = [...emittedFamilies()].filter((f) => !(f in RULE_HANDLING)).sort();
    expect(
      unclassified,
      `clearance.ts emits ${unclassified.join(', ')}, which the solver neither prices nor ` +
        'declines. Add it to RULE_KINDS and give it a row in RULE_HANDLING, saying either ' +
        'which cost term implements it or why a cost cannot.',
    ).toEqual([]);
  });

  it('classifies nothing clearance.ts no longer emits', () => {
    // The other direction, and the one no type can check: a stale row makes the table
    // look complete while a real rule goes unnoticed, and it also means the room
    // report may be offering a fix for something that can no longer happen.
    const emitted = emittedFamilies();
    const stale = Object.keys(RULE_HANDLING).filter((f) => !emitted.has(f)).sort();
    expect(stale, `RULE_HANDLING still lists ${stale.join(', ')} — clearance.ts no longer emits it.`).toEqual([]);
  });

  it('exercises every family it claims the solver prices', () => {
    // Closes the last way this file could lie: a row could name a cost term with no
    // pair of layouts proving the two modules move together on it.
    const covered = new Set(cases().map((c) => c.family));
    const priced = (RULE_KINDS as readonly Family[]).filter((f) => termFor(f) !== null);
    const untested = priced.filter((f) => !covered.has(f)).sort();
    expect(
      untested,
      `${untested.join(', ')} claim a cost term with no layout pair holding the two ` +
        'modules to it. Add a case, or reclassify.',
    ).toEqual([]);
  });
});
