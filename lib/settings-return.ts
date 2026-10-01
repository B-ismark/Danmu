// The way back from Settings.
//
// Settings is reached from four places — the rooms page, the studio's View menu,
// the studio's Cmd/Ctrl+, and the scan screen's "Set up a key" — and it used to
// offer one way out: the breadcrumb's "Rooms". So someone who went to add a key
// halfway through a scan, or to switch units in the middle of arranging a room,
// was sent to the room list and had to find their place again. The page that
// sends someone here now says where it is (`?from=`), and Settings names that
// place on its Back control.
//
// The breadcrumb stays: it is a FIXED destination, Back is HISTORY, and the two
// are different promises (see `components/ui/DocShell.tsx`).

/** A path Settings may send someone back to, or null.
 *
 *  `from` arrives in the address bar, so anyone can write it: only a same-app path
 *  passes. `//host` and `/\host` are other sites to a browser, and Settings itself
 *  would make Back a button that goes nowhere. */
export function safeReturnPath(from: string | null | undefined): string | null {
  if (!from || from[0] !== '/' || from[1] === '/' || from.includes('\\')) return null;
  if (/^\/settings(?:[/?#]|$)/.test(from)) return null;
  return from;
}

/** The Settings address for a page that sends someone there. The rooms page needs
 *  no `from`: the breadcrumb's "Rooms" already goes there. */
export function settingsHref(from?: string | null): string {
  const path = safeReturnPath(from);
  return path && path !== '/' ? `/settings?from=${encodeURIComponent(path)}` : '/settings';
}

/** What the Back control says. A room is named only when the path is that room —
 *  the open room is a persisted id, and may not be the one Settings was opened from. */
export function returnLabel(path: string, room?: { id: string; name: string } | null): string {
  if (path.startsWith('/room/')) {
    return room && path.startsWith(`/room/${room.id}/`) ? `Back to “${room.name}”` : 'Back to your room';
  }
  if (path.startsWith('/onboarding/detect')) return 'Back to the scan';
  if (path.startsWith('/onboarding/capture')) return 'Back to your photos';
  if (path.startsWith('/onboarding/layout-pick')) return 'Back to the room shape';
  return 'Back';
}
