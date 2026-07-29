'use client';

import type { CaptureSlot } from './storage';

// 4 walls only — floor + ceiling dropped (unnecessary for our pipeline).
//
// The ids stay n/e/s/w: they are the storage + geometry contract (CaptureSlot in
// lib/storage.ts, the wall order in lib/photo-geometry.ts, the slot tabs on the
// detect screen). The *labels* are deliberately not compass bearings any more.
// Nobody standing in their own living room knows which wall faces north; they
// know "the one with the window". The pipeline only needs four consecutive walls
// in clockwise order, so the absolute bearing was never information — it was a
// question the user couldn't answer.
export const CAPTURE_SLOTS: { id: CaptureSlot; label: string; turn: string; instruction: string }[] = [
  { id: 'n', label: 'Wall 1', turn: 'start anywhere', instruction: 'Any wall you like — frame it corner to corner.' },
  { id: 'e', label: 'Wall 2', turn: 'turn right', instruction: 'Turn a quarter-turn right and frame the next wall.' },
  { id: 's', label: 'Wall 3', turn: 'opposite the first', instruction: 'Keep turning — this is the wall facing Wall 1.' },
  { id: 'w', label: 'Wall 4', turn: 'turn right again', instruction: 'One last quarter-turn right for the final wall.' },
];

/** The shooting method the geometry step assumes (room centre, ~chest height,
 *  clockwise). It used to live only inside the detection prompt, so the user was
 *  never told how to take photos the pipeline could actually use. */
export const CAPTURE_METHOD =
  'Stand in the middle of the room, hold your phone at chest height, and turn right after each shot.';

export async function startCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    audio: false,
  });
}

export async function snapToBlob(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
}

