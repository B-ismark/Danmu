import { describe, it, expect } from 'vitest';
import { snapToWall, findSupportUnder, findSupportDetailed } from '@/lib/physics';
import { footArea, footFromPart, footIntersectionArea } from '@/lib/geometry';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];

// L-room: notch cut out of the x>1, z>0 quadrant.
const L: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 0],
  [1, 0],
  [1, 2],
  [-3, 2],
];

const TV: [number, number, number] = [1450, 60, 820];

describe('snapToWall (footprint-edge exact)', () => {
  it('snaps to the nearest rectangular wall, facing the room', () => {
    const s = snapToWall([0.4, 1.3, -1.5], TV, RECT);
    expect(s.z).toBeCloseTo(-2 + 0.03 + 0.02, 2); // wall + depth/2 + gap
    expect(s.x).toBeCloseTo(0.4);
    expect(s.rot).toBeCloseTo(0); // facing +Z into the room
  });

  it('snaps to an INNER wall of an L room (the old rect version pushed through it)', () => {
    // Item in the wing near the inner x=1 edge.
    const s = snapToWall([0.7, 0, 1.0], TV, L);
    expect(s.x).toBeCloseTo(1 - 0.05, 2); // flush on the inside of the inner wall
    expect(s.z).toBeCloseTo(1.0);
    expect(s.rot).toBeCloseTo(-Math.PI / 2, 1); // facing -X into the wing
  });

  it('keeps the part inset by half its depth', () => {
    const deep: [number, number, number] = [600, 650, 1700]; // fridge
    const s = snapToWall([-2.5, 0, 0], deep, RECT);
    expect(s.x).toBeCloseTo(-3 + 0.325 + 0.02, 2);
  });
});

// ─── findSupportUnder ───────────────────────────────────────────────────────
// Used to ask only whether the mover's CENTRE sat within the support's
// half-extents plus 5 cm, which called a laptop 90% off a desk "on the desk".
// It now weighs how much of the mover actually rests on the surface.

type SupportPart = Parameters<typeof findSupportUnder>[0][number];

const LAPTOP: [number, number, number] = [340, 240, 220]; // 0.34 × 0.24 m
const DESK: SupportPart = {
  id: 'desk',
  pos: [0, 0, 0],
  dimMM: [1400, 700, 750], // top at 0.75 m; half-width 0.7 m
  category: 'desk',
};

/** Laptop centre X that leaves `share` of its width over the desk's +X edge. */
const overhangX = (share: number) => 0.7 + 0.17 - share * 0.34;

/** The share `findSupportUnder` weighs, measured the same way it does — so a test
 *  can compare two orientations rather than only read its pass/fail verdict. */
const supportShare = (x: number, z: number, rot: number) => {
  const mover = footFromPart([x, 0, z], rot, LAPTOP);
  return footIntersectionArea(mover, footFromPart(DESK.pos, 0, DESK.dimMM)) / footArea(mover);
};

describe('findSupportUnder', () => {
  it('lands a part sitting squarely on the desk', () => {
    expect(findSupportUnder([DESK], 'laptop', 0, 0, LAPTOP)).toBeCloseTo(0.75, 6);
  });

  it('drops a part that is mostly off the edge', () => {
    // 10% of the laptop over the desk. The old centre test said "supported"
    // because the centre was still within half-extents + 5 cm.
    expect(findSupportUnder([DESK], 'laptop', overhangX(0.1), 0, LAPTOP)).toBeNull();
    // 40% is still not enough to hold it up.
    expect(findSupportUnder([DESK], 'laptop', overhangX(0.4), 0, LAPTOP)).toBeNull();
  });

  it('holds a part that is mostly on', () => {
    expect(findSupportUnder([DESK], 'laptop', overhangX(0.6), 0, LAPTOP)).toBeCloseTo(0.75, 6);
  });

  it('honours the support rotation', () => {
    // Desk turned a quarter turn is 0.7 m across, not 1.4. A point 0.5 m out is
    // beyond it — the rotation-blind version counted it as over the desk.
    const turned: SupportPart = { ...DESK, rot: Math.PI / 2 };
    expect(findSupportUnder([turned], 'laptop', 0.5, 0, LAPTOP)).toBeNull();
    expect(findSupportUnder([turned], 'laptop', 0, 0.5, LAPTOP)).toBeCloseTo(0.75, 6);
  });

  it('honours the mover rotation', () => {
    // Straight off ONE edge, rotation cannot matter and the maths has to say so:
    // the desk edge is then a line through the laptop's own centre, and any
    // centrally-symmetric shape is halved by a line through its centre. (This
    // used to be asserted the other way — "at 45° it reaches further along X, so
    // more of it clears the edge" — which is not true, and only passed because
    // the old rotation put the last bit of a 0.5 share below the threshold.)
    for (const rot of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, 1.1]) {
      expect(supportShare(overhangX(0.5), 0, rot)).toBeCloseTo(0.5, 9);
      expect(findSupportUnder([DESK], 'laptop', overhangX(0.55), 0, LAPTOP, rot)).toBeCloseTo(0.75, 6);
      expect(findSupportUnder([DESK], 'laptop', overhangX(0.45), 0, LAPTOP, rot)).toBeNull();
    }
    // Over a CORNER it does matter, and which WAY it is turned matters too —
    // turning one way tucks the laptop's long axis along the desk edge, the other
    // sends it out over the corner. Equal shares here would mean the rotation was
    // ignored; swapped ones would mean the scene's Y-rotation was read mirrored.
    const turnedIn = findSupportUnder([DESK], 'laptop', 0.6, 0.3, LAPTOP, Math.PI / 4);
    const turnedOut = findSupportUnder([DESK], 'laptop', 0.6, 0.3, LAPTOP, -Math.PI / 4);
    expect(turnedIn).not.toBeNull();
    expect(turnedOut).not.toBeNull();
    expect(supportShare(0.6, 0.3, Math.PI / 4)).toBeLessThan(supportShare(0.6, 0.3, -Math.PI / 4));
  });

  it('picks the highest qualifying surface', () => {
    const shelf: SupportPart = { id: 'shelf', pos: [0, 0.8, 0], dimMM: [800, 400, 40], category: 'shelf' };
    expect(findSupportUnder([DESK, shelf], 'laptop', 0, 0, LAPTOP)).toBeCloseTo(0.84, 6);
    expect(findSupportUnder([shelf, DESK], 'laptop', 0, 0, LAPTOP)).toBeCloseTo(0.84, 6);
  });

  it('ignores rugs, wall-mounted pieces and itself', () => {
    const rug: SupportPart = { id: 'rug', pos: [0, 0, 0], dimMM: [3000, 2000, 10], category: 'rug' };
    const tv: SupportPart = { id: 'tv', pos: [0, 1.3, 0], dimMM: [1400, 60, 800], category: 'tv', wallMounted: true };
    expect(findSupportUnder([rug, tv], 'laptop', 0, 0, LAPTOP)).toBeNull();
    expect(findSupportUnder([DESK], 'desk', 0, 0, LAPTOP)).toBeNull();
  });
});

// ─── findSupportDetailed ────────────────────────────────────────────────────
// Same test as findSupportUnder, but names which part won — the signal
// rigid-parenting establishes a relationship from (lib/rigid-parent.ts).

describe('findSupportDetailed', () => {
  it('names the supporting id alongside the height', () => {
    expect(findSupportDetailed([DESK], 'laptop', 0, 0, LAPTOP)).toEqual({ id: 'desk', y: 0.75 });
  });

  it('stays rotation-correct, same as findSupportUnder', () => {
    const turned: SupportPart = { ...DESK, rot: Math.PI / 2 };
    expect(findSupportDetailed([turned], 'laptop', 0.5, 0, LAPTOP)).toBeNull();
    expect(findSupportDetailed([turned], 'laptop', 0, 0.5, LAPTOP)?.y).toBeCloseTo(0.75, 6);
  });

  it('picks the highest qualifying surface, by id', () => {
    const shelf: SupportPart = { id: 'shelf', pos: [0, 0.8, 0], dimMM: [800, 400, 40], category: 'shelf' };
    expect(findSupportDetailed([DESK, shelf], 'laptop', 0, 0, LAPTOP)?.id).toBe('shelf');
    expect(findSupportDetailed([shelf, DESK], 'laptop', 0, 0, LAPTOP)?.id).toBe('shelf');
  });

  it('breaks a tie between two equal-height supports deterministically (first in order wins)', () => {
    const deskA: SupportPart = { ...DESK, id: 'desk-a' };
    const deskB: SupportPart = { ...DESK, id: 'desk-b' };
    expect(findSupportDetailed([deskA, deskB], 'laptop', 0, 0, LAPTOP)?.id).toBe('desk-a');
    expect(findSupportDetailed([deskB, deskA], 'laptop', 0, 0, LAPTOP)?.id).toBe('desk-b');
  });
});
