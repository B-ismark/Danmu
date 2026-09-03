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
import { hasOverride, resolveParts, settledY, type TransformOverrides } from './transforms';
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

/** The height a rider has been DERIVED to sit at, for a consumer that does not hold
 *  the list — § 12. `undefined` means "nothing under this piece has moved", and the
 *  caller keeps whatever Y it already had.
 *
 *  **The selector returns a NUMBER on purpose.** It reads the whole `positions` map,
 *  which is replaced on every commit, but React re-renders only when the selected
 *  value changes — so a piece re-renders when its own height moves and never because
 *  some other piece did. Same trick, and the same reason, as `Draggable`'s
 *  `blockedHere`. The derivation itself is memoised inside `lib/transforms.ts`, so N
 *  parts asking on one store change cost one pass between them rather than N.
 *
 *  `useScene((s) => s.parts)` is the one subscription this adds that a per-part reader
 *  did not have. `parts` changes on an add, a delete, a relabel or a re-detect — not
 *  on a drag — so the cost is a re-render on events that already rebuild the tree. */
export function useSettledY(partId: string): number | undefined {
  const parts = useScene((s) => s.parts);
  return useStudio((s) => settledY(parts, s, partId));
}

/** One part's live transform, subscribing to that part alone.
 *
 *  For the hot paths — `Dressing` following its owner — where re-rendering because
 *  some *other* piece moved is a cost worth avoiding. Same fallback, narrower
 *  subscription.
 *
 *  (It named `Draggable` too, and had not for some time: that component reads
 *  `s.positions[partId]` itself, because it also needs the AUTHORED `dimMM` to divide
 *  a stored dim by for a group scale, which no resolved value can give.)
 *
 *  The Y goes through `useSettledY`, so this and `resolveParts` are one answer. A
 *  derivation added to the list readers alone would have shown as a lamp seated in
 *  the 2D plan and floating in the 3D scene — two code paths for one observable
 *  fact, which is the shape this repo keeps finding. */
export function usePartTransform(part: ScenePart): {
  pos: [number, number, number];
  rot: number;
  dimMM: [number, number, number];
} {
  const pos = useStudio((s) => s.positions[part.id]);
  const rot = useStudio((s) => s.rotations[part.id]);
  const dimMM = useStudio((s) => s.dims[part.id]);
  const settled = useSettledY(part.id);
  return useMemo(() => {
    const base = pos ?? part.pos;
    return {
      pos: settled === undefined ? base : ([base[0], settled, base[2]] as [number, number, number]),
      rot: rot ?? part.rot,
      dimMM: dimMM ?? part.dimMM,
    };
  }, [pos, rot, dimMM, settled, part.pos, part.rot, part.dimMM]);
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
