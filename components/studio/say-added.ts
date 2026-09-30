// What a person is told about an add, on every surface that adds.
//
// `addPieceToRoom` (`lib/add-piece.ts`) decides; this says. The split is the one
// `lib/` keeps everywhere — a pure module cannot reach the toast host — and it is ONE
// function rather than three copies because the three add triggers (the Library
// click, the plan's drop, the 3D drop) already proved once that the copy missing a
// line is the one nobody notices: § H.3 finding 6 was a 3D drop that said nothing.
// A refusal that only one tab shows would be the same defect with a worse outcome,
// because the piece is not there at all and nothing says why.

import type { AddOutcome } from '@/lib/add-piece';
import { toast } from '@/components/ui/StorageToast';

/** Show a refusal or an own-size note. Returns the new piece's id, or null when it
 *  was refused. The toast host is a live region, so this is spoken as well. */
export function sayAdded(outcome: AddOutcome, label: string): string | null {
  if ('refused' in outcome) {
    // Timed, not sticky (`danger`'s default is to stay until dismissed): a refusal
    // that names its reason and its way out is read once, and a Library row pressed
    // three times should not leave three cards to close.
    toast({ tone: 'danger', title: `${label} not added`, message: outcome.refused, ttl: 9000 });
    return null;
  }
  if (outcome.note) toast({ tone: 'neutral', title: `${label} added`, message: outcome.note });
  return outcome.id;
}
