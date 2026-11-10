// @vitest-environment jsdom
//
// "Use my own size" must refuse a size the piece cannot be, never quietly clamp it.
// Before this, `sofa 700x95x83cm` added a 4.00 m sofa and the fit check then reported
// "It goes in, but it is tight" about a piece nobody asked for (rule 2: when something
// does not fit, say so — never silently resize it to fit).
//
// What is pinned: a press on an out-of-range row does NOT reach `onPick`, it raises a
// danger toast saying why, and that toast's one action adds at the clamped size —
// so the nearest legal size is the user's choice. A size inside the range still adds
// on the first press, and Shift-range marking skips the refused rows.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const toast = vi.fn((spec: unknown) => {
  void spec;
  return 1;
});
vi.mock('@/components/ui/StorageToast', () => ({ toast }));

const { LibraryPicker } = await import('@/components/studio/LibraryPicker');

type Spec = { tone: string; title: string; message: string; action?: { label: string; onClick: () => void } };

beforeEach(() => {
  cleanup();
  toast.mockClear();
});

/** The plain "Sofa" row, found by its visible name (a refused row also carries an
 *  `aria-label`, an ordinary one does not, so the label text is the common ground). */
function sofaRow(): HTMLElement {
  const rows = screen
    .getAllByText('Sofa', { exact: true })
    .map((el) => el.closest('button'))
    .filter((b): b is HTMLButtonElement => b !== null);
  expect(rows.length).toBeGreaterThan(0);
  return rows[0];
}

function mount(query: string) {
  const onPick = vi.fn();
  const onPickMany = vi.fn();
  render(<LibraryPicker onPick={onPick} onPickMany={onPickMany} initialQuery={query} autoFocus={false} />);
  return { onPick, onPickMany };
}

describe('a typed size outside the piece’s range is refused, not clamped', () => {
  it('does not add the sofa, and says why', () => {
    const { onPick } = mount('sofa 700x95x83cm');
    fireEvent.click(sofaRow(), { detail: 1 });
    expect(onPick).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    const spec = toast.mock.calls[0][0] as Spec;
    expect(spec.tone).toBe('danger');
    expect(spec.title).toBe('Sofa not added');
    expect(spec.message).toMatch(/width 7000 mm \(it goes up to \d+ mm\)/);
  });

  it('offers the clamped size as an explicit choice, which then adds', () => {
    const { onPick } = mount('sofa 700x95x83cm');
    fireEvent.click(sofaRow(), { detail: 1 });
    const spec = toast.mock.calls[0][0] as Spec;
    expect(spec.action?.label).toMatch(/^Add at \d+×950×830 mm$/);
    spec.action!.onClick();
    expect(onPick).toHaveBeenCalledTimes(1);
    const [item, opts] = onPick.mock.calls[0];
    expect(item.dimMM[1]).toBe(950);
    expect(item.dimMM[2]).toBe(830);
    expect(item.dimMM[0]).toBeLessThan(7000);
    // The label names the exact size that is added — one number, two readers.
    expect(spec.action!.label).toBe(`Add at ${item.dimMM.join('×')} mm`);
    expect(opts).toEqual({ ownSize: true, byPointer: false });
  });

  it('still adds a size the sofa can be on the first press, at exactly that size', () => {
    const { onPick } = mount('sofa 260x95x83cm');
    fireEvent.click(sofaRow(), { detail: 1 });
    expect(toast).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].dimMM).toEqual([2600, 950, 830]);
    expect(onPick.mock.calls[0][1]).toEqual({ ownSize: true, byPointer: true });
  });

  it('adds untouched catalogue sizes when no size is typed', () => {
    const { onPick } = mount('sofa');
    fireEvent.click(sofaRow(), { detail: 1 });
    expect(toast).not.toHaveBeenCalled();
    expect(onPick.mock.calls[0][1]).toEqual({ ownSize: false, byPointer: true });
  });

  it('refuses a drag of an out-of-range row before anything is carried', () => {
    const onPick = vi.fn();
    render(<LibraryPicker onPick={onPick} draggable initialQuery="sofa 700x95x83cm" autoFocus={false} />);
    const setData = vi.fn();
    const notCancelled = fireEvent.dragStart(sofaRow(), { dataTransfer: { setData, setDragImage: vi.fn() } });
    expect(notCancelled).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
