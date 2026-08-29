// @vitest-environment jsdom
//
// `docs/visual-check.md`'s "The mount-height field under a piece that cannot fit".
// Its **wrong looks like** was exact: *typing 120 and watching it become 0 with no
// message.* That is the crossed-interval defect `boundsToUnit` exists for, one control
// along — `Math.max(0, Math.min(maxBottomMM, …))` with a NEGATIVE max applies the wrong
// bound last, so every number typed came back 0 and the field snapped in silence.
//
// Three states, and they are three different sentences rather than one message with a
// number in it:
//
//   !fits      the piece is taller than the room, so there is no height at all
//   outOfRange it fits, but the number typed is outside 0…max
//   noRoom     it fits and max is smaller than one step of the display unit
//
// The third is why `dimUnit` matters here and why the third test is in FEET: a
// centimetre of headroom is `0.03 ft`, and quoting "0–0.03 ft" as a range is true and
// useless. All fourteen of this repo's earlier bound defects were in feet.
//
// Mounted through the real plan page, like `tests/library-click-through.test.tsx`, so
// the Inspector is reached the way a user reaches it — the rail its own page renders —
// rather than through a harness that decides for itself when the row appears.
//
// What it does NOT prove: no layout, no colour, no focus ring. That the message uses
// `--danger-text` for a fault and `--ink-3` for information is a contrast question and
// `tests/color-tokens.test.ts` cannot see this element at all.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { MOUNT_PAD } from '@/lib/physics';
import { stepFor, fromMM } from '@/lib/units';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

// See tests/library-click-through.test.tsx for why these two shims are needed and what
// each one otherwise fails as.
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

vi.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'mount-height-room' }),
  usePathname: () => '/room/mount-height-room/plan',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

const ROOM_H = 1.9;
const ID = 'curtain-1';

/** A wall-mounted piece, whose height the caller varies. `wallMounted` is what makes
 *  the Inspector render the row at all, so a floor-standing fixture would silently
 *  test nothing.
 *
 *  It hangs with its bottom edge ON the floor, and that is not arbitrary. The row reads
 *  the piece's CURRENT mount height into its draft, and `outOfRange` is evaluated before
 *  `noRoom` — so a piece already parked above a sub-step maximum is told "0–0.0 ft under
 *  this ceiling" rather than "there is no room to move it". The first fixture here did
 *  exactly that and read as the `noRoom` branch being dead. Worth knowing rather than
 *  fixing: which of two true messages a crossed case should show is a copy decision, and
 *  the range one is not wrong, only less useful. */
function curtain(heightMM: number): ScenePart {
  return {
    id: ID,
    name: 'Curtain',
    category: 'curtain',
    shape: 'curtain',
    dimMM: [1600, 80, heightMM],
    pos: [0, heightMM / 2000, -1.9],
    rot: 0,
    wallMounted: true,
  } as ScenePart;
}

function setUp(heightMM: number, dimUnit: 'm' | 'ft') {
  cleanup();
  useScene.setState({
    parts: [curtain(heightMM)],
    room: {
      ...useScene.getState().room,
      width: 4,
      depth: 4,
      height: ROOM_H,
      footprint: footprintForLayout('rect', 4, 4),
      layoutId: 'rect',
    },
  });
  // Selected, because the Inspector renders nothing without a selection — and with no
  // position override, so the row reads the authored `pos` rather than a leftover drag.
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [ID], selectedPartId: ID });
  useSettings.setState({ dimUnit });
}

function field(): HTMLInputElement {
  // Found through its own label, which is what a user reads.
  return screen.getByLabelText(/Height off the floor/i) as HTMLInputElement;
}

describe('a piece taller than the room is told so, rather than pinned to 0', () => {
  beforeEach(() => setUp(2600, 'm'));

  it('renders the row at all, or the rest of this file proves nothing', () => {
    render(<PlanPage />);
    // The precondition. `wallMounted` gates the row, and a fixture that lost the flag
    // would take every assertion below with it while still passing as "no message".
    expect(field()).toBeTruthy();
  });

  it('refuses the edit instead of accepting it', () => {
    render(<PlanPage />);
    expect(field().disabled).toBe(true);
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('and says why, which is the half that was missing', () => {
    render(<PlanPage />);
    expect(screen.getByText(/Taller than the room — there is no height it can hang at/)).toBeTruthy();
    // It points at where the amount is, rather than repeating a number it would then
    // own a second copy of.
    expect(screen.getByText(/Room check says by how much/)).toBeTruthy();
  });

  it('typing 120 does not move the piece to 0 — the exact report', () => {
    render(<PlanPage />);
    fireEvent.change(field(), { target: { value: '120' } });
    fireEvent.blur(field());
    // The commit writes through `setPosition`, so an override appearing at all is the
    // defect. Silence plus a snap to 0 was what the user saw.
    expect(useStudio.getState().positions[ID]).toBeUndefined();
  });
});

describe('a piece that fits is told the range, in the unit it is typing in', () => {
  beforeEach(() => setUp(1200, 'm'));

  it('says nothing while the number is inside the range', () => {
    render(<PlanPage />);
    expect(screen.queryByText(/under this ceiling/)).toBeNull();
    expect(field().disabled).toBe(false);
  });

  it('names the range as soon as the number leaves it, while it is still being typed', () => {
    render(<PlanPage />);
    // Well past `room.height - h - MOUNT_PAD`. No blur: the message is derived from the
    // draft precisely so it arrives before the snap rather than after it.
    fireEvent.change(field(), { target: { value: '5' } });
    const maxMM = (ROOM_H - 1.2 - MOUNT_PAD) * 1000;
    // Derived. A literal here would be the hand-typed measurement rule 2 forbids, and
    // would stop being true the moment `MOUNT_PAD` moved.
    expect(screen.getByText(new RegExp(`0–${fromMM(maxMM, 'm').toFixed(2)}\\s*m under this ceiling`))).toBeTruthy();
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });
});

describe('a range narrower than one step is said in words, not quoted as a range', () => {
  // The scar case, in feet. Headroom is chosen so 0 < max < one foot-step: a piece
  // `MOUNT_PAD + half a step`-ish under the ceiling. Derived from MOUNT_PAD and
  // stepFor so it cannot drift out of the band it is testing.
  const HEADROOM_M = MOUNT_PAD + 0.01;
  beforeEach(() => setUp((ROOM_H - HEADROOM_M) * 1000, 'ft'));

  it('is inside the band this test is about', () => {
    // Asserted, not assumed: if MOUNT_PAD or stepFor('ft') changed, this fixture could
    // slide into `!fits` or into an ordinary range and the test below would pass for
    // the wrong reason.
    const maxMM = (ROOM_H - (ROOM_H - HEADROOM_M) - MOUNT_PAD) * 1000;
    expect(maxMM).toBeGreaterThan(0);
    expect(fromMM(maxMM, 'ft')).toBeLessThan(stepFor('ft'));
  });

  it('says there is no room to move it, instead of quoting 0–0.0 ft', () => {
    render(<PlanPage />);
    expect(screen.getByText(/It only just fits — there is no room to move it under this ceiling/)).toBeTruthy();
    // Not a fault: the piece fits. So the field stays usable and is not marked invalid.
    expect(field().disabled).toBe(false);
    expect(field().getAttribute('aria-invalid')).toBe('false');
  });
});
