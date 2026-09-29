// @vitest-environment jsdom
//
// The right rail with nothing selected (`EmptyInspector`). It used to say "Nothing
// selected" and nothing else. Now it says how to pick a piece, shows the room at a
// glance, and offers the two whole-room edits, both of which land in the LEFT rail.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSettings, useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { useRailIntent } from '@/lib/rail-intent';
import { footprintForLayout } from '@/lib/footprint';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('empty-room', 'model'));

const { Inspector } = await import('@/components/studio/Inspector');

const baseRoom = useScene.getState().room;

beforeEach(() => {
  useRailIntent.setState({ left: null });
  useSettings.setState({ dimUnit: 'm' });
  useScene.setState({ room: { ...baseRoom, width: 5, depth: 4, layoutId: 'l', footprint: footprintForLayout('l', 5, 4), roughSize: undefined }, parts: [] });
  useStudio.setState({ railLeftOpen: false, selectedPartId: null, selection: [], selectedWall: null });
});
afterEach(() => cleanup());

describe('the Inspector with nothing selected', () => {
  it('says what goes here and how to fill it', () => {
    render(<Inspector />);
    expect(screen.getByRole('heading', { name: 'Pick a piece to style it' })).toBeTruthy();
  });

  it("states the room's floor area off its outline, not its box", () => {
    render(<Inspector />);
    const card = screen.getByRole('region', { name: 'This room' });
    // An L at 5 × 4 m: 16.472 m², where `width × depth` would say 20.
    expect(card.textContent).toContain('16.5');
    expect(card.textContent).not.toMatch(/\b20(\.0)?\s*m²/);
  });

  it('marks every number as approximate while the room is at its typical size', () => {
    useScene.setState({ room: { ...useScene.getState().room, roughSize: true } });
    render(<Inspector />);
    expect((screen.getByRole('region', { name: 'This room' }).textContent?.match(/≈/g) ?? []).length).toBe(2);
  });

  it.each([
    ['Restyle it', 'style'],
    ['Resize it', 'room'],
  ] as const)('%s opens the left rail on %s', (label, section) => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    expect(useRailIntent.getState().left).toBe(section);
    expect(useStudio.getState().railLeftOpen).toBe(true);
  });

  it('and leaves an already-open left rail open', () => {
    // `toggleRail` flips, so pressing a path with the rail already open must not call it.
    useStudio.setState({ railLeftOpen: true });
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /Resize it/ }));
    expect(useStudio.getState().railLeftOpen).toBe(true);
    expect(useRailIntent.getState().left).toBe('room');
  });
});
