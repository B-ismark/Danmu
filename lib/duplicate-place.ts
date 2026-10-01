// Where a copy goes: beside the piece it was copied from, never inside it.
//
// Duplicate used to try seven FIXED offsets — 350 mm on each diagonal, 700 mm along
// each axis — and, when every one collided, fall back to the last, which was
// `[0, 0]`: the original's own spot. A fixed step is a step sized for a chair. A
// wardrobe, a bed or a sofa is wider than 700 mm, so every offset still overlapped
// the original and the copy landed exactly inside it — the user's report on
// 2026-10-01, "it shouldn't spawn inside the main instance". And each spot was
// checked with `clampIntoFootprint` + `collidesAt`, a two-step imitation of a drop,
// so a copy of a lamp beside its desk hung in the air at desk height.
//
// So the candidates are measured off the piece (its own width and depth plus a gap),
// in the piece's own frame — beside it first, along its width, which is where a
// second chair or a second print goes and which keeps a wall piece on its wall —
// and every candidate is a DROP: `resolvePlacement`, the one pipeline both drag
// surfaces use, decides what it stands on, which wall it rides and whether it is in
// the room and clear. A copy is a drop the user did not have to make.
//
// A selection of several pieces is copied as ONE set, by one shared offset sized off
// the set's combined footprint, so a bed and its nightstands arrive as a bed and its
// nightstands rather than three pieces scattered to wherever each found room. Only
// while the set can arrive as a set: two chairs selected from opposite corners have
// no offset that keeps both in the room, the clamp carried both copies into one
// corner, and the second stood on the first — reported clear, found in review. A set
// whose formation does not survive anywhere is copied piece by piece instead, each
// beside its own original.
//
// "Clear" is stricter for a copy than for a drag, and the user's next look, the same
// day, is why: *"they don't consider whether they're clipping with an object"*. A
// drag's `valid` forgives two things on purpose that a copy must not. It lets a chair
// tuck under a table, which is composition when a person pushes it in and a copy
// buried in the table when Duplicate does it; and its gravity step lets a short piece
// climb a tall one, so a nightstand's copy came back standing ON the bed. So a copy
// also has to touch nothing it could collide with (`snug`), and stand on what its
// original stands on (`footing`) — a floor piece on the floor, a lamp on its desk.
// A rider whose own surface is full may go on another surface of the SAME kind — a
// lamp off a full nightstand onto the other nightstand — and failing that, onto the
// floor beside it. Not onto any top at all: physics will stand a lamp on anything
// broad enough, and the first version's "on something" put a bedside lamp's copy on
// the bed. A lamp on the floor is a lamp the user lifts; a lamp in the duvet is a
// clash nobody asked for.
//
// When nothing BESIDE it is clear, the rest of the room is searched, nearest first:
// "if there's space" means anywhere there is space, not only the spots next to it.
// The first version gave up after those and took the least-bad one, which in a
// furnished T-shaped room was a sofa's copy standing in a lamp, a table and a chair.
//
// Only when no spot in the whole room is clear is the copy made overlapping something
// — Duplicate is never a gesture that does nothing, and refusing it would trap an edge
// case nobody has thought of — with `clear: false` so the caller says so. WHERE it is
// made is the user's third look: *"currently it spawns on top … at some point
// duplicated items mush into each other."* The first version took the nearest spot the
// drag would call valid, and a drag's gravity is what makes a spot valid when the
// floor is full: the copy climbed onto the bed, the next copy onto that one. So the
// overlapping copy keeps its original's footing — a bed stays on the floor, never on
// the bed beside it — and goes where it overlaps LEAST, so a fifth copy finds the
// thinnest gap left rather than the fourth copy's spot. The last resort is the
// original's own spot only when not even that exists, reported the same way.
//
// What a source stands on is asked of the room as it STANDS (`restingOn`), never of a
// remembered link. The caller used to hand in `riderRelation`, which reads the
// authored scene: a lamp authored on a nightstand and dragged to the floor still
// "rode" the nightstand there, and the room-wide search went and found it — the
// copy of a lamp on the floor appeared on a nightstand 3.3 m away, reported clear.

import { resolvePlacement } from './drag-resolve';
import {
  aabbExtents,
  footFromPart,
  footOverlap,
  localToWorld,
  obbFromPart,
  obbOverlap,
  pointInPoly,
  TOUCH_M,
} from './geometry';
import { footprintBounds, type Footprint } from './footprint';
import { isSoftFurnishing } from './layout-rules';
import { isFloorStanding, restingOn } from './physics';
import { canCollideWith, type ScenePart } from './scene-spec';

/** Air between the original and its copy, metres. Enough to read as two pieces from
 *  the default camera; under the 100 mm a person would call "apart". */
export const COPY_GAP_M = 0.05;

/** How far a resolve may move a copy off the spot it was asked for and still count as
 *  that spot — a wall snap re-measuring a print's standoff, not a clamp. */
const ASKED_TOL_M = 0.005;

/** Spacing of the room-wide search once nothing beside the piece is clear, metres.
 *  Fine enough that a gap a chair fits in is not stepped over; a full 6 × 5 room is
 *  ~1300 spots, each one resolve, ~100 ms measured when none is clear. */
export const SEARCH_STEP_M = 0.15;

/** …and the most spots one search may resolve. A room bigger than ~8 × 6 m spaces
 *  its grid out to stay under it, rather than a 12 × 10 m hall costing 5000
 *  resolves (~210 ms measured) and the 40 m maximum seventy thousand. */
const SEARCH_MAX_SPOTS = 2000;

/** What a copy stands on. `copy: true` means the COPY of source `id` — a lamp copied
 *  with its desk is on the desk's copy, whose id the caller has not made yet. */
export type CopySupport = { id: string; copy: boolean } | null;

export type CopyPlacement = {
  /** One answer per source, in the order given. */
  spots: Array<{ pos: [number, number, number]; rot: number; support: CopySupport }>;
  /** Every copy is in the room, touches nothing and stands where its original does. */
  clear: boolean;
  /** Every copy is BESIDE its original — one step away, not wherever the room had
   *  space. The caller says "beside it" only when this is true. */
  beside: boolean;
};

/** The offsets to try, nearest first: the four sides, the four corners, then the four
 *  sides again one piece further out. `w`/`d` are the extents in metres of whatever is
 *  being copied along the frame's own x and z. */
function candidates(w: number, d: number): Array<[number, number]> {
  const sx = w + COPY_GAP_M;
  const sz = d + COPY_GAP_M;
  return [
    [sx, 0], [-sx, 0], [0, sz], [0, -sz],
    [sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz],
    [2 * sx, 0], [-2 * sx, 0], [0, 2 * sz], [0, -2 * sz],
  ];
}

/**
 * @param sources the pieces being copied, at their EFFECTIVE transforms.
 * @param world   every piece in the room at its effective transform, sources included
 *                — the originals are obstacles, which is the whole point.
 */
export function placeCopies(
  sources: ScenePart[],
  world: ScenePart[],
  footprint: Footprint,
  roomHeight: number,
): CopyPlacement {
  return place(sources, world, footprint, roomHeight, new Map());
}

/** @param standsFor world ids that are copies already placed in this same gesture,
 *  mapped to the source each copies — the piece-by-piece fallback's earlier answers. */
function place(
  sources: ScenePart[],
  world: ScenePart[],
  footprint: Footprint,
  roomHeight: number,
  standsFor: ReadonlyMap<string, string>,
): CopyPlacement {
  if (sources.length === 0) return { spots: [], clear: true, beside: true };

  // One piece is measured in its own frame, so "beside" means along its width
  // whichever way it faces. A set has no one facing, so it is measured in the room's.
  const single = sources.length === 1;
  const frame = single ? sources[0].rot : 0;
  let w: number;
  let d: number;
  if (single) {
    w = sources[0].dimMM[0] / 1000;
    d = sources[0].dimMM[1] / 1000;
  } else {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of sources) {
      const { ex, ez } = aabbExtents(s.rot, s.dimMM);
      minX = Math.min(minX, s.pos[0] - ex);
      maxX = Math.max(maxX, s.pos[0] + ex);
      minZ = Math.min(minZ, s.pos[2] - ez);
      maxZ = Math.max(maxZ, s.pos[2] + ez);
    }
    w = maxX - minX;
    d = maxZ - minZ;
  }

  // Supports before what rides them, so a lamp in the set is dropped onto the desk's
  // copy rather than looked for under it.
  const order = sources.map((_, i) => i).sort((a, b) => sources[a].pos[1] - sources[b].pos[1]);
  const probeId = (i: number) => `__copy-probe-${i}__`;
  const sourceOfProbe = new Map([...standsFor, ...sources.map((s, i) => [probeId(i), s.id] as const)]);
  const kinds = new Map(world.map((p) => [p.id, p.category]));
  const kindOf = (id: string) => kinds.get(id);
  // What each source stands on NOW. A world id that stands for a copy is never what an
  // original stands on: the originals are where they were.
  // Floor-standing pieces only, as `ridingParents` asks: a print hung 40 mm above a
  // sideboard is not ON it, and reading it as a rider grounded its copy on the floor.
  const supportOf = new Map(
    sources.map((src) => {
      if (!isFloorStanding(src.category, src.shape)) return [src.id, undefined] as const;
      const on = restingOn(world, src.id, src.pos, src.rot, src.dimMM, src.category, src.shape, src.circle);
      return [src.id, on?.on === 'part' && on.id ? on.id : undefined] as const;
    }),
  );

  type Try = {
    spots: CopyPlacement['spots'];
    valid: boolean;
    inRoom: boolean;
    offOriginal: boolean;
    /** Stands on what its original stands on: the floor for a floor piece, the same
     *  desk — or the copy of it, when the desk is copied too — for a rider. */
    footing: boolean;
    /** A rider on a surface of the same KIND as its original's, a floor piece still on
     *  the floor: a lamp off a full nightstand onto the other nightstand is a
     *  placement, onto the bed is not, and a nightstand onto a bed is not either. */
    footingKind: boolean;
    /** Every copy on the floor. A rider's last clear option; a floor piece's footing. */
    floored: boolean;
    /** Touches nothing it could collide with, tucked or not. */
    snug: boolean;
    /** How much floor the copies share with what they could collide with, m², summed
     *  over the boxes. Only read when nothing is clear: the least of it is where an
     *  overlapping copy goes. */
    overlap: number;
    /** The spots with nothing climbed: a copy the resolve stood on something its
     *  original was not on is put back at its original's level — the floor for a floor
     *  piece, the floor for a rider off its surface's kind. What an overlapping copy is
     *  made at, since on a full floor gravity finds a top under every spot. */
    grounded: CopyPlacement['spots'];
    /** Every copy moved by the SAME offset as every other: the formation survived the
     *  resolve. Always true for one piece. */
    formed: boolean;
    asked: boolean;
  };
  const attempt = (dx: number, dz: number): Try => {
    const spots: CopyPlacement['spots'] = new Array(sources.length);
    const grounded: CopyPlacement['spots'] = new Array(sources.length);
    const probes: ScenePart[] = [];
    let valid = true;
    let inRoom = true;
    let offOriginal = true;
    let footing = true;
    let footingKind = true;
    let floored = true;
    let snug = true;
    let overlap = 0;
    let formed = true;
    let asked = true;
    let lead: [number, number] | null = null;
    for (const i of order) {
      const src = sources[i];
      // The probe must be IN the list it is resolved against: `collidesAt` looks the
      // mover up there and answers "no collision" for one it cannot find.
      const probe: ScenePart = { ...src, id: probeId(i), groupId: undefined };
      const r = resolvePlacement({
        part: probe,
        rawX: src.pos[0] + dx,
        rawZ: src.pos[2] + dz,
        rot: src.rot,
        dim: src.dimMM,
        parts: [...world, ...probes, probe],
        footprint,
        roomHeight,
        snapMode: 'off',
        currentY: src.pos[1],
      });
      const now = r.supportId === undefined ? undefined : (sourceOfProbe.get(r.supportId) ?? r.supportId);
      const onCopy = r.supportId !== undefined && sourceOfProbe.has(r.supportId);
      spots[i] = { pos: r.pos, rot: r.rot, support: now ? { id: now, copy: onCopy } : null };
      probes.push({ ...probe, pos: r.pos, rot: r.rot });
      if (!r.valid) valid = false;
      // The 'wall' arm has no test that can fail it: the resolve rides a too-wide piece
      // to whichever wall fits, and pins one that fits none to where it already hangs,
      // so no spot off the original is ever refused for width. Kept because 'wall' is a
      // refusal and calling it "in the room" would be a lie the day that changes.
      if (r.refusal === 'room' || r.refusal === 'wall') inRoom = false;
      // The containment clamp can carry a step at the room's edge straight back onto
      // the piece it started beside, so "off the original" is asked, not assumed — and
      // asked of the footprints, not of `collidesAt`, which never reports a rug or a
      // curtain: a 2.4 m rug's step right was clamped back to 600 mm over its original
      // and came back `valid`.
      const mine = obbFromPart(r.pos, r.rot, src.dimMM);
      if (sources.some((o) => obbOverlap(mine, obbFromPart(o.pos, o.rot, o.dimMM), -0.001))) offOriginal = false;
      // A lamp copied WITH its desk rides the desk's copy, whose id is a probe's; that
      // probe stands for the desk, so the lamp is on the same footing.
      const was = supportOf.get(src.id);
      if (now !== was) footing = false;
      const sameKind = !was === !now && !(was && now && kindOf(now) !== kindOf(was));
      if (!sameKind) footingKind = false;
      if (now) floored = false;
      const y = sameKind ? r.pos[1] : was ? 0 : src.pos[1];
      grounded[i] = sameKind ? spots[i] : { pos: [r.pos[0], y, r.pos[2]], rot: r.rot, support: null };
      // Asked of the room as it stood, not of the other copies: a set copies its own
      // formation, chairs tucked under their table and all. A soft piece — a rug, a
      // curtain — collides with nothing, so nothing it lies over is a clash.
      if (!isSoftFurnishing(src)) {
        const me = footFromPart(r.pos, r.rot, src.dimMM, src.circle, src.shape);
        const mx = aabbExtents(r.rot, src.dimMM);
        const inTheWay = canCollideWith(src, src.dimMM, r.pos[1]);
        // The overlap is measured where the copy would be MADE if nothing is clear — at
        // its grounded height, where the bed it climbed is in the way again. Only one
        // piece is ever made overlapping (a set falls back to piece by piece first), so
        // the earlier copies of this gesture are in `world` already.
        const inTheWayGrounded = canCollideWith(src, src.dimMM, y);
        for (const o of world) {
          if (!inTheWayGrounded(o)) continue;
          const ox = aabbExtents(o.rot, o.dimMM);
          const ix = Math.min(r.pos[0] + mx.ex, o.pos[0] + ox.ex) - Math.max(r.pos[0] - mx.ex, o.pos[0] - ox.ex);
          const iz = Math.min(r.pos[2] + mx.ez, o.pos[2] + ox.ez) - Math.max(r.pos[2] - mx.ez, o.pos[2] - ox.ez);
          if (ix > 0 && iz > 0) overlap += ix * iz;
          if (snug && inTheWay(o) && footOverlap(me, footFromPart(o.pos, o.rot, o.dimMM, o.circle, o.shape), -TOUCH_M))
            snug = false;
        }
      }
      // Did it land where it was asked, rather than where a clamp or a wall's end
      // carried it? `valid` does not say: the containment clamp is a correction, not
      // a refusal, so a bed stepped half through the east wall comes back valid and
      // 500 mm short — and its nightstands, which were not clamped, do not.
      if (Math.hypot(r.pos[0] - (src.pos[0] + dx), r.pos[2] - (src.pos[2] + dz)) > ASKED_TOL_M) asked = false;
      // …and did it move as far as the first one did? A clamp that corrects every
      // member alike keeps the set a set; one that corrects some of them bends it.
      const moved: [number, number] = [r.pos[0] - src.pos[0], r.pos[2] - src.pos[2]];
      if (!lead) lead = moved;
      else if (Math.hypot(moved[0] - lead[0], moved[1] - lead[1]) > ASKED_TOL_M) formed = false;
    }
    return { spots, grounded, valid, inRoom, offOriginal, footing, footingKind, floored, snug, overlap, formed, asked };
  };

  const clean = (t: Try) => t.valid && t.offOriginal && t.snug && t.formed;
  // Nearest first within each tier, and the tiers in the order a person would rank
  // them: exactly beside it; beside it but shifted by the room's edge; then the rest
  // of the room, nearest first — on the same footing, then, for a rider whose
  // surface is full, on another surface of the same kind, then on the floor.
  const steps = candidates(w, d).map(([lx, lz]) => localToWorld(frame, lx, lz));
  const tries = steps.map(([dx, dz]) => attempt(dx, dz));
  const near = tries.find((t) => clean(t) && t.footing && t.asked) ?? tries.find((t) => clean(t) && t.footing);
  if (near) return { spots: near.spots, clear: true, beside: true };

  const search = roomSearch(sources, footprint, attempt);
  const far =
    search.find((t) => clean(t) && t.footing) ??
    search.find((t) => clean(t) && t.footingKind) ??
    search.find((t) => clean(t) && t.floored);
  if (far) return { spots: far.spots, clear: true, beside: false };

  // A set with nowhere to go AS a set: each piece beside its own original, every copy
  // an obstacle to the next. A rider among them looks for its own original's surface,
  // which is a place it can be; the set's link between them is the part given up.
  //
  // The earlier copies join the world under ids of their own. They had the probes'
  // ids, so the copy placed from index 0 shared one with the next probe, and the
  // resolve took it for the mover: not an obstacle, and not a desk a lamp could use.
  if (!single) {
    const spots: CopyPlacement['spots'] = new Array(sources.length);
    const placed: ScenePart[] = [];
    const placedFor = new Map(standsFor);
    let all = true;
    let beside = true;
    for (const i of order) {
      const one = place([sources[i]], [...world, ...placed], footprint, roomHeight, placedFor);
      spots[i] = one.spots[0];
      const id = `__copy-placed-${i}__`;
      placed.push({ ...sources[i], id, groupId: undefined, pos: one.spots[0].pos, rot: one.spots[0].rot });
      placedFor.set(id, sources[i].id);
      if (!one.clear) all = false;
      if (!one.beside) beside = false;
    }
    return { spots, clear: all, beside };
  }

  // No clear spot anywhere in the room: made anyway, and said. Grounded — never climbed
  // onto whatever is in the way — and where it overlaps least, nearest first among
  // equals, so repeated copies spread into what gaps are left.
  let best: Try | undefined;
  for (const t of [...tries, ...search.all()]) {
    if (t.inRoom && t.offOriginal && (!best || t.overlap < best.overlap - 1e-6)) best = t;
  }
  // `beside` is only ever read of a clear placement; a copy made overlapping is not
  // announced as beside anything.
  if (best) return { spots: best.grounded, clear: false, beside: false };
  return {
    spots: sources.map((s) => ({ pos: [...s.pos] as [number, number, number], rot: s.rot, support: null })),
    clear: false,
    beside: false,
  };
}

/** Every spot in the room on a grid of `SEARCH_STEP_M` or coarser, as offsets of the sources'
 *  centre, nearest first. `find` resolves lazily and remembers what it resolved, so a
 *  room with space near the piece costs a few resolves and only a full one costs the
 *  lot — once, however many questions are asked of it; `all` is that lot.
 *
 *  An offset that would carry the sources' combined box out of the room's bounds is
 *  clamped to the nearest one that does not — flush with the wall, which the grid does
 *  NOT hold: dropping those offsets instead lost every strip along a wall less than a
 *  grid step deeper than the piece, and a chair with a clear 0.55 m strip left was told
 *  there was no space. Clamped offsets are deduplicated, which is what makes a SET
 *  cheap: selecting a room's every piece and duplicating resolved ~1300 offsets × every
 *  member before the fallback — 0.5–1.8 s, measured in review — for a box the size of
 *  the room, whose offsets all clamp to a handful of shifts. Where the box is wider
 *  than the room on an axis, no offset keeps it in, and none is resolved. */
export function roomSearch<T>(
  sources: ScenePart[],
  footprint: Footprint,
  attempt: (dx: number, dz: number) => T,
): { find: (pred: (t: T) => boolean) => T | undefined; all: () => T[]; offsets: number } {
  let cx = 0;
  let cz = 0;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of sources) {
    cx += s.pos[0] / sources.length;
    cz += s.pos[2] / sources.length;
    const { ex, ez } = aabbExtents(s.rot, s.dimMM);
    minX = Math.min(minX, s.pos[0] - ex);
    maxX = Math.max(maxX, s.pos[0] + ex);
    minZ = Math.min(minZ, s.pos[2] - ez);
    maxZ = Math.max(maxZ, s.pos[2] + ez);
  }
  const b = footprintBounds(footprint);
  const step = Math.max(SEARCH_STEP_M, Math.sqrt((b.width * b.depth) / SEARCH_MAX_SPOTS));
  // The shifts that keep the combined box inside the bounds, per axis.
  const [loX, hiX, loZ, hiZ] = [b.minX - minX, b.maxX - maxX, b.minZ - minZ, b.maxZ - maxZ];
  const offsets: Array<[number, number]> = [];
  const taken = new Set<string>();
  if (loX <= hiX && loZ <= hiZ) {
    for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      for (let z = b.minZ + step / 2; z < b.maxZ; z += step) {
        if (!pointInPoly(x, z, footprint)) continue;
        const dx = Math.min(hiX, Math.max(loX, x - cx));
        const dz = Math.min(hiZ, Math.max(loZ, z - cz));
        const key = `${Math.round(dx * 1000)},${Math.round(dz * 1000)}`;
        if (taken.has(key)) continue;
        taken.add(key);
        offsets.push([dx, dz]);
      }
    }
  }
  offsets.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
  const seen: T[] = [];
  const at = (i: number) => {
    if (i === seen.length) seen.push(attempt(offsets[i][0], offsets[i][1]));
    return seen[i];
  };
  return {
    find: (pred) => {
      for (let i = 0; i < offsets.length; i++) if (pred(at(i))) return at(i);
      return undefined;
    },
    all: () => {
      for (let i = seen.length; i < offsets.length; i++) at(i);
      return seen;
    },
    offsets: offsets.length,
  };
}
