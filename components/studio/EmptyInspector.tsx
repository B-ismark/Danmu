'use client';

// The right rail with nothing selected: what to do next, and the two verbs that
// do not need a selection, directly under it.
//
// It has been more than this and was cut back on purpose. A room-at-a-glance card and
// two whole-room shortcuts ("Restyle it", "Resize it") sat here for a release, and in
// review they were the problem: a panel people see before every pick was reading as a
// page of instructions. The left rail already holds both of those edits under their own
// names, so the shortcuts were a second way in, not a missing one.
//
// What came back, and why it earns the place: Add and Start over. They used to be the
// pinned footer at the very bottom of the column, a screen's height from the prompt
// that names them — "or press Add" pointed at a button the eye had to go looking for.
// Here they sit under the sentence that mentions them, which is where a person reading
// it already is, and the footer steps aside while nothing is selected (`RailFooter`).
// Start over only when there is something to start over from, as before.
//
// A phone's Add is its toolbar's primary action, so the sheet does not repeat it.

import { useMediaQuery } from '@/lib/use-media-query';
import { Icon } from '@/components/ui/Icon';
import { usePhoneStudio } from './NarrowViewportBanner';
import { AddPiecesButton } from './CatalogPanel';
import { StartOverButton, useCanStartOver } from './StartOverButton';

export function EmptyInspector() {
  const touch = useMediaQuery('(pointer: coarse)');
  const phone = usePhoneStudio();
  const canStartOver = useCanStartOver();
  return (
    <div className="empty-inspector">
      <h2 className="empty-inspector__eyebrow">Details</h2>
      <div className="empty-inspector__body">
        <span className="empty-inspector__mark" aria-hidden="true">
          <Icon name="cube" size={22} />
        </span>
        <p className="empty-inspector__say">{touch ? 'Tap' : 'Click'} a piece to style it</p>
        <p className="t-small empty-inspector__hint">Or press Add to bring something in from the Library.</p>
      </div>
      {(!phone || canStartOver) && (
        <div className="empty-inspector__actions">
          {!phone && <AddPiecesButton wide />}
          {canStartOver && <StartOverButton />}
        </div>
      )}
    </div>
  );
}
