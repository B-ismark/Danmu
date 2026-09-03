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
  const ys = riderYs(parts, o.positions, o.rotations, o.dims, ctx.parentIds, ctx.roomHeight);
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
 * ── Which riders may be moved, and it is TWO rules rather than one ────────────
 *
 * The first version asked one question — *has this support's top moved since it was
 * authored* — and used it for both halves of the relation. That is a proxy, and it is
 * wrong in both directions:
 *
 *   · **Too weak for a recorded edge.** Every consumer that moves a piece in x/z off
 *     the RESOLVED scene writes this pass's own answer back into `positions`
 *     (`RoomTools`' Suggest and Shuffle, `carryAttached`, `PlanView.moveTo`,
 *     `Draggable.commit`). Set the support's height back to exactly its authored
 *     value afterwards and the proxy says "nothing moved" while the rider is left
 *     standing at the baked Y — measured at 450 mm in the air, persisted. It followed
 *     every height except the one it started at.
 *   · **Too strong for an inferred edge.** `clearParent` deletes a key; it cannot
 *     record *"this rides nothing"*. So an authored-geometry edge is re-inferred even
 *     after the user has explicitly grounded the piece, and with the proxy satisfied
 *     — resize the nightstand first — pressing the Inspector's **Floor** button puts
 *     the lamp on the floor and this pass puts it straight back. Two clicks.
 *
 * So:
 *
 *   1. `rider.pos[1] <= 0` — **a piece standing on the floor rides nothing**,
 *      whatever the relation still says. The same bar `ridingParents` uses on the
 *      authored side, and it is what makes **Floor** (and any drag that grounds a
 *      piece) stick, because both write a Y of exactly 0.
 *   2. A relation `parentIds` RECORDED is honoured unconditionally; one merely
 *      INFERRED from authored geometry is gated on the support's top having moved.
 *      A recorded edge is a decision — a drag landed the piece there and
 *      `Draggable.commit` wrote it down — so the rider belongs on that support's top,
 *      full stop. An inferred one is a guess about a room nobody has touched, and the
 *      gate is what stops the guess overruling a placement.
 *
 * **A piece deliberately left floating over a table keeps floating**, which is the
 * behaviour `tests/placement-banner.test.tsx` pins and which the first attempt broke.
 * It is safe under rule 2 because those pieces have no relation at all: an inferred
 * edge needs the rider within `SUPPORT_Y_EPS` of the top, and nothing in the app can
 * record an edge for a piece that is not resting — `Draggable.commit` only calls
 * `setParent` from a support the drop actually found.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────
 *
 * **No `> 0.3` support bar.** `settleHeights` has one, to decide which of the
 * surfaces it FINDS counts as a table rather than a rug. Wiring the two together is
 * what drops a lamp through a 300 mm ottoman, and `lib/layout-settle.ts` carries the
 * standing warning about it.
 *
 * The first wording of that said *"this function finds nothing"*, and **half of it
 * does**: `parentIds` is a record, but `ridingParents` is a search, with a
 * `findSupportDetailed` and a `pos[1] > 0` bar of its own. The honest reason is
 * narrower and survives that correction — the search has ALREADY happened by the time
 * this function runs, against the authored scene, and re-filtering its answer by
 * height would drop a rider this pass is not entitled to re-seat. It is
 * `ridingParents`' bar that decides which surfaces count, in one place.
 *
 * **The ceiling clamp IS here**, and matches `settleHeights`' floor-anchored branch
 * exactly, because a rider whose support grew can otherwise be pushed through the
 * slab by this pass. A piece too tall for the room keeps its real height and pokes
 * through; `lib/clearance.ts` reports `tall`. Silently shrinking it is the thing this
 * repo does not do. **A clamped rider is left off its support's top**, which is a real
 * consequence rather than a rounding one: `ridingParents` can no longer infer the
 * edge, so `buildSceneFile` writes the relation explicitly (see `riderRelation`'s
 * callers) or a save loses it for good.
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
  // **`seen` cannot fire, and it stays anyway — said plainly rather than pinned.**
  // `relation` is child -> parent, so each child sits in exactly ONE parent's list and
  // nothing can be enqueued twice; a cycle is unreachable from a root by construction,
  // because every member of one has a parent and so is filtered out of the root set.
  // Mutation confirms it: deleting both the test and the `add` leaves 647 tests green,
  // and the case named "terminates on a cycle" never enters this loop at all — it
  // measures the root filter. Writing a test for it would mean writing a test that
  // cannot fail, which is the thing this repo keeps finding.
  //
  // It is kept because the failure it guards against is not a wrong answer but a HUNG
  // TAB, and `withRiders` in `lib/layout-solve.ts` carries the story of that exact
  // outcome arriving through a one-character change to a loop with this shape. A guard
  // whose absence is invisible until someone changes an invariant two files away is
  // the cheap half of that bargain.
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
    // Nothing rests on a television, a curtain or a rug, and a `parentId` out of an
    // imported file is the one door that can name one — `lib/scene-file.ts` checks it
    // for cycles and id-remapping, not for whether the piece can hold anything up.
    // Measured through that door: a rug thickened from 20 mm to 60 mm lifted its rider.
    // These are `findSupportDetailed`'s own two skips, so the answer to "may this hold
    // something up" is the same wherever it is asked.
    if (
      authoredSupport && liveSupport
      && isFloorStanding(liveSupport.category, liveSupport.shape)
      && liveSupport.category !== 'rug'
    ) {
      // Using this pass's own correction for the support if it got one — the second
      // half of walking from the roots. `??` and NOT `||`: a support this pass put on
      // the floor is corrected to exactly 0, which `||` would discard in favour of its
      // uncorrected live Y, carrying its riders to a height it is no longer at.
      currentTop = verticalExtent(
        liveSupport.category, liveSupport.shape, liveSupport.dimMM, out[supportId] ?? liveSupport.pos[1],
      )[1];
      // The AUTHORED pos, not the live one: this term is the whole memory of where the
      // support started. Reading `liveSupport.pos[1]` here makes the comparison
      // `x !== x`, so a support that was MOVED vertically without being resized reports
      // "nothing changed" and drops every rider it carries.
      const authoredTop = verticalExtent(
        authoredSupport.category, authoredSupport.shape, authoredSupport.dimMM, authoredSupport.pos[1],
      )[1];
      // Has this support's top actually MOVED? Not "does it carry a `dims` override" —
      // a width-only resize carries one and moves no rider. `out` is consulted as well,
      // so a support this pass has just lowered carries its own riders down even if
      // that landed it back on its authored top.
      moved = currentTop !== authoredTop || out[supportId] !== undefined;
    }

    for (const childId of kids) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      queue.push(childId); // its own riders may still need it, resized or not
      if (currentTop === null || !liveSupport) continue;

      const rider = live.get(childId);
      if (!rider) continue;
      // A wall or ceiling piece rides its wall, not the furniture under it. Its
      // `pos[1]` is a CENTRE, so "put its bottom on the top" is not even the right
      // arithmetic for one.
      if (!isFloorStanding(rider.category, rider.shape)) continue;
      // Rule 1: on the floor is on the floor. `groundToFloor` and a drag that finds no
      // support both write exactly 0, and neither can leave a tombstone in `parentIds`
      // for a relation that was only ever inferred.
      if (rider.pos[1] <= 0) continue;
      // Rule 2: a RECORDED edge is honoured whatever the support has done; an INFERRED
      // one waits for the support to have moved.
      if (!moved && parentIds[childId] !== supportId) continue;
      if (!stillOver(rider, liveSupport)) continue;

      // The rider's EFFECTIVE height — a rider the user has also resized is a legal
      // combination, and reading the authored `dimMM` here would clamp it by the size
      // it shipped as.
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

/** One derivation per store change, rather than one per subscriber.
 *
 * **This is not an optimisation, it is the difference between the feature being
 * affordable and not.** `components/three/Room.tsx` mounts a `Draggable` per part AND
 * a `Dressing` per part, both of which read `useSettledY`, on top of eight
 * `useRoomScene` subscribers — so an uncached derivation runs `2N + 8` times per store
 * write. `Draggable`'s `liveUpdate` calls `setTransformsFor` on **every rAF** whenever
 * the dragged piece carries company, which is exactly the § 12 case, so that multiple
 * lands on the frame budget. Measured over the pure functions in node, per drag frame:
 *
 *     parts/riders   one call    x (2N + 8)
 *        12 / 1      0.012 ms      0.38 ms
 *        30 / 4      0.029 ms      1.97 ms
 *        60 / 10     0.11  ms     14.3  ms
 *        80 / 14     0.19  ms     31.9  ms
 *
 * The 16.7 ms budget is gone at ~60 parts before React reconciles anything. Cached,
 * the same frame costs one call.
 *
 * The cache is size ONE and keyed on REFERENCE identity, which is what makes it
 * correct here rather than a guess: every subscriber reads the same store slices, so
 * within a render pass they all arrive with identical references and collapse onto one
 * computation, and any store write replaces a slice and misses. The six arguments are
 * separate rather than an options object for the same reason — an object literal built
 * at the call site is a new reference every time and would never hit.
 *
 * `deriveRiderYs` stays pure and uncached: the tests measure that one, so no assertion
 * is ever answered by a cache. The map handed back here is SHARED between callers and
 * must not be mutated; `resolveScene` and `useSettledY` only read it. */
let lastKey: [unknown, unknown, unknown, unknown, unknown, number] | null = null;
let lastValue: Record<string, number> = {};

export function riderYs(
  authored: ScenePart[],
  positions: TransformOverrides['positions'] | undefined,
  rotations: TransformOverrides['rotations'] | undefined,
  dims: TransformOverrides['dims'] | undefined,
  parentIds: Record<string, string>,
  roomHeight: number,
): Record<string, number> {
  if (
    lastKey !== null
    && lastKey[0] === authored && lastKey[1] === positions && lastKey[2] === rotations
    && lastKey[3] === dims && lastKey[4] === parentIds && lastKey[5] === roomHeight
  ) {
    return lastValue;
  }
  lastValue = deriveRiderYs(authored, { positions, rotations, dims }, parentIds, roomHeight);
  lastKey = [authored, positions, rotations, dims, parentIds, roomHeight];
  return lastValue;
}
