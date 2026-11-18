// The eyedropper — I, as in Figma — picks up a surface's OWN colour, not the colour
// it happens to look under the room's light.
//
// That distinction is the whole feature. A blue chair under a warm evening lamp
// renders a muddy violet; a white wall in the north light renders grey-blue. A
// screen-pixel picker would hand you those, and painting a second wall with the
// first wall's *lit* colour makes it darker than the wall it was copied from, every
// time — the error compounds with each copy. So this never reads the canvas. It reads
// the paint: the colour the user chose, or the colour the renderer falls back to
// when they have not chosen one, from the same tables the Inspector's swatch shows.
//
// Where the picked colour goes is the current selection, which the pick leaves
// untouched (the click that picks is not a click that selects). With nothing
// selected there is nowhere to put it, so the caller copies the hex instead.

import { create } from 'zustand';
import { useStudio } from './store';
import { useScene } from './scene-store';
import { defaultBodyColor, SCENE } from './scene-palette';
import { FLOOR_KINDS, FLOOR_SPEC, resolveFloor } from './floor-finish';
import { SWATCH_NAME } from './paint-swatches';
import type { ScenePart } from './scene-spec';
import type { RoomShape } from './scene-store';

/** What was clicked while picking. */
export type ColorSource = { kind: 'part'; id: string } | { kind: 'wall'; index: number } | { kind: 'floor' };

/** The surface's own colour, before light, shadow, grade or finish touch it.
 *  Exactly the value each Inspector swatch shows as "current", which is the test of
 *  whether this is right: pick, then open the source's panel, and the swatch there
 *  is the hex you got. */
export function trueColorOf(
  source: ColorSource,
  parts: readonly ScenePart[],
  room: Pick<RoomShape, 'wallColors' | 'floor'>,
): string | null {
  switch (source.kind) {
    case 'part': {
      const p = parts.find((x) => x.id === source.id);
      return p ? (p.color ?? defaultBodyColor(p.category, p.shape)) : null;
    }
    case 'wall':
      return room.wallColors?.[source.index] ?? SCENE.wall;
    case 'floor':
      return resolveFloor(room.floor).color;
  }
}

/** Where a pick lands: the selection as it stands. */
export type ColorTarget =
  | { kind: 'parts'; ids: string[] }
  | { kind: 'wall'; index: number }
  | { kind: 'floor' }
  | { kind: 'none' };

export function currentColorTarget(): ColorTarget {
  const s = useStudio.getState();
  if (s.selectedFloor) return { kind: 'floor' };
  if (s.selectedWall !== null) return { kind: 'wall', index: s.selectedWall };
  if (s.selection.length > 0) return { kind: 'parts', ids: [...s.selection] };
  return { kind: 'none' };
}

/** Paint `color` onto the target. Returns how many surfaces changed — 0 when there
 *  was nothing to paint, which is the caller's cue to copy instead. */
export function applyColor(target: ColorTarget, color: string): number {
  const scene = useScene.getState();
  switch (target.kind) {
    case 'parts': {
      const live = target.ids.filter((id) => scene.parts.some((p) => p.id === id));
      for (const id of live) scene.updatePart(id, { color });
      return live.length;
    }
    case 'wall':
      scene.setWallColor(target.index, color);
      return 1;
    case 'floor': {
      // Keep the material, the board size and the grout: only the colour moves.
      const floor = resolveFloor(scene.room.floor);
      scene.setFloor({ ...(scene.room.floor ?? { kind: floor.kind }), kind: floor.kind, color });
      return 1;
    }
    case 'none':
      return 0;
  }
}

/** Turn picking on or off. */
export function setPickingColor(on: boolean) {
  if (!on) setPickHover(null);
  if (useStudio.getState().pickingColor !== on) useStudio.getState().setPickingColor(on);
}

/** Is the eyedropper armed? Read by every click handler that could be the pick. */
export function isPickingColor(): boolean {
  return useStudio.getState().pickingColor;
}

/** The wall or floor under the pointer while picking, for the sampler card's live
 *  preview. A piece under the pointer is `hoveredPartId`, which both surfaces already
 *  keep, and it wins over this — a piece always stands in front of its wall or floor.
 *  Its own tiny store rather than a `useStudio` field: it changes on every pointer
 *  move, and nothing but the card reads it. */
export const usePickHover = create<{ source: ColorSource | null }>(() => ({ source: null }));

export function setPickHover(source: ColorSource | null) {
  const cur = usePickHover.getState().source;
  if (cur === source) return;
  if (cur && source && cur.kind === source.kind && JSON.stringify(cur) === JSON.stringify(source)) return;
  usePickHover.setState({ source });
}

/** What the card shows: the piece under the pointer, else the wall or floor. */
export function hoverSource(hoveredPartId: string | null, surface: ColorSource | null): ColorSource | null {
  return hoveredPartId ? { kind: 'part', id: hoveredPartId } : surface;
}

/** A colour's name, when it is one the studio already names — a paint swatch
 *  ("Denim") or a floor swatch ("Pale oak") — else null, and the hex is shown. A
 *  designer reads "Sage" faster than #8FA98C, and it tells them the colour came off
 *  the palette rather than the mixer. */
export function colorName(hex: string): string | null {
  const k = hex.toLowerCase();
  const paint = SWATCH_NAME.get(k);
  if (paint) return paint;
  for (const kind of FLOOR_KINDS) {
    const hit = FLOOR_SPEC[kind].swatches.find((s) => s.hex.toLowerCase() === k);
    if (hit) return hit.name;
  }
  return null;
}
