// Furnished rooms by the hundred: a seeded generator of plausible layouts in the
// known room, and a projector that photographs one from the middle the way the
// capture flow asks. Shared fixture, not a suite.
//
// WHY IT EXISTS. `lib/repeat-sightings.ts` sweeps the lens a photo could have been
// taken on, and the price of that is paid in real pieces that start unticked. A
// price is a rate, and a rate needs a population: the hand-built fixtures in
// `tests/repeat-sightings.test.ts` each isolate one decision, and not one of them
// can say how often a room's dining chairs collide. This can, and the figures the
// module's doc block quotes are this file's output — printed on every green run, so
// a drifting baseline shows up without anyone reading a diff.
//
// What the rooms hold is what the rooms in this app hold: the groups a person
// actually arranges against a wall (bed and its nightstands, sofa with its coffee
// table, a desk and its chair), a dining set sometimes, a rug sometimes, a few
// wall pieces and a ceiling light or fan. Nothing stands within 0.4 m of the
// camera, which is where the person holding it stands.
//
// The shuffle below is `sort` with a random comparator. That is not a uniform
// shuffle and does not need to be one; it IS deterministic for a given seed on one
// engine, which is the property the literals asserted against it depend on.

import type { Category, Shape } from '@/lib/scene-spec';
import { isRoundPart } from '@/lib/scene-spec';
import type { CameraCal } from '@/lib/photo-geometry';
import type { CaptureSlot } from '@/lib/storage';
import { ROOM } from './known-room';
import { ALONG, framedExtent, project, type Box } from './project';

/** mulberry32 — small, seedable, and the same sequence on every machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = 'floor' | 'wall' | 'ceiling';

/** One piece of furniture where it really stands. */
export type Placed = {
  label: string;
  category: Category;
  shape: Shape;
  dim: [number, number, number];
  kind: Kind;
  x: number;
  z: number;
  /** A wall piece's centre height; 0 on the floor, the ceiling's height above. */
  y: number;
  /** Floor pieces: does the width run along world x? */
  alongX: boolean;
  /** Wall pieces: which wall. */
  wall?: CaptureSlot;
  rug?: boolean;
};

const SLOTS: CaptureSlot[] = ['n', 'e', 's', 'w'];

/** The direction a slot's camera looks, as world (x, z). */
function facing(s: CaptureSlot): [number, number] {
  const [ax, az] = ALONG[s];
  return [az, -ax];
}

const wallDistance = (s: CaptureSlot) => (s === 'n' || s === 's' ? ROOM.depth / 2 : ROOM.width / 2);
const wallLength = (s: CaptureSlot) => (s === 'n' || s === 's' ? ROOM.width : ROOM.depth);

/** A point `u` along wall `s` and `v` out from it, in world (x, z). */
function offWall(s: CaptureSlot, u: number, v: number): [number, number] {
  const [fx, fz] = facing(s);
  const [ax, az] = ALONG[s];
  const d = wallDistance(s) - v;
  return [fx * d + ax * u, fz * d + az * u];
}

/** A member of a group, in the group's own wall frame. */
type Member = {
  label: string;
  category: Category;
  shape: Shape;
  dim: [number, number, number];
  u: number;
  v: number;
  widthAlongWall: boolean;
};

const member = (
  label: string,
  category: Category,
  shape: Shape,
  dim: [number, number, number],
  u: number,
  v: number,
  widthAlongWall = true,
): Member => ({ label, category, shape, dim, u, v, widthAlongWall });

function groups(r: () => number): Member[][] {
  const armchairs = r() < 0.5;
  return [
    [
      member('double bed', 'bed', 'bed-double', [1600, 2000, 600], 0, 1.0),
      member('bedside table', 'nightstand', 'nightstand', [450, 400, 550], -1.075, 0.2),
      member('bedside table', 'nightstand', 'nightstand', [450, 400, 550], 1.075, 0.2),
    ],
    [
      member('sofa', 'sofa', 'sofa', [2000, 850, 800], 0, 0.425),
      member('coffee table', 'table', 'coffee-table', [1100, 600, 450], 0, 1.6),
      ...(armchairs
        ? [
            member('armchair', 'chair', 'chair-armchair', [800, 800, 900], -1.5, 1.6),
            member('armchair', 'chair', 'chair-armchair', [800, 800, 900], 1.5, 1.6),
          ]
        : []),
    ],
    [member('wardrobe', 'wardrobe', 'wardrobe', [1200, 600, 2000], 0, 0.3)],
    [
      member('desk', 'desk', 'desk-standard', [1400, 700, 750], 0, 0.35),
      member('office chair', 'chair', 'chair-office', [600, 600, 1100], 0, 1.0),
    ],
    [member('bookshelf', 'shelf', 'bookshelf', [900, 350, 1800], 0, 0.175)],
    [member('fridge', 'fridge', 'fridge', [700, 700, 1800], 0, 0.35)],
    [member('potted plant', 'plant', 'plant', [400, 400, 900], 0, 0.3)],
    [member('floor lamp', 'lamp', 'lamp-floor', [300, 300, 1700], 0, 0.3)],
  ];
}

const WALL_PIECES: Array<Omit<Member, 'u' | 'v' | 'widthAlongWall'> & { y: number }> = [
  { label: 'tv', category: 'tv', shape: 'tv', dim: [1200, 80, 700], y: 1.2 },
  { label: 'framed print', category: 'painting', shape: 'painting', dim: [700, 40, 500], y: 1.5 },
  { label: 'mirror', category: 'mirror', shape: 'mirror', dim: [600, 30, 1400], y: 1.2 },
  { label: 'curtain', category: 'curtain', shape: 'curtain', dim: [1400, 80, 2300], y: 1.45 },
];

type Aabb = [number, number, number, number];

function aabb(p: Placed): Aabb {
  const hx = (p.alongX ? p.dim[0] : p.dim[1]) / 2000;
  const hz = (p.alongX ? p.dim[1] : p.dim[0]) / 2000;
  return [p.x - hx, p.z - hz, p.x + hx, p.z + hz];
}

const touches = (a: Aabb, b: Aabb, gap = 0.05) =>
  a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap;
const insideRoom = (a: Aabb) =>
  a[0] >= -ROOM.width / 2 + 0.01 &&
  a[2] <= ROOM.width / 2 - 0.01 &&
  a[1] >= -ROOM.depth / 2 + 0.01 &&
  a[3] <= ROOM.depth / 2 - 0.01;
/** Where the person holding the phone stands. */
const underfoot = (a: Aabb) => a[0] < 0.4 && a[2] > -0.4 && a[1] < 0.4 && a[3] > -0.4;

/** One furnished room, the same every time for the same seed. */
export function furnishedRoom(seed: number): Placed[] {
  const r = rng(seed);
  const out: Placed[] = [];
  const all = groups(r);
  const count = 3 + Math.floor(r() * 4);
  const pick = [...all].sort(() => r() - 0.5).slice(0, count);
  // A second plant sometimes: two of one kind in one room is the case a duplicate
  // check must not take.
  if (r() < 0.4) pick.push(all[6]);
  for (const g of pick) {
    for (let tries = 0; tries < 40; tries++) {
      const free = r() < 0.2 && g.length === 1;
      const wall = SLOTS[Math.floor(r() * 4)];
      const u0 = (r() - 0.5) * (wallLength(wall) - 1);
      const out0 = free ? 0.5 + r() * 1.5 : 0;
      const ps: Placed[] = g.map((m) => {
        const [x, z] = offWall(wall, u0 + m.u, m.v + out0);
        const wallAlongX = wall === 'n' || wall === 's';
        return {
          label: m.label, category: m.category, shape: m.shape, dim: m.dim, kind: 'floor', x, z, y: 0,
          alongX: m.widthAlongWall ? wallAlongX : !wallAlongX,
        };
      });
      const boxes = ps.map(aabb);
      if (boxes.some((b) => !insideRoom(b) || underfoot(b))) continue;
      if (boxes.some((b) => out.some((o) => !o.rug && o.kind === 'floor' && touches(b, aabb(o))))) continue;
      out.push(...ps);
      break;
    }
  }
  // A dining set sometimes: four identical chairs a pace apart, the population the
  // lens sweep pays its price in.
  if (r() < 0.35) {
    for (let tries = 0; tries < 40; tries++) {
      const cx = (r() - 0.5) * 4;
      const cz = (r() - 0.5) * 3;
      const alongX = r() < 0.5;
      const table: Placed = {
        label: 'dining table', category: 'table', shape: 'desk-standard', dim: [1600, 900, 750],
        kind: 'floor', x: cx, z: cz, y: 0, alongX,
      };
      const chairs: Placed[] = [-0.4, 0.4].flatMap((a) =>
        [-0.75, 0.75].map((b): Placed => {
          const [dx, dz] = alongX ? [a, b] : [b, a];
          return {
            label: 'dining chair', category: 'chair', shape: 'chair-dining', dim: [450, 500, 900],
            kind: 'floor', x: cx + dx, z: cz + dz, y: 0, alongX,
          };
        }),
      );
      const ps = [table, ...chairs];
      const boxes = ps.map(aabb);
      if (boxes.some((b) => !insideRoom(b) || underfoot(b))) continue;
      if (boxes.some((b) => out.some((o) => !o.rug && o.kind === 'floor' && touches(b, aabb(o))))) continue;
      out.push(...ps);
      break;
    }
  }
  if (r() < 0.4) {
    const alongX = r() < 0.5;
    const rug: Placed = {
      label: 'rug', category: 'rug', shape: 'rug', dim: [2000, 1400, 5], kind: 'floor',
      x: (r() - 0.5) * 3, z: (r() - 0.5) * 2, y: 0, alongX, rug: true,
    };
    if (insideRoom(aabb(rug)) && !underfoot(aabb(rug))) out.push(rug);
  }
  const wallCount = Math.floor(r() * 4);
  const hung: Array<{ wall: CaptureSlot; u0: number; u1: number; y0: number; y1: number }> = [];
  for (let k = 0; k < wallCount; k++) {
    const w = WALL_PIECES[Math.floor(r() * WALL_PIECES.length)];
    for (let tries = 0; tries < 30; tries++) {
      const wall = SLOTS[Math.floor(r() * 4)];
      const half = w.dim[0] / 2000;
      const u = (r() - 0.5) * (wallLength(wall) - 2 * half - 0.1);
      const y0 = w.y - w.dim[2] / 2000;
      const y1 = w.y + w.dim[2] / 2000;
      if (hung.some((q) => q.wall === wall && q.u0 < u + half + 0.1 && u - half - 0.1 < q.u1 && q.y0 < y1 && y0 < q.y1)) continue;
      hung.push({ wall, u0: u - half, u1: u + half, y0, y1 });
      const [x, z] = offWall(wall, u, 0);
      out.push({
        label: w.label, category: w.category, shape: w.shape, dim: w.dim, kind: 'wall', x, z, y: w.y,
        alongX: wall === 'n' || wall === 's', wall,
      });
      break;
    }
  }
  if (r() < 0.5) {
    const fan = r() < 0.5;
    const x = (r() - 0.5) * 4;
    const z = (r() - 0.5) * 3;
    // Not straight overhead: a level camera cannot see the ceiling there.
    if (Math.hypot(x, z) > 1.3) {
      out.push(
        fan
          ? { label: 'ceiling fan', category: 'fan', shape: 'fan', dim: [1000, 1000, 200], kind: 'ceiling', x, z, y: ROOM.height, alongX: true }
          : { label: 'pendant light', category: 'lamp', shape: 'lamp-pendant', dim: [500, 500, 300], kind: 'ceiling', x, z, y: ROOM.height, alongX: true },
      );
    }
  }
  return out;
}

/** Points on a piece's outline in 3D: a ceiling disc's rim, a round floor piece's
 *  top and bottom rims, or every edge of a box. The box a detector draws round a
 *  piece is the extent of what it can see of these. */
function outline(p: Placed): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  if (p.kind === 'ceiling') {
    const rr = p.dim[0] / 2000;
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * 2 * Math.PI;
      pts.push([p.x + rr * Math.cos(a), ROOM.height, p.z + rr * Math.sin(a)]);
    }
    return pts;
  }
  if (p.kind === 'floor' && isRoundPart(p.shape)) {
    const rr = Math.max(p.dim[0], p.dim[1]) / 2000;
    const h = p.dim[2] / 1000;
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * 2 * Math.PI;
      for (const y of [0, h]) pts.push([p.x + rr * Math.cos(a), y, p.z + rr * Math.sin(a)]);
    }
    return pts;
  }
  const corners: Array<[number, number, number]> = [];
  if (p.kind === 'floor') {
    const [x0, z0, x1, z1] = aabb(p);
    const h = p.dim[2] / 1000;
    for (const x of [x0, x1]) for (const y of [0, h]) for (const z of [z0, z1]) corners.push([x, y, z]);
  } else {
    const [ax, az] = ALONG[p.wall!];
    const [fx, fz] = facing(p.wall!);
    const [w, d, h] = p.dim.map((v) => v / 1000);
    for (const sw of [-1, 1]) {
      for (const dy of [-h / 2, h / 2]) {
        for (const sd of [0, 1]) {
          corners.push([p.x + ax * sw * (w / 2) - fx * sd * d, p.y + dy, p.z + az * sw * (w / 2) - fz * sd * d]);
        }
      }
    }
  }
  // Twelve edges: the corner pairs that differ in one index bit.
  const steps = 16;
  for (let i = 0; i < 8; i++) {
    for (let b = 0; b < 3; b++) {
      const j = i ^ (1 << b);
      if (j < i) continue;
      for (let t = 0; t <= steps; t++) {
        const f = t / steps;
        pts.push([
          corners[i][0] + (corners[j][0] - corners[i][0]) * f,
          corners[i][1] + (corners[j][1] - corners[i][1]) * f,
          corners[i][2] + (corners[j][2] - corners[i][2]) * f,
        ]);
      }
    }
  }
  return pts;
}

const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' } as const;

/** The box a detector would draw round `p` in the photo of wall `s` taken on `cal`
 *  — the part inside the frame — or null when the photo does not show it: behind
 *  the camera, less than 30% of it in the picture, or a sliver. */
export function boxIn(p: Placed, s: CaptureSlot, cal: CameraCal): Box | null {
  if (p.kind === 'wall' && p.wall === OPPOSITE[s]) return null;
  const pts = outline(p);
  const [fx, fz] = facing(s);
  if (pts.some(([x, , z]) => fx * x + fz * z <= 0.15)) return null;
  const uv = pts.map(([x, y, z]) => project(s, x, y, z, cal));
  const framed = uv.filter(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1).length;
  if (framed / uv.length < 0.3) return null;
  const box = framedExtent(uv);
  if (!box || box[2] < 0.03 || box[3] < 0.03) return null;
  return box;
}

export const SWEEP_SLOTS = SLOTS;
