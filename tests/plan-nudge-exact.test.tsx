// @vitest-environment jsdom
//
// An arrow key in the plan moves a piece by exactly one step, whatever it is lined up
// with.
//
// Both steps are shorter than the item magnet's reach — 10 mm (fine) and 50 mm
// (coarse) against 100 — and a key press used to run through the magnet like a drag.
// So a piece standing flush with a neighbour, or centred on one, was pulled back onto
// that line on every press: in either snap mode it could not be moved off it from the
// keyboard at all. Coming the other way, the press that took the gap under 100 mm
// jumped the whole rest of it. A drag still snaps; it is the press that asks for an
// exact step, the way a turn asks to stay where it stands (`turnInPlace`).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { footprintForLayout } from '@/lib/footprint';
import { currentRoomScene } from '@/lib/room-scene';
import type { SnapMode } from '@/lib/drag-resolve';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('plan-nudge-exact', 'plan'));
const { PlanView } = await import('@/components/studio/PlanView');

const box = (id: string, name: string, x: number, w: number): ScenePart =>
  ({
    id, name, category: 'other', shape: 'box', locked: false,
    dimMM: [w, 400, 700], pos: [x, 0, 0], rot: 0, wallMounted: false,
  }) as ScenePart;

/** The chest's right edge is at 0.30. The crate is 400 wide, so at 0.50 it stands
 *  flush against it — and centred on it along z, with both edges level too. */
const FLUSH = 0.5;

let restoreRect: (() => void) | null = null;
afterEach(() => {
  cleanup();
  restoreRect?.();
  restoreRect = null;
});

function room(crateX: number, snapMode: SnapMode) {
  useScene.setState({
    parts: [box('chest', 'Chest', 0, 600), box('crate', 'Crate', crateX, 400)],
    room: { ...useScene.getState().room, width: 6, depth: 5, height: 2.5, footprint: footprintForLayout('rect', 6, 5), layoutId: 'rect' },
  });
  useStudio.setState({
    positions: {}, rotations: {}, dims: {}, parentIds: {}, hidden: {},
    selection: [], selectedPartId: null, snapMode,
  });
}

const crate = () => currentRoomScene().find((p) => p.id === 'crate')!.pos;

function press(key: string, times: number) {
  const button = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Crate.'))!;
  for (let i = 0; i < times; i++) fireEvent.keyDown(button, { key });
}

describe('an arrow key moves exactly one step (plan tab)', () => {
  it('moves a piece off the neighbour it is flush with, snap fine', () => {
    room(FLUSH, 'fine');
    render(<PlanView />);
    press('ArrowRight', 3);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.03, 9);
  });

  it('moves it off with snap coarse, by the coarse step', () => {
    room(FLUSH, 'coarse');
    render(<PlanView />);
    press('ArrowRight', 1);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.05, 9);
  });

  it('moves it off a centre line, not just an edge', () => {
    // Along z the crate is centred on the chest, which is the other kind of line.
    room(FLUSH, 'fine');
    render(<PlanView />);
    press('ArrowDown', 1);
    expect(crate()[2]).toBeCloseTo(0.01, 9);
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
  });

  it('does not jump the rest of a gap on the way in', () => {
    // 150 mm apart. Five presses close 50 mm of it; the fifth used to take the gap
    // under the magnet's 100 mm and land flush, 100 mm in one press.
    room(FLUSH + 0.15, 'fine');
    render(<PlanView />);
    press('ArrowLeft', 5);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.1, 9);
  });

  it('takes a shorter step exactly when the rest of the selection runs out of room', () => {
    // The tote is selected with the crate and stands 5 mm off the east wall (x = 3), so
    // the set can go 5 of the 10 mm. The crate is re-resolved at that shorter step, and
    // it has to be the same exact step: snapped, 5 mm from its flush line is back on it,
    // and a set that goes nowhere is refused.
    room(FLUSH, 'fine');
    useScene.setState({ parts: [...useScene.getState().parts, box('tote', 'Tote', 2.795, 400)] });
    useStudio.setState({ selection: ['crate', 'tote'], selectedPartId: 'crate' });
    render(<PlanView />);
    press('ArrowRight', 1);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.005, 9);
    expect(currentRoomScene().find((p) => p.id === 'tote')!.pos[0]).toBeCloseTo(2.8, 9);
  });

  it('still snaps a drag flush', () => {
    // The drag half of the same call site: a pointer keeps the setting, so the magnet
    // still pulls a piece dragged in close onto its neighbour's edge.
    room(FLUSH + 0.15, 'fine');
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      if (this.tagName.toLowerCase() !== 'svg') return real.call(this);
      return { x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => ({}) } as DOMRect;
    };
    restoreRect = () => {
      Element.prototype.getBoundingClientRect = real;
    };
    const { container } = render(<PlanView />);
    const svg = container.querySelector('svg')!;
    const button = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Crate.'))!;
    fireEvent.pointerDown(button, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    // Steered by the crate's own position, one pixel at a time, until it is inside
    // 95 mm of the chest — where, snapped, it can only be flush.
    for (let dx = 1; dx <= 200 && crate()[0] > FLUSH + 0.095; dx++) {
      fireEvent.pointerMove(svg, { clientX: 500 - dx, clientY: 500, pointerId: 1 });
    }
    fireEvent.pointerUp(svg, { clientX: 400, clientY: 500, pointerId: 1 });
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
  });
});
