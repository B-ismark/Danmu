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

export const useDragLive = create<{ live: DragLiveInfo; setLive: (l: DragLiveInfo) => void }>(
  (set) => ({ live: null, setLive: (live) => set({ live }) }),
);
