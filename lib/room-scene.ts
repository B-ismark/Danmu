'use client';

// Where a piece actually is — the React half.
//
// The merge itself, and the reason a part's transform lives in two layers at all,
// are in `lib/transforms.ts`. Read that first; the short version is that the layers
// are deliberate and must not be collapsed, but the fallback must only ever be
// written once.
//
// These are the component-facing wrappers. Everything is memoised, because the
// version that was not is why most consumers stopped calling it.

import { useMemo } from 'react';
import { useScene } from './scene-store';
import { useStudio } from './store';
import { hasOverride, type TransformOverrides } from './transforms';
import { riderYs, resolveScene, type SceneContext } from './rider-height';
import type { ScenePart } from './scene-spec';

export type { TransformOverrides } from './transforms';
export { resolvePart, resolveParts } from './transforms';
export { resolveScene, type SceneContext } from './rider-height';

/** The scene as it stands. Memoised on the six store slices it reads, so a consumer
 *  can hold the result across renders and pass it to a `useMemo` of its own.
 *
 *  `parentIds` and the room height are two of the six, and they are subscriptions
 *  rather than `getState()` reads on purpose: the in-session half of § 12 — resize a
 *  desk with the studio open and watch the lamp follow — is a re-render this hook
 *  must be woken for, and a `getState()` read is woken by nothing.
 *  `tests/rider-settle-hooks.test.tsx` mounts the hook and moves each of them. */
export function useRoomScene(): ScenePart[] {
  const parts = useScene((s) => s.parts);
  const roomHeight = useScene((s) => s.room.height);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  const parentIds = useStudio((s) => s.parentIds);

  return useMemo(
    () => resolveScene(parts, { positions, rotations, dims }, { parentIds, roomHeight }),
    [parts, positions, rotations, dims, parentIds, roomHeight],
  );
}

export function useRoomPart(id: string | null): ScenePart | undefined {
  const parts = useRoomScene();
  return useMemo(() => (id ? parts.find((p) => p.id === id) : undefined), [parts, id]);
}

/** One part's live transform, subscribing to that part alone.
 *
 *  For the hot paths — `Draggable` mid-gesture, `Dressing` following its owner —
 *  where re-rendering because some *other* piece moved is a cost worth avoiding.
 *  Same fallback, narrower subscription. */
export function usePartTransform(part: ScenePart): {
  pos: [number, number, number];
  rot: number;
  dimMM: [number, number, number];
} {
  const pos = useStudio((s) => s.positions[part.id]);
  const rot = useStudio((s) => s.rotations[part.id]);
  const dimMM = useStudio((s) => s.dims[part.id]);
  const settled = useSettledY(part.id);
  return useMemo(
    () => {
      const p = pos ?? part.pos;
      return {
        pos: settled === null ? p : ([p[0], settled, p[2]] as [number, number, number]),
        rot: rot ?? part.rot,
        dimMM: dimMM ?? part.dimMM,
      };
    },
    [pos, rot, dimMM, settled, part.pos, part.rot, part.dimMM],
  );
}

/** The Y this piece has been pushed to by the support it rides, or `null` when it
 *  rides nothing that moved — the per-part half of § 12, for the two hot paths that
 *  read one part rather than the list.
 *
 *  A rider's height is a fact about a PAIR, so a per-part hook cannot answer it from
 *  its own slice, and the two things that makes expensive are both handled here
 *  rather than accepted:
 *
 *   · **The derivation is shared, not repeated.** `riderYs` caches on reference
 *     identity, so the `2N + 8` subscribers in a studio collapse onto one computation
 *     per store change. Uncached this cost 14.3 ms per drag frame at 60 parts — the
 *     numbers are in `lib/rider-height.ts`, and an earlier version of this docblock
 *     claimed an early return made it free, which was measured and is false: 94% of
 *     the cost is spent before that return is reached.
 *   · **The selector returns a NUMBER.** zustand compares a selector's result with
 *     `Object.is`, so a part re-renders only when ITS OWN settled Y changes rather
 *     than whenever anything in `positions` moves. Reading the map after subscribing
 *     to the slices — which is what this did first — re-rendered every `Draggable`
 *     and every `Dressing` on every frame of a convoy drag, and made the comments in
 *     both of those files false.
 *
 *  The two `useScene` reads stay subscriptions: a `getState()` read leaves the value
 *  correct on the next render for some other reason and stale until then, which is
 *  the in-session bug wearing a fix's clothes. `tests/rider-settle-hooks.test.tsx`
 *  moves each of them on its own. */
export function useSettledY(id: string): number | null {
  const parts = useScene((s) => s.parts);
  const roomHeight = useScene((s) => s.room.height);
  return useStudio((s) => riderYs(parts, s.positions, s.rotations, s.dims, s.parentIds, roomHeight)[id] ?? null);
}

/** Has the user moved, turned or resized this piece? What the Inspector's and the
 *  context menu's put-it-back affordances key off. */
export function useHasOverrides(id: string | null): boolean {
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  return !!id && hasOverride(id, { positions, rotations, dims });
}

/** The overrides as a plain object, for a non-React caller that already has the
 *  parts. Reads the store at call time on purpose: an event handler wants the values
 *  as they are when it fires, not as they were when it was created. */
export function currentOverrides(): TransformOverrides {
  const s = useStudio.getState();
  return { positions: s.positions, rotations: s.rotations, dims: s.dims };
}

/** The `parentIds` and room height a rider's height needs, read at call time — the
 *  non-hook twin of the two extra subscriptions `useRoomScene` takes. */
export function currentSceneContext(): SceneContext {
  return { parentIds: useStudio.getState().parentIds, roomHeight: useScene.getState().room.height };
}

/** Parts at their effective transforms, read at call time. The non-hook twin of
 *  `useRoomScene`, for pointer handlers and one-shot actions. */
export function currentRoomScene(): ScenePart[] {
  return resolveScene(useScene.getState().parts, currentOverrides(), currentSceneContext());
}
