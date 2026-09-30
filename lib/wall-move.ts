// What a wall takes with it when it moves.
//
// Dragging a wall used to rewrite the footprint and nothing else, so the wall slid
// out from under everything standing on it: a sofa that was against the North wall
// ended up marooned a metre into the room, and — worse — a window kept its glass
// where it was while its HOLE jumped to whichever wall was now nearest, because
// `lib/apertures.ts` re-derives that per frame from `nearestEdge`. Anything mounted
// IN a wall has to move with it or the room is simply wrong.
//
// Pure: no store, no three, no React. The whole reason it lives here rather than
// inside the store action is that the interesting half is geometry with signs in
// it — which normal, which side, which edge — and that is testable in the node
// environment (`tests/wall-move.test.ts`).
//
// Two rules the rest of this file exists to keep:
//
//   · **Only the dragged wall's own pieces, only along its own normal.**
//     `offsetWall` TRANSLATES edge `index` and STRETCHES the two edges either side
//     of it. A piece against a stretched neighbour has not moved — its wall got
//     longer, it did not travel — so carrying it would drag half the room.
//   · **Never make containment worse.** A carried piece is dropped from the move
//     if the move would push it out of the room it was inside; it keeps its place
//     and `lib/clearance.ts` reports the wall now standing in it. Nothing is
//     resized to fit and nothing is silently shoved (CLAUDE.md rule 2) — and the
//     test is `footInsidePoly`, not `outsideShare`, whose probes sit 10% in from
//     the edges and forgive a piece 20 mm through the plaster (rule 3).
//   · **A piece's company travels with it, or none of it does.** A wall claims the
//     pieces standing at it; each brings the rest of its merged set (`groupId`) and
//     whatever rests on it (`parentIds`), the two relations a DRAG already carries
//     (`lib/drag-convoy.ts`). A wall that took only the half of a merged set it was
//     touching pulled the set apart, which is the one thing merging is for. And the
//     containment rule above is judged per set: one member that cannot follow keeps
//     the whole set where it is, rather than leaving a lamp in mid-air over the spot
//     its nightstand used to be.
//   · **A wall coming in pushes what it meets; it never walks through it.** The
//     carry above is for the pieces that BELONG to the wall. Everything else on its
//     path — a sofa out in the room, the coffee table in front of a carried sofa —
//     is pushed ahead of it, piece against piece, each set whole (`pushedByWall`).
//     When the stack runs out of room the WALL stops, and says which piece stopped
//     it; nothing is squeezed, resized or left half through the plaster.

import { footCorners, footFromPart, footInsidePoly, nearestEdge, obbExtentAlong, obbFromPart, pointInPoly, type Foot } from './geometry';
import { offsetWall, wallOutwardNormal, type Footprint } from './footprint';
import { WALL_CARRY_REACH } from './layout-rules';
import { ridesWall, verticalExtent } from './physics';
import { snapshotDescendants } from './rigid-parent';
import type { ScenePart } from './scene-spec';

/** A carried piece's new position. `y` is never touched: moving a wall sideways
 *  changes nothing about how high anything sits. */
export type CarriedPos = { id: string; pos: [number, number, number] };

/** How far a footprint may cross the wall line and still count as contained.
 *
 *  Two millimetres, and it is not a fudge — without it the containment guard
 *  below is INERT for exactly the pieces it exists to protect. `footInsidePoly`
 *  is `every corner pointInPoly`, and a piece standing flush against a wall has
 *  two corners ON the polygon edge, where a ray cast is a coin flip. Measured: a
 *  sofa pushed right up to the east wall of a 6 × 4 room reports `false`, and one
 *  150 mm clear of it reports `true`. So the piece most likely to be carried —
 *  the one touching the wall — was being read as "already outside" and waved
 *  through the was-inside/now-inside test every time.
 *
 *  Deliberately tiny, and deliberately applied to BOTH sides of that comparison.
 *  Symmetry is the point: "was it in" and "is it still in" have to be the same
 *  question or the guard means nothing. 2 mm is two orders below the 20 mm that
 *  `outsideShare` forgives — the sampling error CLAUDE.md rule 3 warns about —
 *  so this cannot pass a piece that is meaningfully through the plaster. */
const CONTAIN_EPS = 0.002;

function contained(f: Foot, poly: Footprint): boolean {
  return footInsidePoly(
    { ...f, hw: Math.max(0, f.hw - CONTAIN_EPS), hd: Math.max(0, f.hd - CONTAIN_EPS) },
    poly,
  );
}

/** How far the foot reaches past the walls: the sum over its outline's corners of
 *  how far each is outside the room. Zero when all of it is in. A sum rather than
 *  the worst corner because a corner already out, carried past the end of its wall,
 *  gains distance only to second order — the worst-corner form let a piece slip
 *  2 mm through the far wall before it grew. For a piece
 *  that STARTS through a wall — a detection that landed in the plaster — where
 *  "was it contained before" has no useful answer: it may keep the overhang it came
 *  with, and may not add to it. */
function overhang(f: Foot, poly: Footprint): number {
  let out = 0;
  for (const [x, z] of footCorners({ ...f, hw: Math.max(0, f.hw - CONTAIN_EPS), hd: Math.max(0, f.hd - CONTAIN_EPS) })) {
    if (pointInPoly(x, z, poly)) continue;
    const e = nearestEdge(poly, x, z);
    if (e) out += e.dist;
  }
  return out;
}

/** The pieces that travel with `seed`: the rest of each one's merged set, and
 *  whatever rests on it, closed to a FIXED POINT — a group mate brought along can
 *  have a lamp on it, and that lamp can belong to a third set. One pass would close
 *  the first hop and leave the second, the bug `lib/drag-convoy.ts` already met.
 *
 *  `admit` is asked about every piece reached this way before it joins; a piece it
 *  turns away brings nothing of its own. */
function withCompany(
  seed: readonly string[],
  parts: ScenePart[],
  parentIds: Record<string, string>,
  admit: (p: ScenePart) => boolean,
): Set<string> {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const out = new Set(seed);
  const queue = [...seed];
  const add = (id: string) => {
    if (out.has(id)) return;
    const p = byId.get(id);
    if (!p || !admit(p)) return;
    out.add(id);
    queue.push(id);
  };
  while (queue.length > 0) {
    const id = queue.shift()!;
    const g = byId.get(id)?.groupId;
    if (g) for (const p of parts) if (p.groupId === g) add(p.id);
    for (const d of snapshotDescendants(id, parts, parentIds)) add(d.id);
  }
  return out;
}

/** Which travelling set each of `ids` belongs to: pieces joined by a merged set or
 *  by resting on one another share a set. Only relations INSIDE `ids` count, so a
 *  piece whose company stayed behind is a set of its own. */
function setsOf(ids: ReadonlySet<string>, parts: ScenePart[], parentIds: Record<string, string>): Map<string, string> {
  const root = new Map<string, string>();
  for (const id of ids) root.set(id, id);
  const find = (id: string): string => {
    let r = id;
    while (root.get(r) !== r) r = root.get(r)!;
    root.set(id, r);
    return r;
  };
  const join = (a: string, b: string) => {
    if (!ids.has(a) || !ids.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) root.set(ra, rb);
  };
  const firstOfGroup = new Map<string, string>();
  for (const p of parts) {
    if (!ids.has(p.id)) continue;
    if (p.groupId) {
      const first = firstOfGroup.get(p.groupId);
      if (first === undefined) firstOfGroup.set(p.groupId, p.id);
      else join(first, p.id);
    }
    for (const d of snapshotDescendants(p.id, parts, parentIds)) join(p.id, d.id);
  }
  const out = new Map<string, string>();
  for (const id of ids) out.set(id, find(id));
  return out;
}

/** The ids whose move breaks the containment rule, grown to their whole sets.
 *  `moved` maps an id to where it would go; ids absent from it are not moving. */
function heldBack(
  parts: ScenePart[],
  moved: ReadonlyMap<string, [number, number, number]>,
  before: Footprint,
  after: Footprint,
  parentIds: Record<string, string>,
): Set<string> {
  const failing = new Set<string>();
  for (const p of parts) {
    const pos = moved.get(p.id);
    if (!pos || ridesWall(p.category, p.shape)) continue;
    const wasInside = contained(footFromPart(p.pos, p.rot, p.dimMM, p.circle, p.shape), before);
    const nowInside = contained(footFromPart(pos, p.rot, p.dimMM, p.circle, p.shape), after);
    if (wasInside && !nowInside) failing.add(p.id);
  }
  if (failing.size === 0) return failing;
  const sets = setsOf(new Set(moved.keys()), parts, parentIds);
  const bad = new Set([...failing].map((id) => sets.get(id)));
  const out = new Set<string>();
  for (const [id, set] of sets) if (bad.has(set)) out.add(id);
  return out;
}

/**
 * Ids of the parts that belong to wall `index` and should travel with it.
 *
 * `parts` must be at their EFFECTIVE transforms (studio overrides merged in) —
 * attachment is decided from where a piece actually is, not where it was seeded.
 *
 * Two different tests, because there are two different kinds of attachment:
 *
 *   · **Mounted in the wall** (`wallMounted`: window, door, TV, mirror, curtain
 *     rod). Decided with `nearestEdge`, which is precisely the rule
 *     `lib/apertures.ts` uses to choose the wall a window cuts through. If these
 *     two tests could disagree, a carried window would leave its own hole behind.
 *   · **Standing against the wall** (floor furniture). Decided by the gap from the
 *     piece's near face to the wall plane — under `WALL_CARRY_REACH`, a walkway —
 *     plus the requirement that it actually
 *     sits along THIS wall's span — in an L-shaped room a sofa in the far wing can
 *     be zero distance from this wall's infinite LINE while having nothing
 *     whatsoever to do with this wall.
 *
 * Locked pieces are carried like any other. A locked window is still a hole in a
 * wall; leaving it behind would put it in the void outside the room, which is not
 * a more faithful record of the photo than moving it.
 */
export function attachedToWall(
  parts: ScenePart[],
  poly: Footprint,
  index: number,
  parentIds: Record<string, string>,
  tol = WALL_CARRY_REACH,
): string[] {
  const n = poly.length;
  if (n < 3 || index < 0 || index >= n) return [];
  const a = poly[index];
  const b = poly[(index + 1) % n];
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const len = Math.hypot(ex, ez);
  if (len < 1e-6) return [];
  // Along the wall, and out of the room. Same normal `offsetWall` will use.
  const tx = ex / len;
  const tz = ez / len;
  const [ox, oz] = wallOutwardNormal(poly, index);
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;

  // Something resting on another piece goes where its support goes, never on its
  // own: a lamp within reach of the wall on a nightstand that is not would be
  // carried off its nightstand into the air.
  const resting = new Set<string>();
  for (const parent of new Set(Object.values(parentIds))) {
    for (const d of snapshotDescendants(parent, parts, parentIds)) resting.add(d.id);
  }

  const out: string[] = [];
  for (const p of parts) {
    if (resting.has(p.id)) continue;
    const dx = p.pos[0] - mx;
    const dz = p.pos[2] - mz;
    // `ridesWall`, not `wallMounted`. This branch means "the piece IS part of this
    // wall", and it hands the question to `nearestEdge`, which always names some wall
    // — so a ceiling pendant 1.355 m clear of every wall in the room was claimed by
    // whichever edge happened to be nearest and carried 0.5 m sideways, off the table
    // it hangs over. A ceiling piece belongs to the room, not to an edge of it.
    if (ridesWall(p.category, p.shape)) {
      if (nearestEdge(poly, p.pos[0], p.pos[2])?.index === index) out.push(p.id);
      continue;
    }
    const obb = obbFromPart(p.pos, p.rot, p.dimMM);
    // Signed distance of the centre outward from the wall plane is negative inside
    // the room, so negate it to get "how far in", then take off the piece's own
    // half-extent in that direction to land on its near face. A negative gap means
    // the piece already overlaps the wall, which counts as attached.
    const gap = -(dx * ox + dz * oz) - obbExtentAlong(obb, ox, oz);
    if (gap > tol) continue;
    // Overlapping the wall's span, allowing for the piece's own width along it —
    // a bed with one corner past the end of a short wall is still on that wall.
    const along = Math.abs(dx * tx + dz * tz);
    if (along > len / 2 + obbExtentAlong(obb, tx, tz)) continue;
    out.push(p.id);
  }
  // …and their company. One exception, a piece that IS part of some other wall: a
  // TV merged with the stand under it goes with its wall, and when THIS wall is
  // parallel to that one, following the set would pull it off its own plaster.
  // Across a wall that meets this one at a corner the move only slides it along its
  // wall, which is where it lives, so it comes.
  const company = withCompany(out, parts, parentIds, (p) => {
    if (!ridesWall(p.category, p.shape)) return true;
    const e = nearestEdge(poly, p.pos[0], p.pos[2]);
    if (!e) return false;
    const [px, pz] = wallOutwardNormal(poly, e.index);
    return Math.abs(px * ox + pz * oz) < 1e-6;
  });
  return parts.filter((p) => company.has(p.id)).map((p) => p.id);
}

/**
 * New positions for the carried parts after wall `index` moved by `delta` along
 * `outward`.
 *
 * `ids` is resolved ONCE per gesture by `attachedToWall` and then reused for every
 * frame of the drag. That is not an optimisation: re-deciding attachment each
 * frame means a piece hovering at the tolerance boundary detaches mid-drag, stops
 * following, and never rejoins — the wall visibly abandons it halfway.
 *
 * `before` / `after` are the footprint either side of the move, because the
 * containment rule is comparative: a piece that was inside must stay inside, and a
 * piece that was already outside (a detection that landed through a wall) is not
 * held hostage to a test it was failing before anyone touched the wall.
 */
export function carryAttached(
  ids: string[],
  parts: ScenePart[],
  before: Footprint,
  after: Footprint,
  outward: [number, number],
  delta: number,
  parentIds: Record<string, string>,
): CarriedPos[] {
  if (ids.length === 0 || delta === 0) return [];
  const wanted = new Set(ids);
  const [ox, oz] = outward;
  const moved = new Map<string, [number, number, number]>();
  for (const p of parts) {
    if (wanted.has(p.id)) moved.set(p.id, [p.pos[0] + ox * delta, p.pos[1], p.pos[2] + oz * delta]);
  }
  // A piece that rides the wall IS part of it: it goes where the wall goes, and its
  // footprint sits ON the boundary, where a containment test is a coin flip. That
  // exemption is for wall riders only — gating it on `wallMounted` skipped the
  // was-inside/now-inside check for the ceiling family too, so a pendant could be
  // carried straight out of the room with nothing testing whether it still fitted.
  const held = heldBack(parts, moved, before, after, parentIds);
  const out: CarriedPos[] = [];
  for (const [id, pos] of moved) if (!held.has(id)) out.push({ id, pos });
  return out;
}

/**
 * How far each wall moved along its OWN outward normal, between two footprints of
 * the same shape.
 *
 * This is the piece that lets a whole-room resize reuse the wall rule. Dragging a
 * wall gives you one index and one delta; typing a new width in Room tools does
 * not — `setRoom` rebuilds the polygon from scratch through `footprintForLayout`,
 * so there is no "the wall that moved". Every wall moved, most of them by zero.
 *
 * Measured at the edge MIDPOINT rather than at a vertex, and **no test pins that
 * choice because none in this codebase can.** The argument for the midpoint is
 * that `offsetWall` translates one edge and stretches its two neighbours, so a
 * neighbour's start vertex moves while the wall itself has not gone anywhere, and
 * a vertex reading would report that stretch as a translation. That argument is
 * sound in general and UNREACHABLE here: every footprint this app produces is
 * axis-aligned and rectilinear, so a stretching neighbour is always perpendicular
 * to the wall that moved and its vertex displacement dots to exactly zero against
 * its own normal. Vertex and midpoint agree on every input `footprintForLayout`
 * and `offsetWall` can make.
 *
 * Mutating it to a vertex reading leaves all 29 tests green, which is the honest
 * state of the claim rather than a gap to paper over. The midpoint stays because
 * it is right for the general case and costs nothing; it is written down as
 * untested rather than described as a property this file guarantees. A fixture
 * that could tell them apart needs a non-rectilinear footprint, which is a shape
 * the app cannot currently build — same family as the rectangle that could not
 * express `wallOutwardNormal`'s defect.
 *
 * Returns [] when the two footprints do not correspond wall-for-wall — a layout
 * change is not a resize, and there is no honest mapping between an L's six walls
 * and a rectangle's four.
 */
export function wallDisplacements(before: Footprint, after: Footprint): number[] {
  const n = before.length;
  if (n < 3 || after.length !== n) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = before[i];
    const b0 = before[(i + 1) % n];
    const a1 = after[i];
    const b1 = after[(i + 1) % n];
    const [ox, oz] = wallOutwardNormal(before, i);
    const mx0 = (a0[0] + b0[0]) / 2;
    const mz0 = (a0[1] + b0[1]) / 2;
    const mx1 = (a1[0] + b1[0]) / 2;
    const mz1 = (a1[1] + b1[1]) / 2;
    out.push((mx1 - mx0) * ox + (mz1 - mz0) * oz);
  }
  return out;
}

/**
 * New positions for everything standing against a wall, after the room itself was
 * resized — the typed-in-Room-tools case, as opposed to the dragged-wall case
 * `carryAttached` serves.
 *
 * **Why this exists at all.** `RoomDimsEditor` already carried the pieces hung
 * from the CEILING when the height changed (`regradeForNewCeiling`) and carried
 * nothing at all when width or depth changed. One axis of three. So shrinking a
 * room left the sofa standing exactly where it was while the wall retreated
 * through it, and the user's screenshot showed a sofa and a floor lamp outside the
 * shell entirely.
 *
 * **A piece can be attached to more than one wall, and the displacements ADD.** A
 * sofa in a corner belongs to both walls that meet there; shrinking the room on
 * both axes has to move it diagonally, and taking only the first wall would leave
 * it through the other one. Summing is also what makes the degenerate case behave:
 * a piece spanning two OPPOSITE walls gets two cancelling deltas and stays put,
 * which is correct — it does not fit, and saying so is `lib/clearance.ts`'s job,
 * not this function's.
 *
 * **Never makes containment worse**, exactly as `carryAttached` does not: a piece
 * that was inside and would end up outside is dropped from the move and keeps its
 * place, so the room reports a wall standing in it rather than the app silently
 * shoving it (CLAUDE.md rule 2). Wall riders are exempt from that test because
 * their footprint sits ON the boundary, where containment is a coin flip — the
 * same exemption, for the same reason, and NOT gated on `wallMounted`, which would
 * hand the ceiling family a free pass out of the room.
 *
 * `parts` must be at their EFFECTIVE transforms, for the reason `attachedToWall`
 * gives: attachment is decided from where a piece actually is.
 */
export function carryForResize(
  parts: ScenePart[],
  before: Footprint,
  after: Footprint,
  parentIds: Record<string, string>,
): CarriedPos[] {
  const deltas = wallDisplacements(before, after);
  if (deltas.length === 0) return [];

  // id → accumulated (dx, dz). Built per wall so a corner piece collects both.
  const shift = new Map<string, [number, number]>();
  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    if (d === 0) continue;
    const [ox, oz] = wallOutwardNormal(before, i);
    const carried = attachedToWall(parts, before, i, parentIds);
    for (const id of carried) {
      const prev = shift.get(id) ?? [0, 0];
      shift.set(id, [prev[0] + ox * d, prev[1] + oz * d]);
    }
    // A wall coming in pushes what it meets, as far as there is room for it — a
    // typed size cannot stop part-way the way a drag does, so each set is pushed up
    // to where it would leave the room (`partial`) and `lib/clearance.ts` reports
    // the rest. Without `partial` the first set to run out of room froze every
    // push along the wall, and the wall then walked through pieces with room to go.
    if (d < 0) {
      const byId = new Map(parts.map((p) => [p.id, p]));
      for (const m of pushedByWall(parts, before, i, -d, carried, parentIds, { partial: true }).moves) {
        const p = byId.get(m.id)!;
        const prev = shift.get(m.id) ?? [0, 0];
        shift.set(m.id, [prev[0] + m.pos[0] - p.pos[0], prev[1] + m.pos[2] - p.pos[2]]);
      }
    }
  }
  if (shift.size === 0) return [];

  const moved = new Map<string, [number, number, number]>();
  for (const p of parts) {
    const s = shift.get(p.id);
    if (!s) continue;
    if (s[0] === 0 && s[1] === 0) continue;
    moved.set(p.id, [p.pos[0] + s[0], p.pos[1], p.pos[2] + s[1]]);
  }
  const held = heldBack(parts, moved, before, after, parentIds);
  const out: CarriedPos[] = [];
  for (const [id, pos] of moved) if (!held.has(id)) out.push({ id, pos });
  return out;
}

/** Why a wall coming in had to stop. `room`: the pushed stack reached the far side
 *  of the room. `wall`: a piece hung on a wall the push cannot slide it along — any
 *  wall not square to this one.
 *
 *  There is no `locked`. `ScenePart.locked` means "came out of your photo", not a
 *  lock, and the user's own Lock (`useStudio.pinned`) guards a piece against the
 *  arranger only — a hand drag and a wall's carry both move it. A push is the same
 *  hand, so it does too. The first version stopped at `locked`, which in a scanned
 *  room was every detected piece, each announced as locked with no way to unlock. */
export type PushStop = { id: string; name: string; reason: 'room' | 'wall' };

export type WallPush = {
  /** The inward travel the pushes allow: the travel asked for when everything in
   *  the way can go ahead of the wall, less when something cannot. */
  inward: number;
  /** Where each pushed piece goes. Absolute, from the `parts` handed in. */
  moves: CarriedPos[];
  /** Set when `inward` came back short of the travel asked for. */
  stoppedBy: PushStop | null;
};

/** A piece in the moving wall's own frame: `near`/`far` inward from the wall's
 *  plane, `lo`/`hi` along it from the wall's midpoint, `bottom`/`top` in height. */
type Band = {
  p: ScenePart;
  near: number;
  far: number;
  lo: number;
  hi: number;
  bottom: number;
  top: number;
};

const TOUCH = 1e-6;

/**
 * What wall `index` pushes ahead of it when it comes `inward` metres into the room.
 *
 * `parts` and `poly` are the room as it was BEFORE the travel — for a drag, as it
 * was at pointer-down, with `inward` the gesture's total. Resolving from the start
 * rather than stepping from the last frame is what lets a wall pulled back again
 * put everything it pushed back where it stood: a push is a correction, and
 * stepping folds every correction into the next frame's base (CLAUDE.md, "restore
 * what a gesture moved").
 *
 * `carried` are the ids `attachedToWall` gave the gesture. They move with the wall,
 * exactly `inward`, and push what stands in front of them like the wall does — a
 * sofa carried in against a coffee table takes the table along.
 *
 * The model is one-dimensional on purpose. A wall translates along its own normal,
 * so everything it pushes goes the same way, and two pieces meet only if they
 * overlap across the wall (along it) and in height: a pendant over a table is not
 * in the table's way. Rugs are pushed by the wall and by nothing else — furniture
 * stands on them, it does not shove them.
 *
 * Every set goes whole (`setsOf`): a merged set, a lamp on its table. A set that
 * cannot move, or that would leave the room, stops the wall where it touched —
 * found by bisection, because every constraint here grows with the travel, so the
 * travel that fits is one interval.
 */
export function pushedByWall(
  parts: ScenePart[],
  poly: Footprint,
  index: number,
  inward: number,
  carried: readonly string[],
  parentIds: Record<string, string>,
  /** A typed resize, which moves the wall the whole way whatever is in front of it:
   *  never stop, push each set as far as it has room for. */
  opts: { partial?: boolean } = {},
): WallPush {
  const n = poly.length;
  if (!(inward > 0) || n < 3 || index < 0 || index >= n) return { inward: Math.max(0, inward), moves: [], stoppedBy: null };
  const a = poly[index];
  const b = poly[(index + 1) % n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return { inward, moves: [], stoppedBy: null };
  const tx = (b[0] - a[0]) / len;
  const tz = (b[1] - a[1]) / len;
  const [ox, oz] = wallOutwardNormal(poly, index);
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;

  const band = (p: ScenePart): Band => {
    const obb = obbFromPart(p.pos, p.rot, p.dimMM);
    const dx = p.pos[0] - mx;
    const dz = p.pos[2] - mz;
    const c = -(dx * ox + dz * oz);
    const en = obbExtentAlong(obb, ox, oz);
    const along = dx * tx + dz * tz;
    const et = obbExtentAlong(obb, tx, tz);
    const [bottom, top] = verticalExtent(p.category, p.shape, p.dimMM, p.pos[1]);
    return { p, near: c - en, far: c + en, lo: along - et, hi: along + et, bottom, top };
  };

  const fixed = new Set(carried);
  const bands = parts.map(band);
  const loose = new Set(parts.filter((p) => !fixed.has(p.id)).map((p) => p.id));
  const unitOf = setsOf(loose, parts, parentIds);

  // A piece hung on a wall slides along it when this wall meets it end-on, and
  // cannot be pushed at all off a wall parallel to this one.
  const pinned = (p: ScenePart): PushStop['reason'] | null => {
    if (!ridesWall(p.category, p.shape)) return null;
    const e = nearestEdge(poly, p.pos[0], p.pos[2]);
    if (!e) return 'wall';
    const [px, pz] = wallOutwardNormal(poly, e.index);
    return Math.abs(px * ox + pz * oz) < 1e-6 ? null : 'wall';
  };

  // Who can push whom: B stands further along the push than A, across the wall they
  // overlap, and they overlap in height. `gap` is the air between them along the
  // push — none when they already overlap along it too, a chair tucked under its
  // table: the chair pushes the table from where it is rather than being driven
  // deeper in. Ordered by near face, ties by id, so each pair points one way.
  const pairs: { a: Band; b: Band; gap: number }[] = [];
  for (const A of bands) {
    if (A.p.category === 'rug') continue;
    for (const B of bands) {
      if (A === B || !loose.has(B.p.id) || B.p.category === 'rug') continue;
      if (loose.has(A.p.id) && unitOf.get(A.p.id) === unitOf.get(B.p.id)) continue;
      if (B.hi - A.lo <= TOUCH || A.hi - B.lo <= TOUCH) continue;
      if (B.top - A.bottom <= TOUCH || A.top - B.bottom <= TOUCH) continue;
      if (B.near < A.near - TOUCH || (B.near <= A.near + TOUCH && B.p.id <= A.p.id)) continue;
      pairs.push({ a: A, b: B, gap: Math.max(0, B.near - A.far) });
    }
  }
  // What the wall itself meets: inside the plane, across its span.
  const facing = bands.filter((B) => loose.has(B.p.id) && B.far > TOUCH && B.hi > -len / 2 + TOUCH && B.lo < len / 2 - TOUCH);

  // A piece hung on a side wall has its depth straddling the plaster, where
  // containment is a coin flip — so it usually lands on the overhang rule below,
  // which lets it slide along the wall and stops it at the corner all the same.
  // (It used to be judged by its line on the plaster instead; the overhang rule
  // made that a second answer to the same question, and a mutant proved it.)
  const footAt = (p: ScenePart, at: [number, number, number]) => footFromPart(at, p.rot, p.dimMM, p.circle, p.shape);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const members = new Map<string, ScenePart[]>();
  for (const [id, u] of unitOf) members.set(u, [...(members.get(u) ?? []), byId.get(id)!]);
  const at = (p: ScenePart, s: number): [number, number, number] => [p.pos[0] - ox * s, p.pos[1], p.pos[2] - oz * s];
  /** Why piece `p` cannot go `s` along the push, in a room whose wall is at `after`. */
  const refuses = (p: ScenePart, s: number, after: Footprint): PushStop['reason'] | null => {
    const why = pinned(p);
    if (why) return why;
    const from = footAt(p, p.pos);
    const to = footAt(p, at(p, s));
    // Contained before: must stay contained. Through a wall already: may keep what
    // it overhangs, and may not add to it — or a piece straddling a side wall would
    // be pushed clean out through the far one.
    if (contained(from, poly)) return contained(to, after) ? null : 'room';
    return overhang(to, after) > overhang(from, poly) + 1e-6 ? 'room' : null;
  };

  const solve = (d: number) => {
    const after = offsetWall(poly, index, -d);
    // `partial`: how far each set can go, found once per set and capped there. A
    // set's constraints grow with its own shift, so the room it has is an interval.
    // Judged against the room as it stood: what limits a pushed set is the far side,
    // and the wall doing the pushing is the one thing it is moving away from — a set
    // the wall will pass through anyway fits `after` at no shift at all, and asking
    // that would pin it where it stands instead of pushing it to the far wall.
    const caps = new Map<string, number>();
    const cap = (u: string, s: number) => {
      if (!opts.partial) return s;
      const known = caps.get(u);
      if (known !== undefined) return Math.min(s, known);
      const fits = (x: number) => members.get(u)!.every((p) => !refuses(p, x, poly));
      if (fits(s)) return s;
      let lo = 0;
      let hi = s;
      if (!fits(0)) lo = hi = 0;
      for (let i = 0; i < 40 && hi - lo > 1e-9; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      caps.set(u, lo);
      return lo;
    };
    const shift = new Map<string, number>();
    const need = (B: Band, want: number) => {
      const u = unitOf.get(B.p.id)!;
      const s = cap(u, want);
      if (s > (shift.get(u) ?? 0) + 1e-9) {
        shift.set(u, s);
        return true;
      }
      return false;
    };
    for (const B of facing) need(B, d - Math.max(B.near, 0));
    const of = (A: Band) => (fixed.has(A.p.id) ? d : (shift.get(unitOf.get(A.p.id)!) ?? 0));
    // Relaxed to a fixed point. Every push goes the same way and only forward, so
    // this terminates; the cap is for a float that refuses to settle.
    for (let round = 0, changed = true; changed && round <= bands.length + 1; round++) {
      changed = false;
      for (const { a: A, b: B, gap } of pairs) {
        const sa = of(A);
        if (sa > gap && need(B, sa - gap)) changed = true;
      }
    }
    let stop: PushStop | null = null;
    const moves: CarriedPos[] = [];
    for (const B of bands) {
      const s = loose.has(B.p.id) ? (shift.get(unitOf.get(B.p.id)!) ?? 0) : 0;
      if (s <= 1e-9) continue;
      const p = B.p;
      if (!stop && !opts.partial) {
        const why = refuses(p, s, after);
        if (why) stop = { id: p.id, name: p.name, reason: why };
      }
      moves.push({ id: p.id, pos: at(p, s) });
    }
    return { moves, stop };
  };

  const whole = solve(inward);
  if (!whole.stop) return { inward, moves: whole.moves, stoppedBy: null };
  let lo = 0;
  let hi = inward;
  let best = solve(0);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = solve(mid);
    if (r.stop) hi = mid;
    else {
      lo = mid;
      best = r;
    }
  }
  return { inward: lo, moves: best.moves, stoppedBy: solve(hi).stop ?? whole.stop };
}
