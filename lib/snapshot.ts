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

/** Long edge of a saved 3D picture, in pixels. The live canvas is sized for the
 *  screen and throttled for speed — `AdaptiveDpr` drops it while the camera moves,
 *  `PerformanceMonitor` pins it to 1x on a struggling GPU — and the picture used to
 *  be a copy of whatever that buffer held, so a laptop saved a ~1400 px frame and a
 *  press just after an orbit could save a regressed one. A file someone shows a
 *  partner full-screen or prints wants its own size, chosen here, not the screen's. */
export const SNAPSHOT_LONG_EDGE = 3200;

/** The pixel ratio to render a snapshot at, for a canvas `cssW` × `cssH` CSS pixels
 *  whose renderer is currently at `current`. Never below `current` — a 4K screen
 *  already beats the target and keeps what it has — and never past what the GPU can
 *  allocate (`maxSide`, from `gl.capabilities.maxTextureSize`), since every buffer
 *  the composer owns is resized to match. Same framing either way: the CSS size,
 *  and so the camera's aspect, is untouched. */
export function snapshotPixelRatio(cssW: number, cssH: number, current: number, maxSide: number): number {
  const longCss = Math.max(cssW, cssH);
  if (!(longCss > 0) || !(current > 0)) return current > 0 ? current : 1;
  const want = SNAPSHOT_LONG_EDGE / longCss;
  const cap = maxSide / longCss;
  return Math.min(Math.max(want, current), Math.max(cap, 0) || current);
}
