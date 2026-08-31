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
    // A door, an AC unit and a mirror sit in or on the plaster, which is the case an
    // exemption from the polygon test would have been written for. They are accepted
    // at EVERY sample without it — measured, and the reason it could be deleted
    // rather than repaired.
    // Literal for the same reason as `considered` above: one size class x every
    // angle x every target x every layout = 3 x 3 x 7 x 5 x 5.
    const every = 1575;
    for (const c of ['door', 'ac', 'mirror'] as const) {
      expect(accepts.get(c), `${c} lost placements it used to have`).toBe(every);
    }
    // …and the three that DID escape keep most of what they had: this is a fix for
    // the walls that are too short, not a ban on wall-mounted furniture.
    for (const c of ['curtain', 'painting', 'tv'] as const) {
      expect(accepts.get(c) ?? 0, `${c} was refused too widely`).toBeGreaterThan(every * 0.7);
    }
  });
});
