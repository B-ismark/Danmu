'use client';

// "Laying the new floor…" — said while a room finish is being prepared, and nothing
// otherwise. The renderer keeps the old finish on screen meanwhile (`useStagedMaps` in
// `components/three/RoomShell.tsx`), so this line is the only sign the press landed.
//
// The live region is ALWAYS mounted, empty when idle: a region inserted together with
// its text is announced unreliably, and one already in the tree is not. The visible
// line fades in after `--dur-quick` (`.finish-status`), so a finish that is ready in a
// frame or two never flashes a spinner at all.

import { useFinishPending, type FinishChannel } from '@/lib/finish-loading';
import { Spinner } from '@/components/ui/primitives';

export function FinishStatus({ channel, saying }: { channel: FinishChannel; saying: string }) {
  const pending = useFinishPending(channel);
  return (
    <div role="status" aria-live="polite" style={{ minWidth: 0 }}>
      {pending && (
        <span className="finish-status">
          <Spinner size={11} />
          {saying}
        </span>
      )}
    </div>
  );
}
