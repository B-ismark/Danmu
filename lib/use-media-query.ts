'use client';

// One media-query hook. There were three near-identical copies — `useMediaQuery`
// in the workspace, `useNarrow` on the capture screen, and `useStackedStudio` in
// NarrowViewportBanner — each with the same matchMedia + listener + cleanup body
// and its own breakpoint constant.
//
// `ready` exists because the naive version is a layout-shift generator: state
// starts `false`, the effect corrects it after the first paint, so a narrow
// viewport renders the wide layout and then jumps. Callers that only *decorate*
// on a match (a hover affordance, reduced motion) can ignore it; callers that
// pick a whole layout should hold off until it is true.

import { useEffect, useLayoutEffect, useState } from 'react';

export type MediaQueryState = {
  matches: boolean;
  /** false until matchMedia has been consulted — i.e. during SSR and the first
   *  client render, when `matches` is a guess rather than an answer. */
  ready: boolean;
};

/** A LAYOUT effect, so the answer lands BEFORE the browser paints. With a plain
 *  useEffect, a caller that holds its layout back until `ready` paints its
 *  placeholder for one frame on every load — trading a reflow on narrow screens
 *  for a flash on every screen. Reading matchMedia during render instead would
 *  be worse: the server has no viewport, so the first client render has to agree
 *  with the server's or hydration mismatches the whole subtree.
 *
 *  useEffect on the server, because useLayoutEffect there is a no-op React warns
 *  about. It never runs during SSR either way. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useMediaQueryState(query: string): MediaQueryState {
  const [state, setState] = useState<MediaQueryState>({ matches: false, ready: false });
  useIsomorphicLayoutEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setState({ matches: mq.matches, ready: true });
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return state;
}

/** Just the boolean, for callers where a first-paint false is harmless. */
export function useMediaQuery(query: string): boolean {
  return useMediaQueryState(query).matches;
}
