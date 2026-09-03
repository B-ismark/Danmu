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
import { findSupportDetailed, heightForNewCeiling } from './physics';
import { ridingParents } from './rigid-parent';
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

// The one memo slot `settledYs` keys on. Declared here rather than under the
// docblock below so nothing reads it in a temporal dead zone.
let slot: {
  parts: ScenePart[];
  positions: TransformOverrides['positions'] | undefined;
  rotations: TransformOverrides['rotations'] | undefined;
  dims: TransformOverrides['dims'] | undefined;
  ys: Map<string, number>;
} | null = null;

/** The Y a rider must sit at once the piece UNDER it has been resized — § 12, and the
 *  repair the user chose in § B.16: derive it when the piece is read, write nothing.
 *
 *  ── The defect ───────────────────────────────────────────────────────────────
 *
 *  A resize writes `useStudio.dims`. `settleHeights` — the pass that seats every
 *  rider — runs once, inside `buildSceneFromRoom`, and answers entirely in the dims it
 *  was handed, which on that path are the AUTHORED ones. `loadTransforms` then applies
 *  the saved `dims` over the top and nothing settles again. So shrinking a desk leaves
 *  the lamp on it hanging at the old top, and growing the desk buries the lamp inside
 *  it. Both directions were pinned as a documented limit in
 *  `tests/layout-settle.test.ts`; that test asserts the fix now, which is what a
 *  self-retiring limit is for. It also fixes the in-session half — `setDim` settles
 *  nothing, ever — because a derivation has no "later" to be missing.
 *
 *  A rider's height is a fact about TWO pieces, so no per-part function can answer it.
 *  `resolvePart` stays exactly what it was and this is layered on top of the list.
 *
 *  ── Scope: a RESIZED support, and deliberately nothing else ──────────────────
 *
 *  The first version of this settled every floating piece on every read, which is a
 *  general read-time gravity pass rather than what § B.16 says ("derived from its
 *  support's *current* dims"). It also **deleted a feature that shipped three commits
 *  earlier**: § 37's placement banner reports a piece resting on nothing as
 *  *Floating*, and once every read seats every piece that state is unreachable — three
 *  assertions in `tests/placement-banner.test.tsx` went red saying so, which is the
 *  suite catching a scope error rather than a bug. So the gate is narrow:
 *
 *    · nothing happens at all unless some piece carries a `dims` override, so a room
 *      nobody has resized pays one `Object.keys` and no geometry;
 *    · a piece is corrected only if it WAS riding another piece, read off live
 *      geometry by `ridingParents` at the AUTHORED sizes — the state `settleHeights`
 *      left everything in — and that support is one of the resized ones;
 *    · a piece dropped in mid-air with nothing under it was never riding anything, so
 *      it is untouched and still reported as floating. Truthfully.
 *
 *  Chains are handled by walking in ascending Y and treating a support this pass has
 *  already moved as a resized one: a lamp on a nightstand on a resized armchair is two
 *  edges, and fixing only the first would leave the lamp where the nightstand was.
 *
 *  Where the piece lands is `findSupportDetailed` against the CURRENT sizes, not the
 *  resized support's top, because a desk that shrank in x/z may no longer be under the
 *  lamp at all — then the honest answer is whatever is under it now, or the floor. The
 *  `> 0.3` bar and the `?? 0` are `settleHeights`' own, so the build path and the read
 *  path cannot disagree about a piece and make it jump the moment a scene snapshot is
 *  written. That bar disagrees with `ridingParents`' `> 0` on one named pair — a lamp
 *  on a 300 mm ottoman — and the disagreement is inherited from `settleHeights`, which
 *  documents it, rather than introduced here.
 *
 *  ── Memoised on argument identity ────────────────────────────────────────────
 *
 *  `resolveParts` is called from pointer handlers (`currentRoomScene`), from
 *  `useRoomScene`'s memo, and — through `settledY` below — once per `Draggable` on
 *  every store change, so without a shared cache the last of those alone would be
 *  O(parts³) per commit. The four identity checks are exactly `useRoomScene`'s memo
 *  deps, and the override maps are replaced wholesale by their setters, so identity is
 *  a sound key.
 *
 *  One slot, deliberately: there is one scene, and a second one would thrash rather
 *  than break. The Map is fresh on every miss and never mutated here; do not mutate it
 *  in a caller either.
 *
 *  Sparse — a piece already at its derived height is absent rather than
 *  present-and-equal, because `resolveParts` uses absence to hand back the part
 *  object itself. */
export function settledYs(parts: ScenePart[], o: Partial<TransformOverrides>): Map<string, number> {
  if (
    slot !== null &&
    slot.parts === parts &&
    slot.positions === o.positions &&
    slot.rotations === o.rotations &&
    slot.dims === o.dims
  ) {
    return slot.ys;
  }
  const ys = deriveRiderYs(parts, o);
  slot = { parts, positions: o.positions, rotations: o.rotations, dims: o.dims, ys };
  return ys;
}

function deriveRiderYs(
  parts: ScenePart[],
  o: Partial<TransformOverrides>,
): Map<string, number> {
  const ys = new Map<string, number>();
  const resized = o.dims;
  if (!resized || Object.keys(resized).length === 0) return ys;

  // Who was riding whom, at the sizes `settleHeights` seated everything at. The
  // POSITIONS and rotations are the user's, because a piece they dragged onto a table
  // is riding that table; only the sizes are held at the authored ones, so the
  // adjacency test asks "was this seated before the resize".
  const authored = parts.map((p) => resolvePart(p, { positions: o.positions, rotations: o.rotations }));
  const wasRiding = ridingParents(authored);
  if (Object.keys(wasRiding).length === 0) return ys;

  // Ascending Y, so a support is corrected before anything standing on it asks. The
  // world carries each correction as it is made — `findSupportDetailed` reads tops out
  // of this list, and a stale one is how the second edge of a chain goes wrong.
  const world = parts.map((p) => resolvePart(p, o));
  const byId = new Map(world.map((p, i) => [p.id, i] as const));
  for (const p of [...world].sort((a, b) => a.pos[1] - b.pos[1])) {
    const supportId = wasRiding[p.id];
    if (supportId === undefined) continue;
    if (!(supportId in resized) && !ys.has(supportId)) continue;
    const support = findSupportDetailed(world, p.id, p.pos[0], p.pos[2], p.dimMM, p.rot, p.circle);
    const y = support !== null && support.y > 0.3 ? support.y : 0;
    if (y === p.pos[1]) continue;
    ys.set(p.id, y);
    const at = byId.get(p.id)!;
    world[at] = { ...world[at], pos: [p.pos[0], y, p.pos[2]] };
  }
  return ys;
}

/** One piece's derived Y, or `undefined` when nothing under it has moved.
 *
 *  For the readers that deliberately do NOT hold the list — `Draggable`, which writes
 *  its own object3D from a per-part subscription, and `Dressing`, which follows one
 *  piece. They go through the same memo as `resolveParts`, so the 3D tab and the 2D
 *  plan cannot disagree about where a rider is: the alternative was a derivation in
 *  the list readers only, which would have shown as a lamp seated in the plan and
 *  floating in the scene. */
export function settledY(
  parts: ScenePart[],
  o: Partial<TransformOverrides>,
  id: string,
): number | undefined {
  return settledYs(parts, o).get(id);
}

/** Test-only: drop the memo, so a case can be measured from cold. */
export function resetSettleMemo(): void {
  slot = null;
}

/** Every part, as the room currently stands — including a rider's derived height
 *  (see `settledYs`). */
export function resolveParts(parts: ScenePart[], o: Partial<TransformOverrides>): ScenePart[] {
  const ys = settledYs(parts, o);
  if (ys.size === 0) return parts.map((p) => resolvePart(p, o));
  return parts.map((p) => {
    const r = resolvePart(p, o);
    const y = ys.get(p.id);
    return y === undefined ? r : { ...r, pos: [r.pos[0], y, r.pos[2]] as [number, number, number] };
  });
}

/**
 * The size a part's group is DRAWN at when its scale is 1 — which is not always the
 * authored `dimMM`, and the difference cost a user their resize.
 *
 * A parametric shape — whatever `isParametric` says, and the list is deliberately NOT
 * repeated here, because it was and it went stale the moment the set grew from six to
 * fourteen — rebuilds its geometry from the effective dim, so `Draggable` leaves its
 * group at scale 1 and the mesh carries the resize. Every other shape keeps authored
 * geometry and wears the resize as a group scale. So "authored dim x live scale" is
 * the current size for the second kind and returns the AUTHORED size for the first,
 * whatever the user did to it — and `commit()` wrote that back through `setDim` on
 * every drop. Resize a wardrobe, then merely MOVE it, and the width went home; in the
 * parametric shapes and nowhere else, which is why it reported as "sometimes". (It was
 * six of them when that was written and is fourteen now — § 36 — so the failure has a
 * wider surface than the sentence originally described.)
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
