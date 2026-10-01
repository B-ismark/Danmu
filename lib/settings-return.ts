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
  if (isSettingsPath(url.pathname)) return null;
  // The parsed form, not the input: it is what the check above approved. Checked
  // AGAIN as the router will read it, because normalising can make a path out of
  // another site: `/.//host` resolves to the pathname `//host`, which is
  // same-origin as a pathname and another site as an address.
  const out = url.pathname + url.search + url.hash;
  return new URL(out, APP_ORIGIN).origin === APP_ORIGIN ? out : null;
}

function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/');
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

/** How Back gets there. History, when the entry behind Settings is the page the
 *  label names — going back brings it back as it was left. The address otherwise:
 *  a fresh tab, a bookmark, a link from another site, or a tab that arrived on
 *  Settings and has since wandered. `history.length` cannot tell those apart,
 *  because it counts the whole tab.
 *
 *  `previous` is the path of the entry behind this one, where the browser can say
 *  (the Navigation API): null for none, or none in this app. `undefined` means it
 *  cannot say, and then the fallback is the path this DOCUMENT was first loaded at
 *  — a soft navigation keeps the document, so a document that began anywhere but
 *  Settings was routed here by the app. */
export function wayBack(
  returnTo: string,
  at: { previous?: string | null; documentPath?: string | null },
): 'history' | 'address' {
  if (at.previous !== undefined) {
    return at.previous !== null && at.previous === pathOf(returnTo) ? 'history' : 'address';
  }
  if (!at.documentPath) return 'address';
  return isSettingsPath(at.documentPath) ? 'address' : 'history';
}

function pathOf(path: string): string {
  return new URL(path, APP_ORIGIN).pathname;
}
