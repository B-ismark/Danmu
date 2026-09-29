// @vitest-environment jsdom
//
// A shut rail is an icon strip, not an empty band (see `shell-parts.tsx`). What the
// strip owes: one named way back in per thing the rail holds, each landing on the
// section it names, and side tooltips, because a bubble above or below one icon covers
// the next one down.
//
// What jsdom cannot see: the strip's width, the tooltip actually clearing the rail, or
// the scroll into view. Those are `docs/visual-check.md`'s.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import type { ScenePart } from '@/lib/scene-spec';
import { useRailIntent } from '@/lib/rail-intent';
import { Tooltip } from '@/components/ui/Tooltip';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('strip-room', 'model'));

const { LeftRailBody, RightRailBody } = await import('@/components/studio/shells/shell-parts');
const { PartTree } = await import('@/components/studio/PartTree');

const sofa = { id: 'sofa-1', name: 'Sofa', shape: 'sofa', category: 'sofa', dimMM: [2000, 900, 850], pos: [0, 0, 0], rot: 0, color: '#b07a52' } as unknown as ScenePart;

beforeEach(() => {
  useRailIntent.setState({ left: null });
  useScene.getState().setParts([sofa]);
  useStudio.setState({ railLeftOpen: false, railRightOpen: false, selectedPartId: null, selection: [], selectedWall: null, catalogOpen: false });
});
afterEach(() => cleanup());

describe('the left rail, shut', () => {
  it.each([
    ["Open the room's size and walls", 'room'],
    ["Open the room's style and light", 'style'],
    ['Open the catalog, 1 piece in this room', 'pieces'],
  ] as const)('%s asks for %s and opens the rail', (name, section) => {
    render(<LeftRailBody open={false} />);
    fireEvent.click(screen.getByRole('button', { name }));
    expect(useRailIntent.getState().left).toBe(section);
    expect(useStudio.getState().railLeftOpen).toBe(true);
  });

  it('the catalog icon carries the piece count', () => {
    render(<LeftRailBody open={false} />);
    expect(screen.getByRole('button', { name: /Open the catalog/ }).textContent).toBe('1');
  });

  it('the tree takes the request and opens that section, focused', () => {
    useRailIntent.getState().askLeft('style');
    render(<PartTree />);
    const toggle = screen.getByRole('button', { name: /^Style/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    expect(useRailIntent.getState().left, 'taken, not left for the next mount').toBeNull();
  });

  it('a tree already on screen takes a request that arrives later', () => {
    // The empty Inspector's paths ask while the left rail is OPEN, so the tree is
    // mounted before the request, not by it.
    render(<PartTree />);
    act(() => useRailIntent.getState().askLeft('style'));
    const toggle = screen.getByRole('button', { name: /^Style/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    expect(useRailIntent.getState().left).toBeNull();
  });
});

describe('the right rail, shut', () => {
  it('with nothing selected it offers Add, and Add opens the Library', () => {
    render(<RightRailBody open={false} />);
    expect(screen.queryByRole('button', { name: /Open the details panel/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add a piece to the room' }));
    expect(useStudio.getState().catalogOpen).toBe(true);
  });

  it('with a piece selected it shows that piece, and pressing it opens the rail', () => {
    act(() => useStudio.getState().setSelected('sofa-1'));
    render(<RightRailBody open={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the details panel for Sofa' }));
    expect(useStudio.getState().railRightOpen).toBe(true);
  });

  it('opening from the selection icon lands focus in the panel it opened', () => {
    // The icon that was pressed unmounts with the strip; without a landing, focus
    // falls to the page and the next Tab starts again at the top bar.
    function Rail() {
      return <RightRailBody open={useStudio((s) => s.railRightOpen)} />;
    }
    act(() => useStudio.getState().setSelected('sofa-1'));
    const { container } = render(<Rail />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the details panel for Sofa' }));
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);

    // Taken once: shut it and open it again the other way, from the rail's own
    // chevron, and focus stays on the chevron that was pressed.
    const chevron = document.createElement('button');
    document.body.appendChild(chevron);
    act(() => useStudio.setState({ railRightOpen: false }));
    chevron.focus();
    act(() => useStudio.setState({ railRightOpen: true }));
    expect(document.activeElement).toBe(chevron);
    chevron.remove();
  });

  it('caps the selection count on its badge, as the catalog icon does', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ ...sofa, id: `sofa-${i}` }));
    act(() => {
      useScene.getState().setParts(many);
      useStudio.setState({ selectedPartId: 'sofa-0', selection: many.map((p) => p.id) });
    });
    render(<RightRailBody open={false} />);
    expect(screen.getByRole('button', { name: /120 selected pieces/ }).textContent).toBe('99+');
  });
});

describe('side tooltips', () => {
  const bubble = () => document.body.querySelector<HTMLElement>('[role="tooltip"]');
  function openAt(placement: 'left' | 'right', rect: Partial<DOMRect>) {
    render(
      <Tooltip label="Style" placement={placement}>
        <button type="button">s</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button', { name: 's' });
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, ...rect } as DOMRect);
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' });
    return bubble()!;
  }

  it("'right' sits beside the trigger, centred on it", () => {
    const b = openAt('right', { left: 6, right: 38, top: 100, bottom: 132, width: 32, height: 32 });
    expect(b.style.left).toBe('46px');
    expect(b.style.top).toBe('116px');
    expect(b.style.transform).toBe('translate(0, -50%)');
  });

  it("'left' mirrors it from the trigger's left edge", () => {
    const b = openAt('left', { left: 900, right: 932, top: 100, bottom: 132, width: 32, height: 32 });
    expect(b.style.left).toBe('892px');
    expect(b.style.transform).toBe('translate(-100%, -50%)');
  });

  it("the strips' icons use them: rightward off the left rail, leftward off the right", () => {
    // Leftward off the LEFT rail would open over the window's edge; above or below,
    // over the neighbouring icon.
    render(<LeftRailBody open={false} />);
    fireEvent.pointerEnter(screen.getByRole('button', { name: "Open the room's style and light" }), { pointerType: 'mouse' });
    expect(bubble()?.style.transform).toBe('translate(0, -50%)');
    cleanup();
    render(<RightRailBody open={false} />);
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Add a piece to the room' }), { pointerType: 'mouse' });
    expect(bubble()?.style.transform).toBe('translate(-100%, -50%)');
  });

  it('is never wider than the room on its side, so it wraps instead of running off', () => {
    // jsdom's window is 1024 wide: a trigger ending at 900 leaves 1024 - 8 - 908 = 108.
    const b = openAt('right', { left: 868, right: 900, top: 100, bottom: 132, width: 32, height: 32 });
    expect(b.style.maxWidth).toBe('108px');
  });

  it('stays on screen for a trigger at the very top', () => {
    const b = openAt('right', { left: 6, right: 38, top: 0, bottom: 4, width: 32, height: 4 });
    // MARGIN 8 + half of the 28px one-line height.
    expect(b.style.top).toBe('22px');
  });
});
