// Where a piece actually is — the pure half.
//
// A part's transform lives in two places, and that is deliberate:
//
//   `useScene.parts`  — the AUTHORED scene. Where `defaultScene` put a piece, or
//                       where the geometry engine resolved a detection to.
//   `useStudio.*`     — the user's EDITS, as `positions` / `rotations` / `dims`
//                       maps keyed by part id. Overrides win.
//
// **Do not collapse these into one.** The separation is load-bearing, and the path
// that needs it is easy to miss: dragging a piece writes only the override map, so a
// detected room whose furniture the user has only MOVED carries transform overrides
// and no scene snapshot at all. Re-scanning then rebuilds `parts` from the new
// detections (`buildSceneFromRoom`) while those moves re-apply by id — which is what
// `lib/storage.ts` means by "each detection carries a `uid` … so a user's transforms
// survive a re-detect". Fold the maps into `ScenePart` and that survival goes with
// them, along with any way to say "put this piece back where it was found".
//
// What the separation must NOT be is open-coded. `positions[p.id] ?? p.pos` written
// out by hand is a silent bug the moment someone forgets it: the piece renders, the
// numbers look plausible, and it is simply in the wrong place. `lib/room-scene.ts`
// was already declaring itself the one place that merge happens — and four files
// used it while twelve wrote the fallback out again, because it rebuilt the whole
// array on every render and the hot paths could not afford that.
//
// So the merge lives here, once, with no React and no store imports so that the pure
// consumers (`lib/scene-file.ts`, `lib/wall-actions.ts`, a saved-layout preview) use
// the same code the renderer does. `lib/room-scene.ts` wraps it in memoised hooks.
// `tests/room-scene.test.ts` fails if a thirteenth hand-written copy appears.

import type { ScenePart } from './scene-spec';

/** The user's edits, as the studio store holds them. */
export type TransformOverrides = {
  positions: Record<string, [number, number, number]>;
  rotations: Record<string, number>;
  dims: Record<string, [number, number, number]>;
};

/** One part, as it currently stands. */
export function resolvePart(p: ScenePart, o: Partial<TransformOverrides>): ScenePart {
  const pos = o.positions?.[p.id];
  const rot = o.rotations?.[p.id];
  const dimMM = o.dims?.[p.id];
  // The part itself when nothing overrides it, rather than a copy: referential
  // equality for the untouched majority is what makes memoising the list pay, and
  // what lets a consumer compare parts by identity to see what changed.
  if (!pos && rot === undefined && !dimMM) return p;
  return { ...p, pos: pos ?? p.pos, rot: rot ?? p.rot, dimMM: dimMM ?? p.dimMM };
}

/** Every part, as the room currently stands. */
export function resolveParts(parts: ScenePart[], o: Partial<TransformOverrides>): ScenePart[] {
  return parts.map((p) => resolvePart(p, o));
}

/** Has the user moved, turned or resized this piece at all?
 *
 *  `rotations` is checked against `undefined` rather than for truthiness: a piece
 *  the user turned back to square has an override of `0`, and treating that as "no
 *  override" makes the Inspector's put-it-back affordance disappear while the
 *  override is still there to be dropped. */
export function hasOverride(id: string, o: Partial<TransformOverrides>): boolean {
  return !!o.positions?.[id] || o.rotations?.[id] !== undefined || !!o.dims?.[id];
}
