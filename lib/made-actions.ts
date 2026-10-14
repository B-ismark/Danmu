// Turning blocks into one piece, and one piece back into blocks — the two gestures the
// selection header offers. The arithmetic is `lib/made-piece.ts`'s; this file is the
// pure plan of what changes (`planPack` / `planTakeApart`, tested) plus the one place
// that writes it into the stores.
//
// Both are SWAPS: parts leave, parts arrive, in one `useScene` update, so history
// records a single step and Undo puts the room back exactly. Overrides the leaving parts
// carried are forgotten — their size and position now live inside the arriving part —
// and anything that was riding one of them is handed to the arriving piece rather than
// left pointing at an id that no longer exists.

import { v4 as uuid } from 'uuid';
import { announce } from './announce';
import { anchorFor } from './physics';
import { currentRoomScene } from './room-scene';
import { useScene } from './scene-store';
import { useStudio } from './store';
import { explodeMade, MAX_BLOCKS, packMade, type MadeSpec, type PackInput } from './made-piece';
import type { ScenePart } from './scene-spec';

/** Why a selection cannot become a piece, in a sentence for a person — or null when it
 *  can. Only things that stand on the floor pack: a made piece is floor-anchored, so a
 *  television on the wall or a light on the ceiling inside one would be pulled down. */
export function packRefusal(chosen: readonly ScenePart[]): string | null {
  if (chosen.length < 2 && !(chosen.length === 1 && chosen[0].shape === 'made')) {
    return 'Select two or more pieces to save them as one.';
  }
  const hung = chosen.find((p) => p.wallMounted || anchorFor(p.category, p.shape) !== 'floor');
  if (hung) return `“${hung.name}” hangs on a wall or the ceiling, so it cannot be part of a piece that stands.`;
  if (blockInputs(chosen).length > MAX_BLOCKS) return `A piece can hold up to ${MAX_BLOCKS} blocks.`;
  return null;
}

/** The blocks a selection is made of, as world parts. A made piece inside the selection
 *  is opened up into its own blocks, so saving a bench with a second bench beside it
 *  makes one flat piece rather than a piece inside a piece. A colour chosen for the
 *  whole made piece is the colour its blocks were drawn in, so they keep it. */
function blockInputs(chosen: readonly ScenePart[]): PackInput[] {
  return chosen.flatMap((p) => (p.shape === 'made' && p.made ? openUp(p, p.made) : [p]));
}

function openUp(p: ScenePart, spec: MadeSpec): ScenePart[] {
  const blocks = explodeMade(p, spec);
  return p.color ? blocks.map((b) => ({ ...b, color: p.color })) : blocks;
}

/** The piece a selection WOULD pack into, for the save dialog to describe before
 *  anything changes. Null when it cannot (`packRefusal` says why). */
export function packPreview(chosen: readonly ScenePart[]): MadeSpec | null {
  if (packRefusal(chosen)) return null;
  return packMade(blockInputs(chosen))?.spec ?? null;
}

export type SwapPlan = {
  /** Ids leaving the room. */
  remove: string[];
  /** Parts arriving, in the order they go in. */
  add: ScenePart[];
  /** Riding edges to write: a child that rode a leaving part, and what it rides now.
   *  `null` means it rides nothing — there is no single part under it any more. */
  reparent: Record<string, string | null>;
  /** What to select afterwards. */
  select: string[];
};

/** The swap that turns `chosen` (resolved — as the room stands) into one made piece.
 *  `parentIds` is the riding map, so what rode a block rides the piece. */
export function planPack(
  chosen: readonly ScenePart[],
  parentIds: Readonly<Record<string, string>>,
  name: string,
  modular: boolean,
  id = `made-${uuid().slice(0, 6)}`,
): SwapPlan | null {
  if (packRefusal(chosen)) return null;
  const packed = packMade(blockInputs(chosen), modular);
  if (!packed) return null;
  const piece: ScenePart = {
    id,
    // `other`, not the lead block's category: a made piece is whatever its maker built,
    // and borrowing `desk` would hand a bench of cabinets a desk's knee space.
    category: 'other',
    name,
    shape: 'made',
    pos: packed.pos,
    rot: packed.rot,
    dimMM: packed.spec.sizeMM,
    locked: false,
    made: packed.spec,
  };
  const remove = chosen.map((p) => p.id);
  const gone = new Set(remove);
  const reparent: Record<string, string | null> = {};
  for (const [child, parent] of Object.entries(parentIds)) {
    if (gone.has(parent) && !gone.has(child)) reparent[child] = id;
  }
  return { remove, add: [piece], reparent, select: [id] };
}

/** The swap that opens a made piece back into its blocks, at the size and place it is
 *  drawn. The blocks come back as one group, so a click still picks up the whole set and
 *  "Save as my piece" is one press away again. */
export function planTakeApart(
  piece: ScenePart,
  parentIds: Readonly<Record<string, string>>,
  groupId = `grp-${uuid().slice(0, 6)}`,
): SwapPlan | null {
  if (piece.shape !== 'made' || !piece.made) return null;
  const blocks = openUp(piece, piece.made).map((b) => ({ ...b, groupId }));
  const reparent: Record<string, string | null> = {};
  for (const [child, parent] of Object.entries(parentIds)) {
    if (parent === piece.id) reparent[child] = null;
  }
  return { remove: [piece.id], add: blocks, reparent, select: blocks.map((b) => b.id) };
}

/** Write a swap into the stores as one step. Arriving parts take the place in the list
 *  of the first part leaving, so the rail's Catalog does not jump the new piece to the
 *  bottom. */
export function applySwap(plan: SwapPlan): void {
  const before = useScene.getState().parts;
  const gone = new Set(plan.remove);
  const at = before.findIndex((p) => gone.has(p.id));
  const kept = before.filter((p) => !gone.has(p.id));
  const insertAt = at < 0 ? kept.length : before.slice(0, at).filter((p) => !gone.has(p.id)).length;
  useScene.setState({ parts: [...kept.slice(0, insertAt), ...plan.add, ...kept.slice(insertAt)] });

  const st = useStudio.getState();
  for (const id of plan.remove) st.resetTransforms(id);
  const parentIds = { ...useStudio.getState().parentIds };
  for (const [child, parent] of Object.entries(plan.reparent)) {
    if (parent) parentIds[child] = parent;
    else delete parentIds[child];
  }
  st.setParentIds(parentIds);
  st.setSelection(plan.select, plan.select[0] ?? null);
}

/** Pack the pieces with these ids into one made piece, standing where they stood.
 *  Returns the new piece, or a refusal for a person. */
export function packIntoPiece(ids: readonly string[], name: string, modular: boolean): ScenePart | { refused: string } {
  const live = currentRoomScene();
  const want = new Set(ids);
  const chosen = live.filter((p) => want.has(p.id));
  const refused = packRefusal(chosen);
  if (refused) return { refused };
  const plan = planPack(chosen, useStudio.getState().parentIds, name, modular);
  if (!plan) return { refused: 'Those pieces could not be packed.' };
  applySwap(plan);
  announce(`${chosen.length} pieces are now “${name}”.`);
  return plan.add[0];
}

/** Open the made piece with this id back into its blocks. */
export function takeApart(id: string): void {
  const piece = currentRoomScene().find((p) => p.id === id);
  if (!piece) return;
  const plan = planTakeApart(piece, useStudio.getState().parentIds);
  if (!plan) return;
  applySwap(plan);
  announce(`“${piece.name}” is ${plan.add.length} blocks again.`);
}
