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
    expect(rooms, 'the presets must actually produce rooms, or this asserts nothing').toBeGreaterThanOrEqual(8);
    expect(noisy).toEqual([]);
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

    const win = part({
      category: 'other',
      shape: 'window',
      name: 'Window',
      dimMM: [1200, 80, 1200],
      pos: [1.5, 1.4, -2.46],
      wallMounted: true,
    });
    expect(rules([win, wardrobe(1.5)])).not.toContain('clash-mounted');
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
    // repeats the table back to itself; this drives the wardrobe from clear of the TV
    // to fully inside it and watches the term never move. A **Try a fix** button here
    // would have nothing to descend.
    const t = tv();
    const w = wardrobe(0, 0);
    const parts = [t, w];
    const ctx: LayoutContext = { parts, movable: [false, true], footprint: RECT };
    const prepared = prepare(ctx);
    const readings: number[] = [];
    let everFlagged = false;
    for (const z of [-1.0, -1.4, -1.8, -2.0, -2.2, -2.45]) {
      const at: Placement[] = [
        { x: t.pos[0], z: t.pos[2], yaw: t.rot },
        { x: 0, z, yaw: 0 },
      ];
      readings.push(costBreakdown(prepared, at, undefined, NAV_CELL).overlap);
      const moved = [t, { ...w, pos: [0, 0, z] as [number, number, number] }];
      if (analyzeRoom(moved, ROOM).issues.some((i) => i.rule === 'clash-mounted')) everFlagged = true;
    }
    expect(everFlagged, 'the sweep must reach a reported overlap, or it proves nothing').toBe(true);
    expect(readings.every((r) => r === 0), `overlap read ${readings.join(', ')}`).toBe(true);
  });
});
