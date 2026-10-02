// @vitest-environment jsdom
//
// § H.6.7 — a drag out and back leaves the room as it found it.
//
// Both tabs write a drag's company live, frame by frame, and a write is an override: it
// pins the piece against a re-detect and is saved with the room. So a nightstand dragged
// out and back, or one Escape cancelled, left its lamp and the rest of the selection
// pinned where they already stood — and the nightstand itself. The gesture now drops, as
// it ends, every override it CREATED for a piece that ended where it began
// (`overridesBroughtHome`). An override the user already had is theirs, and stays.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { footprintForLayout } from '@/lib/footprint';
import { overridesBroughtHome } from '@/lib/transforms';
import type { ScenePart } from '@/lib/scene-spec';
import { stubPlanCanvas } from './helpers/mount';
import { stripComments } from './helpers/source';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('drag-out-and-back', 'plan'));
const { PlanView } = await import('@/components/studio/PlanView');

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart =>
  ({
    name: 'Piece', category: 'other', shape: 'box', locked: false,
    dimMM: [600, 400, 700], pos: [0, 0, 0], rot: 0, wallMounted: false,
    ...over,
  }) as ScenePart;

describe('overridesBroughtHome', () => {
  const a = part({ id: 'a', pos: [1, 0, 2], rot: 0.5 });
  const start = [a];
  type Maps = Parameters<typeof overridesBroughtHome>[0];
  const none: Maps = { positions: {}, rotations: {} };
  const after = (pos: [number, number, number], rot: number): Maps => ({ positions: { a: pos }, rotations: { a: rot } });

  it.each([
    ['home, both made by the gesture', none, after([1, 0, 2], 0.5), ['a'], ['a']],
    ['home to float noise', none, after([1 + 1e-12, 0, 2 - 1e-12], 0.5 + 1e-12), ['a'], ['a']],
    ['a whole turn is home', none, after([1, 0, 2], 0.5 + 2 * Math.PI), ['a'], ['a']],
    ['a micron off is a placement', none, after([1 + 1e-6, 0, 2], 0.5 + 1e-5), [], []],
    // Radians, not metres: a wall's heading out of `atan2` is noise at this size, and
    // `SAME_M` read as an angle called it a turn.
    ['a heading inside SAME_TURN is home', none, after([1, 0, 2], 0.5 + 5e-7), ['a'], ['a']],
    ['moved, not turned: the turn goes, the move stays', none, after([1.4, 0, 2], 0.5), [], ['a']],
    ['turned in place: the spot goes, the turn stays', none, after([1, 0, 2], 1.2), ['a'], []],
    ['lifted is not home', none, after([1, 0.3, 2], 0.5), [], ['a']],
    ['already the user’s, home or not', after([1, 0, 2], 0.5), after([1, 0, 2], 0.5), [], []],
  ] as [string, Maps, Maps, string[], string[]][])('%s', (_, before, now, pos, rot) => {
    expect(overridesBroughtHome(before, now, start)).toEqual({ positions: pos, rotations: rot });
  });

  it('asks only about pieces the gesture began with', () => {
    expect(overridesBroughtHome(none, after([1, 0, 2], 0.5), [])).toEqual({ positions: [], rotations: [] });
  });
});

describe('forgetOverrides', () => {
  it('drops exactly the named overrides, in one update', () => {
    useStudio.setState({ positions: { a: [0, 0, 0], b: [1, 0, 0] }, rotations: { a: 1, b: 2 }, dims: { a: [1, 1, 1] } });
    useStudio.getState().forgetOverrides({ positions: ['a'], rotations: ['b'] }, { positions: {}, rotations: {} });
    const s = useStudio.getState();
    expect(s.positions).toEqual({ b: [1, 0, 0] });
    expect(s.rotations).toEqual({ a: 1 });
    expect(s.dims).toEqual({ a: [1, 1, 1] });
  });

  it('writes nothing, and tells no one, when there is nothing to drop', () => {
    useStudio.setState({ positions: { a: [0, 0, 0] }, rotations: {} });
    const was = useStudio.getState();
    const heard = vi.fn();
    const off = useStudio.subscribe(heard);
    useStudio.getState().forgetOverrides({ positions: ['zz'], rotations: ['a'] }, was);
    off();
    expect(useStudio.getState()).toBe(was);
    expect(heard).not.toHaveBeenCalled();
  });

  it('hands back the maps the gesture began with when it leaves them as they were', () => {
    // History compares by reference: a copy of the room it already holds is an undo
    // step that changes nothing.
    const before = { positions: { b: [1, 0, 0] as [number, number, number] }, rotations: { a: 1 } };
    useStudio.setState({ positions: { a: [0, 0, 0], b: [1, 0, 0] }, rotations: { a: 1 } });
    useStudio.getState().forgetOverrides({ positions: ['a'], rotations: [] }, before);
    expect(useStudio.getState().positions).toBe(before.positions);
    expect(useStudio.getState().rotations).toBe(before.rotations);
  });

  it('keeps its own copy when the contents differ', () => {
    const before = { positions: { b: [1, 0, 0] as [number, number, number] }, rotations: { b: 1 } };
    useStudio.setState({ positions: { a: [0, 0, 0], b: [1.5, 0, 0] }, rotations: { b: 2 } });
    useStudio.getState().forgetOverrides({ positions: ['a'], rotations: [] }, before);
    expect(useStudio.getState().positions).toEqual({ b: [1.5, 0, 0] });
    expect(useStudio.getState().positions).not.toBe(before.positions);
    expect(useStudio.getState().rotations).toEqual({ b: 2 });
  });

  it.each([
    ['fewer', { a: [0, 0, 0], b: [1, 0, 0] }, { a: [0, 0, 0] }],
    ['other', { b: [1, 0, 0] }, { a: [1, 0, 0] }],
  ] as [string, Record<string, [number, number, number]>, Record<string, [number, number, number]>][])(
    'keeps its own copy when it holds %s pieces than it began with',
    (_, began, now) => {
      useStudio.setState({ positions: { ...now, gone: [9, 9, 9] }, rotations: {} });
      useStudio.getState().forgetOverrides({ positions: ['gone'], rotations: [] }, { positions: began, rotations: {} });
      expect(useStudio.getState().positions).toEqual(now);
    },
  );
});

let restoreRect: (() => void) | null = null;
afterEach(() => {
  cleanup();
  restoreRect?.();
  restoreRect = null;
});

/** A nightstand with the room's own lamp on it, and a box selected with it. Nothing
 *  carries an override unless `lampPinned`. */
function room({ lampPinned = false } = {}) {
  const ns = part({ id: 'ns', name: 'Nightstand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0] });
  const lamp = part({ id: 'lamp', name: 'Lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0.05, 0.55, 0] });
  const box = part({ id: 'box', name: 'Box', pos: [-1.5, 0, 1.5] });
  useScene.setState({
    parts: [ns, lamp, box],
    room: { ...useScene.getState().room, width: 6, depth: 5, height: 2.5, footprint: footprintForLayout('rect', 6, 5), layoutId: 'rect' },
  });
  useStudio.setState({
    positions: lampPinned ? { lamp: [0.05, 0.55, 0] } : {}, rotations: {}, dims: {}, parentIds: {}, hidden: {},
    selection: ['ns', 'box'], selectedPartId: 'ns', snapMode: 'off',
  });
  restoreRect = stubPlanCanvas();
  const { container } = render(<PlanView />);
  const svg = container.querySelector('svg')!;
  const handle = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Nightstand.'))!;
  return { svg, handle };
}

/** Out 100 px and, unless `stopAt` says otherwise, back to the press. */
function dragOut(svg: Element, handle: Element) {
  fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
  for (let x = 502; x <= 600; x += 2) fireEvent.pointerMove(svg, { clientX: x, clientY: 500, pointerId: 1 });
  // The gesture has written all three: otherwise every assertion below is vacuous.
  expect(Object.keys(useStudio.getState().positions).sort()).toEqual(['box', 'lamp', 'ns']);
}
function comeBack(svg: Element) {
  for (let x = 598; x >= 500; x -= 2) fireEvent.pointerMove(svg, { clientX: x, clientY: 500, pointerId: 1 });
}

describe('a drag out and back in the plan', () => {
  it('pins nothing: not the piece, its lamp or the rest of the selection', () => {
    const { svg, handle } = room();
    const was = useStudio.getState();
    dragOut(svg, handle);
    comeBack(svg);
    fireEvent.pointerUp(svg, { clientX: 500, clientY: 500, pointerId: 1 });
    // The very maps it began with, so history records no step.
    expect(useStudio.getState().positions).toBe(was.positions);
    expect(useStudio.getState().rotations).toBe(was.rotations);
  });

  it('nor does one Escape cancelled', () => {
    const { svg, handle } = room();
    const was = useStudio.getState();
    dragOut(svg, handle);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStudio.getState().positions).toBe(was.positions);
    expect(useStudio.getState().rotations).toBe(was.rotations);
  });

  it('keeps an override the lamp already had', () => {
    const { svg, handle } = room({ lampPinned: true });
    const was = useStudio.getState();
    dragOut(svg, handle);
    comeBack(svg);
    fireEvent.pointerUp(svg, { clientX: 500, clientY: 500, pointerId: 1 });
    expect(useStudio.getState().positions).toBe(was.positions);
  });

  it('keeps every override of a drag that went somewhere', () => {
    const { svg, handle } = room();
    dragOut(svg, handle);
    fireEvent.pointerUp(svg, { clientX: 600, clientY: 500, pointerId: 1 });
    expect(Object.keys(useStudio.getState().positions).sort()).toEqual(['box', 'lamp', 'ns']);
  });
});

describe('the 3D tab asks the same question', () => {
  // No component test can drive `Draggable` under jsdom, so this holds the one
  // structural fact the behaviour rests on: the world a gesture resolves against is
  // opened and closed in one place each, and the close is what unpins.
  const src = stripComments(readFileSync(join(__dirname, '..', 'components/three/Draggable.tsx'), 'utf8'));
  const body = (name: string) => src.slice(src.indexOf(`function ${name}()`), src.indexOf('\n  }\n', src.indexOf(`function ${name}()`)));

  it('clears the gesture world only in closeGestureWorld, which unpins', () => {
    expect(src.match(/effCache\.current = null/g)).toHaveLength(1);
    expect(body('closeGestureWorld')).toMatch(/effCache\.current = null/);
    // …handing over the maps it began with, so history sees the room it already holds.
    expect(body('closeGestureWorld')).toMatch(/forgetOverrides\(overridesBroughtHome\(before, s, start\), before\)/);
  });

  it('opens it only in openGestureWorld, which records the overrides it began with', () => {
    // Once there, once in `effParts`' lazy fill outside any gesture.
    expect(src.match(/effCache\.current = buildEffSnapshot\(\)/g)).toHaveLength(2);
    expect(body('openGestureWorld')).toMatch(/overridesAtStart\.current = \{ positions, rotations \}/);
  });

  it('closes on every release: a drag, a stretch and the gizmo, and on unmount', () => {
    expect(src.match(/closeGestureWorld\(\);/g)).toHaveLength(4);
    expect(src.match(/openGestureWorld\(\);/g)).toHaveLength(4);
  });

  // After `commit()`, every time: the close clears the snapshot `commit()` resolves the
  // company against, and unpins before `commit()` stamps the lead's turn.
  it.each([
    ['the drag', 'function onPointerUp('],
    ['the stretch', 'function releaseStretch()'],
    ['the gizmo', 'onMouseUp={() => {'],
  ])('closes %s after committing it', (_, from) => {
    const at = src.indexOf(from);
    expect(at).toBeGreaterThan(-1);
    const close = src.indexOf('closeGestureWorld();', at);
    const commit = src.indexOf('commit();', at);
    expect(commit).toBeGreaterThan(at);
    expect(commit).toBeLessThan(close);
  });

  it('closes on unmount, the teardown that ends a gesture with no release', () => {
    const from = src.indexOf('if (drag.current?.hold) window.clearTimeout(drag.current.hold);');
    expect(from).toBeGreaterThan(-1);
    const teardown = src.slice(from, src.indexOf('detachTouch();', from));
    expect(teardown).toMatch(/closeGestureWorld\(\);/);
  });
});
