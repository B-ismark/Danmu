// Rigid parenting — when a part rests on top of another, moving/rotating the
// support carries the resting part along (translate + rotate around the
// support's own pivot), the way `Dressing.tsx`'s procedural decor already
// rides a part's live transform for free.
//
// The relationship (`useStudio.parentIds`, childId -> parentId) is an override
// map, not authored on `ScenePart` — see CLAUDE.md on why overrides are the
// layer that survives a re-scan. Because of that, it can go stale: Suggest
// layout, a saved Layout A/B, a wall carrying furniture away, or the
// quarter-turn shortcut can all move a part without ever touching `parentIds`.
// Rather than hunting down and hooking every one of those movers,
// `snapshotDescendants` re-validates each edge PHYSICALLY (footprint overlap +
// Y-adjacency) against live positions every time it's read — a stale edge
// simply fails to cascade instead of cascading a child to the wrong place.
// That is the one property this module exists to guarantee.
//
// Put precisely, because two useful consequences follow and neither is visible
// from the code on its own: an edge is a PREDICATE over live geometry, not a
// stored fact. `parentIds` only records that a pair is worth asking about; the
// answer is recomputed at every read.
//
//   · A RESIZE is covered for free, without appearing in the list above. It moves
//     neither part — it changes the SUPPORT's size under a child that has not gone
//     anywhere — and nothing re-asks `parentIds` when a dim changes
//     (`DimensionEditor` calls `setDim` and nothing else). It does not need to: the
//     parts these reads see come from `resolveParts`, so the `dims` override is
//     already applied and the support's NEW size is what gets asked. Shrink a desk
//     out from under a lamp and dragging the desk carries nobody.
//   · REVIVAL. A failed read drops the edge for that read only; nothing is ever
//     pruned from the map. Grow the desk back and the lamp is a rigid child again,
//     with no drop having happened. The same property that makes staleness harmless
//     is what makes the relationship restorable — a reader who assumes the map is
//     the truth finds the first bullet surprising, and one who assumes a stale edge
//     gets cleaned up finds this one surprising.
//
// Both are pinned in `tests/rigid-parent.test.ts`. One thing that follows and is
// deliberately NOT this module's to fix: shrinking a support's height drops the
// edge correctly and leaves the child hanging where it was. Dropping the edge is
// the whole job here; re-grounding that child, or reporting that it is in the air,
// belongs to the physics and clearance layers.

import type { ScenePart } from './scene-spec';
import { footArea, footFromPart, footIntersectionArea, localToWorld, worldToLocal } from './geometry';
import { MIN_SUPPORT_SHARE, SUPPORT_Y_EPS } from './physics';

export type DescendantOffset = {
  id: string;
  /** The descendant's IMMEDIATE parent (may itself be a descendant of root). */
  parentId: string;
  /** XZ offset from the immediate parent, in the immediate parent's local frame. */
  localOffset: [number, number];
  /** World-space Y offset from the immediate parent — rotation-invariant. */
  offsetY: number;
  relRot: number;
  /** The child's own world rotation at the moment of the snapshot.
   *
   *  Kept so `cascadeTransform` can tell a cascade that TURNED a child from one
   *  that merely carried it sideways. `relRot` alone cannot: it is a difference, so
   *  it is unchanged either way. */
  rot: number;
};

function isPhysicallySupported(child: ScenePart, parent: ScenePart): boolean {
  const childFoot = footFromPart(child.pos, child.rot, child.dimMM, child.circle);
  const childArea = footArea(childFoot);
  if (!(childArea > 0)) return false;
  const parentFoot = footFromPart(parent.pos, parent.rot, parent.dimMM, parent.circle);
  const shared = footIntersectionArea(childFoot, parentFoot);
  if (shared / childArea < MIN_SUPPORT_SHARE) return false;
  const parentTop = parent.pos[1] + parent.dimMM[2] / 1000;
  return Math.abs(child.pos[1] - parentTop) < SUPPORT_Y_EPS;
}

/** Walk the (possibly multi-level) subtree resting on `rootId`, using LIVE
 *  positions in `parts`. Each edge is re-validated physically before being
 *  trusted — see the module comment. BFS order, so a caller applying
 *  `cascadeTransform` over the result always sees a descendant's immediate
 *  parent processed before the descendant itself. */
export function snapshotDescendants(
  rootId: string,
  parts: ScenePart[],
  parentIds: Record<string, string>,
): DescendantOffset[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const childrenOf = new Map<string, string[]>();
  for (const [child, parent] of Object.entries(parentIds)) {
    let list = childrenOf.get(parent);
    if (!list) {
      list = [];
      childrenOf.set(parent, list);
    }
    list.push(child);
  }

  const out: DescendantOffset[] = [];
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parent = byId.get(parentId);
    if (!parent) continue; // dead id — nothing to hang children off of
    for (const childId of childrenOf.get(parentId) ?? []) {
      // Bounds a cyclic/corrupted map defensively — a well-formed parentIds map
      // (each child has exactly one parent) can never legitimately revisit an id.
      if (visited.has(childId)) continue;
      visited.add(childId);
      const child = byId.get(childId);
      if (!child) continue; // orphaned relationship — the part no longer exists
      if (!isPhysicallySupported(child, parent)) continue; // stale — not really resting there any more
      const [lx, lz] = worldToLocal(parent.rot, child.pos[0] - parent.pos[0], child.pos[2] - parent.pos[2]);
      out.push({
        id: childId,
        parentId,
        localOffset: [lx, lz],
        offsetY: child.pos[1] - parent.pos[1],
        relRot: child.rot - parent.rot,
        rot: child.rot,
      });
      queue.push(childId);
    }
  }
  return out;
}

/** Apply a parent's new (already gravity-resolved) transform to every
 *  descendant `snapshotDescendants` found. Each level re-derives its own new
 *  Y from its own immediate parent's just-computed Y, so a middle part whose
 *  own height changed (it gravitated onto something taller/shorter) still
 *  gets every descendant's height right, recursively — not a single delta
 *  carried flat from the root.
 *
 *  `rot` comes back only on a child the cascade actually TURNED. It used to be
 *  unconditional, which made every pure translate write a rotation override for
 *  every rigid child — `setTransformsFor` creates the key whether or not the value
 *  changed, and per lib/transforms.ts an override pins that angle against a
 *  re-detect and persists it. That is the exact needless pin `ConvoyMove.rot` and
 *  `convoyRestore` were written to avoid, one layer down and firing on every drag
 *  of anything with a lamp on it. Compared exactly, not against a tolerance: a
 *  round-trip through `relRot` that lands a float short of the start angle really
 *  did move, and writing it is the old behaviour, so the comparison can only ever
 *  omit a write that was provably a no-op. */
export function cascadeTransform(
  rootId: string,
  newPos: [number, number, number],
  newRot: number,
  descendants: DescendantOffset[],
  /** Write `rot` for these children even when the recomputed angle equals the one
   *  in the snapshot.
   *
   *  Omitting an unchanged rotation is right on a live frame and silently wrong on
   *  a RESTORE, because on a restore the two are equal BY CONSTRUCTION:
   *  `relRot` is the child's angle minus the parent's at snapshot time, and the
   *  restore replays from that same parent angle, so the sum is always exactly the
   *  snapshot angle and the write was always omitted. Turn a desk with a lamp on it
   *  and press Escape: the desk went back, the lamp's position went back, and the
   *  rotation override the drag had written to the lamp stayed — persisted, 90 deg out
   *  of formation. Floats do not save it; verified at zero and non-zero start angles.
   *
   *  A predicate rather than a boolean so `convoyRestore` can put back exactly the
   *  angles the gesture actually overrode, and not stamp a rotation pin on a child
   *  that never had one. */
  forceRotFor?: (id: string) => boolean,
): Array<{ id: string; pos: [number, number, number]; rot?: number }> {
  const transforms = new Map<string, { pos: [number, number, number]; rot: number }>();
  transforms.set(rootId, { pos: newPos, rot: newRot });
  const out: Array<{ id: string; pos: [number, number, number]; rot?: number }> = [];
  for (const d of descendants) {
    const parent = transforms.get(d.parentId);
    if (!parent) continue; // BFS order guarantees this shouldn't happen; never trust it blindly
    const [wx, wz] = localToWorld(parent.rot, d.localOffset[0], d.localOffset[1]);
    const pos: [number, number, number] = [parent.pos[0] + wx, parent.pos[1] + d.offsetY, parent.pos[2] + wz];
    const rot = parent.rot + d.relRot;
    transforms.set(d.id, { pos, rot });
    out.push(rot === d.rot && !forceRotFor?.(d.id) ? { id: d.id, pos } : { id: d.id, pos, rot });
  }
  return out;
}

/** Drop edges whose child or parent no longer exists.
 *
 *  Structural only — it says nothing about whether an edge is still physically
 *  true, which is `snapshotDescendants`' job on every read and the reason a stale
 *  edge is harmless in the first place. This exists for the OTHER cost: the map is
 *  persisted per room, deleting a piece leaves its edges behind on both sides
 *  (`resetTransforms(id)` clears only the child side), and nothing else ever
 *  removes them. Called on room load, not on delete — delete is undoable, and an
 *  edge that survives is what makes the cascade work again when the piece comes
 *  back to the same spot. */
export function livingParents(
  parentIds: Record<string, string> | undefined,
  parts: Array<{ id: string }>,
): Record<string, string> {
  if (!parentIds) return {};
  const alive = new Set(parts.map((p) => p.id));
  const out: Record<string, string> = {};
  for (const [child, parent] of Object.entries(parentIds)) {
    if (alive.has(child) && alive.has(parent)) out[child] = parent;
  }
  return out;
}

/** Would linking `childId` under `candidateParentId` create a cycle? Checked
 *  both when a live drag auto-establishes a relationship and when a scene
 *  file imports one (a hand-edited file can encode a loop directly). */
export function wouldCreateCycle(
  childId: string,
  candidateParentId: string,
  parentIds: Record<string, string>,
): boolean {
  if (candidateParentId === childId) return true;
  const visited = new Set<string>();
  let cur: string | undefined = candidateParentId;
  while (cur !== undefined) {
    if (cur === childId) return true;
    if (visited.has(cur)) return true; // pre-existing corruption — refuse rather than loop forever
    visited.add(cur);
    cur = parentIds[cur];
  }
  return false;
}
