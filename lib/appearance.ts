// Night mode: which palette the app's chrome wears.
//
// Three answers. `system` (the default) follows the device's
// `prefers-color-scheme`; `light` and `dark` pin it. The palettes themselves are
// CSS (`app/globals.css`, the light `:root` block and the `:root[data-theme="dark"]`
// block with its media-query mirror); this module only decides which one applies.
//
// **How a choice reaches the page.** An explicit `light` / `dark` is written to
// `<html data-theme>`; `system` leaves the attribute OFF, and the stylesheet's
// `@media (prefers-color-scheme: dark)` block does the rest — so a device that
// flips to dark at sunset while the app is open changes with it and no script has
// to notice. `[data-theme="light"]` is what lets Light win on a dark device.
//
// **Before first paint.** The attribute has to be on `<html>` before the browser
// draws anything, or a Dark user on a light device gets a flash of cream on every
// load. React cannot do that — it runs after the HTML is painted — so
// `APPEARANCE_BOOT` is a few lines of plain script inlined into the document head
// by `app/layout.tsx`. It reads the same localStorage record `useSettings`
// persists, and it is built here from the same vocabulary, so the script and the
// store cannot disagree about what a valid answer is. The CSP already permits it:
// `script-src` carries `'unsafe-inline'` for Next's own bootstrap (see the note in
// `next.config.mjs`), so no hash or nonce is needed. If that ever tightens to a
// hash, this string is the thing to hash.
//
// What this does NOT touch: the 3D room. Walls, floor, furniture and the lighting
// mood's sky are the user's room and its light, not the app's paper.

/** The vocabulary, `as const` with the union derived, for the reason `SHAPES` and
 *  `LIGHTINGS` are: a persisted value is checked against it at runtime. */
export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];
export const DEFAULT_APPEARANCE: Appearance = 'system';

/** The labels the two controls show (Settings, and the View menu's quick switch).
 *  One list, so the two cannot name the same choice differently. */
export const APPEARANCE_OPTIONS: ReadonlyArray<{ value: Appearance; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The localStorage key `useSettings` persists under. Named once, here, because the
 *  boot script has to read the same record without importing the store. */
export const SETTINGS_STORAGE_KEY = 'danmu-settings';

/** Whatever localStorage held, as an answer this app has. Anything unknown is the
 *  default rather than a guess. */
export function parseAppearance(v: unknown): Appearance {
  return (APPEARANCES as readonly unknown[]).includes(v) ? (v as Appearance) : DEFAULT_APPEARANCE;
}

/** The `data-theme` value an appearance writes, or null for "leave it off". */
export function themeAttribute(a: Appearance): 'light' | 'dark' | null {
  return a === 'system' ? null : a;
}

/** The pinned answers, in the form the boot script tests against. Derived, so a
 *  fourth appearance cannot be honoured by the store and ignored before paint. */
const PINNED = APPEARANCES.filter((a) => themeAttribute(a) !== null);

/** The inline script for `<head>`. ES5 and self-contained: it runs before any
 *  bundle, and it must never throw — a private window or blocked storage makes
 *  `localStorage` itself throw, and the answer then is simply System. */
export const APPEARANCE_BOOT =
  `(function(){try{` +
  `var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)})||'null');` +
  `var a=s&&s.state&&s.state.appearance;` +
  `if(${JSON.stringify(PINNED)}.indexOf(a)>=0)document.documentElement.setAttribute('data-theme',a);` +
  `}catch(e){}})();`;

/** Write an appearance to the document, without animating the switch.
 *
 *  Every control with a colour transition would otherwise fade over its own
 *  120-300ms, out of step with everything that has none — a storm across the
 *  whole screen. `data-theme-switching` turns transitions off (`globals.css`) for
 *  the frame the colours change in, and is removed two frames later, once the
 *  new styles have been computed. */
export function applyAppearance(root: HTMLElement, a: Appearance): void {
  const next = themeAttribute(a);
  if (root.getAttribute('data-theme') === next) return;
  suppressTransitions(root);
  if (next) root.setAttribute('data-theme', next);
  else root.removeAttribute('data-theme');
}

/** The one-frame transition blackout, also used when the SYSTEM flips while the
 *  app is open (the media query changes the colours with no attribute write). */
export function suppressTransitions(root: HTMLElement): void {
  root.setAttribute('data-theme-switching', '');
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 16);
  raf(() => raf(() => root.removeAttribute('data-theme-switching')));
}

/** The browser chrome's colour (`<meta name="theme-color">`). `app/layout.tsx`
 *  emits one per scheme with a `media` attribute, which follows the DEVICE — so a
 *  pinned appearance has to re-point them, or a Dark app on a light phone keeps a
 *  cream status bar over it. Pinned: the matching tag applies to `all` and the
 *  other to nothing. System: both go back to their own scheme. */
export function applyThemeColor(doc: Document, a: Appearance): void {
  const pinned = themeAttribute(a);
  for (const meta of Array.from(doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))) {
    const own = meta.dataset.scheme ?? schemeOf(meta.getAttribute('media'));
    if (!own) continue;
    if (meta.dataset.scheme !== own) meta.dataset.scheme = own;
    const media = pinned === null ? `(prefers-color-scheme: ${own})` : pinned === own ? 'all' : 'not all';
    // Only on a change: `AppearanceSync` re-runs this from a MutationObserver on
    // these very tags, and a write of the same value is still a mutation record.
    if (meta.getAttribute('media') !== media) meta.setAttribute('media', media);
  }
}

function schemeOf(media: string | null): 'light' | 'dark' | null {
  const m = /prefers-color-scheme:\s*(light|dark)/.exec(media ?? '');
  return m ? (m[1] as 'light' | 'dark') : null;
}
