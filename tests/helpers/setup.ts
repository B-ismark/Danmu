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
 *  · **`localStorage` / `sessionStorage`.** Not a missing global but a shadowed one.
 *    Node 25+ ships its own Web Storage on `globalThis`, and without
 *    `--localstorage-file` its `localStorage` is `undefined` (with an
 *    ExperimentalWarning). Vitest's jsdom environment does not replace a global Node
 *    already has, so every jsdom file that touched storage — zustand's `persist`
 *    included — failed with "Cannot read properties of undefined (reading 'setItem')":
 *    ~630 tests on Node 26, none on CI's Node 22, where Node's storage is still off.
 *    Pointing both names at jsdom's own Storage puts every Node version back on the
 *    browser implementation the tests were written against, with no `NODE_OPTIONS`.
 *    The node environment has the mirror problem: on Node 22 `localStorage` is not a
 *    name at all, so zustand's `createJSONStorage(() => localStorage)` catches the
 *    ReferenceError and `persist` stands down; on 25+ the name exists and is
 *    `undefined`, so `persist` keeps going and throws on its first `setItem`
 *    (`tests/sound.test.ts`). There the globals are deleted, which is the Node 22
 *    world those files were written in. The getter is never CALLED to decide this,
 *    because calling it is what prints the warning, once per file.
 *
 *  Nothing else belongs here. A shim only one file needs stays in that file, where the
 *  reader can see why it is there. */

if (typeof window !== 'undefined') {
  // Vitest's jsdom environment exposes the JSDOM instance as `jsdom`.
  const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
  if (dom) {
    for (const key of ['localStorage', 'sessionStorage'] as const) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
    }
  }
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
} else {
  for (const key of ['localStorage', 'sessionStorage']) {
    if (Object.getOwnPropertyDescriptor(globalThis, key)?.configurable) Reflect.deleteProperty(globalThis, key);
  }
}
