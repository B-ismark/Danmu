/** Does a viewport `widthPx` CSS pixels wide satisfy `query`?
 *
 *  Every width feature in the query has to hold, because `useStudioLayout` is not the
 *  only caller and a query may carry both ends. A query with NO width feature in it —
 *  `(hover: none) and (pointer: coarse)`, `(prefers-reduced-motion: reduce)` — answers
 *  `false`, which is the same answer `tests/helpers/setup.ts` gives it everywhere else:
 *  simulating a width must not quietly also simulate a touch screen.
 *
 *  Deliberately not exported. It is an implementation detail of the two shims below, and
 *  a test that called it directly would be asserting this file against itself. */
function widthMatches(query: string, widthPx: number): boolean {
  const feature = /\(\s*(max|min)-width:\s*(\d+(?:\.\d+)?)px\s*\)/g;
  let seen = false;
  for (let m = feature.exec(query); m; m = feature.exec(query)) {
    seen = true;
    const px = Number(m[2]);
    if (m[1] === 'max' ? widthPx > px : widthPx < px) return false;
  }
  return seen;
}

/** Answer `matchMedia` as a viewport of a GIVEN width, for the run of one test.
 *
 *  `tests/helpers/setup.ts` answers `matches: false` for every query, which is the wide
 *  shell — correct as a default and the reason ~115 node-environment files pay nothing.
 *  But a component that BRANCHES on the shell then has one branch no test can reach, and
 *  a fixture that cannot express the other case is the defect this repo keeps finding.
 *
 *  **A width rather than a blanket `true`, because the studio has THREE steps and a
 *  blanket answer can only reach the outermost one.** This shim used to answer `true` to
 *  every `max-width` query, which makes `useStudioLayout`'s two queries both match and
 *  pins it to `stacked` — so `compact` (1024–1279px, where the rails render
 *  `--rail-*-tight`) was unreachable by construction, in the helper written to make the
 *  branches reachable. A parsed width has no middle step it cannot express.
 *
 *  It lives here rather than in the test file because `tests/toolchain.test.ts` sweeps
 *  every test file for a hand-rolled `matchMedia` — correctly, since ten of them had one
 *  — so the sanctioned way to need a different answer is to ask for it here.
 *
 *  Returns the restore function; call it in `afterEach`. */
export function viewportAt(widthPx: number): () => void {
  const prior = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: widthMatches(query, widthPx),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return () => {
    if (prior) Object.defineProperty(window, 'matchMedia', prior);
  };
}

/** A viewport narrow enough for the studio to stack its rails under the room.
 *
 *  640px because that is what a 1280px laptop reports at 200% browser zoom — the case
 *  that made the stacked shell worth reaching, rather than a number chosen to sit under
 *  a breakpoint. It is also comfortably above `NarrowViewportBanner`'s 400px reflow
 *  floor, so this simulates a stacked studio and not the modal that refuses to lay one
 *  out; the old blanket-`true` shim matched that query too. */
export function stackedViewport(): () => void {
  return viewportAt(640);
}

/** `next/navigation`'s four hooks, as a component test needs them.
 *
 *  Nine `.test.tsx` files hand-rolled this same module object — four hooks, differing
 *  only in a room id and a tab — and seven of them also hand-rolled the same
 *  `matchMedia` and `scrollIntoView` globals. That is nine copies of a fixture whose
 *  subject is a THIRD-PARTY interface: when `next/navigation` grows a hook a page
 *  calls, every copy has to learn it, and the ones that do not fail as an undefined
 *  function deep inside a render rather than as a missing mock. The globals moved
 *  further, into `tests/helpers/setup.ts` and `vitest.config.ts`'s `setupFiles`,
 *  because they are not per-file at all.
 *
 *  **`vi.mock`'s factory must not close over an import.** vitest hoists the `vi.mock`
 *  call above every `import` in the file, so a factory returning `navigationMock(…)`
 *  read from a static import throws *Cannot access before initialization*. The factory
 *  may be `async` and `await import()` this module itself, which resolves when the mock
 *  is applied rather than when it is hoisted — that is the shape every call site uses:
 *
 *      vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('my-room'));
 *
 *  Pass the room id and which studio tab the page believes it is on; pass `null` for a
 *  route with no `roomId` (the workspace), where `useParams` must answer `{}` rather
 *  than a room that does not exist.
 *
 *  The tab is an explicit argument rather than something derived from the id, and that
 *  is the one thing here worth defending: `usePathname` is the only difference between
 *  the plan page's mock and the model page's, so deriving it would be a second source
 *  of truth for which tab a test is on — silently right for the six files on `/plan`
 *  and silently wrong for the two on `/model`. */
export function navigationMock(roomId: string | null, tab: 'plan' | 'model' = 'plan') {
  const pathname = roomId === null ? '/workspace' : `/room/${roomId}/${tab}`;
  return {
    useParams: () => (roomId === null ? {} : { roomId }),
    usePathname: () => pathname,
    useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
    useSearchParams: () => new URLSearchParams(),
  };
}
