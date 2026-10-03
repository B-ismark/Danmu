'use client';

// Mounts the 3D room once per studio visit and lets the tabs borrow it. The
// mechanism and the reason are in `lib/room-host.ts`.

import dynamic from 'next/dynamic';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { roomHost } from '@/lib/room-host';

// `ssr: false`; no fallback, `CanvasVeil` covers the wait.
const Room = dynamic(() => import('./Room').then((m) => m.Room), { ssr: false, loading: () => null });

export function useRoomHost() {
  return useSyncExternalStore(roomHost.subscribe, roomHost.get, roomHost.get);
}

/** In the room layout: owns the node and, once the 3D tab has been opened, the canvas. */
export function RoomHostProvider() {
  const { host, wanted, attached } = useRoomHost();
  useEffect(() => {
    roomHost.mount(document);
    return () => roomHost.unmount();
  }, []);
  if (!host || !wanted) return null;
  return createPortal(<Room paused={!attached} onFirstFrame={roomHost.markDrawn} />, host);
}

/** On the 3D page: where the host is shown. */
export function RoomSlot() {
  const ref = useRef<HTMLDivElement>(null);
  const { host } = useRoomHost();
  useLayoutEffect(() => {
    if (!host || !ref.current) return;
    roomHost.attach(ref.current);
    return () => roomHost.detach(document);
  }, [host]);
  return <div ref={ref} style={{ position: 'absolute', inset: 0 }} />;
}
