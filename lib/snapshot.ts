'use client';

// One-shot scene snapshot channel. The Export menu's 3D-view item bumps the
// token; the capture component inside the canvas watches it, captures the next
// frame, and downloads it as a PNG. Deterministic, free, dimension-true —
// this replaced the AI photoreal render pipeline.

import { create } from 'zustand';

type SnapshotState = {
  token: number;
  /** The room's name, handed over by the menu that had it loaded. The capture
   *  runs deep inside the R3F canvas, where no component holds the name and
   *  next/navigation hooks do not reach — so it rides the same request that
   *  bumps the token. Empty means an unnamed room, which keeps the old fixed
   *  filename.
   *
   *  Required, not optional. It was `name?`, defaulting to the name already in the
   *  store — a branch no caller could reach, since the one caller always resolves a
   *  name first. Dead plumbing wearing a decision's name reads as a decision, and
   *  the reachable half of that default is worse than nothing: it would carry the
   *  PREVIOUS room's name onto this room's download. */
  name: string;
  request: (name: string) => void;
};

export const useSnapshot = create<SnapshotState>((set) => ({
  token: 0,
  name: '',
  request: (name) => set((s) => ({ token: s.token + 1, name })),
}));

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
