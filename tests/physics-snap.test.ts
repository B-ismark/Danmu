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

describe('snapToWall pinned to one edge', () => {
  // The wall a piece is allowed to ride is a caller's decision when anything is
  // following it: `nearestEdge` changes its mind discontinuously at the midline
  // between two walls, and that flip becomes the delta a whole selection
  // translates by. See `Convoy.leadEdge`.
  it('keeps the named wall even when another is nearer', () => {
    const free = snapToWall([2.8, 0, 1.5], TV, RECT);
    const pinned = snapToWall([2.8, 0, 1.5], TV, RECT, 0, 0);
    // `.not.toBeCloseTo(0)` is satisfied by `undefined` — verified: with
    // `snapToWall` returning no `rot` at all this line passed and the failure
    // surfaced one line down, on the pinned side. `rot` is genuinely optional on
    // the return type (`if (!edge) return { x, z }`), so "it chose a different
    // wall" has to assert that it chose a wall at all.
    expect(free.rot).toBeDefined();
    expect(free.rot).not.toBeCloseTo(0);
    expect(pinned.rot).toBeCloseTo(0);
    expect(pinned.z).toBeCloseTo(-2 + TV[1] / 2000 + 0.02);
    // Along the wall it tracks the pointer as far as its own half-width allows —
    // x = 2.8 on a wall ending at 3 would put 525 mm of a 1.45 m TV round the
    // corner. See the describe below.
    expect(pinned.x).toBeCloseTo(3 - TV[0] / 2000, 6);
  });

  it('tracks the pointer exactly while the whole piece still fits', () => {
    // The other side of the same clamp: it must not be a general pull toward the
    // middle. Half a TV is 725 mm, so x = 1.5 is well inside and must come back
    // untouched.
    expect(snapToWall([1.5, 0, 1.5], TV, RECT, 0, 0).x).toBeCloseTo(1.5, 9);
  });

  it('falls back to the nearest wall for an index the footprint no longer has', () => {
    // A wall drag can shorten the outline under a held index. Falling back is the
    // forgiving direction: the nearest wall is a less constrained answer, never a
    // wrong one, where a refusal would strand the piece.
    const stale = snapToWall([2.8, 0, 1.5], TV, RECT, 0, 99);
    const free = snapToWall([2.8, 0, 1.5], TV, RECT);
    expect(stale).toEqual(free);
  });

  it('is unchanged when no edge is named', () => {
    expect(snapToWall([0, 0, -1.5], TV, RECT, 0, null)).toEqual(snapToWall([0, 0, -1.5], TV, RECT));
    expect(snapToWall([0, 0, -1.5], TV, RECT, 0, undefined)).toEqual(snapToWall([0, 0, -1.5], TV, RECT));
  });
});

// ─── A wall-mounted piece stays ON the wall it is mounted to ────────────────
//
// `edgeProjection` clamps its parameter to [0, 1], so it returns the nearest point
// ON the segment — and `snapToWall` used to put the piece's CENTRE there. Aim past
// the end of a wall and the centre landed exactly on the corner, with half the
// piece through the return wall. The report was "sometimes the TV sticks to the
// farthest edge of the wall it's on, sometimes there's a bit of a gap between the
// TV and the other wall" — one behaviour, seen from two corners.
//
// Every case is checked on ALL FOUR walls and at BOTH ends of each, because this
// is a handedness bug: the along-wall unit vector points a different way per edge
// and its sign is invisible wherever the test is symmetric. A square room would
// also hide a width/depth mix-up, so the fixture is 6 × 4.
describe('snapToWall keeps the whole piece on its wall', () => {
  /** The four walls of RECT, by edge index, with the axis they run along and the
   *  coordinate that varies along them — **derived from `RECT` itself**, so the two
   *  cannot disagree. This was transcribed by hand under a comment claiming it was
   *  derived, which was harmless only by luck: `want` is computed from these
   *  numbers, so a changed `RECT` did go red. It is one edit away from not being. */
  const WALLS = RECT.map((a, i) => {
    const b = RECT[(i + 1) % RECT.length];
    const along = a[0] === b[0] ? ('z' as const) : ('x' as const);
    const axis = along === 'x' ? 0 : 1;
    const fixed = along === 'x' ? `z = ${a[1]}` : `x = ${a[0]}`;
    return { index: i, name: `edge ${i} (${fixed})`, along, from: a[axis], to: b[axis] };
  });
  const half = TV[0] / 2000; // 0.725 m along the wall

  it('stops half its width short of both ends of every wall', () => {
    for (const w of WALLS) {
      for (const end of [w.from, w.to]) {
        // Aim a metre PAST the corner, so the projection clamps to the end.
        const past = end + Math.sign(end - (w.from + w.to) / 2) * 1;
        const at: [number, number, number] = w.along === 'x' ? [past, 0, 0] : [0, 0, past];
        const s = snapToWall(at, TV, RECT, 0, w.index);
        const got = w.along === 'x' ? s.x : s.z;
        const want = end - Math.sign(end - (w.from + w.to) / 2) * half;
        expect(got, `${w.name}, end ${end}`).toBeCloseTo(want, 6);
      }
    }
  });

  it('leaves a piece alone wherever it genuinely fits', () => {
    for (const w of WALLS) {
      const at: [number, number, number] = w.along === 'x' ? [0.4, 0, 0] : [0, 0, 0.4];
      const s = snapToWall(at, TV, RECT, 0, w.index);
      expect(w.along === 'x' ? s.x : s.z, w.name).toBeCloseTo(0.4, 9);
    }
  });

  it('centres a piece wider than the wall it is on rather than pinning it to one end', () => {
    // A 5 m panel on the 4 m east wall. Clamping both ends against each other
    // would let the min beat the max; the piece keeps its real size and the room
    // report is what says it does not fit (rule 2).
    const WIDE: [number, number, number] = [5000, 60, 800];
    for (const aim of [-9, 0, 9]) {
      const s = snapToWall([0, 0, aim], WIDE, RECT, 0, 1);
      expect(s.z, `aimed at z = ${aim}`).toBeCloseTo(0, 6);
    }
  });

  it('does the same on an inner wall of an L, whose ends are not room corners', () => {
    // The L's inner edge x = 1 runs z 0 → 2, so it is 2 m long and a 1.45 m TV has
    // only 550 mm of travel on it. Aimed at either end it must come back inside.
    const inner = L.findIndex((p, i) => p[0] === 1 && L[(i + 1) % L.length][0] === 1);
    expect(inner, 'the fixture must have an inner x = 1 wall').toBeGreaterThanOrEqual(0);
    const low = snapToWall([0.7, 0, -5], TV, L, 0, inner);
    const high = snapToWall([0.7, 0, 5], TV, L, 0, inner);
    for (const s of [low, high]) {
      expect(s.z).toBeGreaterThanOrEqual(0 + half - 1e-9);
      expect(s.z).toBeLessThanOrEqual(2 - half + 1e-9);
    }
    // …and they are not the same point, or the clamp would be collapsing both
    // ends onto the middle.
    expect(Math.abs(high.z - low.z)).toBeGreaterThan(0.4);
  });
});
