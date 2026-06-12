'use client';

// One-shot scene snapshot channel. The TopBar button bumps the token; the
// SnapshotOnDemand component inside the canvas watches it, captures the next
// frame, and downloads it as a PNG. Deterministic, free, dimension-true —
// this replaced the AI photoreal render pipeline.

import { create } from 'zustand';

type SnapshotState = {
  token: number;
  /** non-null while the last capture is being encoded */
  request: () => void;
};

export const useSnapshot = create<SnapshotState>((set) => ({
  token: 0,
  request: () => set((s) => ({ token: s.token + 1 })),
}));

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
