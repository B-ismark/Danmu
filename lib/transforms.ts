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

import { isParametric, type ScenePart } from './scene-spec';
import { heightForNewCeiling } from './physics';
import { carryForResize } from './wall-move';
import type { Footprint } from './footprint';

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

/**
 * The size a part's group is DRAWN at when its scale is 1 — which is not always the
 * authored `dimMM`, and the difference cost a user their resize.
 *
 * A parametric shape (`isParametric`: sofa, curtain, WARDROBE, closet, bookshelf,
 * shoe-rack) rebuilds its geometry from the effective dim, so `Draggable` leaves its
 * group at scale 1 and the mesh carries the resize. Every other shape keeps authored
 * geometry and wears the resize as a group scale. So "authored dim x live scale" is
 * the current size for the second kind and returns the AUTHORED size for the first,
 * whatever the user did to it — and `commit()` wrote that back through `setDim` on
 * every drop. Resize a wardrobe, then merely MOVE it, and the width went home; in
 * those six shapes and nowhere else, which is why it reported as "sometimes".
 *
 * It takes the part and the overrides rather than two dims, and that is the fix
 * being made unrepeatable rather than a convenience: the two-dim version's whole
 * failure mode was a caller handing it the authored dim twice, which is exactly what
 * the broken code did and what no unit test of the function itself can see.
 */
export function renderBaseDim(p: ScenePart, o: Partial<TransformOverrides>): [number, number, number] {
  return isParametric(p.shape) ? resolvePart(p, o).dimMM : p.dimMM;
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
/** Every Y a ceiling move changes, in BOTH transform layers.
 *
 *  A part's height lives in two places on purpose — the authored `ScenePart` and
 *  the user's override — and a ceiling move has to reach both. Writing only the
 *  override leaves a stale authored height that "Back to where it started" hands
 *  straight back; writing only the authored one is invisible while an override
 *  exists. So this returns two lists, not one resolved answer, and the caller
 *  writes each to the layer it came from.
 *
 *  A part whose Y does not change is OMITTED rather than written back unchanged: a
 *  no-op write to the override layer still CREATES an override, which then pins the
 *  piece against a re-detect and gets persisted. The rule for which pieces move at
 *  all is `heightForNewCeiling`'s, not this function's — this one only knows about
 *  the two layers.
 *
 *  The clamp reads the EFFECTIVE dim, so a piece the user resized is held inside
 *  the room by the size it is now rather than the size it shipped as. */
export function regradeForNewCeiling(
  parts: ScenePart[],
  o: Partial<TransformOverrides>,
  oldHeight: number,
  newHeight: number,
): { authored: Array<{ id: string; y: number }>; overridden: Array<{ id: string; y: number }> } {
  const authored: Array<{ id: string; y: number }> = [];
  const overridden: Array<{ id: string; y: number }> = [];
  if (!(newHeight > 0) || newHeight === oldHeight) return { authored, overridden };
  for (const p of parts) {
    const dim = resolvePart(p, o).dimMM;
    const a = heightForNewCeiling(p.category, p.shape, dim, p.pos[1], oldHeight, newHeight);
    if (a !== p.pos[1]) authored.push({ id: p.id, y: a });
    const ov = o.positions?.[p.id];
    if (ov) {
      const b = heightForNewCeiling(p.category, p.shape, dim, ov[1], oldHeight, newHeight);
      if (b !== ov[1]) overridden.push({ id: p.id, y: b });
    }
  }
  return { authored, overridden };
}

/** Both layers, after the ROOM was resized — the x/z companion to
 *  `regradeForNewCeiling`, and it exists because that function was the whole of
 *  the story for one axis out of three.
 *
 *  Typing a new height in Room tools regraded everything hanging from the
 *  ceiling. Typing a new width or depth carried nothing, so the wall retreated
 *  through the furniture and left it outside the room.
 *
 *  Attachment is decided ONCE, on the EFFECTIVE parts, because that is where a
 *  piece actually is — a sofa the user dragged against the north wall is attached
 *  to the north wall regardless of where `defaultScene` first put it. The
 *  resulting displacement is then applied to BOTH layers, which is what keeps
 *  them from drifting apart: the override is what renders, and the authored
 *  position is what a re-detect falls back to.
 *
 *  A part that does not move is OMITTED rather than written back unchanged, for
 *  the reason `regradeForNewCeiling` gives — a no-op write to the override layer
 *  still CREATES an override, which pins the piece against a re-detect and gets
 *  persisted. Same rule, and it is the reason this returns two sparse lists
 *  rather than a new parts array. */
export function recarryForResize(
  parts: ScenePart[],
  o: Partial<TransformOverrides>,
  before: Footprint,
  after: Footprint,
): {
  authored: Array<{ id: string; pos: [number, number, number] }>;
  overridden: Array<{ id: string; pos: [number, number, number] }>;
} {
  const authored: Array<{ id: string; pos: [number, number, number] }> = [];
  const overridden: Array<{ id: string; pos: [number, number, number] }> = [];

  const effective = resolveParts(parts, o);
  const carried = carryForResize(effective, before, after);
  if (carried.length === 0) return { authored, overridden };

  // The DISPLACEMENT, not the absolute position: `carryForResize` answered about
  // the effective parts, and the authored layer may sit somewhere else entirely.
  const byId = new Map(effective.map((p) => [p.id, p.pos]));
  const shift = new Map<string, [number, number]>();
  for (const c of carried) {
    const from = byId.get(c.id);
    if (!from) continue;
    const dx = c.pos[0] - from[0];
    const dz = c.pos[2] - from[2];
    if (dx === 0 && dz === 0) continue;
    shift.set(c.id, [dx, dz]);
  }

  for (const p of parts) {
    const s = shift.get(p.id);
    if (!s) continue;
    authored.push({ id: p.id, pos: [p.pos[0] + s[0], p.pos[1], p.pos[2] + s[1]] });
    const ov = o.positions?.[p.id];
    if (ov) overridden.push({ id: p.id, pos: [ov[0] + s[0], ov[1], ov[2] + s[1]] });
  }
  return { authored, overridden };
}
