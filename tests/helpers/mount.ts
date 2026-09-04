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
