// @vitest-environment jsdom
//
// § H.6.7 — the plan tab writes down what a piece was set down on.
//
// A drag's company is planned from the rider relation, and the relation's recorded half
// is written on a landing. The 3D tab's drop always wrote it; the plan tab never did, so
// a lamp moved here onto the other nightstand kept the FIRST one's link, and moving the
// second nightstand left the lamp standing on air over it. This drives the arrow keys
// (the plan's own gesture with no drop to wait for) and then asks what a drag of the
// second nightstand would carry. A pointer drag is driven too, because it records at a
// different moment: on the release, once, rather than on every frame.
//
// Snap is OFF here so the pointer drag goes where it is steered: with it on, the item
// magnet pulls the lamp onto its lines with both nightstands. The arrow keys no longer
// snap either way (§ H.6.8, `tests/plan-nudge-exact.test.tsx`).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { footprintForLayout } from '@/lib/footprint';
import { currentRiderRelation, currentRoomScene } from '@/lib/room-scene';
import { planConvoy } from '@/lib/drag-convoy';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('plan-landing', 'plan'));
const { PlanView } = await import('@/components/studio/PlanView');

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart =>
  ({
    name: 'Piece', category: 'other', shape: 'box', locked: false,
    dimMM: [600, 400, 700], pos: [0, 0, 0], rot: 0, wallMounted: false,
    ...over,
  }) as ScenePart;

const stand = (id: string, name: string, x: number) =>
  part({ id, name, category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [x, 0, 0] });

let restoreRect: (() => void) | null = null;
afterEach(() => {
  cleanup();
  restoreRect?.();
  restoreRect = null;
});

/** jsdom lays nothing out, so the plan's `<svg>` measures 0 × 0 and every pointer maps
 *  to one point. A square canvas is enough: the drag below steers by the lamp's own
 *  position, so the scale the plan fits the room at does not have to be known here. */
function stubCanvas() {
  const real = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    if (this.tagName.toLowerCase() !== 'svg') return real.call(this);
    return { x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => ({}) } as DOMRect;
  };
  restoreRect = () => {
    Element.prototype.getBoundingClientRect = real;
  };
}

function room(parentIds: Record<string, string>) {
  const lamp = part({ id: 'lamp', name: 'Lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0.1, 0.55, 0] });
  useScene.setState({
    parts: [stand('n1', 'Left', 0), stand('n2', 'Right', 0.45), lamp],
    room: { ...useScene.getState().room, width: 6, depth: 5, height: 2.5, footprint: footprintForLayout('rect', 6, 5), layoutId: 'rect' },
  });
  useStudio.setState({
    positions: {}, rotations: {}, dims: {}, parentIds, hidden: {},
    selection: [], selectedPartId: null, snapMode: 'off',
  });
}

/** 30 presses of 10 mm: from 0.10 to 0.40, which takes the lamp's whole foot off the
 *  left nightstand (right edge 0.225) and onto the right one. */
function nudgeLampRight() {
  render(<PlanView />);
  const key = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Lamp.'))!;
  for (let i = 0; i < 30; i++) fireEvent.keyDown(key, { key: 'ArrowRight' });
}

const carriedBy = (id: string) =>
  planConvoy({
    draggedId: id,
    parts: currentRoomScene(),
    selection: [id],
    restsOn: currentRiderRelation(),
    footprint: useScene.getState().room.footprint,
    roomHeight: 2.5,
  }).own.map((d) => d.id);

describe('the plan tab records a landing (§ H.6.7)', () => {
  it('moves a dragged lamp’s link to the nightstand it was nudged onto', () => {
    room({ lamp: 'n1' });
    nudgeLampRight();
    expect(currentRoomScene().find((p) => p.id === 'lamp')!.pos[0]).toBeCloseTo(0.4, 6);
    expect(useStudio.getState().parentIds).toEqual({ lamp: 'n2' });
    // …which is the whole point: the right nightstand now takes it along.
    expect(carriedBy('n2')).toEqual(['lamp']);
    expect(carriedBy('n1')).toEqual([]);
  });

  it('writes the link for a lamp the room came with, too', () => {
    // No recorded link at all — the room's own lamp, inferred onto the left nightstand
    // from the authored parts. Those parts are never rewritten, so without a recorded
    // link on the right one the relation would go on naming the left.
    room({});
    nudgeLampRight();
    expect(useStudio.getState().parentIds).toEqual({ lamp: 'n2' });
    expect(carriedBy('n2')).toEqual(['lamp']);
  });

  it('records a pointer drag’s landing once, on the release', () => {
    room({ lamp: 'n1' });
    stubCanvas();
    const { container } = render(<PlanView />);
    const svg = container.querySelector('svg')!;
    const key = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Lamp.'))!;
    const lampX = () => currentRoomScene().find((p) => p.id === 'lamp')!.pos[0];
    fireEvent.pointerDown(key, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    for (let dx = 2; dx <= 600 && lampX() < 0.4; dx += 2) {
      fireEvent.pointerMove(svg, { clientX: 500 + dx, clientY: 500, pointerId: 1 });
    }
    expect(lampX()).toBeGreaterThanOrEqual(0.4);
    // Over the right nightstand, and the record not yet touched: a frame is not a drop.
    expect(useStudio.getState().parentIds).toEqual({ lamp: 'n1' });
    fireEvent.pointerUp(svg, { clientX: 500, clientY: 500, pointerId: 1 });
    expect(useStudio.getState().parentIds).toEqual({ lamp: 'n2' });
    expect(carriedBy('n2')).toEqual(['lamp']);
  });

  it('records nothing for a click, however much the pointer jittered', () => {
    // The room's own lamp, never linked. A press and release a couple of pixels apart
    // still moves it a little with snap off, but it is a click, not a drop, and a
    // recorded link is honoured where an inferred one is only a guess.
    room({});
    stubCanvas();
    const { container } = render(<PlanView />);
    const svg = container.querySelector('svg')!;
    const key = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Lamp.'))!;
    fireEvent.pointerDown(key, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 502, clientY: 500, pointerId: 1 });
    expect(currentRoomScene().find((p) => p.id === 'lamp')!.pos[0]).not.toBe(0.1);
    fireEvent.pointerUp(svg, { clientX: 502, clientY: 500, pointerId: 1 });
    expect(useStudio.getState().parentIds).toEqual({});
  });

  it('keeps a drag’s landing its own when an arrow key moves another piece mid-drag', () => {
    // The right nightstand is nudged off along the floor while the lamp is being
    // dragged. Its landing — on the floor — is its own; handed to the lamp, the release
    // unlinked a lamp still standing on the left nightstand.
    room({ lamp: 'n1' });
    stubCanvas();
    const { container } = render(<PlanView />);
    const svg = container.querySelector('svg')!;
    const button = (name: string) => screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith(`${name}.`))!;
    fireEvent.pointerDown(button('Lamp'), { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 490, clientY: 500, pointerId: 1 });
    fireEvent.keyDown(button('Right'), { key: 'ArrowRight' });
    expect(currentRoomScene().find((p) => p.id === 'n2')!.pos[0]).toBeGreaterThan(0.45);
    fireEvent.pointerUp(svg, { clientX: 490, clientY: 500, pointerId: 1 });
    expect(useStudio.getState().parentIds).toEqual({ lamp: 'n1' });
  });
});
