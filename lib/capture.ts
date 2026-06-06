'use client';

import type { CaptureSlot } from './storage';

// 4 wall orientations only — floor + ceiling dropped (unnecessary for our pipeline).
export const CAPTURE_SLOTS: { id: CaptureSlot; label: string; angle: string; instruction: string }[] = [
  { id: 'n', label: 'North Wall', angle: '0°', instruction: 'Frame the north wall.' },
  { id: 'e', label: 'East Wall', angle: '90°', instruction: 'Frame the east wall.' },
  { id: 's', label: 'South Wall', angle: '180°', instruction: 'Frame the south wall.' },
  { id: 'w', label: 'West Wall', angle: '270°', instruction: 'Frame the west wall.' },
];

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

