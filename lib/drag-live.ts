'use client';

// Live drag channel — high-frequency state for the part currently being moved.
// Kept OUT of useStudio so per-frame updates only re-render the few light
// consumers (measurement guides, validity tint), never the whole part tree.

import { create } from 'zustand';
import type { SnapLine } from './item-snap';

export type DragLiveInfo = {
  partId: string;
  /** resolved scene position (after containment + gravity) */
  x: number;
  y: number;
  z: number;
  rot: number;
  dimMM: [number, number, number];
  /** floor-standing (true) vs wall/ceiling-mounted */
  floor: boolean;
  /** false when the current spot collides or leaves the room */
  valid: boolean;
  /** When the piece under the hand fits but its COMPANY does not, the name of the
   *  member that ran out of room. The thing that refused is not the thing being
   *  dragged, and a readout that says only `blocked` while the piece it labels has
   *  clear floor all round it is worse than saying nothing. Left undefined when
   *  the dragged piece is itself the problem — `blocked` is the honest word then.
   *  The 2D plan says the same sentence through `announce` + a red outline. */
  blockedBy?: string;
  /** Every piece to outline red this frame — the dragged one and whichever members
   *  ran out of room.
   *
   *  Separate from `blockedBy` because they answer different questions: one is the
   *  sentence (one name, or nobody finishes it), this is the drawing (all of them,
   *  or the user fixes one piece at a time and the refusal appears to wander). Read
   *  with a per-part selector so only the pieces whose state actually CHANGES
   *  re-render — the whole point of this channel living outside `useStudio`. */
  blockedIds?: string[];
  /** item-to-item alignment lines that magnetised this frame */
  snapLines?: SnapLine[];
} | null;

// A refusal that OUTLIVES the gesture is not this channel's business, even though it
// travels on it: what counts as one, which pieces it names and how long it stays up all
// live in lib/refusal.ts. This file only carries it.

export const useDragLive = create<{
  live: DragLiveInfo;
  setLive: (l: DragLiveInfo) => void;
  /** Pieces to outline red for a gesture that is NOT a drag — a turn from the context
   *  menu or an accelerator, which has no `live` frame to ride on and no pointer under
   *  which the user could have watched the refusal happen.
   *
   *  It is here, and not in either tab's own state, because it is the one channel both
   *  tabs already read. `PlanView` holds its own `blockedIds` in component state and the
   *  3D `Draggable` reads `live.blockedIds`; `spinSelection` is mounted on BOTH and can
   *  reach neither, so the same wardrobe in the same corner outlined red when refused by
   *  Shift+Arrow and did nothing at all when refused by the context menu. Same tab, same
   *  piece, same outcome, two answers — which is the thing `spinSelection`'s own docblock
   *  says a gesture reached four ways must never be. It was said in the live region, so
   *  a screen-reader user heard it and everyone else got silence.
   *
   *  Kept flat rather than folded into `live` so a per-part selector still re-renders
   *  only the pieces whose state changed, which is the whole reason this store exists
   *  outside `useStudio`. */
  refusedIds: string[];
  setRefusedIds: (ids: string[]) => void;
}>((set) => ({
  live: null,
  setLive: (live) => set({ live }),
  refusedIds: [],
  setRefusedIds: (refusedIds) => set({ refusedIds }),
}));
