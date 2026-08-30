// @vitest-environment jsdom
//
// A button that says it is working, while it is working.
//
// The defect: `setBusy(true)` and then seconds of SYNCHRONOUS solving on the same
// tick. React flushes the state change, the browser is never handed a frame to
// paint it in, and `setBusy(false)` runs before it would have been. So the label
// never changes, `disabled` never takes effect, and the window locks up looking
// like a crash. `SuggestButton` and `TryFixButton` both shipped with that shape —
// `TryFixButton` even had a "Trying…" label that had never once been on screen.
//
// These assertions are therefore all about ORDER: what is true DURING the work,
// not what is true after it. A test that only checked the end state passes against
// the bug, because the end state was always correct.
//
// What this file cannot do: prove a paint happened. jsdom has no compositor, so
// the frame counting below is a proxy — it proves the work is deferred past a
// frame boundary, which is the mechanism, not the pixel. See NOT VERIFIED in the
// PR body.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useBusyAction } from '@/components/ui/useBusyAction';

// A controllable clock. jsdom's own rAF (when present) is tied to a real timer,
// which would make every assertion below a race.
let frames: FrameRequestCallback[] = [];
const realRaf = globalThis.requestAnimationFrame;

function flushFrame() {
  const due = frames;
  frames = [];
  act(() => {
    for (const cb of due) cb(0);
  });
  return due.length;
}

beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    frames.push(cb)) as typeof globalThis.requestAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
});

function Probe({ work }: { work: () => void | Promise<void> }) {
  const [busy, run] = useBusyAction();
  return (
    <button onClick={() => run(work)} disabled={busy} aria-busy={busy}>
      {busy ? 'Working…' : 'Go'}
    </button>
  );
}

describe('useBusyAction', () => {
  it('shows the busy label BEFORE the work runs, not after it finishes', () => {
    const work = vi.fn();
    render(<Probe work={work} />);

    act(() => {
      screen.getByRole('button').click();
    });

    // The whole point. The work has not started, and the button already says so.
    expect(work).not.toHaveBeenCalled();
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('Working…');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('runs the work only after the frame carrying that label', () => {
    const work = vi.fn();
    render(<Probe work={work} />);
    act(() => {
      screen.getByRole('button').click();
    });

    flushFrame();
    // Still nothing: a rAF callback runs before its own frame is presented, so
    // working here would block the paint of the very label just rendered.
    expect(work).not.toHaveBeenCalled();

    flushFrame();
    expect(work).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').textContent).toBe('Go');
  });

  it('refuses a second press while the first is still pending', () => {
    const work = vi.fn();
    render(<Probe work={work} />);
    const btn = screen.getByRole('button');

    // Both presses land in the gap between the press and the paint — which is
    // exactly the window `disabled` cannot cover, because the re-render carrying
    // it has not been presented yet. `dispatchEvent` rather than the disabled
    // attribute is what makes this reachable at all.
    act(() => {
      btn.click();
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    flushFrame();
    flushFrame();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('lets a later press through once the first has finished', () => {
    const work = vi.fn();
    render(<Probe work={work} />);
    const btn = screen.getByRole('button');

    act(() => btn.click());
    flushFrame();
    flushFrame();
    act(() => btn.click());
    flushFrame();
    flushFrame();
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('clears the flag when the work throws, so the button is not dead forever', () => {
    // ONLY setTimeout. `vi.useFakeTimers()` with no argument also replaces
    // `requestAnimationFrame`, which would overwrite the frame stub installed in
    // `beforeEach` — the frames would then go nowhere, the work would never run,
    // and the test would fail for a reason that has nothing to do with its subject.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const boom = () => {
        throw new Error('solver blew up');
      };
      render(<Probe work={boom} />);
      const btn = screen.getByRole('button');

      act(() => btn.click());
      flushFrame();
      flushFrame();

      // The button comes back. A stuck `busy` is a permanently disabled control
      // with no way out short of a reload — worse than the crash, and silent.
      expect(screen.getByRole('button').textContent).toBe('Go');
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);

      // …and the error is still raised, on a later task. Swallowing it would hide
      // a real solver crash from `window.onerror` and from the console, so the
      // order is: clear the flag, then re-raise. Both halves are asserted because
      // either one alone has an obvious wrong implementation that passes it.
      expect(() => vi.runAllTimers()).toThrow('solver blew up');
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the flag across an async gap and clears it at the end', async () => {
    let settle!: () => void;
    const work = () => new Promise<void>((res) => (settle = res));
    render(<Probe work={work} />);

    act(() => screen.getByRole('button').click());
    flushFrame();
    flushFrame();
    // Mid-await: the work has started and has NOT finished, so the label has to
    // still be saying so. Clearing on return rather than on resolution is the
    // obvious wrong implementation and this is the assertion that catches it.
    expect(screen.getByRole('button').textContent).toBe('Working…');

    await act(async () => {
      settle();
    });
    expect(screen.getByRole('button').textContent).toBe('Go');
  });
});
