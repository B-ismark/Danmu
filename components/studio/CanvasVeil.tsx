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
// And a third, which is not a wait: the 3D view's first frame THREW, and R3F's loop
// does not schedule another after a throw, so the canvas would stay dark for good
// (`lib/first-frame.ts`). The veil stays up and says so, with the one way forward the
// app can offer — 'Smoother' (quality `low`) draws without the post-processing chain, which is where the
// crashes this has seen lived.
//
// The words come in after a beat (`.veil__say`), so a load that takes a frame is a
// frame of paper and not a flash of text.

import { useParams } from 'next/navigation';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { Spinner } from '@/components/ui/primitives';

export function CanvasVeil({
  building = false,
  failed = false,
}: {
  /** the 3D view has not drawn its first frame */
  building?: boolean;
  /** its first frame threw and it will not draw again without a reload */
  failed?: boolean;
}) {
  const { roomId } = useParams<{ roomId: string }>();
  const hydrated = useScene((s) => s.hydratedRoomId === roomId);
  const quality = useStudio((s) => s.quality);
  if (hydrated && failed) {
    const smooth = quality !== 'high';
    return (
      <div className="veil veil--over" role="alert">
        <div className="veil__fail">
          <span>The 3D view could not draw this room.</span>
          <span className="veil__hint">Your room is saved. {smooth ? 'Reloading usually clears it.' : 'The Smoother view draws it more simply and usually works.'}</span>
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            onClick={() => {
              if (!smooth) useStudio.getState().setQuality('low');
              window.location.reload();
            }}
          >
            {smooth ? 'Reload' : 'Switch to Smoother and reload'}
          </button>
        </div>
      </div>
    );
  }
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
