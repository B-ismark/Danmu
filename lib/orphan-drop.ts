// What happens to the pieces standing on something that is deleted.
//
// Reported 2026-10-01: *"an item on top of another remains floating even after
// deleting the item it was initially on. It seems the app detects it but does
// nothing about it."* Both halves were true. `removeParts` filtered the doomed pieces
// out of the scene and left everything else exactly where it stood, so a lamp on a
// deleted desk kept the desk's height with nothing under it — and the Inspector's
// `restingOn` banner said "Floating", because it asks the state question correctly.
// A delete is a change to the room, and gravity is part of the room.
//
// So each piece RESTING on a doomed one — asked of the scene as it stands, the same
// question the banner asks, not of a remembered link that may be stale — drops onto
// the highest top under it that is not being deleted, or the floor. Only the pieces
// directly on a doomed one: a book on that lamp rides the lamp down, because
// `deriveRiderYs` carries a rider when its support's top moves.
//
// Pure, so the delete path can apply it and its Undo can put it back exactly.

import { highestSurfaceUnder, isFloorStanding, restingOn, verticalExtent } from './physics';
import type { ScenePart } from './scene-spec';

export type OrphanDrop = {
  id: string;
  /** Where it stood, for Undo. */
  from: [number, number, number];
  to: [number, number, number];
  /** What it lands on, or null for the floor. */
  supportId: string | null;
};

/** `scene` is every piece at its EFFECTIVE transform, the doomed ones included. */
export function orphanDrops(scene: ScenePart[], doomed: ReadonlySet<string>): OrphanDrop[] {
  // A shortcut, not a rule: with nothing doomed the loop below finds nothing either.
  if (doomed.size === 0) return [];
  const kept = scene.filter((p) => !doomed.has(p.id));
  const out: OrphanDrop[] = [];
  for (const p of kept) {
    // `pos[1]` is the underside only for a floor-standing piece (`verticalExtent`); a
    // wall fixture's is its centre, and nothing here is entitled to drop one.
    if (p.pos[1] <= 0 || !isFloorStanding(p.category, p.shape)) continue;
    const on = restingOn(scene, p.id, p.pos, p.rot, p.dimMM, p.category, p.shape, p.circle);
    // The floor answers with a null id, so this is also the "it rests on a part" test.
    if (!on?.id || !doomed.has(on.id)) continue;
    // Asked of what is LEFT, and only below where it stood: whatever it was beside on
    // the desk is not something it falls up onto, and a book on this piece is not
    // something it lands on.
    const bottom = verticalExtent(p.category, p.shape, p.dimMM, p.pos[1])[0];
    const under = highestSurfaceUnder(kept, p.id, p.pos[0], p.pos[2], p.dimMM, p.rot, p.circle, p.shape, bottom);
    const y = under ? under.y : 0;
    out.push({ id: p.id, from: [...p.pos], to: [p.pos[0], y, p.pos[2]], supportId: under ? under.id : null });
  }
  return out;
}

/** A drop and what it overwrote — enough for the delete's Undo to put the piece back.
 *
 *  The previous values are the OVERRIDE layer's (`useStudio.positions`, `parentIds`),
 *  not the piece's resolved transform: a piece that had never been moved had no
 *  override, and Undo has to give it none again rather than pin it at the height it
 *  happened to stand. `undefined` is therefore a stated answer, "there was nothing". */
export type DropRecord = {
  drop: OrphanDrop;
  prevPos: [number, number, number] | undefined;
  prevParent: string | undefined;
};

/** Whether applying `drop` writes a position at all. A piece re-seated on a kept top
 *  exactly as high as the deleted one only changes its link, and "a transform write is
 *  never free" — an override pins the piece against a re-detect and is persisted. */
export function dropMoves(drop: OrphanDrop): boolean {
  return drop.to[1] !== drop.from[1];
}

/** Read what each drop is about to overwrite. Call BEFORE applying them. */
export function recordDrops(
  drops: OrphanDrop[],
  positions: Readonly<Record<string, [number, number, number]>>,
  parentIds: Readonly<Record<string, string>>,
): DropRecord[] {
  return drops.map((drop) => ({ drop, prevPos: positions[drop.id], prevParent: parentIds[drop.id] }));
}

const same3 = (a: readonly number[] | undefined, b: readonly number[]) =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i]);

/** Put the overrides back as `recordDrops` found them — for each piece only if
 *  nothing has written that part of it since. Undo of a delete can arrive seconds
 *  later, after the lamp has been dragged somewhere on purpose, and the delete's Undo
 *  is not entitled to undo THAT. Returns the same objects when nothing needed
 *  restoring. */
export function undoDrops(
  records: DropRecord[],
  positions: Record<string, [number, number, number]>,
  parentIds: Record<string, string>,
): { positions: Record<string, [number, number, number]>; parentIds: Record<string, string> } {
  let nextPos = positions;
  let nextParents = parentIds;
  for (const { drop, prevPos, prevParent } of records) {
    if (dropMoves(drop) && same3(nextPos[drop.id], drop.to)) {
      if (nextPos === positions) nextPos = { ...positions };
      if (prevPos) nextPos[drop.id] = prevPos;
      else delete nextPos[drop.id];
    }
    // What `landOn` left in the link map: the support it landed on, or no entry.
    if (nextParents[drop.id] === (drop.supportId ?? undefined) && nextParents[drop.id] !== prevParent) {
      if (nextParents === parentIds) nextParents = { ...parentIds };
      if (prevParent) nextParents[drop.id] = prevParent;
      else delete nextParents[drop.id];
    }
  }
  return { positions: nextPos, parentIds: nextParents };
}
