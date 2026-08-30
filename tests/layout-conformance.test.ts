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
  DEFAULT_WEIGHTS,
  NAV_CELL,
  prepare,
  RULE_HANDLING,
  type CostBreakdown,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { RULE_KINDS, routeWidth, TUCKED_CLASH_SHARE, WALK_MIN, type RuleKind } from '@/lib/layout-rules';
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
  // With the navigation term ON: it is the term `reach` and `cut-off` name, and a
  // conformance test that left it at zero could never hold them to anything.
  return costBreakdown(prepare(ctx), at, undefined, NAV_CELL);
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
      // Turned round. At yaw 0 this "good" layout had the sofa 20 mm from the south
      // wall and facing it — the report raised `zone` on it ("2 cm in front") and the
      // navigation term found 2 m² with no route to the door. It passed anyway while
      // facing the wrong way cost four units and nothing priced reachability; the
      // fixture was clean only on the one rule it was named for.
      good: [here(d), { x: 0, z: 1.5, yaw: Math.PI }],
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

  // ── …and the same rule for a pair that is ALLOWED to share floor ──────────
  //
  // The fixture above is a sofa and a wardrobe, which `sharesFloor` says nothing
  // about — so it cannot express the way these two modules actually came apart.
  // A dining chair and a table are *supposed* to overlap: `clearance.ts` forgives
  // them up to `TUCKED_CLASH_SHARE`, and `layout-score.ts` used to forgive them
  // **entirely**, a blanket `continue` with no bar at all. Same predicate, one
  // threshold, and the file that owned the number said in a comment that the two
  // "cannot disagree about whether a tucked-in chair is a collision".
  //
  // They disagreed for every chair past 85%: the solver would happily bury one
  // completely inside the table for free and the report called the result a clash.
  // Invisible while the only caller was inertia-anchored — a repair barely moves
  // anything — and 8 of 40 arrangements once anything searched from a scattered
  // start.
  //
  // `bad` is the chair standing exactly where the table is (share 1.0); `good` is
  // the chair pushed hard under its near edge, at share 0.25 — comfortably under
  // the bar, so the pair also pins that the fix did NOT make ordinary tucking
  // expensive. (0.25 is this fixture's own measured share. The 0.231 quoted in
  // `lib/layout-rules.ts` is a different number about a different room — what the
  // seeded `t` and `open` presets actually produce — and the two were briefly
  // conflated here, which is the hand-typed-measurement trap rule 2 names.)
  {
    const t = diningTable();
    const c = part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 480, 900], pos: [0, 0, 0] });
    out.push({
      family: 'clash',
      what: 'a dining chair buried in the table rather than tucked under it',
      parts: [t, c],
      bad: [
        { x: 0, z: 0, yaw: 0 },
        { x: 0, z: 0, yaw: 0 },
      ],
      good: [
        { x: 0, z: 0, yaw: 0 },
        // Half the table's depth out, less a little, so the chair's own footprint
        // is mostly clear of it — a chair at the table, not inside it.
        { x: 0, z: 0.52, yaw: Math.PI },
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

  // ── Half the room sealed off ──────────────────────────────────────────────
  //
  // The case that had no fixture, and no term, for as long as `reach` and `cut-off`
  // claimed to be "priced over the finalists". A line of dining chairs across the
  // room: nothing overlaps, no zone is blocked, the door swings freely and its route
  // in is clear, and chairs are not route-formers so the walkway term is blind. Every
  // pairwise term is happy and half the floor has no way to it.
  //
  // The good layout is the same seven chairs stacked in a corner, which is untidy and
  // is not a fault — the point of the pair is that only reachability separates them.
  {
    const d = door();
    const w = wardrobe();
    const chairs = Array.from({ length: 7 }, () => chair());
    const across: Placement[] = chairs.map((_, i) => ({ x: -2.6 + i * 0.867, z: 0.2, yaw: 0 }));
    // Clear of every wall by more than a walkway, and clear of the door's swing and
    // the route in from it — otherwise the "good" layout seals a strip of floor behind
    // itself and is no better than the bad one, which is exactly what a first draft of
    // this fixture did: 2.66 m² stranded behind a block pushed against the west wall.
    const stacked: Placement[] = chairs.map((_, i) => ({
      x: -1.2 + (i % 4) * 0.6,
      z: i < 4 ? -0.3 : 0.3,
      yaw: 0,
    }));
    // Behind the line, so it is the piece that cannot be got to.
    const stranded: Placement = { x: 2, z: 1.6, yaw: Math.PI };

    out.push({
      family: 'cut-off',
      what: 'a line of chairs sealing off half the floor',
      parts: [d, w, ...chairs],
      bad: [here(d), stranded, ...across],
      good: [here(d), stranded, ...stacked],
    });
    out.push({
      family: 'reach',
      what: 'a wardrobe on the far side of that line',
      parts: [d, w, ...chairs],
      bad: [here(d), stranded, ...across],
      good: [here(d), stranded, ...stacked],
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

// ─── The bar itself, which a good/bad pair cannot reach ─────────────────────
//
// The `clash` fixtures above straddle `TUCKED_CLASH_SHARE` at share 1.0 against
// 0.25, and a pair like that proves the rule fires — not that the two modules meet
// cleanly at the number they now share. It cannot: the harness asserts a term
// *rises* between two layouts, which stays true however shallow the ramp is and
// wherever the boundary sits. A near-bar pair was written first and survived
// mutating BOTH defects below, which is the "fixture that cannot express the
// defect" this repo keeps finding — so the bar gets direct assertions instead.
describe('layout-rules · the report and the solver meet cleanly at TUCKED_CLASH_SHARE', () => {
  /** A dining chair sitting `share` of its own footprint inside the table.
   *  Both are centred on x and the chair is the narrower, so the share is purely
   *  the z overlap over the chair's own depth. */
  function tuckedAt(share: number) {
    const t = diningTable();
    const c = part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 480, 900], pos: [0, 0, 0] });
    const chairD = c.dimMM[1] / 1000;
    const z = t.dimMM[1] / 2000 + chairD / 2 - chairD * share;
    const at: Placement[] = [
      { x: 0, z: 0, yaw: 0 },
      { x: 0, z, yaw: Math.PI },
    ];
    return { parts: [t, c], at };
  }

  it('the geometry helper actually produces the share it is asked for', () => {
    // The floor under both assertions below: if `tuckedAt` were wrong, each of them
    // would be measuring some other arrangement and passing for the wrong reason.
    // Read back off the solver, since `overlap` is a known function of the share.
    for (const want of [0.5, 0.9]) {
      const { parts, at } = tuckedAt(want);
      const got = 1 - (1 - costAt(parts, at).overlap / 1000) * (1 - TUCKED_CLASH_SHARE);
      if (want > TUCKED_CLASH_SHARE) expect(got).toBeCloseTo(want, 3);
    }
    // …and one below the bar must genuinely cost nothing, or the read-back above is
    // reading a saturated zero and would agree with anything.
    expect(costAt(...Object.values(tuckedAt(0.5)) as [ScenePart[], Placement[]]).overlap).toBe(0);
    expect(costAt(...Object.values(tuckedAt(0.9)) as [ScenePart[], Placement[]]).overlap).toBeGreaterThan(0);
  });

  it('across the bar’s whole neighbourhood, the two never disagree', () => {
    // What the exact-bar case turned out to be, once measured rather than reasoned
    // about. The two comparisons DID face opposite ways — the report flagged at
    // `>=` the bar while the solver charges the excess above it, which is 0 there —
    // so in principle a share of exactly 0.85 was a finding the solver could not
    // see, carrying a **Try a fix** button that could do nothing. Aligning them is
    // still right and costs nothing.
    //
    // **But it is measure-zero and this test says so rather than pretending.** The
    // share is a quotient of two float geometry results; it lands a part in 1e15
    // either side of the bar and never on it, so no fixture can sit a piece exactly
    // there and the old boundary was unobservable in practice. Asserting the
    // neighbourhood is the honest version: at every sample, the report flagging and
    // the solver charging must be the same answer. That catches any divergence with
    // real width, which is the only kind a user can meet.
    const disagreements: string[] = [];
    for (let k = -20; k <= 20; k++) {
      const share = TUCKED_CLASH_SHARE + k * 0.002;
      if (share <= 0 || share >= 1) continue;
      const { parts, at } = tuckedAt(share);
      // `> 0`, not `> epsilon`. An epsilon here re-creates the very mismatch this
      // is looking for: at the sample sitting a part in 1e15 above the bar the
      // solver charges ~1e-14, which any tolerance above that reads as "silent"
      // while the report — correctly — flags. The question is whether the solver
      // charges at all.
      const charges = costAt(parts, at).overlap > 0;
      const reports = flagged(parts, at, 'clash');
      if (charges !== reports) {
        disagreements.push(`share ${share.toFixed(3)}: solver ${charges ? 'charges' : 'silent'}, report ${reports ? 'flags' : 'quiet'}`);
      }
    }
    expect(disagreements, disagreements.join('\n')).toEqual([]);
  });

  it('just past the bar, the charge already outweighs any taste term', () => {
    // `DEFAULT_WEIGHTS` says three orders of magnitude exist so that "no amount of
    // taste can buy a collision". The un-normalised ramp carved out a window where
    // it could: at share 0.851 it charged about one weighted unit, under a single
    // `alignment` unit, so the solver could prefer — or decline to repair — an
    // arrangement the report was flagging. Normalising the excess over `1 - bar`
    // closes it, and this is the assertion that can tell the two apart.
    const share = TUCKED_CLASH_SHARE + 0.001;
    const { parts, at } = tuckedAt(share);
    expect(flagged(parts, at, 'clash'), 'the report flags just past the bar').toBe(true);
    expect(
      costAt(parts, at).overlap,
      'a reported collision must cost more than one unit of taste',
    ).toBeGreaterThan(DEFAULT_WEIGHTS.alignment);
  });
});
