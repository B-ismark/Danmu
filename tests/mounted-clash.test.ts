// § 17 — "a drag refused by a wall-mounted TV says nothing and names nothing."
//
// Two halves, and only the first was in the report when this was written.
//
//   1. The drag has refused a wardrobe through a mounted TV since PR #42, and the
//      room report was silent about one already in the room, because rule 2 runs over
//      `floorBlockers` and that set excludes everything wall-mounted by definition.
//      Same question, two answers.
//
//   2. Looking for the pairs that would newly fire turned up the opposite fault, in
//      the app's own presets: `collidesAt` exempted only rugs, so **nothing could be
//      dragged in front of a curtain** — while the seeder puts four pieces there.
//
// So the property under test is not "a mounted clash is reported". It is **that the
// drag and the report answer the same question the same way**, in both directions:
// every pair the drag refuses is a pair the report names, and every pair the drag
// allows is one it stays quiet about. One predicate, two readers — which is the same
// repair `lib/layout-rules.ts` and `lib/drag-resolve.ts` already are.

import { describe, expect, it } from 'vitest';
import type { DimUnit } from '@/lib/store';
import { analyzeRoom } from '@/lib/clearance';
import { collidesAt, defaultScene, SHAPES, type ScenePart, type Shape } from '@/lib/scene-spec';
import { isSoftFurnishing, isObstacle, RULE_KINDS } from '@/lib/layout-rules';
import {
  costBreakdown,
  prepare,
  RULE_HANDLING,
  NAV_CELL,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { footprintForLayout } from '@/lib/footprint';
import { LAYOUT_IDS } from '@/lib/storage';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2.5],
  [3, -2.5],
  [3, 2.5],
  [-3, 2.5],
];
const ROOM = { footprint: RECT, height: 2.8 };

let n = 0;
const part = (p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ id: `${p.shape}-${++n}`, name: String(p.shape), rot: 0, locked: false, ...p }) as ScenePart;

/** A TV on the north wall at the standard mount height, 1.4 m to its centre.
 *  `wallMounted` is set explicitly rather than left to the normaliser: this file is
 *  about what the two consumers do with the flag, not about who sets it. */
const tv = (x = 0) =>
  part({
    category: 'tv',
    shape: 'tv',
    name: 'TV',
    dimMM: [1450, 90, 830],
    pos: [x, 1.4, -2.45],
    wallMounted: true,
  });

const wardrobe = (x = 0, z = -2.2) =>
  part({ category: 'wardrobe', shape: 'wardrobe', name: 'Wardrobe', dimMM: [1200, 600, 2100], pos: [x, 0, z] });

const rules = (parts: ScenePart[]) => analyzeRoom(parts, ROOM).issues.map((i) => i.rule);

describe('§ 17 · what is soft, and what that is for', () => {
  it('names the members and the deliberate non-members', () => {
    // Pinned exactly, in both directions, because the failure this guards is a shape
    // being ADDED on a hunch — every addition switches collision OFF for that shape in
    // every room, which is the direction nothing visibly complains about.
    const soft = (SHAPES as readonly Shape[]).filter((s) => isSoftFurnishing({ category: 'other', shape: s }));
    expect([...soft].sort()).toEqual(['curtain', 'rug']);
    // A soundbar is thin and small and is emphatically solid; a painting hangs like a
    // curtain and is a rigid board. Neither is a member and both are the near miss.
    for (const s of ['soundbar', 'painting', 'mirror', 'tv', 'ac-unit'] as Shape[]) {
      expect(isSoftFurnishing({ category: 'other', shape: s }), `${s} must stay solid`).toBe(false);
    }
  });

  it('still answers on the CATEGORY, for a room saved before the shape existed', () => {
    // Every call site this replaced tested `category === 'rug'`. A persisted part can
    // carry that category with some other shape on it, and losing those would turn
    // collision back ON for a rug — a piece every other rule already exempts.
    expect(isSoftFurnishing({ category: 'rug', shape: 'plane' })).toBe(true);
    expect(isSoftFurnishing({ category: 'rug', shape: 'box' })).toBe(true);
  });
});

describe('§ 17 · the presets seed pieces in front of the curtains, and that is fine', () => {
  it('lets a piece be dragged in front of a curtain', () => {
    // THE regression, and it is a defect in the DRAG rather than in the report: the
    // curtain is modelled with about 110 mm of depth standing off the wall, so anything
    // with its back to that wall is inside it. `collidesAt` exempted only rugs, so the
    // app refused to create a placement it ships four of.
    const curtain = part({
      category: 'curtain',
      shape: 'curtain',
      name: 'Curtains',
      dimMM: [1800, 120, 2400],
      pos: [0, 1.55, -2.44],
      wallMounted: true,
    });
    const ns = part({ category: 'nightstand', shape: 'nightstand', name: 'Nightstand', dimMM: [450, 400, 550], pos: [0, 0, -2.2] });
    const parts = [curtain, ns];
    expect(collidesAt(parts, ns.id, ns.pos, ns.rot, ns.dimMM), 'a nightstand may stand in front of curtains').toBe(false);
    expect(collidesAt(parts, curtain.id, curtain.pos, curtain.rot, curtain.dimMM), 'and the curtain may be slid past it').toBe(false);
    expect(rules(parts), 'and the room report says nothing about the pair').not.toContain('clash-mounted');
  });

  it('is quiet on every preset, at two sizes', () => {
    // The measurement that found the curtain fault: before this change four seeded
    // pairs fired — the `l` room's bookshelf and the `u` room's wardrobe, nightstand
    // and bedside lamp. A room the app itself builds must never open onto an error.
    let rooms = 0;
    const noisy: string[] = [];
    for (const id of LAYOUT_IDS) {
      for (const [w, d] of [
        [6, 5],
        [3.5, 3],
      ] as const) {
        const footprint = footprintForLayout(id, w, d);
        const parts = defaultScene(id, w, d, { footprint, height: 2.8 });
        if (parts.length === 0) continue;
        rooms++;
        for (const i of analyzeRoom(parts, { footprint, height: 2.8 }).issues) {
          if (i.rule === 'clash-mounted') noisy.push(`${id} ${w}×${d}: ${i.detail}`);
        }
      }
    }
    // EXACT, not `>= 8`. The loose bound left four rooms of slack and the
    // `parts.length === 0` skip above is the swallow: an early return emptying both
    // sizes of `t` and `u` brings this to 8 and the file stays green. Measured: 12 of
    // 12 produce parts.
    expect(rooms, 'every preset at both sizes must produce a room').toBe(LAYOUT_IDS.length * 2);
    expect(noisy).toEqual([]);
    // Printed, so a degenerating sweep is visible on a PASSING run — `pnpm test` passes
    // `--disableConsoleIntercept` for exactly this.
    console.log(`[§17] preset sweep: ${rooms} rooms, ${noisy.length} mounted clashes`);
  });
});

describe('§ 17 · the drag and the report agree about a mounted piece', () => {
  it('reports a wardrobe standing where a TV hangs', () => {
    const t = tv();
    const w = wardrobe();
    const parts = [t, w];
    expect(collidesAt(parts, w.id, w.pos, w.rot, w.dimMM), 'the drag refuses it').toBe(true);
    const found = analyzeRoom(parts, ROOM).issues.filter((i) => i.rule === 'clash-mounted');
    expect(found.length, 'and the report names it exactly once').toBe(1);
    expect([...found[0].partIds].sort(), 'naming both pieces, so a click can select them').toEqual(
      [t.id, w.id].sort(),
    );
    expect(found[0].detail, 'and naming them in words').toContain('Wardrobe');
    expect(found[0].detail).toContain('TV');
    expect(found[0].severity).toBe('error');
  });

  it('is quiet when the same two are on different walls', () => {
    // The pair that proves the rule is about geometry rather than about a TV existing.
    const parts = [tv(-2), wardrobe(2)];
    expect(rules(parts)).not.toContain('clash-mounted');
    expect(collidesAt(parts, parts[1].id, parts[1].pos, parts[1].rot, parts[1].dimMM)).toBe(false);
  });

  it('is quiet when they overlap in plan but not in height', () => {
    // A TV console under its own TV is the most ordinary arrangement in the catalogue,
    // and it overlaps the TV completely from above. The height test is what separates a
    // stack from a clash, and dropping it would report every mounted piece in the app.
    const t = tv();
    const console_ = part({
      category: 'tv',
      shape: 'tv-console',
      name: 'TV console',
      dimMM: [1400, 400, 500],
      pos: [0, 0, -2.3],
    });
    const parts = [t, console_];
    expect(collidesAt(parts, console_.id, console_.pos, console_.rot, console_.dimMM)).toBe(false);
    expect(rules(parts)).not.toContain('clash-mounted');
  });

  it('sees a piece standing on a surface, which floorBlockers cannot', () => {
    // The widening the old comment in `clearance.ts` asked for, stated as a test. A
    // bedside lamp on a chest at y = 0.9 is inside a TV mounted at 1.4 m exactly as a
    // wardrobe is — and `floorBlockers`' `pos[1] < 0.05` drops it, so rule 2 could
    // never have reached this pair however its other filters were widened.
    const t = tv();
    const lamp = part({
      category: 'lamp',
      shape: 'lamp-table',
      name: 'Bedside lamp',
      dimMM: [220, 220, 450],
      pos: [0, 1.2, -2.4],
    });
    expect(isObstacle(lamp), 'the lamp is not an obstacle — that is the point').toBe(false);
    const parts = [t, lamp];
    expect(collidesAt(parts, lamp.id, lamp.pos, lamp.rot, lamp.dimMM), 'the drag refuses it').toBe(true);
    expect(rules(parts), 'so the report must too').toContain('clash-mounted');
  });

  it('prints a band with two DIFFERENT numbers, even when it is 7 mm wide, in every unit', () => {
    // The rule fires on a band as narrow as 5 mm and the sentence used to print metres
    // at `toFixed(2)` — 1 cm of resolution — so a real pair printed "between 1.06 m and
    // 1.06 m up": a sentence whose whole job is to say where they meet, saying nothing.
    // These two sizes are legal (`clampDims` passes both unchanged) and the band between
    // them is 7 mm, which is what an arbitrary `groundY` answer ordinarily produces —
    // heights are not on the 10 mm drag grid, that grid is x/z only.
    //
    // § B.12 made the unit the user's, which put that collapse back within reach: metres
    // at two decimals is the exact case above. Rounding OUTWARD is what forecloses it —
    // floor the low, ceil the high, so two ends of a non-empty band cannot land on one
    // number — and the sweep is over EVERY unit because picking one is how the first
    // version of this only ever tested the unit it was written in.
    //
    // The capture is `[\d.]+`, not `\d+`: against "105.6 cm" the old pattern matched the
    // "6" and the assertion then compared two fragments of two different numbers. It
    // reported as the band being inverted, which is the finding this test exists to
    // raise — a regex that mis-parses a passing sentence looks exactly like the defect.
    const narrowTv = part({
      category: 'tv', shape: 'tv', name: 'TV', dimMM: [1450, 90, 688], pos: [0, 1.4, -2.45], wallMounted: true,
    });
    const shelf = part({
      category: 'shelf', shape: 'bookshelf', name: 'Bookshelf', dimMM: [1200, 600, 1063], pos: [0, 0, -2.2],
    });
    for (const unit of ['cm', 'm', 'mm', 'ft', 'in'] as DimUnit[]) {
      const found = analyzeRoom([narrowTv, shelf], ROOM, { dimUnit: unit })
        .issues.filter((i) => i.rule === 'clash-mounted');
      expect(found.length, `the fixture must produce the finding in ${unit}, or this asserts nothing`).toBe(1);
      const nums = [...found[0].detail.matchAll(new RegExp(`([\\d.]+) ${unit}`, 'g'))].map((m) => Number(m[1]));
      console.log(`[§17] 7 mm band in ${unit}: ${nums.join(' .. ')}`);
      expect(nums.length, `two numbers in ${unit}, a low and a high`).toBe(2);
      expect(nums[1], `the high must exceed the low in ${unit} — outward rounding guarantees it`)
        .toBeGreaterThan(nums[0]);
    }
  });

  it('exempts a soft piece on the FLOOR, not only a soft one on the wall', () => {
    // The curtain fixture above is `wallMounted`, so it only ever exercised the mounted
    // side of the exemption. Removing `!isSoftFurnishing(p)` from `floorSolids` left the
    // whole file green. A rug lying under a wall piece whose bottom reaches the floor is
    // the case: every other rule in the app exempts a rug, and this one must too.
    // `shape: 'painting'`, NOT `shape: 'box'` with the flag set. The first version used
    // a box and the mutation survived: `verticalExtent` reads `anchorFor(category,
    // shape)`, not the stored flag, and a box anchors to the FLOOR — so `pos[1] = 0.15`
    // was read as a bottom, the piece sat at [0.15, 0.45] and never met the rug at all.
    // Setting `wallMounted` does not make a shape's geometry centred; the anchor table
    // does. That is the two-questions trap in `CLAUDE.md`, and it made a fixture that
    // could not express the defect it was written for.
    const lowShelf = part({
      category: 'painting', shape: 'painting', name: 'Low shelf',
      dimMM: [1200, 60, 300], pos: [0, 0.15, -2.4], wallMounted: true,
    });
    const rug = part({ category: 'rug', shape: 'rug', name: 'Rug', dimMM: [2000, 1400, 10], pos: [0, 0, -2.0] });
    const solid = part({ category: 'other', shape: 'box', name: 'Crate', dimMM: [500, 500, 400], pos: [0, 0, -2.35] });
    expect(rules([lowShelf, rug]), 'a rug is exempt on the floor side').not.toContain('clash-mounted');
    expect(
      rules([lowShelf, solid]),
      'and the same geometry with a solid piece IS reported, or the fixture proves nothing',
    ).toContain('clash-mounted');
  });

  it('leaves doors and windows to the rules that speak for them', () => {
    // A wardrobe across a door is reported — by `door` and `entry`, which name the
    // fault ("you cannot open this") rather than the mechanism. Two findings for one
    // problem is noise, and the one that would be added is the less useful of the two.
    const door = part({
      category: 'door',
      shape: 'door',
      name: 'Door',
      dimMM: [900, 50, 2050],
      pos: [-1.5, 1.025, -2.47],
      wallMounted: true,
    });
    const w = wardrobe(-1.5);
    const found = rules([door, w]);
    expect(found, 'the door rules still fire').toContain('door');
    expect(found, 'and this rule stays out of it').not.toContain('clash-mounted');

    // The exclusion is TWO clauses — category and shape — and the fixture above carries
    // both, so each is redundant against it and deleting either one stayed green. A
    // persisted part can carry one without the other, which is the same drift
    // `isSoftFurnishing`'s own category arm exists for, so each clause gets a fixture
    // that only it can answer.
    const doorByCategory = part({
      category: 'door', shape: 'box', name: 'Old door',
      dimMM: [900, 50, 2050], pos: [-1.5, 1.025, -2.47], wallMounted: true,
    });
    expect(rules([doorByCategory, wardrobe(-1.5)]), 'category alone excludes it').not.toContain(
      'clash-mounted',
    );
    const doorByShape = part({
      category: 'other', shape: 'door', name: 'Door shape',
      dimMM: [900, 50, 2050], pos: [-1.5, 1.025, -2.47], wallMounted: true,
    });
    expect(rules([doorByShape, wardrobe(-1.5)]), 'shape alone excludes it').not.toContain(
      'clash-mounted',
    );

    const win = part({
      category: 'other',
      shape: 'window',
      name: 'Window',
      dimMM: [1200, 80, 1200],
      pos: [1.5, 1.4, -2.46],
      wallMounted: true,
    });
    const winRules = rules([win, wardrobe(1.5)]);
    // The positive control, and without it every `not.toContain` in this file is one
    // fixture tweak away from vacuous: change the `wardrobe` helper's default z and the
    // pieces stop overlapping, so nothing is reported and every negative passes.
    expect(winRules, 'the window rule fires, so the pieces really are in contact').toContain('window');
    expect(winRules).not.toContain('clash-mounted');
  });
});

describe('§ 17 · the two OTHER readers of analyzeRoom, found by review', () => {
  it('does not answer “No room for it” about a piece that fits', async () => {
    // A verdict must not grow a term its own search cannot see. `checkFit` seats a probe,
    // then runs `analyzeRoom` over the seat it chose — but `overlapsSomething`'s
    // prefilter skipped every `wallMounted` piece, so once this rule existed the search
    // could rank a seat under a TV and the report would then call that seat an error.
    //
    // Measured before the fix, in a 6×5 m room: a bookshelf and a wardrobe that both
    // plainly fit came back `no-room`. Both sides read `isMountedObstruction` now.
    const { checkFit } = await import('@/lib/fit-check');
    const { footprintForLayout } = await import('@/lib/footprint');
    const footprint = footprintForLayout('rect', 6, 5);
    const room = { footprint, height: 2.8 };
    const base = defaultScene('rect', 6, 5, { footprint, height: 2.8 });
    const wallTv = (x: number, z: number, rot: number) =>
      part({ category: 'tv', shape: 'tv', name: 'Wall TV', dimMM: [1450, 90, 830], pos: [x, 1.4, z], rot, wallMounted: true });
    const withTvs = [
      ...base,
      wallTv(0, -2.45, 0),
      wallTv(0, 2.45, Math.PI),
      wallTv(-2.95, 0, Math.PI / 2),
      wallTv(2.95, 0, -Math.PI / 2),
    ];
    for (const cand of [
      { name: 'Bookshelf', category: 'shelf', shape: 'bookshelf', dimMM: [800, 300, 1800] },
      { name: 'Wardrobe', category: 'wardrobe', shape: 'wardrobe', dimMM: [1200, 600, 2100] },
    ] as const) {
      const bare = checkFit(cand as never, base, room);
      expect(bare.status, `${cand.name} must fit the empty-walled room, or this proves nothing`).toBe('fits');
      const withWalls = checkFit(cand as never, withTvs, room);
      console.log(`[§17] checkFit ${cand.name}: no TVs=${bare.status}  four wall TVs=${withWalls.status}`);
      expect(
        withWalls.status,
        `${cand.name} still fits — mounting four TVs does not remove the floor`,
      ).not.toBe('no-room');
    }
  });

  it('lets Shuffle reject a candidate that parks a piece inside a wall fixture', async () => {
    // The other reader: `newRoomFindings`'s `serious` predicate is
    // `severity === 'error' || rule === 'clash'`, so this rule is in scope and a
    // candidate INTRODUCING one is refused. That is the gate working — the solver cannot
    // price the pair, so it will wander into it by luck, and refusing is what stops
    // Shuffle offering a wardrobe inside a TV.
    //
    // The cost is measured rather than assumed: over 8 seeds in a 6×5 room with a TV on
    // each of the four walls, Shuffle returned null once with the rule at `error` and
    // never with it suppressed. Seven presses in eight still succeed, so the toast's
    // "press Shuffle again for a different try" is TRUE — which is the claim this test
    // pins, because a review reported it as false.
    const { newRoomFindings } = await import('@/lib/layout-shuffle');
    const t = tv();
    const w = wardrobe(2, 0);
    const parts = [t, w];
    expect(analyzeRoom(parts, ROOM).issues.some((i) => i.rule === 'clash-mounted')).toBe(false);
    // A "solve" that walks the wardrobe under the TV.
    // `moved` is what `applyPlacements` reads to decide which placements to apply —
    // omitting it made the "moved" room identical to the original, so nothing was new
    // and the assertion failed against an empty list. Index 1 is the wardrobe.
    const result = {
      placements: [
        { x: t.pos[0], z: t.pos[2], yaw: t.rot },
        { x: 0, z: -2.2, yaw: 0 },
      ],
      moved: [1],
    } as never;
    const found = newRoomFindings(parts, { ...ROOM }, result);
    expect(
      found.map((f) => f.rule),
      'a candidate that creates one must be refused, or Shuffle can offer it',
    ).toContain('clash-mounted');
  });
});

describe('§ 17 · the RULE_HANDLING row is true, not plausible', () => {
  it('is classified at all, and as something the solver cannot price', () => {
    expect(RULE_KINDS).toContain('clash-mounted');
    expect(RULE_HANDLING['clash-mounted'].costTerm).toBeNull();
    expect(RULE_HANDLING['clash-mounted'].movable).toBe(false);
    expect(RULE_HANDLING['clash-mounted'].why, 'a null cost term must say why').toBeTruthy();
  });

  it('measures the claim the row makes: the overlap term is zero at every depth', () => {
    // The row says `c.overlap` is identically zero for a floor↔mounted pair because the
    // term is gated on `isObstacle` at BOTH indices. Asserting `costTerm: null` only
    // repeats the table back to itself, so this drives a wardrobe from clear of the TV
    // to fully inside it and watches the term never move.
    //
    // ── The first version of this test could not fail, and the reason is the sharp one.
    //
    // It scored ONE pair, `[tv, wardrobe]`, and `prepare` gives that `obstacle =
    // [false, true]`. With two parts and the non-obstacle at index 0 the pair loop body
    // never executes AT ALL: `i = 0` is skipped by the i-gate and `i = 1` has no `j`.
    // So every reading was 0 by array arity rather than by gating, and three mutations
    // survived the whole file — deleting the j-gate, deleting the accumulation outright,
    // and setting `DEFAULT_WEIGHTS.overlap` to 0 (the weight is applied inside
    // `costBreakdown`, before it returns, so a zero weight satisfies `r === 0` too).
    //
    // Two changes fix it and neither is optional. **A positive control** — an ordinary
    // floor pair scored through the same call — turns "the term is off" into a failure
    // instead of a pass. And **both part orders**, because which gate is exercised is an
    // accident of array order: with `[tv, wardrobe]` the j-gate survives and the i-gate
    // dies; with `[wardrobe, tv]` it is exactly reversed, and no single ordering can
    // verify both.
    const sweep = (parts: ScenePart[], tvFirst: boolean) => {
      const ctx: LayoutContext = { parts, movable: parts.map(() => true), footprint: RECT };
      const prepared = prepare(ctx);
      const t = tvFirst ? parts[0] : parts[1];
      const readings: number[] = [];
      let everFlagged = false;
      for (const z of [-1.0, -1.4, -1.8, -2.0, -2.2, -2.45]) {
        const wardrobeAt: Placement = { x: 0, z, yaw: 0 };
        const tvAt: Placement = { x: t.pos[0], z: t.pos[2], yaw: t.rot };
        readings.push(
          costBreakdown(prepared, tvFirst ? [tvAt, wardrobeAt] : [wardrobeAt, tvAt], undefined, NAV_CELL)
            .overlap,
        );
        const w = parts.find((p) => p.id !== t.id)!;
        const moved = [t, { ...w, pos: [0, 0, z] as [number, number, number] }];
        if (analyzeRoom(moved, ROOM).issues.some((i) => i.rule === 'clash-mounted')) everFlagged = true;
      }
      return { readings, everFlagged };
    };

    // THE CONTROL. Two ordinary floor obstacles in the same place — the pair the term
    // exists for. If this is 0, the term is off and the sweeps below mean nothing.
    const a = wardrobe(0, 0);
    const b = part({ category: 'wardrobe', shape: 'wardrobe', name: 'Other wardrobe', dimMM: [1200, 600, 2100], pos: [0, 0, 0] });
    const controlCtx: LayoutContext = { parts: [a, b], movable: [true, true], footprint: RECT };
    const control = costBreakdown(
      prepare(controlCtx),
      [
        { x: 0, z: 0, yaw: 0 },
        { x: 0, z: 0, yaw: 0 },
      ],
      undefined,
      NAV_CELL,
    ).overlap;
    console.log(`[§17] overlap control (two floor pieces in one place) = ${control}`);
    expect(control, 'the overlap term must be alive, or a zero below proves nothing').toBeGreaterThan(0);

    for (const tvFirst of [true, false]) {
      const t = tv();
      const w = wardrobe(0, 0);
      const { readings, everFlagged } = sweep(tvFirst ? [t, w] : [w, t], tvFirst);
      console.log(`[§17] overlap, tv ${tvFirst ? 'first' : 'second'}: ${readings.join(', ')}`);
      expect(everFlagged, 'the sweep must reach a reported overlap, or it proves nothing').toBe(true);
      expect(
        readings.every((r) => r === 0),
        `overlap read ${readings.join(', ')} with the tv at index ${tvFirst ? 0 : 1}`,
      ).toBe(true);
    }
  });

  it('keeps a `why` that says which term and which predicate, not just a truthy string', () => {
    // `toBeTruthy()` was the only assertion on it, and truncating the whole ten-line
    // explanation to 'x' passed. Nothing in the app READS `why` — it is written for the
    // next person deciding whether this row is still true — so the test is the only
    // thing that can keep it from decaying into a placeholder. Pinned on the two names
    // that make the claim checkable rather than on the prose around them.
    const why = RULE_HANDLING['clash-mounted'].why ?? '';
    expect(why).toContain('overlap');
    expect(why).toContain('isObstacle');
    expect(why.length, 'a reason, not a placeholder').toBeGreaterThan(120);
  });
});
