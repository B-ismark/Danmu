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

/** The most pixels a saved picture may have. Safari refuses to encode a canvas over
 *  16,777,216 pixels (`toBlob` hands back null), and the snapshot is copied into a 2D
 *  canvas to be encoded — the same limit `sheetScale` respects for the floor plan. */
export const SNAPSHOT_MAX_PIXELS = 16_777_216;

/** The pixel ratio to render a snapshot at, for a canvas `cssW` × `cssH` CSS pixels
 *  whose renderer is currently at `current`. Normally never below `current` — a 4K
 *  screen already beats the target and keeps what it has. Two hard limits outrank
 *  that, and can take the ratio BELOW the screen's: what the GPU can allocate
 *  (`maxSide`), and what a browser will encode (`SNAPSHOT_MAX_PIXELS`) — an ultrawide
 *  at 2x is past the second, and saving a smaller picture beats saving none. Same
 *  framing either way: the CSS size, and so the camera's aspect, is untouched. */
export function snapshotPixelRatio(cssW: number, cssH: number, current: number, maxSide: number): number {
  const longCss = Math.max(cssW, cssH);
  if (!(longCss > 0) || !(current > 0)) return current > 0 ? current : 1;
  const want = Math.max(SNAPSHOT_LONG_EDGE / longCss, current);
  const bySide = maxSide > 0 ? maxSide / longCss : want;
  const byArea = Math.sqrt(SNAPSHOT_MAX_PIXELS / (cssW * Math.max(cssH, 1)));
  return Math.min(want, bySide, byArea);
}
