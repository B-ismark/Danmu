import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeRoom } from '@/lib/clearance';
import { footprintForLayout, type LayoutId } from '@/lib/footprint';
import {
  DEFAULT_WEIGHTS,
  NAV_CELL,
  costBreakdown,
  prepare,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { ROOM } from '@/lib/parts-catalog';
import { defaultScene } from '@/lib/scene-spec';

/** § G.1 — does a brand-new room seal its own routes?
 *
 *  **The answer is no, and the way § G.1 came to say yes is the point of this file.**
 *  It measured `defaultScene('t', ROOM.width, ROOM.depth)` and found `navigation`
 *  232.20 on the T and 472.20 on the U, both reproduced here. But `ROOM`'s
 *  5.6 x 4.2 is **`DEFAULT_ROOM`'s size, and `DEFAULT_ROOM.layoutId` is `'rect'`**
 *  (`lib/scene-store.ts`) — so that pairing is a T built at the rectangle's
 *  dimensions, which no path in the app constructs. Onboarding is the only screen
 *  that picks a layout and it offers its own five sizes; a saved room carries its
 *  own; and `loadFromRoom(null)` falls back to the rect.
 *
 *  § G.1's own headline was that every solver fixture used 6 x 5 while the app
 *  shipped 5.6 x 4.2, so "the fixture differs from the shipping default by 40 cm".
 *  The fixture that found *that* had the same fault one level up: it combined a
 *  layout id with another layout's dimensions. **A fixture is a claim about a
 *  reachable state, and neither sweep checked that its own state was reachable.**
 *
 *  So the assertion here is the property nobody had: every size onboarding OFFERS
 *  seeds a room that strands no floor. The two tables that follow it are printed,
 *  not asserted, because they measure where the cliff is rather than deciding
 *  anything — and the cliff is real: a T or U taken down to ~4.2 m deep does strand
 *  floor, which a user can reach by dragging a wall, and which the room report is
 *  right to report.
 *
 *  No solver runs in any of these numbers. It is `defaultScene` scored by
 *  `costBreakdown`, which is what makes them a statement about the SEEDER.
 *
 *  **Mutation ledger — eight tried, six killed, and the two survivors are why the
 *  file looks like this.** Killed: `PLAN_RANKS` 4 → 1 (the U strands 750.60, which
 *  is the exact figure `BED_LADDER`'s docblock cites, so the plan search really is
 *  what prevents it); the seeder's rule (A) stage deleted (749.40); the `u` preset
 *  re-sized to 4.2 on the picker page itself (619.20 — and the failure message read
 *  `u 6x4.2`, which is the proof the list is parsed and not copied); `defaultScene`
 *  forced to return `[]`; the `tall` guard inverted; and a preset row deleted from
 *  the page. Survived: `CLASH_SHARE` 0.5 → 0.0, because a starter room has no
 *  overlapping pair for any clash bar to catch; and `settleParts` bypassed, which is
 *  what retired the `outside` assertion below.
 *
 *  The `parts > 0` assertion earns its place from that pass rather than from
 *  caution: with the seeder returning nothing, `navigation`, `outside` and the
 *  report are ALL clean, because an empty room strands no floor. It is the only
 *  thing standing between this gate and a vacuous green. */

const HEIGHT = 2.8;
const PRESETS: LayoutId[] = ['rect', 'l', 't', 'u', 'open'];

type Row = {
  layout: LayoutId;
  w: number;
  d: number;
  parts: number;
  navigation: number;
  outside: number;
  total: number;
  findings: string[];
};

function score(layout: LayoutId, w: number, d: number): Row {
  const poly = footprintForLayout(layout, w, d);
  const parts = defaultScene(layout, w, d, { footprint: poly, height: HEIGHT });
  const at: Placement[] = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
  const model = prepare({
    parts,
    movable: parts.map((p) => !p.wallMounted),
    footprint: poly,
  } as LayoutContext);
  const b = costBreakdown(model, at, DEFAULT_WEIGHTS, NAV_CELL) as unknown as Record<string, number>;
  const report = analyzeRoom(parts, { footprint: poly, height: HEIGHT });
  return {
    layout,
    w,
    d,
    parts: parts.length,
    navigation: b.navigation,
    outside: b.outside,
    total: b.total,
    findings: report.issues.map((i) => i.rule),
  };
}

const tally = (kinds: string[]) =>
  kinds.length === 0
    ? '—'
    : [...new Set(kinds)].map((k) => `${k}x${kinds.filter((q) => q === k).length}`).join(' ');

/** The sizes onboarding offers, DERIVED from the only screen that offers them.
 *
 *  Hand-copying this list is the defect this file exists to describe: a fixture
 *  that names its own numbers cannot notice a preset being resized. Parsed the way
 *  `tests/shape-contract.test.ts` parses `scripts/export-detector.py`, and the count
 *  is asserted before the loop so a regex that matches nothing cannot pass. */
function offeredSizes(): Array<{ id: LayoutId; width: number; depth: number }> {
  const src = readFileSync(join(process.cwd(), 'app/onboarding/layout-pick/page.tsx'), 'utf8');
  const block = src.slice(src.indexOf('const PRESETS = ['), src.indexOf('const HEIGHT'));
  const out: Array<{ id: LayoutId; width: number; depth: number }> = [];
  const row = /id:\s*'([a-z]+)'\s*as\s*const\s*,\s*name:\s*'[^']*'\s*,\s*width:\s*([\d.]+)\s*,\s*depth:\s*([\d.]+)/g;
  for (let m = row.exec(block); m !== null; m = row.exec(block)) {
    out.push({ id: m[1] as LayoutId, width: Number(m[2]), depth: Number(m[3]) });
  }
  return out;
}

describe('§ G.1 · a starter room does not seal its own routes', () => {
  const offered = offeredSizes();

  it('parsed every preset the layout picker offers', () => {
    // Five today. If the picker grows a sixth this fails rather than skipping it,
    // which is the whole reason the list is derived instead of typed.
    expect(offered).toHaveLength(5);
    expect(offered.map((o) => o.id)).toEqual(PRESETS);
    for (const o of offered) {
      expect(o.width, `${o.id} width parsed`).toBeGreaterThan(0);
      expect(o.depth, `${o.id} depth parsed`).toBeGreaterThan(0);
    }
  });

  it('every size onboarding offers seeds a room that strands no floor', () => {
    const rows = offered.map((o) => score(o.id, o.width, o.depth));

    console.log('\n§ G.1 · the sizes onboarding OFFERS (layout-pick PRESETS)\n');
    console.log('preset     w x d    parts   navigation        total   analyzeRoom');
    for (const r of rows) {
      console.log(
        `${r.layout.padEnd(6)}  ${r.w.toFixed(1)} x ${r.d.toFixed(1)}  ${String(r.parts).padStart(5)}  ` +
          `${r.navigation.toFixed(2).padStart(11)}  ${r.total.toFixed(2).padStart(11)}   ${tally(r.findings)}`,
      );
    }

    for (const r of rows) {
      // `navigation === 0` is not a threshold — it is the definition of "this room
      // strands no floor", and it is the same quantity the seeder's own rule (A)
      // requires of a bed-bearing plan.
      expect(r.navigation, `${r.layout} ${r.w}x${r.d} strands floor`).toBe(0);
      // There was an `outside === 0` assertion here and it is DELETED, because the
      // mutation pass could not make it fail: bypassing the seeder's own
      // `settleParts` call changes nothing at any of these five sizes, so every
      // starter piece is already inside its bay and that settle is insurance rather
      // than load-bearing here. An assertion nobody can see failing is decoration,
      // and its green is worse than no assertion. `outside` is still PRINTED by the
      // table below, where it costs nothing and claims nothing.
      //
      // And the user-visible half: Room check must be quiet on a room nobody has
      // touched. A `navigation` of 0 with a finding still standing would mean the
      // two consumers disagree, which is what tests/layout-conformance.test.ts is for.
      expect(r.findings, `${r.layout} ${r.w}x${r.d} reports a finding on first open`).toEqual([]);
      expect(r.parts, `${r.layout} ${r.w}x${r.d} seeded an empty room`).toBeGreaterThan(0);
    }
  });

  it('prints the pairing § G.1 measured, which no path in the app constructs', () => {
    console.log(
      `\n§ G.1 · defaultScene(<layout>, ROOM.width, ROOM.depth) = ${ROOM.width} x ${ROOM.depth}` +
        ` — the size of DEFAULT_ROOM, whose layoutId is 'rect'\n`,
    );
    console.log('preset  parts   navigation      outside        total   analyzeRoom');
    for (const layout of PRESETS) {
      const r = score(layout, ROOM.width, ROOM.depth);
      console.log(
        `${r.layout.padEnd(6)}  ${String(r.parts).padStart(5)}  ` +
          `${r.navigation.toFixed(2).padStart(11)}  ${r.outside.toFixed(2).padStart(11)}  ` +
          `${r.total.toFixed(2).padStart(11)}   ${tally(r.findings)}`,
      );
    }
    console.log(
      "  the rect — which is what DEFAULT_ROOM actually is at this size — is the clean one,\n" +
        '  and it is the only row of the five a user can reach without resizing a room by hand.',
    );

    // The one row that IS reachable: DEFAULT_ROOM, used by the store's initial state
    // and by loadFromRoom(null). If this ever strands floor, a user with no saved
    // room sees a finding before touching anything.
    const fallback = score('rect', ROOM.width, ROOM.depth);
    expect(fallback.navigation, 'DEFAULT_ROOM strands floor').toBe(0);
    expect(fallback.findings, 'DEFAULT_ROOM reports a finding').toEqual([]);
  });

  it('prints where the depth cliff is, per preset', () => {
    const WIDTHS = [4.0, 4.5, 5.0, 5.6, 6.0, 6.5, 7.0, 7.5];
    const DEPTHS = [3.0, 3.4, 3.8, 4.2, 4.6, 5.0, 5.6];
    let cells = 0;

    for (const layout of PRESETS) {
      console.log(`\n§ G.1 · ${layout} · navigation term by room size (parts in brackets)\n`);
      console.log(`  d\\w  ${WIDTHS.map((w) => w.toFixed(1).padStart(13)).join('')}`);
      for (const d of DEPTHS) {
        const out: string[] = [];
        for (const w of WIDTHS) {
          const r = score(layout, w, d);
          cells += 1;
          out.push(`${r.navigation === 0 ? '.' : r.navigation.toFixed(0)}(${r.parts})`.padStart(13));
        }
        console.log(`${d.toFixed(1).padStart(5)}  ${out.join('')}`);
      }
    }
    console.log(
      '\n  A dot is a room that strands nothing. The grid is NOT monotonic in area — the L is\n' +
        '  clean at 4.0 x 3.4 and costs ~592 at 4.0 x 5.0 — so "too small for its furniture" is\n' +
        '  the wrong reading. Part count is not the driver either: the U at 5.6 x 4.2 and at\n' +
        '  5.6 x 4.6 both seed 12 pieces, and only the shallower one strands floor.',
    );

    expect(cells).toBe(PRESETS.length * WIDTHS.length * DEPTHS.length);
    // 280 cells, each a full build + clearance field, so this is ~5 s of real work
    // and it does not fit vitest's DEFAULT 5 s `testTimeout` — which is a bound
    // nobody chose, since `vitest.config.ts` sets no `testTimeout` at all. This test
    // hit it on its first green run, which is § A.4 of `what-is-still-open.md`
    // happening to the file that measured § A.4. The budget is stated here rather
    // than raised globally: a grid is allowed to be slow, and the other 117 files
    // should not silently inherit a longer leash because this one is.
  }, 40000);
});
