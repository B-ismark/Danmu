// What a Library row is carrying while it is dragged, and the ghost that shows where it
// would land.
//
// A browser hands a drag's payload over only on DROP: during `dragover`,
// `dataTransfer.getData` returns '' by specification (only `types` is readable), so the
// 3D room cannot know WHAT is being dragged until the user lets go. The picker parks
// the item here on `dragstart` and clears it on `dragend` — which fires on the source
// row whether the drop landed, missed, or was cancelled with Esc — so the room can ask
// "what would this be, here?" on every frame of the drag.
//
// The ghost's pose is not computed here. It is `planPiece` (`lib/add-piece.ts`), the
// same function the drop runs, so the preview and the result are one answer. This
// module only holds the two facts a frame needs and tells whoever is drawing them.

import type { NewPiece, PiecePlan } from './add-piece';

export type Ghost = { item: NewPiece; plan: PiecePlan; at: { x: number; y: number } };

/** What a ghost SHOWS, as opposed to where it stands: which piece, and whether the drop
 *  would be refused. The 3D ghost re-renders only when this changes and writes every
 *  other move straight onto its transform — see `components/three/DropGhost.tsx`.
 *  Null when there is nothing to stand anywhere: no ghost, or a refusal with no pose. */
export type GhostLook = { item: NewPiece; refused: boolean };

export function ghostLook(g: Ghost | null): GhostLook | null {
  if (!g || !g.plan.pose) return null;
  return { item: g.item, refused: 'refused' in g.plan };
}

/** Whether two looks would draw the same thing. A pose-only move must answer true, or
 *  the ghost goes back to re-rendering its whole geometry on every pointer move. */
export function sameLook(a: GhostLook | null, b: GhostLook | null): boolean {
  if (a === null || b === null) return a === b;
  return a.item === b.item && a.refused === b.refused;
}

let carried: NewPiece | null = null;
let ghost: Ghost | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

export const dropCarry = {
  /** A Library row has started a drag. */
  start(item: NewPiece) {
    carried = item;
  },
  /** The drag is over, however it ended. Clears the ghost with it: a drag cancelled
   *  over the room must not leave a translucent sofa standing in it. */
  end() {
    carried = null;
    if (ghost) {
      ghost = null;
      tell();
    }
  },
  carried: () => carried,
  ghost: () => ghost,
  show(g: Ghost | null) {
    if (g === ghost) return;
    ghost = g;
    tell();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
