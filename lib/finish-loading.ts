// Which room finish is being prepared right now, so the control that asked for it
// can say so.
//
// Generating a finish's textures is plain JavaScript on the main thread — a few
// hundred milliseconds for brick, tile or stone, the first time. Done in the render
// that asked for it, the page simply froze: the press did not show as pressed, and the
// room did not change, until it was all over. So the renderer (`useStagedMaps` in
// `components/three/RoomShell.tsx`) keeps the old finish on screen, marks the new one
// pending HERE, lets a frame paint, generates, and clears it. The editors read this to
// show a spinner and a sentence while the floor or the walls are being laid.
//
// A tiny external store rather than zustand: it is two strings, nothing persists, and
// both readers are hooks.

import { useSyncExternalStore } from 'react';

export type FinishChannel = 'floor' | 'wall';

const pending: Record<FinishChannel, string | null> = { floor: null, wall: null };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Mark `key` as being prepared on `channel`, replacing whatever was. */
export function markPending(channel: FinishChannel, key: string): void {
  if (pending[channel] === key) return;
  pending[channel] = key;
  emit();
}

/** Clear the channel — but only if it is still `key` that is pending. A slow finish
 *  that completes after a newer choice was made must not clear the newer one's
 *  spinner. */
export function clearPending(channel: FinishChannel, key: string): void {
  if (pending[channel] !== key) return;
  pending[channel] = null;
  emit();
}

export function pendingFinish(channel: FinishChannel): string | null {
  return pending[channel];
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while a finish on this channel is being prepared. */
export function useFinishPending(channel: FinishChannel): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending[channel] !== null,
    () => false,
  );
}
