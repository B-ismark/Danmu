// A rider follows the piece it was put on, when that piece changes height.
//
// The bug (§ 12): put a lamp on a desk, make the desk taller, and the lamp stays at
// the height the desk USED to be — floating, in the 3D scene, in a saved file, and
// invisible from directly above in the plan. `setDim` writes a `dims` override and
// settles nothing, so it is wrong in-session as well as after a reload.
//
// This is the READ half of the answer: nothing here writes to the store. A rider's Y
// is a CONSEQUENCE of its support's size, so it is derived where the scene is read
// and never persisted. That is not a performance choice, it is what makes the two
// layers survive: a derived Y written back becomes the rider's stored position, and
// the next read compares that stored value against the AUTHORED support top, finds
// them a metre apart, and concludes the piece rides nothing.
//
// ── Two things this got wrong the first two times it was built ────────────────
//
// Both attempts were reverted with CI green over every defect, so they are written
// down rather than left to be rediscovered (`docs/what-is-still-open.md` § 12).
//
//   · **The relation is REMEMBERED, not re-derived from live geometry.** Recovering
//     "this rides that" by testing the rider's LIVE `pos[1]` against the support's
//     AUTHORED top works exactly until any consumer writes a resolved position back,
//     at which point the relation vanishes permanently and persisted.
//     `moveWallCarrying`, `duplicateSelection` and Suggest all reach that state with
//     no gesture on the rider at all. So the relation comes from `parentIds` — a
//     durable override map every landing drag writes — unioned with
//     `ridingParents(AUTHORED parts)`, which covers a seeded rider that has never
//     been touched and whose authored Y is therefore still true.
//   · **A rider lands on its NAMED support, not on whatever is highest.**
//     `findSupportDetailed` maximises `top` and has no below-test, so asking it
//     "what is under this lamp" once a wardrobe overlaps the desk lifts the lamp
//     from 0.75 m to 1.8 m onto a piece it was never on. Nothing here calls it: the
//     named support's own top is the answer, and the only question asked of geometry
//     is whether the rider is still OVER that support.
//
// And the rule that generalises past this file, because three consumers get it wrong:
// **a consumer that moves a piece in x/z must not write a Y it did not compute.**
// `recarryForResize` gets it right.

import { footArea, footFromPart } from './geometry';
import { coversEnoughToSupport, isFloorStanding, MOUNT_PAD, verticalExtent } from './physics';
import { ridingParents } from './rigid-parent';
import { resolvePart, resolveParts, type TransformOverrides } from './transforms';
import type { ScenePart } from './scene-spec';

/** What a rider's height needs that the two transform layers cannot supply on their
 *  own: the record of what was put on what, and the ceiling to clamp against.
 *
 *  Separate from `TransformOverrides` because `parentIds` is a separate `useStudio`
 *  slice with its own history entry and its own persistence — folding it in would
 *  make every existing `{ positions, rotations, dims }` literal in the repo an
 *  incomplete override object, and `TransformOverrides` is destructured out of the
 *  store by name in several places. */
export type SceneContext = {
  parentIds: Record<string, string>;
  /** Metres. */
  roomHeight: number;
};

/** The room as it currently stands, INCLUDING a rider that has followed its support
 *  to a new height.
 *
 *  **This, not `resolveParts`, is what a consumer rendering or exporting the room
 *  wants.** `resolveParts` answers *"what did the user override"*; this answers
 *  *"where is everything"*. They differ only for a piece standing on another piece
 *  whose height changed — which is precisely the case that was wrong in the 3D scene,
 *  the plan and a saved file at once, and looked correct in all three from directly
 *  above.
 *
 *  The context is REQUIRED rather than optional, and that is the whole guard: an
 *  optional argument means a caller that forgets it gets the old, wrong answer with
 *  nothing to say so — the shape `AnalyzeOptions.dimUnit` was corrected into last
 *  cycle. `tests/room-scene.test.ts` sweeps for the hand-written alternatives. */
export function resolveScene(
  parts: ScenePart[],
  o: Partial<TransformOverrides>,
  ctx: SceneContext,
): ScenePart[] {
  const ys = deriveRiderYs(parts, o, ctx.parentIds, ctx.roomHeight);
  const resolved = resolveParts(parts, o);
  // The untouched majority keeps referential equality with `resolveParts`' answer,
  // which is what `resolvePart` returns the part itself for and what makes memoising
  // downstream pay. An empty correction returns that array unchanged.
  for (let i = 0; i < resolved.length; i++) {
    const y = ys[resolved[i].id];
    if (y === undefined) continue;
    const p = resolved[i];
    resolved[i] = { ...p, pos: [p.pos[0], y, p.pos[2]] };
  }
  return resolved;
}

/** Which piece each rider was put on — child id -> support id.
 *
 *  Two sources, and the union is the point rather than a hedge. `parentIds` is what
 *  a drag records and is durable across everything; it is empty for a room nobody has
 *  dragged in. `ridingParents` reads the AUTHORED parts, which is where `defaultScene`
 *  and the detection pass left a seeded rider, and is the only one of the two that can
 *  answer for a lamp the user has never touched.
 *
 *  `parentIds` wins a disagreement: it is the record of a decision, where the other is
 *  an inference from the state before any decision was made. */
export function riderRelation(
  authored: ScenePart[],
  parentIds: Record<string, string>,
): Record<string, string> {
  return { ...ridingParents(authored), ...parentIds };
}

/** Is the rider still over enough of its support to be held up by it?
 *
 *  The Y half of "is this resting on that" is deliberately NOT asked — asking it is
 *  the defect described in the module comment. This is the plan-view question only,
 *  against the LIVE footprints of both, so a rider dragged off its support (or a
 *  support shrunk out from under one) stops following it. */
function stillOver(rider: ScenePart, support: ScenePart): boolean {
  const foot = footFromPart(rider.pos, rider.rot, rider.dimMM, rider.circle);
  return coversEnoughToSupport(foot, footArea(foot), support);
}

/**
 * The Y each rider should be at, given what its support is now — sparse, and empty
 * when nothing has changed size.
 *
 * `authored` is `useScene.parts`; `o` is the user's override maps; `parentIds` is the
 * `useStudio` slice of the same name, which is a separate slice from
 * `TransformOverrides` and so is passed separately rather than folded in.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────
 *
 * **No `> 0.3` support bar.** `settleHeights` has one, to decide which of the
 * surfaces it FINDS counts as a table rather than a rug. This function finds nothing
 * — it follows a support the user or the seeder already chose — so filtering that
 * choice by height would overrule a decision rather than make one. Wiring the two
 * bars together is what drops a lamp through a 300 mm ottoman, and
 * `lib/layout-settle.ts` carries the standing warning about it.
 *
 * **The ceiling clamp IS here**, and matches `settleHeights`' floor-anchored branch
 * exactly, because a rider whose support grew can otherwise be pushed through the
 * slab by this pass. A piece too tall for the room keeps its real height and pokes
 * through; `lib/clearance.ts` reports `tall`. Silently shrinking it is the thing this
 * repo does not do.
 *
 * `roomHeight` in metres.
 */
export function deriveRiderYs(
  authored: ScenePart[],
  o: Partial<TransformOverrides>,
  parentIds: Record<string, string>,
  roomHeight: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const relation = riderRelation(authored, parentIds);

  const childrenOf = new Map<string, string[]>();
  for (const [child, parent] of Object.entries(relation)) {
    const list = childrenOf.get(parent);
    if (list) list.push(child);
    else childrenOf.set(parent, [child]);
  }
  if (childrenOf.size === 0) return out;

  const byId = new Map(authored.map((p) => [p.id, p]));
  const live = new Map(authored.map((p) => [p.id, resolvePart(p, o)]));
  const cap = roomHeight - MOUNT_PAD;

  // Roots are the supports that ride nothing themselves. Walking DOWN from them —
  // rather than sorting by Y, which the second attempt did — is what puts a support's
  // own correction in hand before the piece riding it asks for its top. A lamp on a
  // nightstand on a desk needs the nightstand's new height, and the nightstand only
  // has one once the desk has been processed. Array order and ascending Y coincide in
  // every chain fixture anyone writes by hand, which is exactly why sorting by Y
  // passed a suite that could not express the case.
  //
  // A cycle (which `wouldCreateCycle` prevents on the `parentIds` side and `y`
  // strictly increasing prevents on the `ridingParents` side, but which the UNION
  // could still contain) is simply never reached from a root, and `seen` bounds the
  // walk regardless.
  const queue = [...childrenOf.keys()].filter((id) => relation[id] === undefined);
  const seen = new Set<string>(queue);

  while (queue.length > 0) {
    const supportId = queue.shift()!;
    const kids = childrenOf.get(supportId) ?? [];
    const authoredSupport = byId.get(supportId);
    const liveSupport = live.get(supportId);

    // The support's top as it is NOW, using this pass's own correction for it if it
    // got one — which is the second half of walking from the roots.
    let currentTop: number | null = null;
    let moved = false;
    if (authoredSupport && liveSupport) {
      currentTop = verticalExtent(
        liveSupport.category, liveSupport.shape, liveSupport.dimMM, out[supportId] ?? liveSupport.pos[1],
      )[1];
      const authoredTop = verticalExtent(
        authoredSupport.category, authoredSupport.shape, authoredSupport.dimMM, authoredSupport.pos[1],
      )[1];
      // The gate: has this support's top actually MOVED? Not "does it carry a `dims`
      // override" — a width-only resize carries one and moves no rider. `out` is
      // consulted as well, so a support this pass has just lowered carries its own
      // riders down even if that landed it back on its authored top.
      moved = currentTop !== authoredTop || out[supportId] !== undefined;
    }

    for (const childId of kids) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      queue.push(childId); // its own riders may still need it, resized or not
      if (!moved || currentTop === null || !liveSupport) continue;

      const rider = live.get(childId);
      if (!rider) continue;
      // A wall or ceiling piece rides its wall, not the furniture under it. Its
      // `pos[1]` is a CENTRE, so "put its bottom on the top" is not even the right
      // arithmetic for one.
      if (!isFloorStanding(rider.category, rider.shape)) continue;
      if (!stillOver(rider, liveSupport)) continue;

      const h = rider.dimMM[2] / 1000;
      const y = currentTop + h > cap ? Math.max(0, cap - h) : currentTop;
      // Unchanged is OMITTED rather than returned, for the reason
      // `regradeForNewCeiling` gives about writes — a consumer that turns this map
      // into overrides must not be handed a no-op to persist.
      if (y !== rider.pos[1]) out[childId] = y;
    }
  }

  return out;
}
