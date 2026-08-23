'use client';

// Which studio shell to lay the room out in — a throwaway A/B switch, dev only.
//
// Three prototypes are being compared against what ships today, and the only
// honest comparison is the real one: the same room, the same WebGL context, the
// same Inspector contents, differing solely in how width is handed out. So this
// is a switch inside `StudioShell` rather than three mock routes.
//
//   /room/<id>/model              → 'current'  (the control)
//   /room/<id>/model?shell=sash   → drag-resizable rails
//   /room/<id>/model?shell=elastic→ container-query rails + a breakpoint ladder
//   /room/<id>/model?shell=overlay→ full-bleed canvas, rails floating over it
//
// Two deliberate details:
//
// · The variant is `ready` on the same terms as the media query in
//   `lib/use-media-query.ts`, and `StudioShell` holds its first paint until both
//   are. Reading `location.search` during render would disagree with the server's
//   render and mismatch hydration; reading it in a plain effect would paint the
//   control shell first and then swap — remounting the canvas and spoiling the
//   very frame timings this switch exists to measure.
//
// · It survives the 3D ↔ 2D tab switch through `sessionStorage`, because the tab
//   links carry no query string and losing the variant halfway through a
//   comparison is how you end up comparing the wrong two things. sessionStorage,
//   not localStorage: this is scratch state for one tab, and it has no business
//   next to the user's real settings.

import { useEffect, useLayoutEffect, useState } from 'react';

/** The vocabulary, with the union derived from it — never a union beside a
 *  hand-kept membership test, which drifts the moment a fourth shell appears. */
export const SHELL_VARIANTS = ['current', 'sash', 'elastic', 'overlay'] as const;
export type ShellVariant = (typeof SHELL_VARIANTS)[number];

const KEY = 'danmu-shell-variant';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function parse(raw: string | null): ShellVariant | null {
  return raw != null && (SHELL_VARIANTS as readonly string[]).includes(raw) ? (raw as ShellVariant) : null;
}

export function useShellVariant(): { variant: ShellVariant; ready: boolean } {
  const [state, setState] = useState<{ variant: ShellVariant; ready: boolean }>({
    variant: 'current',
    ready: false,
  });

  useIsomorphicLayoutEffect(() => {
    // Compiled out of a production build, so a `?shell=` in a shared URL can
    // never hand a visitor a prototype. The three prototype modules are still
    // imported by `StudioShell`; they are side-effect-free and drop out of the
    // bundle with the branch, and they are meant to be deleted down to one
    // anyway.
    if (process.env.NODE_ENV === 'production') {
      setState({ variant: 'current', ready: true });
      return;
    }
    let store: Storage | null = null;
    try {
      store = window.sessionStorage;
    } catch {
      // Private modes and third-party-cookie blocking can throw on access alone.
    }
    const fromUrl = parse(new URLSearchParams(window.location.search).get('shell'));
    if (fromUrl) {
      try {
        store?.setItem(KEY, fromUrl);
      } catch {
        // Full or unavailable. The URL still won this navigation.
      }
      setState({ variant: fromUrl, ready: true });
      return;
    }
    let stored: ShellVariant | null = null;
    try {
      stored = parse(store?.getItem(KEY) ?? null);
    } catch {
      stored = null;
    }
    setState({ variant: stored ?? 'current', ready: true });
  }, []);

  return state;
}
