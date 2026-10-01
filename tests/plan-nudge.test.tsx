// @vitest-environment jsdom
//
// An arrow key in the plan moves a piece one step, and with the snap on it stops on the
// first line it reaches on the way: a neighbour's edge or centre. Grid marks are not
// stopping points, so a piece off the grid stays off it.
//
// Both steps are shorter than the drag magnet's reach — 10 mm (Fine) and 50 mm (Coarse)
// against 100 — and a key press used to run through that magnet. So a piece standing
// flush with a neighbour, or centred on one, was pulled back onto that line on every
// press and could not be arrowed off it; coming the other way, the press that took the
// gap under 100 mm jumped the rest of it. Turning the snap off for a press fixed both
// and broke the landing: on Coarse a 30 mm gap could not be closed at all, and on Fine
// a piece 5 mm off its neighbour went 5 mm into it. Lines ahead of the piece, met
// rather than stepped over, give both halves — and a press into a neighbour it is
// already touching does not move it.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { footprintForLayout } from '@/lib/footprint';
import { currentRoomScene } from '@/lib/room-scene';
import type { SnapMode } from '@/lib/drag-resolve';
import type { ScenePart } from '@/lib/scene-spec';
import { ANNOUNCE_EVENT } from '@/lib/announce';
import { stubPlanCanvas } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('plan-nudge', 'plan'));
const { PlanView } = await import('@/components/studio/PlanView');

const box = (id: string, name: string, x: number, w: number, z = 0): ScenePart =>
  ({
    id, name, category: 'other', shape: 'box', locked: false,
    dimMM: [w, 400, 700], pos: [x, 0, z], rot: 0, wallMounted: false,
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

function room(crateX: number, snapMode: SnapMode, crateZ = 0) {
  useScene.setState({
    parts: [box('chest', 'Chest', 0, 600), box('crate', 'Crate', crateX, 400, crateZ)],
    room: { ...useScene.getState().room, width: 6, depth: 5, height: 2.5, footprint: footprintForLayout('rect', 6, 5), layoutId: 'rect' },
  });
  useStudio.setState({
    positions: {}, rotations: {}, dims: {}, parentIds: {}, hidden: {},
    selection: [], selectedPartId: null, snapMode,
  });
}

const at = (id: string) => currentRoomScene().find((p) => p.id === id)!.pos;
const crate = () => at('crate');

const buttonFor = (name: string) =>
  screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith(`${name}.`))!;

function press(key: string, times: number, name = 'Crate') {
  for (let i = 0; i < times; i++) fireEvent.keyDown(buttonFor(name), { key });
}

/** Every sentence the studio's live region was handed while `run` ran. */
function listening(run: () => void): string[] {
  const spoken: string[] = [];
  const hear = (e: Event) => spoken.push((e as CustomEvent<string>).detail);
  window.addEventListener(ANNOUNCE_EVENT, hear);
  try {
    run();
  } finally {
    window.removeEventListener(ANNOUNCE_EVENT, hear);
  }
  return spoken;
}

/** Whether anything in the plan is drawn as refused. */
const drawnRefused = (container: HTMLElement) => container.innerHTML.includes('var(--danger)');

describe('an arrow key leaves a line it stands on (plan tab)', () => {
  it('moves a piece off the neighbour it is flush with, snap Fine', () => {
    room(FLUSH, 'fine');
    render(<PlanView />);
    press('ArrowRight', 3);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.03, 9);
  });

  it('moves it off with snap Coarse, by the coarse step', () => {
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
    // 150 mm apart. Six presses close 60 mm of it; the sixth used to take the gap to
    // 90 mm, inside the drag magnet's 100, and land flush — 90 mm in one press.
    room(FLUSH + 0.15, 'fine');
    render(<PlanView />);
    press('ArrowLeft', 6);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.09, 9);
  });

  it('does not slide the piece sideways onto a line it is not moving along', () => {
    // 50 mm off the chest's centre line along z, so the drag magnet would pull it level.
    // A press to the right moves it right and nowhere else.
    room(FLUSH + 0.3, 'fine', 0.05);
    render(<PlanView />);
    press('ArrowRight', 1);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.31, 9);
    expect(crate()[2]).toBeCloseTo(0.05, 9);
  });
});

describe('an arrow key lands on the first line it reaches (plan tab)', () => {
  it('closes a gap shorter than the coarse step, flush', () => {
    // 30 mm apart: a whole 50 mm step would put the crate 20 mm into the chest.
    room(FLUSH + 0.03, 'coarse');
    render(<PlanView />);
    press('ArrowLeft', 1);
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
  });

  it('closes a gap shorter than the fine step, flush and not inside', () => {
    // 5 mm apart: a whole 10 mm step is 5 mm into the chest, which the touching
    // allowance would have accepted and kept.
    room(FLUSH + 0.005, 'fine');
    render(<PlanView />);
    press('ArrowLeft', 1);
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
  });

  it('keeps a piece that is off the grid off it, by a whole step', () => {
    // Stopping on the next grid mark would make this press 5 mm, and from a flush
    // position the next mark can be a hair away.
    room(1.505, 'fine');
    render(<PlanView />);
    press('ArrowRight', 1);
    expect(crate()[0]).toBeCloseTo(1.515, 9);
  });

  it('does not move a piece into the neighbour it is touching', () => {
    // A whole Fine step is exactly the collision test's touching allowance, so it was
    // float noise whether the crate went 10 mm into the chest and stayed there.
    room(FLUSH, 'fine');
    render(<PlanView />);
    press('ArrowLeft', 3);
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
  });

  it('takes the exact step with the snap off', () => {
    room(1.505, 'off');
    render(<PlanView />);
    press('ArrowRight', 1);
    expect(crate()[0]).toBeCloseTo(1.515, 9);
  });

  it('takes a shorter step exactly when the rest of the selection runs out of room', () => {
    // The tote is selected with the crate and stands 5 mm off the east wall (x = 3), so
    // the set can go 5 of the 10 mm. The crate is re-resolved at that shorter step, and
    // it must not be put back on a grid mark: rounded, 5 mm is either back where it
    // started or 5 mm further than the tote can follow, and the press does nothing.
    room(FLUSH, 'fine');
    useScene.setState({ parts: [...useScene.getState().parts, box('tote', 'Tote', 2.795, 400)] });
    useStudio.setState({ selection: ['crate', 'tote'], selectedPartId: 'crate' });
    render(<PlanView />);
    press('ArrowRight', 1);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.005, 9);
    expect(at('tote')[0]).toBeCloseTo(2.8, 9);
  });

  it('steps onto a neighbour that is not in its way', () => {
    // A rug: the collision test lets the crate stand on it, so the press is not stopped
    // at its edge either.
    room(FLUSH, 'fine');
    useScene.setState({ parts: [{ ...box('rug', 'Rug', 0, 600), category: 'rug' }, box('crate', 'Crate', FLUSH, 400)] });
    render(<PlanView />);
    press('ArrowLeft', 1);
    expect(crate()[0]).toBeCloseTo(FLUSH - 0.01, 9);
  });

  it('does not stop on a line of a piece selected with it', () => {
    // The tote moves with the crate, 3 mm short of lining up with it. Stopping there
    // took 7 mm off every press, because the tote had moved on by the next one.
    room(FLUSH + 0.3, 'fine');
    useScene.setState({ parts: [...useScene.getState().parts, box('tote', 'Tote', FLUSH + 0.297, 400, 0.7)] });
    useStudio.setState({ selection: ['crate', 'tote'], selectedPartId: 'crate' });
    render(<PlanView />);
    press('ArrowRight', 2);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.32, 9);
    expect(at('tote')[0]).toBeCloseTo(FLUSH + 0.317, 9);
  });

  it('stops the rest of the selection where the piece stops', () => {
    // The tote is selected with the crate and stands flush behind it, and the crate is
    // 3 mm off the chest. A Coarse press stops the crate flush after 3 mm, and the tote
    // was checked where the whole 50 mm step would have put it — 47 mm inside the crate
    // — so the set was refused by its own member.
    room(FLUSH + 0.003, 'coarse');
    useScene.setState({ parts: [...useScene.getState().parts, box('tote', 'Tote', FLUSH + 0.403, 400)] });
    useStudio.setState({ selection: ['crate', 'tote'], selectedPartId: 'crate' });
    render(<PlanView />);
    expect(listening(() => press('ArrowLeft', 1))).toEqual([]);
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
    expect(at('tote')[0]).toBeCloseTo(FLUSH + 0.4, 9);
  });

  it('steps from the room as it is when a key is pressed during a drag', () => {
    // The crate is dragged away from the tote, and the tote is arrowed toward where
    // the crate stood. Read off the drag's pointer-down world, the tote bumped into the
    // crate that was no longer there and stopped flush with it at 1.9.
    room(1.5, 'fine');
    useScene.setState({ parts: [...useScene.getState().parts, box('tote', 'Tote', 2.0, 400)] });
    restoreRect = stubPlanCanvas();
    const { container } = render(<PlanView />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(buttonFor('Crate'), { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    for (let dy = 1; dy <= 300 && crate()[2] < 0.7; dy++) {
      fireEvent.pointerMove(svg, { clientX: 500, clientY: 500 + dy, pointerId: 1 });
    }
    expect(crate()[2]).toBeGreaterThanOrEqual(0.7);
    press('ArrowLeft', 12, 'Tote');
    fireEvent.pointerUp(svg, { clientX: 500, clientY: 600, pointerId: 1 });
    expect(at('tote')[0]).toBeCloseTo(1.88, 9);
  });

  it('turns from the room as it is when a key is pressed during a drag', () => {
    // Shift+arrow is the same gesture as an arrow, and read the same drag state. A turn
    // takes the angle either way and only SAYS whether it fits, so the sentence is the
    // thing to read: against the crate where it stood when the drag began, 10 mm away,
    // the tote's corner swung into it and was told it does not fit.
    room(1.5, 'fine');
    useScene.setState({ parts: [...useScene.getState().parts, box('tote', 'Tote', 2.11, 800)] });
    restoreRect = stubPlanCanvas();
    const spoken = listening(() => {
      const { container } = render(<PlanView />);
      const svg = container.querySelector('svg')!;
      fireEvent.pointerDown(buttonFor('Crate'), { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
      for (let dy = 1; dy <= 300 && crate()[2] < 0.7; dy++) {
        fireEvent.pointerMove(svg, { clientX: 500, clientY: 500 + dy, pointerId: 1 });
      }
      expect(crate()[2]).toBeGreaterThanOrEqual(0.7);
      fireEvent.keyDown(buttonFor('Tote'), { key: 'ArrowRight', shiftKey: true });
      fireEvent.pointerUp(svg, { clientX: 500, clientY: 600, pointerId: 1 });
    });
    expect(spoken.filter((s) => s.startsWith('Tote'))).toEqual(['Tote turned to 15 degrees.']);
    expect(currentRoomScene().find((p) => p.id === 'tote')!.rot).toBeCloseTo(Math.PI / 12, 9);
  });

  it('still snaps a drag flush', () => {
    // The drag half of the same call site: a pointer keeps the drag magnet, so a piece
    // dragged in close is pulled onto its neighbour's edge from 100 mm out.
    room(FLUSH + 0.15, 'fine');
    restoreRect = stubPlanCanvas();
    const { container } = render(<PlanView />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(buttonFor('Crate'), { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    // Steered by the crate's own position, one pixel at a time, until it is inside
    // 95 mm of the chest — where, snapped, it can only be flush.
    for (let dx = 1; dx <= 200 && crate()[0] > FLUSH + 0.095; dx++) {
      fireEvent.pointerMove(svg, { clientX: 500 - dx, clientY: 500, pointerId: 1 });
    }
    fireEvent.pointerUp(svg, { clientX: 400, clientY: 500, pointerId: 1 });
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
  });
});

describe('an arrow key that goes nowhere says so (plan tab)', () => {
  // The last candidate of every press is the spot the piece stands on, so a press that
  // could not go anywhere was accepted there and said nothing — at a neighbour, at the
  // room's edge, and with a set that could not follow alike.
  it('says so at a neighbour it is touching, and draws nothing in red', () => {
    room(FLUSH, 'fine');
    const { container } = render(<PlanView />);
    expect(listening(() => press('ArrowLeft', 2))).toEqual([
      'Crate cannot go any further that way.',
      'Crate cannot go any further that way.',
    ]);
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
    expect(drawnRefused(container)).toBe(false);
    // …and a press that does move says nothing.
    expect(listening(() => press('ArrowRight', 1))).toEqual([]);
    expect(crate()[0]).toBeCloseTo(FLUSH + 0.01, 9);
  });

  it("says so at the room's edge", () => {
    room(2.8, 'fine');
    render(<PlanView />);
    expect(listening(() => press('ArrowRight', 1))).toEqual(['Crate cannot go any further that way.']);
    expect(crate()[0]).toBeCloseTo(2.8, 9);
  });

  it('says why when the step itself was refused, in red', () => {
    // Snap off, the crate already 5 mm into the chest — inside the touching allowance —
    // and the exact step would take it 15 mm in.
    room(FLUSH - 0.005, 'off');
    const { container } = render(<PlanView />);
    expect(listening(() => press('ArrowLeft', 1))).toEqual(['Crate will not fit there: something is in the way.']);
    expect(crate()[0]).toBeCloseTo(FLUSH - 0.005, 9);
    expect(drawnRefused(container)).toBe(true);
  });

  it('leaves a drag held against the wall silent', () => {
    // A hand holding a piece against the wall can see it is not moving; saying so on
    // every frame would talk over everything else the live region has to say.
    room(2.8, 'fine');
    restoreRect = stubPlanCanvas();
    const spoken = listening(() => {
      const { container } = render(<PlanView />);
      const svg = container.querySelector('svg')!;
      fireEvent.pointerDown(buttonFor('Crate'), { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
      for (let dx = 1; dx <= 40; dx++) fireEvent.pointerMove(svg, { clientX: 500 + dx, clientY: 500, pointerId: 1 });
      fireEvent.pointerUp(svg, { clientX: 540, clientY: 500, pointerId: 1 });
    });
    expect(crate()[0]).toBeCloseTo(2.8, 9);
    expect(spoken).toEqual([]);
  });

  it('names the piece in the set that cannot follow, in red', () => {
    // The tote is selected with the crate and already stands against the east wall.
    room(FLUSH, 'fine');
    useScene.setState({ parts: [...useScene.getState().parts, box('tote', 'Tote', 2.8, 400)] });
    useStudio.setState({ selection: ['crate', 'tote'], selectedPartId: 'crate' });
    const { container } = render(<PlanView />);
    expect(listening(() => press('ArrowRight', 1))).toEqual([
      'Tote will not fit there, so the rest of the selection cannot follow.',
    ]);
    expect(crate()[0]).toBeCloseTo(FLUSH, 9);
    expect(drawnRefused(container)).toBe(true);
  });
});
