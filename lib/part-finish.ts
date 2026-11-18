// How a piece of furniture is finished: its wood and its upholstery, each a choice
// from a short list. Pure data and validation; the presets these name live in
// `components/three/materials.ts`, and `components/three/part-finish.tsx` applies
// them to every surface of a piece through one context.
//
// ── Why these options and not a sheen slider ─────────────────────────────────
//
// A Finish row (Auto / Matte / Satin / Polished / Metal) sat in the Inspector once,
// and was removed in review because it **changed nothing a person could see**: it
// moved roughness, and under the room's soft image light roughness alone barely moves
// a pixel. So every option here changes what the SURFACE looks like, not only how it
// catches light:
//
//   · Wood  — Natural (the grain, as the piece is drawn), Painted (the grain painted
//             over: flat colour, only its relief left), Lacquered (the grain under a
//             high gloss that shows the room's reflections).
//   · Fabric — Linen (the plain weave every piece is drawn in), Velvet (no weave, a
//             crushed pile and a strong sheen at the edges), Bouclé (deep looped nubs).
//
// `tests/part-finish.test.ts` measures each option against the default on a rendered
// tone, so an option that stops being visible fails rather than ships again.
//
// The fields are `woodFinish` and `fabricFinish`, not `finish`: that name is still on
// rooms saved with the old row, and reading it back as one of these would revive a
// choice nobody has made in this UI.

import type { Shape, ScenePart } from './scene-spec';

export const WOOD_FINISHES = ['natural', 'painted', 'lacquered'] as const;
export type WoodFinish = (typeof WOOD_FINISHES)[number];

export const FABRIC_FINISHES = ['linen', 'velvet', 'boucle'] as const;
export type FabricFinish = (typeof FABRIC_FINISHES)[number];

export type FinishSpec = { readonly label: string; readonly note: string };

export const WOOD_FINISH_SPEC: Record<WoodFinish, FinishSpec> = {
  natural: { label: 'Natural', note: 'The grain shows through an oiled finish.' },
  painted: { label: 'Painted', note: 'One flat colour; only the grain’s texture shows.' },
  lacquered: { label: 'Lacquered', note: 'High gloss over the grain, catching reflections.' },
};

export const FABRIC_FINISH_SPEC: Record<FabricFinish, FinishSpec> = {
  linen: { label: 'Linen', note: 'A plain, slubbed weave.' },
  velvet: { label: 'Velvet', note: 'Soft pile with a sheen at the edges.' },
  boucle: { label: 'Bouclé', note: 'Deep, nubbly loops.' },
};

/** What a piece's finish resolves to, both axes filled in. */
export type PartFinish = { wood: WoodFinish; fabric: FabricFinish };

/** What a piece is DRAWN in, so the Inspector names the finish on screen. A made piece
 *  with none of its own shows its blocks' finish when every block with that surface
 *  shares it (`MadeGeo` draws each block in its own), whichever way it arrived — packed,
 *  off the shelf or out of a file. */
export function resolvePartFinish(p: Pick<ScenePart, 'woodFinish' | 'fabricFinish'> & Partial<Pick<ScenePart, 'shape' | 'made'>>): PartFinish {
  const blocks = p.shape === 'made' && p.made ? p.made.blocks : [];
  const shared = <T,>(vals: (T | undefined)[]): T | undefined =>
    vals.length > 0 && vals.every((v) => v === vals[0]) ? vals[0] : undefined;
  return {
    wood: p.woodFinish ?? shared(blocks.filter((b) => WOOD_SHAPES.has(b.shape)).map((b) => b.woodFinish)) ?? 'natural',
    fabric: p.fabricFinish ?? shared(blocks.filter((b) => FABRIC_SHAPES.has(b.shape)).map((b) => b.fabricFinish)) ?? 'linen',
  };
}

// ── Which pieces have which ─────────────────────────────────────────────────
//
// Read off the renderers, not written from what furniture usually is: a shape is in a
// set exactly when its drawing uses that surface. `tests/part-finish.test.ts` walks
// every shape's geometry and fails in BOTH directions — a shape that draws wood but is
// missing here gets no control for it, and one listed here that draws none gets a
// control that does nothing, which is the defect this whole file exists to avoid.

// A mirror's or a painting's wood is its frame; a lamp's fabric is its shade; a clothes
// rack's is the clothes. Each is what the control would change, so each is listed.
export const WOOD_SHAPES: ReadonlySet<Shape> = new Set<Shape>([
  'bed-double', 'bed-single', 'bookshelf', 'chair-armchair', 'chair-dining', 'closet',
  'coffee-table', 'desk-l', 'desk-standard', 'door', 'door-cabinet', 'drawer-unit',
  'mirror', 'mirror-oval', 'nightstand', 'open-shelf', 'ottoman', 'painting',
  'shoe-rack', 'side-table', 'slat-panel', 'sofa', 'stool', 'tv-console', 'wardrobe',
  'worktop',
]);
export const FABRIC_SHAPES: ReadonlySet<Shape> = new Set<Shape>([
  'bed-double', 'bed-single', 'chair-armchair', 'chair-dining', 'chair-office',
  'clothes-rack', 'curtain', 'lamp-floor', 'lamp-table', 'ottoman', 'screen',
  'seat-pad', 'sofa',
]);

/** Which finish controls a piece gets. A made piece has whatever its blocks have. */
export function finishAxes(part: Pick<ScenePart, 'shape' | 'made'>): { wood: boolean; fabric: boolean } {
  if (part.shape === 'made' && part.made) {
    const shapes = part.made.blocks.map((b) => b.shape);
    return { wood: shapes.some((s) => WOOD_SHAPES.has(s)), fabric: shapes.some((s) => FABRIC_SHAPES.has(s)) };
  }
  return { wood: WOOD_SHAPES.has(part.shape), fabric: FABRIC_SHAPES.has(part.shape) };
}

type Finishes = { woodFinish?: WoodFinish; fabricFinish?: FabricFinish };

/** Reads a piece's finishes from a file. A value off the list is dropped and said so,
 *  and so is one the piece has no surface for (a lacquered TV): kept, it would be
 *  state no control shows or clears, riding along until a model swap revived it.
 *  Absent is the default and says nothing. `axes` is `finishAxes` of the piece as
 *  read — for a made piece, AFTER its blocks are. */
export function readPartFinishes(
  v: { woodFinish?: unknown; fabricFinish?: unknown },
  axes: { wood: boolean; fabric: boolean },
  name: string,
  dropped?: string[],
): Finishes {
  const out: Finishes = {};
  if (v.woodFinish !== undefined) {
    if (!(WOOD_FINISHES as readonly unknown[]).includes(v.woodFinish)) dropped?.push(`${name}'s wood finish was unreadable, so it was left natural`);
    else if (!axes.wood) dropped?.push(`${name} has no wood to finish, so its wood finish was left out`);
    else out.woodFinish = v.woodFinish as WoodFinish;
  }
  if (v.fabricFinish !== undefined) {
    if (!(FABRIC_FINISHES as readonly unknown[]).includes(v.fabricFinish)) dropped?.push(`${name}'s fabric was unreadable, so it was left linen`);
    else if (!axes.fabric) dropped?.push(`${name} has no upholstery, so its fabric was left out`);
    else out.fabricFinish = v.fabricFinish as FabricFinish;
  }
  return out;
}

/** The finishes `f` names that a piece of this kind can actually show — the rest
 *  dropped. Every path that carries a finish onto a DIFFERENT model (a swap, a
 *  re-scan's rebuild, a block packed into a piece) passes it through here, so a velvet
 *  sofa swapped for a bookshelf does not keep an invisible velvet that comes back the
 *  day it is swapped for an armchair. */
export function finishesFor(part: Pick<ScenePart, 'shape' | 'made'>, f: Finishes): Finishes {
  const axes = finishAxes(part);
  const out: Finishes = {};
  if (axes.wood && f.woodFinish !== undefined) out.woodFinish = f.woodFinish;
  if (axes.fabric && f.fabricFinish !== undefined) out.fabricFinish = f.fabricFinish;
  return out;
}

/** `part` with `finishes` set to what it can show, and nothing else. */
export function withFinishes<P extends Pick<ScenePart, 'shape' | 'made'> & Finishes>(part: P, finishes: Finishes): P {
  const out = { ...part };
  delete out.woodFinish;
  delete out.fabricFinish;
  return Object.assign(out, finishesFor(part, finishes));
}
