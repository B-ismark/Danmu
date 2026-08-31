import { describe, it, expect } from 'vitest';
import { resolvePlacement } from '@/lib/drag-resolve';
import { footprintForLayout, pointInFootprint } from '@/lib/footprint';
import { footFromPart, footInsidePoly } from '@/lib/geometry';
import { CATEGORIES, SHAPES, type Category, type ScenePart, type Shape } from '@/lib/scene-spec';
import { ridesWall } from '@/lib/physics';
import { dimRangeFor } from '@/lib/dimension-ranges';

// § H.16 — "models are still going through walls in 2d plan mode".
//
// It was not the plan. Both tabs end in `resolvePlacement`, and `resolvePlacement`
// exempted every wall-mounted piece from the polygon test outright, on the stated
// grounds that `snapToWall` had "just placed it exactly on an edge". `snapToWall`
// says in its own comment that it does no such thing when the piece is wider than
// the wall it landed on — it CENTRES it and lets both ends hang past the corners,
// deliberately, because shrinking it is what rule 2 forbids. On a rectangle those
// ends hang over the next wall's floor. On an L, a T or a U they hang into the
// missing quadrant, and the drag committed `valid` with no red and nothing said.
//
// These are a SWEEP rather than examples, because choosing examples is exactly how
// the first version missed it: the piece that fails is whichever one happens to be
// wider than the shortest wall of the room it is in, which is a property of the
// pair and not of either.

const LAYOUTS = ['rect', 'l', 't', 'u', 'open'] as const;
const H = 2.5;
const SHAPE_SET = new Set<string>(SHAPES);

/** The pipeline's own containment test shrinks the footprint by 10 mm before
 *  asking, because the clamp parks a piece EXACTLY on the wall and a corner on the
 *  boundary is not "outside". Asking a stricter question than the code asks is how
 *  the first run of this sweep produced 11,890 findings, none of them real. */
const SLACK = 10;
const shrink = (d: [number, number, number]): [number, number, number] => [d[0] - SLACK, d[1] - SLACK, d[2]];

function shapeFor(c: Category): Shape {
  if (SHAPE_SET.has(c)) return c as Shape;
  const alt: Partial<Record<Category, Shape>> = {
    chair: 'chair-dining',
    table: 'coffee-table',
    lamp: 'lamp-floor',
    shelf: 'bookshelf',
    bed: 'bed-double',
    desk: 'desk-standard',
    monitor: 'monitor',
    fridge: 'fridge',
    ottoman: 'ottoman',
    other: 'box',
  };
  return (alt[c] ?? 'box') as Shape;
}

function sizesFor(c: Category, s: Shape): Array<[string, [number, number, number]]> {
  const r = dimRangeFor(c, s);
  return [
    ['min', [...r.min] as [number, number, number]],
    [
      'mid',
      [
        Math.round((r.min[0] + r.max[0]) / 2),
        Math.round((r.min[1] + r.max[1]) / 2),
        Math.round((r.min[2] + r.max[2]) / 2),
      ] as [number, number, number],
    ],
    ['max', [...r.max] as [number, number, number]],
  ];
}

function mk(c: Category, s: Shape, dim: [number, number, number]): ScenePart {
  return { id: 'sub', name: s, category: c, shape: s, pos: [0, 0, 0], rot: 0, dimMM: dim, locked: false } as ScenePart;
}

const ROTS = [0, Math.PI / 4, Math.PI / 2];
const XS = [-4, -2, -1, 0, 1, 2, 4];
const ZS = [-3, -1.5, 0, 1.5, 3];

/** One pass of the whole catalogue. Returns per-category accept counts and the
 *  placements that were accepted while sitting outside the room. */
function sweep() {
  const escapes: string[] = [];
  const accepts = new Map<Category, number>();
  let considered = 0;
  for (const layout of LAYOUTS) {
    const poly = footprintForLayout(layout, 6, 5);
    for (const c of CATEGORIES) {
      const s = shapeFor(c);
      for (const [label, dim] of sizesFor(c, s)) {
        const p = mk(c, s, dim);
        for (const rot of ROTS) {
          for (const x of XS) {
            for (const z of ZS) {
              considered++;
              const r = resolvePlacement({
                part: p,
                rawX: x,
                rawZ: z,
                rot,
                dim,
                parts: [p],
                footprint: poly,
                roomHeight: H,
                snapMode: 'off',
              });
              if (!r.valid) continue;
              accepts.set(c, (accepts.get(c) ?? 0) + 1);
              // A rug is exempt from the OBB test ON PURPOSE — it belongs under the
              // furniture, up to the skirting and across an L's missing corner — so
              // it is held to what the code actually promises for it: its CENTRE is
              // over real floor. Skipping rugs outright would make a rug regression
              // invisible here, which is the same defect one level up.
              const ok =
                c === 'rug'
                  ? pointInFootprint(r.pos[0], r.pos[2], poly)
                  : footInsidePoly(footFromPart(r.pos, r.rot, shrink(dim), p.circle), poly);
              if (!ok) {
                escapes.push(
                  `${layout} ${c}/${s} ${label} rot=${rot.toFixed(2)} to=(${x},${z}) -> (${r.pos[0].toFixed(3)},${r.pos[2].toFixed(3)}) rides=${ridesWall(c, s)}`,
                );
              }
            }
          }
        }
      }
    }
  }
  return { escapes, accepts, considered };
}

describe('a placement the pipeline calls VALID is inside the room', () => {
  const { escapes, accepts, considered } = sweep();

  it('holds for every category, at min / mid / max size, in every layout', () => {
    // Printed on every green run, not only on a red one: this is the measurement,
    // and a number nobody reads is not a check. `--disableConsoleIntercept` in
    // `pnpm test` is what makes it visible.
    console.log(
      `wall-rider containment: ${considered} considered, ${[...accepts.values()].reduce((a, b) => a + b, 0)} accepted, ${escapes.length} accepted-but-outside`,
    );
    for (const e of escapes.slice(0, 20)) console.log('   ' + e);
    expect(escapes).toEqual([]);
  });

  it('considered the whole catalogue rather than whatever it happened to find', () => {
    // **A LITERAL, not `LAYOUTS.length * ROTS.length * …`.** The derived version was
    // the first thing written here and it is an assertion that measures its own
    // subject: cut `LAYOUTS` down to the two rectangular rooms, or `ROTS` down to
    // zero degrees, and the expectation shrinks with it and the file stays green —
    // while the sweep can no longer reach a single one of the placements this test
    // exists for, all of which were in an L, a T or a U at an angle. Both survived a
    // mutation run against the derived form.
    //
    // 5 layouts x 22 categories x 3 sizes x 3 angles x 7 x-targets x 5 z-targets.
    expect(considered).toBe(34650);
    // …and the coverage that matters is named rather than counted, because the
    // number above is satisfiable by any five layouts.
    for (const layout of ['l', 't', 'u'] as const) expect(LAYOUTS).toContain(layout);
    expect(ROTS.some((r) => r > 0.1 && Math.abs(r - Math.PI / 2) > 0.1)).toBe(true);
    expect(CATEGORIES.filter((c) => ridesWall(c, shapeFor(c))).length).toBeGreaterThanOrEqual(5);
  });

  // The positive half, and it is the half that makes the negative half mean
  // anything: `valid = false` for everything would satisfy the sweep above.
  it('still accepts wall-mounted pieces everywhere they fit', () => {
    // Every one of these numbers is HALF of an A/B: the sweep was run once against
    // the exemption and once without it, and both columns are recorded here. That
    // matters because the whole case for DELETING the exemption rather than
    // narrowing it is a claim about what it cost, and a post-fix count on its own
    // cannot support a claim about a build it never ran.
    //
    // With the exemption, all six riders sat at 1575 — necessarily, since it made
    // `inRoom` unconditionally true for them. `every` is that ceiling: one size
    // class x 3 sizes x 3 angles x 7 x-targets x 5 z-targets x 5 layouts.
    const every = 1575;

    // A door, an AC unit and a mirror sit in or on the plaster, which is precisely
    // the case an exemption from the polygon test would have been written for. They
    // keep every placement they had WITHOUT it: the 10 mm shrink was already doing
    // that job. (`monitor` reads like a fourth member of this list and is not one —
    // its anchor is not a wall anchor, so `ridesWall` is false for it and the
    // exemption never applied. A comment here claimed otherwise and claimed 1575
    // for it; it is 1306, and always was.)
    for (const c of ['door', 'ac', 'mirror'] as const) {
      expect(accepts.get(c), `${c} lost placements it used to have`).toBe(every);
    }

    // The three that DID escape, pinned at the exact post-fix count rather than a
    // loose floor, because the floor was the weaker assertion in both directions:
    // `> every * 0.7` passes on the unfixed build (where all three are 1575) and so
    // could not tell the two columns apart at all.
    const KEPT = { curtain: 1264, painting: 1530, tv: 1557 } as const;
    for (const [c, n] of Object.entries(KEPT)) {
      expect(accepts.get(c as Category), `${c} moved`).toBe(n);
    }

    // …and the sentence the fix is actually defended with, as one number. Deleting
    // the exemption cost 374 placements — 311 curtain, 45 painting, 18 TV — and the
    // point is the SECOND half: **not one placement besides**. 28,739 were accepted
    // with the exemption and 28,365 without, across all 22 categories, so a non-rider
    // that gains or loses a placement moves this even though no line above names it.
    // That is not hypothetical: of the mutations run against this file, breaking the
    // rug exemption — which touches no wall rider at all — was caught by this line
    // ALONE, with the escape sweep and all six per-rider pins still green.
    const totalAccepted = [...accepts.values()].reduce((a, b) => a + b, 0);
    expect(totalAccepted, 'the fix moved something outside the six wall riders').toBe(28365);

    // Arithmetic over the four literals above, and deliberately not more than that:
    // no source mutation can reach it, because a wrong `KEPT` fails the loop first.
    // What it guards is the PROSE — 374 is quoted in `Design.md`, in
    // `docs/what-is-still-open.md` and in `drag-resolve.ts`'s own comment, and this
    // is the line that goes red when someone re-measures the pins and leaves those
    // three saying the old number.
    expect(every * 3 - (KEPT.curtain + KEPT.painting + KEPT.tv)).toBe(374);
  });
});
