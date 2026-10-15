// @vitest-environment jsdom
//
// Phase 0, "adding a piece is easy to find": the A key, the plan tab's canvas trigger,
// the size-example chips and the touch hold. Mounted as the real plan page inside the
// real studio layout for the reason `library-click-through.test.tsx` gives.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { STUDIO_SURFACE_ID } from '@/components/studio/KeyboardShortcuts';
import { LibraryPicker } from '@/components/studio/LibraryPicker';
import { SIZE_EXAMPLES } from '@/lib/size-examples';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('add-discoverable-room'));
vi.mock('@/components/three/RoomHost', () => ({ RoomHostProvider: () => null, RoomSlot: () => null, useRoomHost: () => null }));

const { default: PlanPageAlone } = await import('@/app/room/[roomId]/plan/page');
const { default: StudioLayout } = await import('@/app/room/[roomId]/layout');
function PlanPage() {
  return (
    <StudioLayout>
      <PlanPageAlone />
    </StudioLayout>
  );
}

// jsdom has no PointerEvent, so a fired pointerdown carries no pointerType or
// coordinates; the long-press decision reads both.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PE extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? '';
    }
  }
  (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
}

beforeEach(() => {
  cleanup();
  useStudio.setState({ catalogOpen: false, selection: [], selectedPartId: null });
});

const surface = () => document.getElementById(STUDIO_SURFACE_ID)!;
const press = (init: KeyboardEventInit, target: Element = surface()) => fireEvent.keyDown(target, init);

describe('the A key', () => {
  it('toggles the Library while the room has focus', () => {
    render(<PlanPage />);
    surface().focus();
    press({ key: 'a' });
    expect(useStudio.getState().catalogOpen).toBe(true);
    // Opening hands focus to the search field, so A types there; closing by key
    // needs the room focused again (a press on the canvas does that).
    surface().focus();
    press({ key: 'A' });
    expect(useStudio.getState().catalogOpen).toBe(false);
  });

  it('yields while typing in a field', () => {
    useStudio.setState({ catalogOpen: true });
    render(<PlanPage />);
    const field = screen.getByLabelText('Search the Library');
    press({ key: 'a' }, field);
    expect(useStudio.getState().catalogOpen).toBe(true);
  });

  it('yields when focus is on a control rather than the room', () => {
    render(<PlanPage />);
    const btn = screen.getAllByRole('button')[0];
    btn.focus();
    press({ key: 'a' }, btn);
    expect(useStudio.getState().catalogOpen).toBe(false);
  });

  it('Ctrl/Cmd+A stays select-all and does not open the Library', () => {
    render(<PlanPage />);
    surface().focus();
    press({ key: 'a', ctrlKey: true });
    press({ key: 'a', metaKey: true });
    expect(useStudio.getState().catalogOpen).toBe(false);
  });

  it('Alt+A and Shift+A are not ours', () => {
    render(<PlanPage />);
    surface().focus();
    press({ key: 'a', altKey: true });
    press({ key: 'A', shiftKey: true });
    expect(useStudio.getState().catalogOpen).toBe(false);
  });
});

describe('the Add triggers', () => {
  it('the plan tab has the canvas trigger too, named like the rail one', () => {
    render(<PlanPage />);
    const triggers = screen.getAllByRole('button', { name: 'Add from the Library' });
    expect(triggers.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(triggers[0]);
    expect(useStudio.getState().catalogOpen).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Close the Library' }).length).toBeGreaterThanOrEqual(2);
  });
});

describe('size examples', () => {
  const host = () => render(<LibraryPicker onPick={() => {}} onPickMany={() => {}} autoFocus={false} />);

  it('are offered while the field is empty, and wrap', () => {
    host();
    const group = screen.getByRole('group', { name: 'Try a size' });
    expect(group.style.flexWrap).toBe('wrap');
    for (const ex of SIZE_EXAMPLES) expect(screen.getByRole('button', { name: ex.text })).toBeTruthy();
  });

  it('pressing one fills the field, keeps focus there and hides the row', () => {
    host();
    fireEvent.click(screen.getByRole('button', { name: SIZE_EXAMPLES[0].text }));
    const field = screen.getByLabelText('Search the Library') as HTMLInputElement;
    expect(field.value).toBe(SIZE_EXAMPLES[0].text);
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole('group', { name: 'Try a size' })).toBeNull();
  });

  it('are absent in the swap modal (no onPickMany)', () => {
    render(<LibraryPicker onPick={() => {}} autoFocus={false} />);
    expect(screen.queryByRole('group', { name: 'Try a size' })).toBeNull();
  });
});

describe('touch long-press', () => {
  it('marks a row without adding it, and the click after does not add either', () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    render(<LibraryPicker onPick={onPick} onPickMany={() => {}} autoFocus={false} />);
    const row = screen.getAllByRole('button').find((b) => b.classList.contains('pick-row'))!;
    fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 5, clientY: 5 });
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.pointerUp(row, { pointerType: 'touch' });
    fireEvent.click(row, { detail: 1 });
    expect(onPick).not.toHaveBeenCalled();
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Add 1$/ })).toBeTruthy();
    // A plain tap afterwards still adds.
    fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerUp(row, { pointerType: 'touch' });
    fireEvent.click(row, { detail: 1 });
    expect(onPick).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a mouse never arms it', () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    render(<LibraryPicker onPick={onPick} onPickMany={() => {}} autoFocus={false} />);
    const row = screen.getAllByRole('button').find((b) => b.classList.contains('pick-row'))!;
    fireEvent.pointerDown(row, { pointerType: 'mouse', clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(2000);
    fireEvent.click(row, { detail: 1 });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(row.getAttribute('aria-pressed')).toBeNull();
    vi.useRealTimers();
  });
});
