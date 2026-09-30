// Change which model a piece uses, keeping where it stands and its colour.
//
// It lived inside the Inspector as a closure over the panel's hooks, which made it
// reachable from exactly one button. The right-click menu offers the same verb now
// ("Change the model…", the Inspector's own words — one action, one name), so the
// swap is a store-level action both can call, and the modal that picks the new
// model is mounted once per room tab (`SwapModelHost`) rather than inside a panel
// that a narrow shell may not be showing.

import { useStudio } from './store';
import { useScene } from './scene-store';
import { currentRoomScene } from './room-scene';
import { findSupportDetailed, groundY, heightForNewCeiling } from './physics';
import { isWallMountedPart, type LibraryItem } from './scene-spec';

/** Replace piece `id`'s model with `item`, re-grounded for the new size and mount.
 *  `dimOverride` carries a size the picker's search words named — already clamped
 *  by `sizeFromQuery`, so it is the same number as `item.dimMM` by the time it gets
 *  here; it stays a parameter so a caller with a size in hand can say so rather than
 *  mutate the item on the way in. Stale transform overrides are dropped (an old
 *  scale would distort the new base size). */
export function swapPartModel(id: string, item: LibraryItem, dimOverride?: [number, number, number]) {
  const scene = currentRoomScene();
  const part = scene.find((p) => p.id === id);
  if (!part) return;
  const { room, updatePart } = useScene.getState();
  const s = useStudio.getState();
  // The rotation the swap LANDS on: `resetTransforms` below discards the overridden
  // rot, so the new model's footprint is measured at the authored one.
  const baseRot = useScene.getState().parts.find((p) => p.id === id)?.rot ?? 0;
  const dimMM = dimOverride ?? ([...item.dimMM] as [number, number, number]);
  const [x, y, z] = part.pos;
  const wallMounted = isWallMountedPart(item.category, item.shape);
  let ny = y;
  let support: { id: string; y: number } | null = null;
  if (wallMounted) {
    // `heightForNewCeiling` with the ceiling held still, NOT a hand-written clamp:
    // it returns `y` untouched for `floor` and `wall-floor` (a door stays on its
    // threshold) and clamps everything else into the wall.
    ny = heightForNewCeiling(
      item.category,
      item.shape,
      dimMM,
      groundY(item.category, item.shape, dimMM, room.height),
      room.height,
      room.height,
    );
  } else {
    // The NEW kind is the one asking: the snapshot still holds the old one under
    // this id, and a swap to a chair must not stand it on the table it tucks under.
    support = findSupportDetailed(scene, { id, category: item.category, shape: item.shape }, x, z, dimMM, baseRot);
    ny = support !== null && support.y > 0.3 ? support.y : 0;
  }
  s.resetTransforms(id); // drop stale rotate/scale overrides (and any rigid-parenting link)
  // The name too — leaving it stale is how a swapped-in door kept its old "tall
  // mirror" identity, so hover and the Catalog showed a conflicting label.
  updatePart(id, { name: item.label, category: item.category, shape: item.shape, dimMM, wallMounted });
  s.setPosition(id, [x, ny, z]);
  // Re-establish what `resetTransforms` just cleared — the swap moved the part, but
  // did not stop it resting on whatever it landed on.
  if (!wallMounted && support && support.y > 0.3) s.setParent(id, support.id);
  else s.clearParent(id);
}
