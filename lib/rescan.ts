// A fresh scan replaces the room's arrangement, and keeps the old one as a layout.
//
// **Why a scan has to do anything here at all.** `RoomSync` builds a room from its
// detections only when it has no saved scene, and a scene is saved the moment anything
// in the studio is added, deleted or reshaped. So on any room someone had touched, a
// new scan was written to `detectedObjects` and never seen: the studio kept loading the
// old snapshot, and **Re-scan** — which had also been answering from the cached list
// rather than looking at the photos again — was a button that did nothing twice over.
//
// **Why the old arrangement is kept rather than merged.** A fresh scan mints new ids,
// so the old transforms point at pieces that no longer exist, and a library piece the
// user added has no row in the new list to survive through. Merging would mean
// guessing which new sofa is the old one. Instead the whole arrangement — both layers,
// exactly as `LayoutsPanel`'s own **Save current** stores them — goes into the room's
// layouts under a name that says where it came from, so one press in the studio puts it
// back. Nothing the user made is deleted; it is moved somewhere they can find it.
//
// **Write order is the safety.** Backup first, then the new detections, then the drop.
// There is no transaction across keys, so an interruption after the backup leaves a
// spare layout, and one before the drop leaves the old behaviour (the old snapshot
// still wins) — never a room whose arrangement is gone with no copy.
//
// **An edited list is the other half, and it is handled the opposite way.** Arriving
// on the scan screen with a list the room was already built from, the person ticks,
// unticks, deletes or re-words rows — the same pieces, not new ones — so
// `adoptEditedList` edits the saved arrangement piece by piece instead of replacing
// it. Same reason it has to act at all: the saved scene overrules the list.

import { newLayout, roomStore, type LayoutVariant, type RoomData, type Transforms } from './storage';
import { buildSceneFromRoom, type ScenePart } from './scene-spec';
import { detectionPartIds, fromRecord, type SavedDetection } from './detection-record';

export const BEFORE_RESCAN = 'Before re-scan';

const EMPTY: Transforms = { positions: {}, rotations: {}, dims: {} };

function hasEdits(t: Transforms | undefined): boolean {
  if (!t) return false;
  return [t.positions, t.rotations, t.dims, t.hidden, t.pinned, t.parentIds].some(
    (m) => m && Object.keys(m).length > 0,
  );
}

/** Save `detectedObjects` from a scan that actually ran, and make the studio show it.
 *  Returns the layout the previous arrangement was kept as, or null when there was
 *  nothing to keep (a first scan of an untouched room). */
export async function adoptFreshScan(
  room: RoomData,
  detectedObjects: NonNullable<RoomData['detectedObjects']>,
  now: number = Date.now(),
): Promise<LayoutVariant | null> {
  const [savedScene, transforms] = await Promise.all([
    roomStore.loadSceneParts<unknown[]>(room.id),
    roomStore.loadTransforms(room.id),
  ]);
  // A room with detections and moves but no snapshot is still an arrangement: it
  // is the old detections at the user's transforms, rebuilt the way `RoomSync` would.
  const hadDetections = (room.detectedObjects?.length ?? 0) > 0;
  const something = savedScene !== undefined || hasEdits(transforms) || hadDetections;
  let kept: LayoutVariant | null = null;
  if (something) {
    kept = newLayout(BEFORE_RESCAN, savedScene ?? buildSceneFromRoom(room), transforms ?? EMPTY, { now });
    await roomStore.saveLayout(room.id, kept);
  }
  // Into the room as stored, not over it with the copy this was handed: a name or a
  // size written since that copy was read would otherwise be put back.
  if (!(await roomStore.editRoom(room.id, (r) => ({ ...r, detectedObjects })))) return null;
  await roomStore.forgetArrangement(room.id);
  return kept;
}

/** What in a row decides the piece it builds. Not `id` (its index, rewritten on every
 *  save), `conf` or `source` (how it was found, not what it is), and not `color`: the
 *  review screen samples one from the photo for any row that lacks it, so counting
 *  that would rebuild a piece the user had recoloured just for having been looked at.
 *
 *  Read through the codec rather than off the record, because the screen re-saves
 *  every row through `toRecord` and that is not the identity on an old one: a row
 *  saved before labels carried their wall, or before a missing category meant
 *  `other`, comes back written differently and meaning the same. Compared raw, every
 *  row of such a room read as changed the first time anyone pressed Continue, and
 *  every piece was rebuilt for having been looked at. */
function buildsAs(r: SavedDetection): string {
  const d = fromRecord(r);
  return JSON.stringify([d.label, d.slot, d.category, d.box, d.dimMM ?? null, d.position ?? null, d.yaw ?? null, d.shape ?? null]);
}

export type ListEdit = {
  parts: ScenePart[];
  /** Pieces that were in the room and are not any more. */
  removed: number;
  /** Pieces that were not in the room and are now. */
  added: number;
  /** Pieces rebuilt in place because their row changed — a new word, a new box. */
  updated: number;
};

/** Carry the review screen's edits to a list that was ALREADY in the room into the
 *  room's saved arrangement, piece by piece. Null when no piece changes.
 *
 *  **Why not simply rebuild.** The saved scene is what the studio loads, over the
 *  list, forever — so a tick changed on a room anyone had arranged was saved and
 *  never seen, and **Continue with N pieces** was a count of nothing. But the scene
 *  is also everything the person made in the studio: pieces from the library, a sofa
 *  recoloured, a detected piece deleted. Rebuilding would trade one unticked bed for
 *  all of that. So only the pieces whose ROWS changed move: a row unticked or deleted
 *  takes its piece out, a row newly kept puts one in, and a row that changed while
 *  kept is rebuilt from its new details. Everything else is left exactly as it was,
 *  including a detected piece the studio deleted — whether or not its row changed.
 *  Re-wording a row is about what the piece is called, and deleting the piece was
 *  about whether it is in the room; the first used to undo the second, so tidying
 *  the names on the list put back a chair the person had taken out.
 *
 *  A piece is found by the id its row builds as (`detectionPartIds`), and a new one is
 *  built by `buildSceneFromRoom` against the whole new list, so it is the piece the
 *  studio would have built. Transforms are keyed by the same ids and are not touched:
 *  a piece ticked back in later lands where the person last put it.
 *
 *  A rebuilt piece takes the place of the one it replaces, and keeps what the studio
 *  did to it (`carryStudioEdits`). It used to be taken out and appended, rebuilt bare,
 *  so re-wording one kept row on the scan screen moved it to the bottom of the list
 *  and quietly undid its recolour and the set it was merged into. */
export function applyListEdits(parts: ScenePart[], room: RoomData, next: SavedDetection[]): ListEdit | null {
  const before = room.detectedObjects ?? [];
  const was = new Map(detectionPartIds(before).map((id, i) => [id, before[i]]));
  const now = new Map(detectionPartIds(next).map((id, i) => [id, next[i]]));
  const out = new Set<string>();
  const into = new Set<string>();
  for (const [id, r] of was) {
    const n = now.get(id);
    if (r.locked && (!n?.locked || buildsAs(n) !== buildsAs(r))) out.add(id);
  }
  const present = new Set(parts.map((p) => p.id));
  for (const [id, n] of now) {
    const r = was.get(id);
    // Newly kept goes in; kept and changed is rebuilt only if it is still there.
    if (n.locked && (!r?.locked || (buildsAs(r) !== buildsAs(n) && present.has(id)))) into.add(id);
  }
  if (out.size === 0 && into.size === 0) return null;
  // Filtered to the rows going in, which is also what keeps an emptied list — which
  // builds the starter room — from putting starter furniture into anybody's room.
  const built = buildSceneFromRoom({ ...room, detectedObjects: next }).filter((p) => into.has(p.id));
  const updated = built.filter((p) => present.has(p.id) && out.has(p.id)).length;
  const removed = [...out].filter((id) => present.has(id) && !into.has(id)).length;
  const added = built.length - updated;
  // A row unticked whose piece the studio had already deleted changes no piece.
  if (removed + added + updated === 0) return null;
  const rebuilt = new Map(built.map((p) => [p.id, p]));
  const kept = parts.flatMap((p) => {
    const fresh = rebuilt.get(p.id);
    if (fresh) return [carryStudioEdits(p, fresh, was.get(p.id), now.get(p.id))];
    return out.has(p.id) ? [] : [p];
  });
  return {
    parts: [...kept, ...built.filter((p) => !present.has(p.id))],
    removed,
    added,
    updated,
  };
}

/** `fresh`, rebuilt from its row's new details, with what the studio had done to
 *  `old`, the piece it replaces. `was` and `now` are the row before and after.
 *
 *  The row decides what the piece IS — its model, its size, where the photo put it —
 *  and the studio decides how it looks and what it belongs to, so those carry:
 *
 *  · **Colour**, when the studio changed it. The build copies the row's photo colour
 *    onto the piece, so a piece whose colour is still the row's has nobody's choice
 *    in it, and follows the row. One that differs was recoloured, or reset, and that
 *    stands.
 *  · **Merged set**, always: it is not something a row has an opinion on.
 *  · **Decor, light and name**, only while it is the same model. What sits on a
 *    desk and a lamp's brightness belong to that model, and a studio name survives a
 *    rebuild only while the row's words have not changed as well — the scan screen's
 *    new word is the newer name. A name carried across a change of model is how a bed
 *    came to be called Fridge: the studio's model swap names the piece, and a rebuild
 *    that put the row's own model back under the swap's name would repeat it. */
function carryStudioEdits(
  old: ScenePart,
  fresh: ScenePart,
  was: SavedDetection | undefined,
  now: SavedDetection | undefined,
): ScenePart {
  const out: ScenePart = { ...fresh };
  if (old.color !== was?.color) out.color = old.color;
  if (old.groupId !== undefined) out.groupId = old.groupId;
  if (old.shape === fresh.shape) {
    if (old.decor !== undefined) out.decor = old.decor;
    if (old.light !== undefined) out.light = old.light;
    if (was && now && fromRecord(was).label === fromRecord(now).label) out.name = old.name;
  }
  return out;
}

/** Save an edited list the room was already built from, and make the studio show the
 *  edit. The counterpart of `adoptFreshScan` for the cached list: that one replaces
 *  the arrangement because a new scan mints new pieces; this one keeps it, because an
 *  edited list is the same pieces with some ticked differently.
 *
 *  A room with no saved scene needs nothing but the save — it is built from the list
 *  on every load. Write order: the list first, then the scene, so an interruption
 *  between leaves the old scene overruling the new ticks, which is where this started,
 *  never a scene whose rows are missing. */
export async function adoptEditedList(room: RoomData, detectedObjects: SavedDetection[]): Promise<ListEdit | null> {
  const saved = await roomStore.loadSceneParts<ScenePart[]>(room.id);
  const edit = saved ? applyListEdits(saved, room, detectedObjects) : null;
  // `editRoom`, for the reason `adoptFreshScan` gives. And a room deleted meanwhile
  // gets no scene written for it, which would be keys belonging to nothing.
  if (!(await roomStore.editRoom(room.id, (r) => ({ ...r, detectedObjects })))) return null;
  if (edit) await roomStore.saveSceneParts(room.id, edit.parts);
  return edit;
}

/** The toast's sentence for an edit, counted rather than described: "1 piece taken out
 *  and 2 added." The rest of the room is the point, so it is said last. */
export function listEditSentence(edit: Pick<ListEdit, 'removed' | 'added' | 'updated'>): string {
  const bits = (
    [
      [edit.removed, 'taken out'],
      [edit.added, 'added'],
      // Not "updated to its new details": "3 updated to its new details" is the
      // sentence that made, and the count already says which.
      [edit.updated, 'updated'],
    ] as const
  ).filter(([n]) => n > 0);
  const said = bits.map(([n, verb], i) => (i === 0 ? `${n} ${n === 1 ? 'piece' : 'pieces'} ${verb}` : `${n} ${verb}`));
  const list = said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}` : said[0];
  return `${list}. Everything else is as you left it.`;
}
