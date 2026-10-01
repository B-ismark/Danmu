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
 *  passes. The test is the one the router will apply — resolve it as a URL and
 *  compare origins — rather than a guess at its characters, because a browser
 *  reads more spellings as another site than a character test lists: `//host`,
 *  `/\host`, and `/<tab>/host`, since URL parsing deletes tabs and newlines
 *  anywhere in the input. Settings itself would make Back a button that goes
 *  nowhere. */
export function safeReturnPath(from: string | null | undefined): string | null {
  if (!from || from[0] !== '/') return null;
  let url: URL;
  try {
    url = new URL(from, APP_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== APP_ORIGIN) return null;
  if (url.pathname === '/settings' || url.pathname.startsWith('/settings/')) return null;
  // The parsed form, not the input: it is what the check above approved.
  return url.pathname + url.search + url.hash;
}

/** Any origin a path cannot name. Only the comparison matters, not the host. */
const APP_ORIGIN = 'https://app.invalid';

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
  return 'Back';
}

/** How Back gets there. History, when this document was opened somewhere else in
 *  the app and routed here — the entry behind Settings is then the page that sent
 *  someone, and going back to it brings it back as it was left. The address, when
 *  this document was opened ON Settings — a fresh tab, a bookmark, a link from
 *  another site — because the entry behind it is then not this app at all, and
 *  `history.length` cannot tell those apart: it counts the whole tab.
 *
 *  `documentPath` is the path the document was first loaded at (the navigation
 *  timing entry's URL), or null when the browser cannot say. */
export function wayBack(documentPath: string | null | undefined): 'history' | 'address' {
  if (!documentPath) return 'address';
  return documentPath === '/settings' || documentPath.startsWith('/settings/') ? 'address' : 'history';
}
