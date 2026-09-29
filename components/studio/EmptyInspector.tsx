'use client';

// The right rail with nothing selected: a mark and one line saying how to fill it.
//
// It has been more than this and was cut back on purpose. A room-at-a-glance card and
// two whole-room shortcuts ("Restyle it", "Resize it") sat here for a release, and in
// review they were the problem: a panel people see before every pick was reading as a
// page of instructions. The left rail already holds both of those edits under their own
// names, so the shortcuts were a second way in, not a missing one. If anything is added
// back, it has to earn a place over the one line.
//
// Add is not offered here either. It is the pinned footer directly below.

import { useMediaQuery } from '@/lib/use-media-query';
import { Icon } from '@/components/ui/Icon';

export function EmptyInspector() {
  const touch = useMediaQuery('(pointer: coarse)');
  return (
    <div className="empty-inspector">
      <span className="empty-inspector__mark" aria-hidden="true">
        <Icon name="pointer" size={22} />
      </span>
      <p className="t-small empty-inspector__say">{touch ? 'Tap' : 'Click'} a piece to style it</p>
    </div>
  );
}
