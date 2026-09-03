/** Runs before every test file, in that file's own environment — see `setupFiles` in
 *  `vitest.config.ts`.
 *
 *  It exists for two browser globals jsdom does not implement, which seven `.test.tsx`
 *  files each defined for themselves:
 *
 *  · **`matchMedia`.** `lib/use-media-query.ts` calls `window.matchMedia(query)`
 *    UNGUARDED — every other reader in the app uses `?.` — so a page that renders
 *    `StudioShell` or `NarrowViewportBanner` throws without it. `matches: false` is the
 *    same answer the optional readers already get from `undefined`, since all of them
 *    compare `=== true`; this shim changes no behaviour for them and unblocks the one
 *    that needs it.
 *  · **`scrollIntoView`.** jsdom defines no layout, so the method is absent; the
 *    Inspector and the part tree call it after a selection change.
 *
 *  **The guard is what makes this global.** Roughly 115 of the suite's files run in the
 *  node environment where there is no `window` at all, and this file runs for every one
 *  of them. Touching `Element` unconditionally would make a setup file the reason a pure
 *  geometry test cannot start.
 *
 *  Nothing else belongs here. A shim only one file needs stays in that file, where the
 *  reader can see why it is there. */

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
