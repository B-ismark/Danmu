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
/** Answer `matchMedia` as a viewport NARROWER than every studio breakpoint, for the run
 *  of one test.
 *
 *  `tests/helpers/setup.ts` answers `matches: false` for every query, which is the wide
 *  shell — correct as a default and the reason ~115 node-environment files pay nothing.
 *  But a component that BRANCHES on the shell then has one branch no test can reach, and
 *  a fixture that cannot express the other case is the defect this repo keeps finding.
 *
 *  It lives here rather than in the test file because `tests/toolchain.test.ts` sweeps
 *  every test file for a hand-rolled `matchMedia` — correctly, since ten of them had one
 *  — so the sanctioned way to need a different answer is to ask for it here.
 *
 *  Returns the restore function; call it in `afterEach`. */
export function stackedViewport(): () => void {
  const prior = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      // Every `max-width` query the studio asks matches on a narrow viewport; anything
      // else keeps the default answer, so this shim widens nothing by accident.
      matches: query.includes('max-width'),
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

export function navigationMock(roomId: string | null, tab: 'plan' | 'model' = 'plan') {
  const pathname = roomId === null ? '/workspace' : `/room/${roomId}/${tab}`;
  return {
    useParams: () => (roomId === null ? {} : { roomId }),
    usePathname: () => pathname,
    useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
    useSearchParams: () => new URLSearchParams(),
  };
}
