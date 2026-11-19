// @vitest-environment jsdom
//
// I — the eyedropper, as in Figma. The next click on a piece, a wall or the floor
// picks up that surface's OWN colour for the selection.
//
// "Own" is the requirement, in the user's words: "A blue chair might look warmer if
// there's a warm light on in the room and copying the rendered color for a wall would
// be wrong." So nothing here reads a pixel. A pick reads the paint — the stored
// colour, or the default the renderer falls back to — and that is asserted by
// comparing against the same tables the Inspector's swatch shows, under a warm light
// mood that would change every lit pixel in the room.
//
// Mounted through the real studio layout around the real plan page, so the key goes
// through the real shortcut handler and the press through the plan's real handlers.
// The 3D tab's three handlers (Draggable, Pickable, RoomShell) are not reachable
// without WebGL; they call the same `pickColor`, and the visual check covers them.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { footprintForLayout } from '@/lib/footprint';
import { defaultBodyColor, SCENE } from '@/lib/scene-palette';
import { resolveFloor } from '@/lib/floor-finish';
import { trueColorOf, applyColor, setPickHover, colorName } from '@/lib/eyedropper';
import { STUDIO_SURFACE_ID } from '@/components/studio/KeyboardShortcuts';
import type { ScenePart } from '@/lib/scene-spec';
import { viewportAt } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('eyedropper-room'));
vi.mock('@/components/three/RoomHost', () => ({ RoomHostProvider: () => null, RoomSlot: () => null, useRoomHost: () => null }));

const { default: PlanPageAlone } = await import('@/app/room/[roomId]/plan/page');
const { default: StudioLayout } = await import('@/app/room/[roomId]/layout');
function Studio() {
  return (
    <StudioLayout>
      <PlanPageAlone />
    </StudioLayout>
  );
}

const CHAIR = 'chair-1';
const SOFA = 'sofa-1';
const BLUE = '#3a5f8c';
const WALL_GREEN = '#7a9a6e';

function chair(): ScenePart {
  return {
    id: CHAIR, name: 'Armchair', category: 'chair', shape: 'chair-dining', locked: false,
    dimMM: [800, 800, 900], pos: [-1, 0, 0], rot: 0, wallMounted: false,
  } as ScenePart;
}
function sofa(): ScenePart {
  return {
    id: SOFA, name: 'Sofa', category: 'sofa', shape: 'sofa', locked: false,
    dimMM: [2000, 900, 850], pos: [1, 0, 1], rot: 0, wallMounted: false, color: BLUE,
  } as ScenePart;
}

let restore: () => void = () => {};
let copied: string[] = [];
beforeEach(() => {
  cleanup();
  restore = viewportAt(1440);
  useScene.setState({
    parts: [chair(), sofa()],
    room: {
      ...useScene.getState().room,
      width: 4, depth: 4, height: 2.6,
      footprint: footprintForLayout('rect', 4, 4),
      layoutId: 'rect',
      wallColors: { 1: WALL_GREEN },
      floor: undefined,
    },
  });
  useStudio.setState({
    pickingColor: false, uiHidden: false, catalogOpen: false,
    positions: {}, rotations: {}, dims: {},
    selection: [CHAIR], selectedPartId: CHAIR, selectedWall: null, selectedFloor: false,
  });
  copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t: string) => (copied.push(t), Promise.resolve()) },
  });
});
afterEach(() => restore());

const surface = () => document.getElementById(STUDIO_SURFACE_ID)!;
function pressI(target: Element = surface()) {
  if (target === surface()) surface().focus();
  fireEvent.keyDown(target, { key: 'i', code: 'KeyI' });
}
const piece = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}\\. Arrow keys`) });
/** A wall's handle on the plan, by its index in the footprint. */
const wall = (i: number) => document.querySelector<SVGGElement>(`[data-wall="${i}"]`)!;
const press = (el: Element) => fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
const hint = () => document.querySelector<HTMLElement>('.sampler');
const part = (id: string) => useScene.getState().parts.find((p) => p.id === id)!;

describe('what colour a surface "is"', () => {
  it('a named colour is called by its name — paint or floor — and anything else is a hex', () => {
    expect(colorName('#4f6d8c')).toBe('Denim');
    expect(colorName('#E6E1D6')).toBe('Pale oak');
    expect(colorName(BLUE)).toBeNull();
  });

  it('is its paint: the stored colour, or the default the renderer falls back to — never a lit pixel', () => {
    const room = { wallColors: { 1: WALL_GREEN }, floor: undefined };
    const parts = [chair(), sofa()];
    expect(trueColorOf({ kind: 'part', id: SOFA }, parts, room)).toBe(BLUE);
    // An unpainted piece is the colour its Inspector swatch shows as the default.
    expect(trueColorOf({ kind: 'part', id: CHAIR }, parts, room)).toBe(defaultBodyColor('chair', 'chair-dining'));
    expect(trueColorOf({ kind: 'wall', index: 1 }, parts, room)).toBe(WALL_GREEN);
    expect(trueColorOf({ kind: 'wall', index: 0 }, parts, room), 'an unpainted wall').toBe(SCENE.wall);
    expect(trueColorOf({ kind: 'floor' }, parts, room)).toBe(resolveFloor(undefined).color);
    expect(trueColorOf({ kind: 'part', id: 'gone' }, parts, room)).toBeNull();
  });

  it('a floor pick changes only the colour: material, board size and grout stay', () => {
    useScene.setState({ room: { ...useScene.getState().room, floor: { kind: 'tile', sizeMM: 600, color: '#ffffff' } } });
    applyColor({ kind: 'floor' }, BLUE);
    expect(useScene.getState().room.floor).toEqual({ kind: 'tile', sizeMM: 600, color: BLUE });
  });
});

describe('I picks a colour for the selection', () => {
  it('I arms it and says so; I again, or Esc, puts it down — and Esc keeps the selection', () => {
    render(<Studio />);
    expect(hint()).toBeNull();
    pressI();
    expect(useStudio.getState().pickingColor).toBe(true);
    expect(hint(), 'the mode is visible').not.toBeNull();
    expect(surface().hasAttribute('data-picking-color'), 'the cursor turns to a crosshair').toBe(true);
    pressI();
    expect(useStudio.getState().pickingColor).toBe(false);

    pressI();
    fireEvent.keyDown(surface(), { key: 'Escape' });
    expect(useStudio.getState().pickingColor).toBe(false);
    expect(useStudio.getState().selection, 'Esc put the picker down, not the selection').toEqual([CHAIR]);
  });

  it('is not armed by typing an i into a field', () => {
    render(<Studio />);
    const field = document.querySelector<HTMLInputElement>('input')!;
    field.focus();
    fireEvent.keyDown(field, { key: 'i', code: 'KeyI' });
    expect(useStudio.getState().pickingColor).toBe(false);
  });

  it('a press on another piece paints the selected one with its colour, and selects nothing', () => {
    render(<Studio />);
    pressI();
    press(piece('Sofa'));
    expect(part(CHAIR).color).toBe(BLUE);
    expect(useStudio.getState().selection, 'the chair is still the one selected').toEqual([CHAIR]);
    expect(useStudio.getState().draggingId, 'and the sofa was not picked up').toBeNull();
    expect(part(SOFA).color, 'the source is untouched').toBe(BLUE);
    expect(useStudio.getState().pickingColor, 'one pick per press of I').toBe(false);
  });

  it('picks a wall’s paint, not its look, onto a piece', () => {
    render(<Studio />);
    pressI();
    // Index 1 is the painted one; find it among the plan's wall handles.
    press(wall(1));
    expect(part(CHAIR).color).toBe(WALL_GREEN);
    expect(useStudio.getState().selectedWall, 'the wall was not selected').toBeNull();
  });

  it('with a wall selected, paints the wall', () => {
    useStudio.setState({ selection: [], selectedPartId: null, selectedWall: 2 });
    render(<Studio />);
    pressI();
    press(piece('Sofa'));
    expect(useScene.getState().room.wallColors[2]).toBe(BLUE);
    expect(useStudio.getState().selectedWall).toBe(2);
  });

  it('paints every piece in a multi-selection', () => {
    const other = { ...chair(), id: 'chair-2', name: 'Side chair', pos: [-1, 0, -1] } as ScenePart;
    useScene.setState({ parts: [...useScene.getState().parts, other] });
    useStudio.setState({ selection: [CHAIR, 'chair-2'], selectedPartId: CHAIR });
    render(<Studio />);
    pressI();
    press(piece('Sofa'));
    expect(part(CHAIR).color).toBe(BLUE);
    expect(part('chair-2').color).toBe(BLUE);
  });

  it('with nothing selected, copies the hex instead of painting anything', () => {
    useStudio.setState({ selection: [], selectedPartId: null });
    render(<Studio />);
    pressI();
    press(piece('Sofa'));
    expect(copied).toEqual([BLUE.toUpperCase()]);
    expect(part(CHAIR).color).toBeUndefined();
  });

  it('the Inspector offers it as Pick, for a hand without a keyboard', () => {
    render(<Studio />);
    fireEvent.click(screen.getByRole('button', { name: /Colour/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Pick$/ }));
    expect(useStudio.getState().pickingColor).toBe(true);
    // …and the hint's Cancel is the way out without Esc.
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(useStudio.getState().pickingColor).toBe(false);
  });

  it('the sampler card previews the colour under the pointer, before the click', () => {
    render(<Studio />);
    pressI();
    expect(hint()!.textContent, 'nothing under the pointer yet').toContain('—');
    act(() => setPickHover({ kind: 'wall', index: 1 }));
    expect(hint()!.textContent).toContain(WALL_GREEN.toUpperCase());
    // A piece in front of the wall wins, the way it does on screen.
    act(() => useStudio.setState({ hoveredPartId: SOFA }));
    expect(hint()!.textContent).toContain(BLUE.toUpperCase());
    expect(hint()!.textContent).toContain('to sample');
    // A colour the studio names is shown by name: Denim is a palette swatch.
    act(() => useScene.getState().updatePart(SOFA, { color: '#4F6D8C' }));
    expect(hint()!.textContent).toContain('Denim');
    expect(hint()!.textContent).not.toContain('#4F6D8C');
    act(() => useStudio.setState({ hoveredPartId: null }));
    fireEvent.keyDown(surface(), { key: 'Escape' });
    expect(hint(), 'put down').toBeNull();
    pressI();
    expect(hint()!.textContent, 'and the last hover did not outlive the mode').toContain('—');
  });

  it('is put down when the room is left', () => {
    const { unmount } = render(<Studio />);
    pressI();
    act(() => unmount());
    expect(useStudio.getState().pickingColor).toBe(false);
  });
});
