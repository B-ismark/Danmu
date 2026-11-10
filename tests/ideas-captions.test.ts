import { describe, expect, it } from 'vitest';
import { distinctLeads, ideaCaption, IDEAS_PER_PAGE } from '@/lib/layout-ideas';
import { lockedForShuffle, shuffleRoom, type ShuffleOffer } from '@/lib/layout-shuffle';
import { footprintBounds, type Footprint } from '@/lib/footprint';
import { frontVector } from '@/lib/geometry';
import type { ScenePart } from '@/lib/scene-spec';
import type { Placement } from '@/lib/layout-score';
import { ROOMS } from './helpers/ideas-rooms';

// The Ideas gallery's cards must be told apart by their captions, and what a caption
// says must be true of its arrangement. Measured on every room the bench uses, with
// the real search, one press, first page of four.

const COMPASS_OUT: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** An independent read of "against the X wall": some polygon edge lies within a hand
 *  of the piece's back, and that edge faces out toward X. Written from the polygon
 *  alone, not from the production helpers. */
function backIsOnWall(poly: Footprint, part: ScenePart, at: Placement, side: string): boolean {
  const [fx, fz] = frontVector(at.yaw);
  const x = at.x - (fx * part.dimMM[1]) / 2000;
  const z = at.z - (fz * part.dimMM[1]) / 2000;
  const area = poly.reduce((s, [ax, az], i) => {
    const [bx, bz] = poly[(i + 1) % poly.length];
    return s + (ax * bz - bx * az);
  }, 0);
  const sign = area > 0 ? 1 : -1;
  const [ox, oz] = COMPASS_OUT[side];
  return poly.some(([ax, az], i) => {
    const [bx, bz] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    const nx = (sign * (bz - az)) / len;
    const nz = (sign * -(bx - ax)) / len;
    if (nx * ox + nz * oz < 0.9) return false;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)));
    return Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az))) <= 0.1;
  });
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

      const b = footprintBounds(r.footprint);
      leads.forEach((lead, i) => {
        if (lead === null) return;
        const subject = r.parts.findIndex((p) => lead.startsWith(`${p.name} `));
        expect(subject, lead).toBeGreaterThanOrEqual(0);
        const part = r.parts[subject];
        const at = ideas[i].placements[subject];
        const [headAll, ...tails] = lead.split(' · ');
        const head = headAll.split(', facing')[0];
        const wall = /against the (north|south|east|west) wall/.exec(head);
        if (wall) expect(backIsOnWall(r.footprint, part, at, wall[1]), lead).toBe(true);
        // A named region of the room: its bounding-box third, each way.
        const tx = (at.x - b.minX) / b.width;
        const tz = (at.z - b.minZ) / b.depth;
        const region = /in the (?:(north|south)(?:-(east|west))?|(east|west))$/.exec(head);
        if (region) {
          const ns = region[1];
          const ew = region[2] ?? region[3];
          if (ns === 'north') expect(tz).toBeLessThan(1 / 3);
          if (ns === 'south') expect(tz).toBeGreaterThan(2 / 3);
          if (ew === 'west') expect(tx).toBeLessThan(1 / 3);
          if (ew === 'east') expect(tx).toBeGreaterThan(2 / 3);
        }
        if (head.endsWith('in the middle of the room')) {
          for (const t of [tx, tz]) {
            expect(t).toBeGreaterThanOrEqual(1 / 3);
            expect(t).toBeLessThanOrEqual(2 / 3);
          }
        }
        // Each trailing clause names a piece that moved in this idea, truthfully.
        for (const tail of tails) {
          const j = r.parts.findIndex((p) => tail.startsWith(`${p.name} `));
          expect(j, tail).toBeGreaterThanOrEqual(0);
          expect(ideas[i].moved).toContain(j);
          const w = /by the (north|south|east|west) wall$/.exec(tail);
          if (w) expect(backIsOnWall(r.footprint, r.parts[j], ideas[i].placements[j], w[1]), tail).toBe(true);
        }
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
