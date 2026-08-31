// The studio's one-sentence live region, as a channel rather than a component.
//
// It was three lines inside `components/studio/KeyboardShortcuts.tsx`, next to the
// `StudioAnnouncer` that renders what it says, and that was fine for as long as
// every caller was a component. It stopped being fine the moment a rule in `lib/`
// had something to say: nothing in `lib/` imports from `@/components` and nothing
// should start, so a refusal decided in `lib/wall-actions.ts` had a choice between
// inverting that direction and handing a reason back to four call sites to render
// four ways — which is `lib/layout-rules.ts`'s scar exactly.
//
// So the DISPATCH lives here and the rendering stays where it was. A window event
// rather than a store field, unchanged from the original: any surface can call it,
// including the 3D canvas, without a store contract change, and it costs nothing
// when nobody is listening.

/** The event `StudioAnnouncer` listens for. Exported so the listener and the
 *  dispatcher cannot drift on the string. */
export const ANNOUNCE_EVENT = 'danmu:announce';

/** Speak one sentence in the studio's live region. For things a screen reader
 *  cannot otherwise know: a move that was refused, a piece that was duplicated. */
export function announce(message: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(ANNOUNCE_EVENT, { detail: message }));
}
