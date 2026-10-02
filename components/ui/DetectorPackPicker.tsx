'use client';

// Basic or Full: the one choice a person makes about the furniture finder, asked the
// same way on the scan screen and in Settings so the two never describe it differently.
// Each option carries its size, read off the mirror (`detectorStatus`), because a
// download button without its size is the thing every offline-content guideline warns
// against.

import { Segmented } from './primitives';
import { megabytes } from '@/lib/model-cache';
import type { DetectorPack } from '@/lib/model-verify';
import type { DetectorStatus } from '@/lib/local-detect';

/** What each pack finds, in a person's words. Measured on a real four-photo room: the
 *  full pair found 13 of 19 pieces where the small model alone found about half that. */
export const PACK_SAYS: Record<DetectorPack, string> = {
  full: 'Finds the most furniture.',
  basic: 'Smaller download. Finds about half as much, so expect to draw more boxes by hand.',
};

export function DetectorPackPicker({
  value,
  onChange,
  sizes,
}: {
  value: DetectorPack;
  onChange: (p: DetectorPack) => void;
  /** The size of each whole pack, or null while it is being read. */
  sizes: Record<DetectorPack, DetectorStatus | null>;
}) {
  const label = (p: DetectorPack, name: string) => {
    const s = sizes[p];
    return s && s.size > 0 ? `${name} · ${megabytes(s.size)}` : name;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Segmented<DetectorPack>
        ariaLabel="Which furniture finder to keep"
        options={[
          { value: 'full', label: label('full', 'Full') },
          { value: 'basic', label: label('basic', 'Basic') },
        ]}
        value={value}
        onChange={onChange}
        stretch
      />
      <p className="t-small" style={{ margin: 0, color: 'var(--ink-2)' }}>
        {PACK_SAYS[value]}
      </p>
    </div>
  );
}

/** Whether the browser says this connection is metered: mobile data, or Data Saver
 *  on. Only Chromium reports either, so `false` means "not known to be", never
 *  "known not to be" — the card is careful to say "seem". */
export function onMeteredConnection(): boolean {
  try {
    const c = (navigator as unknown as { connection?: { type?: string; saveData?: boolean } }).connection;
    return !!c && (c.type === 'cellular' || c.saveData === true);
  } catch {
    return false;
  }
}
