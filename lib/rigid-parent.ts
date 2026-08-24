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

import type { ScenePart } from './scene-spec';
import { footArea, footFromPart, footIntersectionArea, localToWorld, worldToLocal } from './geometry';
import { MIN_SUPPORT_SHARE } from './physics';

/** How far a child's Y may drift from its parent's current top and still count
 *  as "resting there" — generous enough for floating-point settle noise, tight
 *  enough that a part moved elsewhere and merely passing back over the old
 *  footprint at floor height doesn't re-qualify. */
const SUPPORT_Y_EPS = 0.05;

export type DescendantOffset = {
  id: string;
  /** The descendant's IMMEDIATE parent (may itself be a descendant of root). */
  parentId: string;
  /** XZ offset from the immediate parent, in the immediate parent's local frame. */
  localOffset: [number, number];
  /** World-space Y offset from the immediate parent — rotation-invariant. */
  offsetY: number;
  relRot: number;
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
 *  carried flat from the root. */
export function cascadeTransform(
  rootId: string,
  newPos: [number, number, number],
  newRot: number,
  descendants: DescendantOffset[],
): Array<{ id: string; pos: [number, number, number]; rot: number }> {
  const transforms = new Map<string, { pos: [number, number, number]; rot: number }>();
  transforms.set(rootId, { pos: newPos, rot: newRot });
  const out: Array<{ id: string; pos: [number, number, number]; rot: number }> = [];
  for (const d of descendants) {
    const parent = transforms.get(d.parentId);
    if (!parent) continue; // BFS order guarantees this shouldn't happen; never trust it blindly
    const [wx, wz] = localToWorld(parent.rot, d.localOffset[0], d.localOffset[1]);
    const pos: [number, number, number] = [parent.pos[0] + wx, parent.pos[1] + d.offsetY, parent.pos[2] + wz];
    const rot = parent.rot + d.relRot;
    transforms.set(d.id, { pos, rot });
    out.push({ id: d.id, pos, rot });
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
