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
  /** item-to-item alignment lines that magnetised this frame */
  snapLines?: SnapLine[];
} | null;

export const useDragLive = create<{ live: DragLiveInfo; setLive: (l: DragLiveInfo) => void }>(
  (set) => ({ live: null, setLive: (live) => set({ live }) }),
);
