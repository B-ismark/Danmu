import { describe, expect, it } from 'vitest';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout, type Footprint, type LayoutId } from '@/lib/footprint';
import { footInsidePoly, footOverlap, nearestEdge } from '@/lib/geometry';
import { WALL_GAP, footAt, isObstacle } from '@/lib/layout-rules';
import { wallAffinity } from '@/lib/physics';
import { constructiveStart, lockedForSolve, makeRng, movableFor, randomizeStart } from '@/lib/layout-solve';
import type { Placement } from '@/lib/layout-score';

// `constructiveStart` (§ 57 item 1, 2026-10-15): a start BUILT the way a person
// furnishes an empty room — biggest first, wall pieces backed onto a wall, a walkway
// off what is already down — instead of thrown. `shuffleRoom` alternates it with the
// scatter. These pin what makes it a different start from the scatter, measured against
// the scatter on the same seeds, so turning it back into the scatter is a red.

const ROOMS: [LayoutId, number, number][] = [['rect', 5, 4], ['l', 4.5, 4], ['t', 6, 5], ['u', 6, 5], ['open', 6, 4]];
const SEEDS = Array.from({ length: 12 }, (_, k) => k + 1);

const setup = (id: LayoutId, w: number, d: number) => {
  const parts = defaultScene(id, w, d);
  const footprint = footprintForLayout(id, w, d);
  const movable = movableFor(parts, lockedForSolve(parts, {}, null));
  return { parts, footprint, movable };
};

/** Floor obstacles a start leaves outside the room or overlapping another obstacle. */
function clashes(parts: ScenePart[], footprint: Footprint, at: Placement[]): number {
  const feet = parts.map((p, i) => (isObstacle(p) && !p.wallMounted ? footAt(p, at[i].x, at[i].z, at[i].yaw) : null));
  let n = 0;
  feet.forEach((f, i) => {
    if (!f) return;
    if (!footInsidePoly(f, footprint)) n++;
    for (let j = i + 1; j < feet.length; j++) if (feet[j] && footOverlap(f, feet[j]!)) n++;
  });
  return n;
}

/** Wall-preferring pieces a start leaves backed onto a wall, square to it. */
function againstWall(parts: ScenePart[], footprint: Footprint, movable: boolean[], at: Placement[]): [number, number] {
  let on = 0, of = 0;
  parts.forEach((p, i) => {
    if (!movable[i] || p.wallMounted || !isObstacle(p) || wallAffinity(p.category, p.shape) !== 'prefers-wall') return;
    of++;
    const e = nearestEdge(footprint, at[i].x, at[i].z);
    if (e && Math.abs(e.dist - (p.dimMM[1] / 2000 + WALL_GAP)) < 0.05) on++;
  });
  return [on, of];
}

describe('constructiveStart', () => {
  it('starts with fewer pieces through each other or the walls than the scatter', () => {
    const rows: string[] = [];
    let built = 0, thrown = 0;
    for (const [id, w, d] of ROOMS) {
      const { parts, footprint, movable } = setup(id, w, d);
      let b = 0, t = 0;
      for (const s of SEEDS) {
        b += clashes(parts, footprint, constructiveStart(parts, footprint, movable, makeRng(s)));
        t += clashes(parts, footprint, randomizeStart(parts, footprint, movable, makeRng(s)));
      }
      rows.push(`${id} ${w}x${d}: built ${b} · scatter ${t}`);
      built += b;
      thrown += t;
    }
    console.log('  ' + rows.join('\n  '));
    // Measured 2026-10-15: rect 5x4 0 / 23, l 4.5x4 4 / 45, t 6x5 52 / 109, u 6x5 0 / 32,
    // open 6x4 48 / 95. A third of the scatter's; the t and open rooms keep the most
    // because their dining sets are placed by the scatter as a whole and only redrawn.
    expect({ built, thrown }).toEqual({ built: 104, thrown: 304 });
  });

  it('backs the pieces that want a wall onto one', () => {
    let on = 0, of = 0, scatterOn = 0;
    for (const [id, w, d] of ROOMS) {
      const { parts, footprint, movable } = setup(id, w, d);
      for (const s of SEEDS) {
        const [a, n] = againstWall(parts, footprint, movable, constructiveStart(parts, footprint, movable, makeRng(s)));
        on += a;
        of += n;
        scatterOn += againstWall(parts, footprint, movable, randomizeStart(parts, footprint, movable, makeRng(s)))[0];
      }
    }
    console.log(`  against a wall: built ${on}/${of} · scatter ${scatterOn}/${of}`);
    // Measured 2026-10-15. The twelve it misses are pieces every wall slot it tried
    // would have put through something, so it kept the least-crowded try instead.
    expect({ on, of, scatterOn }).toEqual({ on: 84, of: 96, scatterOn: 5 });
  });

  it('leaves a locked piece, and every piece it does not place, where the scatter put it', () => {
    const { parts, footprint } = setup('rect', 5, 4);
    const bed = parts.findIndex((p) => wallAffinity(p.category, p.shape) === 'prefers-wall' && isObstacle(p) && !p.wallMounted);
    expect(bed, 'the fixture has a wall piece to lock').toBeGreaterThanOrEqual(0);
    const locked = lockedForSolve(parts, { [parts[bed].id]: true }, null);
    const movable = movableFor(parts, locked);
    for (const s of SEEDS) {
      const built = constructiveStart(parts, footprint, movable, makeRng(s));
      const thrown = randomizeStart(parts, footprint, movable, makeRng(s));
      expect(built[bed], `seed ${s}`).toEqual(thrown[bed]);
      parts.forEach((p, i) => {
        if (movable[i] && isObstacle(p) && !p.wallMounted) return;
        expect(built[i], `seed ${s}: ${p.id}`).toEqual(thrown[i]);
      });
    }
  });

  it('is a function of its seed', () => {
    const { parts, footprint, movable } = setup('l', 4.5, 4);
    expect(constructiveStart(parts, footprint, movable, makeRng(7))).toEqual(constructiveStart(parts, footprint, movable, makeRng(7)));
    expect(constructiveStart(parts, footprint, movable, makeRng(7))).not.toEqual(constructiveStart(parts, footprint, movable, makeRng(8)));
  });
});
