'use client';

// The one way to move a wall.
//
// Four places move walls — the 3D handle (`components/three/WallHandles.tsx`), the
// plan's handle and its arrow-key nudge (`components/studio/PlanView.tsx`) and the
// inspector's ±10 cm buttons — and each used to call `useScene.moveWall` straight,
// which moved the polygon and nothing else. Teaching four call sites to carry the
// furniture standing on the wall is exactly how `layout-rules.ts` came to exist:
// consumers with private copies of the same rule drift. So they all call this.
//
// It lives outside both stores because it spans them. The wall is `useScene`
// (structure); a piece's position is a `useStudio` override
// (`positions[id] ?? part.pos`, resolved by `lib/room-scene.ts`), and the override
// is the layer that WINS. Writing `part.pos` in the scene store would be silently
// discarded for every piece the user has ever dragged, so the carry writes
// overrides — the same channel a drag or the gizmo writes, already persisted per
// room and already in the undo stack.
//
// Undo is one entry for the whole gesture: `lib/history.ts` snapshots both stores
// behind a 250 ms debounce, so the wall and everything it carried undo together.

import { useScene } from './scene-store';
import { useStudio } from './store';
import { attachedToWall, carryAttached } from './wall-move';
import { wallOutwardNormal } from './footprint';
import type { ScenePart } from './scene-spec';

/** Parts at their effective transforms — the non-hook twin of `useRoomScene`,
 *  because this runs inside pointer handlers, not render. */
function effectiveParts(): ScenePart[] {
  const { positions, rotations, dims } = useStudio.getState();
  return useScene.getState().parts.map((p) => ({
    ...p,
    pos: positions[p.id] ?? p.pos,
    rot: rotations[p.id] ?? p.rot,
    dimMM: dims[p.id] ?? p.dimMM,
  }));
}

/**
 * Ids of everything wall `index` will take with it.
 *
 * Call this ONCE when a drag starts and hand the result to every
 * `moveWallCarrying` of that gesture. Re-resolving attachment per frame lets a
 * piece sitting near the tolerance detach halfway through a drag and never
 * rejoin — the wall visibly walks away from its own sofa.
 */
export function wallAttachments(index: number): string[] {
  return attachedToWall(effectiveParts(), useScene.getState().room.footprint, index);
}

/**
 * Move wall `index` by `delta` metres along its outward normal and carry what is
 * attached to it. Returns the delta actually applied (0 if the room clamp refused).
 *
 * Pass `ids` from `wallAttachments` during a drag; omit it for a one-shot nudge
 * (arrow key, inspector button), where resolving attachment fresh is correct.
 */
export function moveWallCarrying(index: number, delta: number, ids?: string[]): number {
  const before = useScene.getState().room.footprint;
  const attached = ids ?? attachedToWall(effectiveParts(), before, index);
  // Read before the move: the moved edge translates along this normal and keeps its
  // direction, so one reading holds for the whole gesture — but the polygon object
  // does not, so take it from `before`.
  const outward = wallOutwardNormal(before, index);
  const applied = useScene.getState().moveWall(index, delta);
  // Clamped. The wall did not move, so nothing on it may move either.
  if (applied === 0) return 0;
  if (attached.length === 0) return applied;
  const after = useScene.getState().room.footprint;
  const moves = carryAttached(attached, effectiveParts(), before, after, outward, applied);
  useStudio.getState().setPositionsFor(moves);
  return applied;
}
