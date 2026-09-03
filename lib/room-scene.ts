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
import { hasOverride, resolveParts, type TransformOverrides } from './transforms';
import type { ScenePart } from './scene-spec';

export type { TransformOverrides } from './transforms';
export { resolvePart, resolveParts } from './transforms';

/** The scene as it stands. Memoised on the four store slices it reads, so a consumer
 *  can hold the result across renders and pass it to a `useMemo` of its own. */
export function useRoomScene(): ScenePart[] {
  const parts = useScene((s) => s.parts);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);

  return useMemo(
    () => resolveParts(parts, { positions, rotations, dims }),
    [parts, positions, rotations, dims],
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
  return useMemo(
    () => ({ pos: pos ?? part.pos, rot: rot ?? part.rot, dimMM: dimMM ?? part.dimMM }),
    [pos, rot, dimMM, part.pos, part.rot, part.dimMM],
  );
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

/** Parts at their effective transforms, read at call time. The non-hook twin of
 *  `useRoomScene`, for pointer handlers and one-shot actions. */
export function currentRoomScene(): ScenePart[] {
  return resolveParts(useScene.getState().parts, currentOverrides());
}
