'use client';

// "Laying the new floor…" — said while a room finish is being prepared, and nothing
// otherwise. The renderer keeps the old finish on screen meanwhile (`useStagedFinish`
// in `components/three/RoomShell.tsx`), so this line is the only sign the press landed.
//
// The live region is ALWAYS mounted, empty when idle: a region inserted together with
// its text is announced unreliably, and one already in the tree is not. What goes INTO
// it waits `SAY_AFTER_MS`, the same beat the visible line fades in on
// (`.finish-status`), so a finish ready in a frame or two neither flashes a spinner nor
// makes a screen reader say "laying…" about something already done. And a wait that
// WAS announced is closed out loud ("Floor laid"): emptying the region says nothing,
// so a listener used to hear the start of every wait and never its end.

import { useEffect, useState } from 'react';
import { useFinishPending, type FinishChannel } from '@/lib/finish-loading';
import { Spinner } from '@/components/ui/primitives';

/** How long a wait must last before it is said at all. */
export const SAY_AFTER_MS = 250;
/** How long the closing words stay in the region before it empties again. */
const DONE_FOR_MS = 2000;

export function FinishStatus({ channel, saying, done }: { channel: FinishChannel; saying: string; done: string }) {
  const pending = useFinishPending(channel);
  const [phase, setPhase] = useState<'idle' | 'saying' | 'done'>('idle');
  useEffect(() => {
    if (pending) {
      const t = setTimeout(() => setPhase('saying'), SAY_AFTER_MS);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts a timer: the closing words are said, then cleared
    setPhase((p) => (p === 'saying' ? 'done' : 'idle'));
    const t = setTimeout(() => setPhase('idle'), DONE_FOR_MS);
    return () => clearTimeout(t);
  }, [pending]);
  return (
    <div role="status" aria-live="polite" style={{ minWidth: 0 }}>
      {pending && phase === 'saying' && (
        <span className="finish-status">
          <Spinner size={11} />
          {saying}
        </span>
      )}
      {!pending && phase === 'done' && <span className="sr-only">{done}</span>}
    </div>
  );
}
