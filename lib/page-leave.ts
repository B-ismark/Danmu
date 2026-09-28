'use client';

// Leaving the PAGE, as opposed to leaving the room: a reload, a closed tab, a phone that
// puts the browser in the background. None of those unmounts anything, so a component
// whose pending save is flushed on unmount loses it — and every save the studio makes is
// pending for a while first. `RoomSync` writes 300 ms after the last change, and the Room
// section's size boxes commit 200 ms after the last keystroke, before `RoomSync` has even
// seen the change. Measured in a browser: a width typed and reloaded straight away came
// back as it was (`docs/what-is-still-open.md` § 47).
//
// So a pending save registers here too, and runs early when the page is hidden.
//
// Two PHASES, because the two debounces are a chain: the size boxes' commit is what hands
// `RoomSync` the change it then saves, so it has to run first or `RoomSync` flushes a room
// that does not yet carry the new width. Every 'commit' runs before any 'persist',
// whichever registered first.
//
// `visibilitychange` to hidden as well as `pagehide`, because either can be the last event a
// page gets: a phone that backgrounds the browser hides the tab and may discard it later
// with nothing further. A flush that has already run has nothing left to write, so the
// second event finds nothing, which is why a flush must forget what it wrote. And one
// flush that throws does not stop the rest: each is its own save.
//
// Starting a write is not finishing it, and what a leave saves is `roomStore.saveOnLeave`,
// one transaction for everything `RoomSync` still had waiting, so it lands whole or not at
// all. Measured in Chromium, a change made and left at once, five of each: a duplicated
// piece kept on a reload 5 of 5 and a typed width on a closed tab 5 of 5, with no room
// ever half-saved — where three separate saves had stored the width without its outline
// on 4 of 5 closed tabs. A typed width on a RELOAD is still lost, 0 of 5, whole: that save
// reads the room before it can write it, and the old document is gone first
// (`docs/what-is-still-open.md` § 47).

const PHASES = ['commit', 'persist'] as const;
export type LeavePhase = (typeof PHASES)[number];

const flushes = Object.fromEntries(PHASES.map((phase) => [phase, new Set<() => void>()])) as Record<
  LeavePhase,
  Set<() => void>
>;
let listening = false;

function flushAll() {
  for (const phase of PHASES) {
    for (const flush of [...flushes[phase]]) {
      try {
        flush();
      } catch (err) {
        console.error('[page-leave] a save could not start', err);
      }
    }
  }
}

function onVisibility() {
  if (document.visibilityState === 'hidden') flushAll();
}

/** Run `flush` when the page is hidden or left, in `phase` order. Returns the unregister. */
export function onPageLeave(phase: LeavePhase, flush: () => void): () => void {
  flushes[phase].add(flush);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', onVisibility);
    listening = true;
  }
  return () => {
    flushes[phase].delete(flush);
  };
}
