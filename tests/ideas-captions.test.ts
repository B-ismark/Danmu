import { describe, expect, it } from 'vitest';
import { backWall, distinctLeads, ideaCaption, IDEAS_PER_PAGE, NEAR_LANDMARK_M } from '@/lib/layout-ideas';
import { lockedForShuffle, shuffleRoom, type ShuffleOffer } from '@/lib/layout-shuffle';
import { footprintBounds, footprintForLayout, wallOutwardNormal, wallSegments, type Footprint } from '@/lib/footprint';
import { distToBoundary, footFromPart, footInsidePoly, frontVector, pointInPoly } from '@/lib/geometry';
import { roleOf, WALL_ATTACH_TOL } from '@/lib/layout-rules';
import { wallLabelFor, wallLabelOf } from '@/lib/wall-label';
import type { ScenePart } from '@/lib/scene-spec';
import type { Placement } from '@/lib/layout-score';
import { ROOMS } from './helpers/ideas-rooms';

// The Ideas gallery's cards must be told apart by their captions, and what a caption
// says must be true of its arrangement. Measured on every room the bench uses, with
// the real search, one press, first page of four. Wall names are the plan's own
// (`wallLabelOf`), never a convention of this file's.

const lower = (label: string) => (/^wall \d+$/i.test(label) ? label.toLowerCase() : `the ${label.toLowerCase()}`);

function edgeDist(poly: Footprint, e: number, x: number, z: number): number {
  const [ax, az] = poly[e];
  const [bx, bz] = poly[(e + 1) % poly.length];
  const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
  return Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az)));
}

/** Is `phrase` ("the north wall" / "wall 3") a wall the piece's back is on? Some edge
 *  the plan labels that way is within reach of the back and faces away from it. */
function backIsOn(poly: Footprint, part: ScenePart, at: Placement, phrase: string): boolean {
  const [fx, fz] = frontVector(at.yaw);
  const x = at.x - (fx * part.dimMM[1]) / 2000;
  const z = at.z - (fz * part.dimMM[1]) / 2000;
  return poly.some((_, e) => {
    if (lower(wallLabelOf(poly, e)) !== phrase) return false;
    const [ox, oz] = wallOutwardNormal(poly, e);
    return ox * -fx + oz * -fz >= 0.5 && edgeDist(poly, e, x, z) <= WALL_ATTACH_TOL;
  });
}

const TAIL = /^(.+?) moves (by (?:the .+ wall|wall \d+)|near the (?:window|door|TV)|to the middle of the room)$/;

/** Every claim in `lead` checked against the arrangement. */
function checkTrue(parts: ScenePart[], footprint: Footprint, lead: string, idea: { placements: Placement[]; moved: number[] }) {
  const b = footprintBounds(footprint);
  const [head, ...tails] = lead.split(' · ');
  const subject = parts.findIndex((p) => head.startsWith(`${p.name} `));
  expect(subject, lead).toBeGreaterThanOrEqual(0);
  const claimIn = (j: number, words: string) => {
    const part = parts[j];
    const at = idea.placements[j];
    const wall = /(?:against|by) ((?:the .+? wall)|(?:wall \d+))/.exec(words);
    if (wall) expect(backIsOn(footprint, part, at, wall[1]), words).toBe(true);
    if (/in the middle of the room/.test(words)) {
      // Inside the room (the footprint test, not a box), and in the box's central third.
      expect(footInsidePoly(footFromPart([at.x, 0, at.z], at.yaw, part.dimMM, part.circle, part.shape), footprint), words).toBe(true);
      for (const t of [(at.x - b.minX) / b.width, (at.z - b.minZ) / b.depth]) {
        expect(t).toBeGreaterThanOrEqual(1 / 3);
        expect(t).toBeLessThanOrEqual(2 / 3);
      }
    }
    const near = /near the (window|door|TV)/.exec(words);
    if (near) {
      const role = near[1] === 'TV' ? 'tv' : near[1];
      expect(
        parts.some((q, k) => k !== j && roleOf(q) === role && Math.hypot(q.pos[0] - at.x, q.pos[2] - at.z) <= NEAR_LANDMARK_M),
        words,
      ).toBe(true);
    }
  };
  claimIn(subject, head.split(', facing')[0]);
  for (const tail of tails) {
    const m = TAIL.exec(tail);
    expect(m, `a tail with a verb: ${tail}`).not.toBeNull();
    const j = parts.findIndex((p) => p.name === m![1]);
    expect(j, tail).toBeGreaterThanOrEqual(0);
    expect(idea.moved, tail).toContain(j);
    claimIn(j, m![2].replace('to the middle', 'in the middle'));
  }
}

describe('Ideas captions tell the cards apart', () => {
  for (const r of ROOMS()) {
    it(`${r.name}: distinct within a page, and true`, { timeout: 120_000 }, () => {
      const locked = lockedForShuffle(r.parts, {});
      const out = shuffleRoom(r.parts, { footprint: r.footprint, height: 2.4 }, locked, { attempt: 1, history: [] as ShuffleOffer[] });
      const ideas = (out?.ideas ?? []).slice(0, IDEAS_PER_PAGE.wide).map((i) => ({ placements: i.placements, moved: i.moved }));
      expect(ideas.length).toBeGreaterThan(1);
      const leads = distinctLeads(r.parts, r.footprint, ideas);
      expect(new Set(leads).size, leads.join('\n')).toBe(leads.length);
      leads.forEach((lead, i) => {
        if (lead !== null) checkTrue(r.parts, r.footprint, lead, ideas[i]);
      });
    });
  }

  it('leaves a lone card with the short caption', () => {
    const r = ROOMS()[0];
    const locked = lockedForShuffle(r.parts, {});
    const out = shuffleRoom(r.parts, { footprint: r.footprint, height: 2.4 }, locked, { attempt: 1, history: [] });
    const one = (out?.ideas ?? []).slice(0, 1).map((i) => ({ placements: i.placements, moved: i.moved }));
    expect(distinctLeads(r.parts, r.footprint, one)).toEqual([ideaCaption(r.parts, r.footprint, one[0]).lead]);
  });
});

describe('a caption names a wall the way the plan does', () => {
  it('wallLabelOf is what the plan and the Inspector compute from wallSegments, in every preset', () => {
    for (const id of ['rect', 'l', 't', 'u', 'open'] as const) {
      const fp = footprintForLayout(id, 6, 5);
      const segs = wallSegments(fp);
      expect(segs.length).toBe(fp.length);
      fp.forEach((_, e) => expect(wallLabelOf(fp, e), `${id} edge ${e}`).toBe(wallLabelFor(segs[e].yaw, e, fp.length === 4)));
    }
  });

  it('says "wall N" on an outline that is not four-sided, and a compass side on one that is', () => {
    expect(wallLabelOf(footprintForLayout('l', 6, 5), 0)).toMatch(/^Wall \d$/);
    expect(wallLabelOf(footprintForLayout('rect', 6, 5), 0)).toMatch(/^(North|South|East|West) wall$/);
  });

  const sofa = { id: 'sofa', name: 'Sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 800], pos: [0, 0, 0], rot: 0, locked: false } as ScenePart;
  const tied = (fp: Footprint, parts: ScenePart[], pls: Placement[][]) =>
    distinctLeads(parts, fp, pls.map((placements) => ({ placements, moved: placements.map((_, i) => i) })));

  it('an L room: the caption says the wall the plan labels, "against wall N"', () => {
    const fp = footprintForLayout('l', 6, 5);
    const b = footprintBounds(fp);
    // Back flat on the first edge's wall, in two spots, so the two cards tie.
    const [ax, az] = fp[0];
    const [bx, bz] = fp[1];
    const [ox, oz] = wallOutwardNormal(fp, 0);
    const yaw = Math.atan2(-ox, -oz);
    const pl = (t: number): Placement => ({ x: ax + (bx - ax) * t - ox * 0.45, z: az + (bz - az) * t - oz * 0.45, yaw }) as Placement;
    const [one, two] = tied(fp, [sofa], [[pl(0.35)], [pl(0.65)]]);
    expect(b.width).toBeGreaterThan(0);
    expect(one).toBe(two);
    expect(one).toBe(`Sofa against ${wallLabelOf(fp, 0).toLowerCase()}`);
  });

  it('open-floor claims in an L stay inside the footprint: the notch is never "the middle of the room"', () => {
    const fp = footprintForLayout('l', 6, 5);
    const b = footprintBounds(fp);
    // The deepest point of the cut-away quadrant inside the box's central third.
    let notch: [number, number] | null = null;
    let deepest = 0;
    for (let i = 0; i <= 20; i++) {
      for (let k = 0; k <= 20; k++) {
        const x = b.minX + b.width * (1 / 3 + (i / 20) / 3);
        const z = b.minZ + b.depth * (1 / 3 + (k / 20) / 3);
        if (pointInPoly(x, z, fp)) continue;
        const d = distToBoundary(fp, x, z);
        if (d > deepest) {
          deepest = d;
          notch = [x, z];
        }
      }
    }
    expect(notch, 'the fixture must have floor-less ground in its middle third').not.toBeNull();
    expect(deepest).toBeGreaterThan(WALL_ATTACH_TOL + 0.1);
    let inside: [number, number] | null = null;
    for (let i = 0; i <= 20 && !inside; i++) {
      for (let k = 0; k <= 20 && !inside; k++) {
        const x = b.minX + b.width * (1 / 3 + (i / 20) / 3);
        const z = b.minZ + b.depth * (1 / 3 + (k / 20) / 3);
        if (pointInPoly(x, z, fp) && distToBoundary(fp, x, z) > 0.8) inside = [x, z];
      }
    }
    expect(inside, 'and some floor in it too').not.toBeNull();
    const at = (p: [number, number]): Placement => ({ x: p[0], z: p[1], yaw: 0 }) as Placement;
    const [inNotch, onFloor] = tied(fp, [{ ...sofa, dimMM: [600, 200, 800] }], [[at(notch!)], [at(inside!)]]);
    expect(inNotch).not.toMatch(/middle of the room/);
    expect(onFloor).toBe('Sofa in the middle of the room');
  });

  it('a corner takes the wall the back faces, not the nearer edge', () => {
    const fp = footprintForLayout('rect', 6, 4);
    const b = footprintBounds(fp);
    // Back to the EAST wall (front is -x), 0.04 m off it, and only 0.01 m off the
    // north wall: the nearest edge is north, the wall it is turned away from is east.
    const yaw = -Math.PI / 2;
    const place = { x: b.maxX - 0.04 - 0.45, z: b.minZ + 0.01, yaw } as Placement;
    const e = backWall(sofa, place, fp);
    expect(e).not.toBeNull();
    expect(lower(wallLabelOf(fp, e!))).toBe('the east wall');
    const other = { x: b.maxX - 0.04 - 0.45, z: b.minZ + 0.8, yaw } as Placement;
    const [a, c] = tied(fp, [sofa], [[place], [other]]);
    expect(a).toBe('Sofa against the east wall');
    expect(c).toBe('Sofa against the east wall');
  });
});
