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

import { roomStore, type LayoutVariant, type RoomData, type Transforms } from './storage';
import { buildSceneFromRoom } from './scene-spec';

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
    kept = {
      id: `l-${now.toString(36)}`,
      name: BEFORE_RESCAN,
      createdAt: now,
      parts: savedScene ?? buildSceneFromRoom(room),
      transforms: transforms ?? EMPTY,
    };
    await roomStore.saveLayout(room.id, kept);
  }
  await roomStore.saveRoom({ ...room, detectedObjects });
  await roomStore.forgetArrangement(room.id);
  return kept;
}
