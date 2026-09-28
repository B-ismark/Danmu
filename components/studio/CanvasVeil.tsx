'use client';

// What covers the room while it is not the room yet.
//
// Two waits, both of which used to show something wrong rather than nothing. Opening
// a room reads it out of IndexedDB in three parts, and until they are all in, the
// studio drew whatever the scene store still held: the room you were in before, or
// the starter room, which is someone else's furniture for a moment. And the first
// frame of the 3D view waits on shader compilation, a blank grey canvas on a slow
// device. The veil is opaque paper for both, so the wrong room is never on screen,
// and it says which wait it is.
//
// The words come in after a beat (`.veil__say`), so a load that takes a frame is a
// frame of paper and not a flash of text.

import { useParams } from 'next/navigation';
import { useScene } from '@/lib/scene-store';
import { Spinner } from '@/components/ui/primitives';

export function CanvasVeil({ building = false }: { /** the 3D view has not drawn its first frame */ building?: boolean }) {
  const { roomId } = useParams<{ roomId: string }>();
  const hydrated = useScene((s) => s.hydratedRoomId === roomId);
  const say = !hydrated ? 'Opening your room…' : building ? 'Building the 3D view…' : null;
  if (say === null) return null;
  return (
    <div className="veil veil--over" role="status">
      <span className="veil__say">
        <Spinner size={14} /> {say}
      </span>
    </div>
  );
}
