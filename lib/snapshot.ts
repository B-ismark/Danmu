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
   *  filename. */
  name: string;
  request: (name?: string) => void;
};

export const useSnapshot = create<SnapshotState>((set) => ({
  token: 0,
  name: '',
  request: (name) => set((s) => ({ token: s.token + 1, name: name ?? s.name })),
}));

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
