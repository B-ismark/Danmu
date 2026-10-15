// The options a building-block shape carries — which end treatment a worktop has, whether a
// drawer unit locks — and the one resolver that turns what a part stored into what it draws.
//
// **Why this is a field and not more shapes.** A worktop on legs, on end panels and on
// nothing is one piece of furniture with three finishes, and a Library row per finish is
// the shape the beds and the fridges were merged out of (`PART_LIBRARY`'s notes on the
// one bed). So `ScenePart.blockStyle` holds the choice, typed per key, and a part that
// never made one stores nothing: absent means the shape's defaults, here, in one place.
//
// **A vocabulary is an `as const` array with the union derived** (`BLOCK_ENDS`, `BLOCK_BANDS`),
// for the reason `SHAPES` is — `lib/scene-file.ts` checks a stranger's value against the
// runtime list, and a union beside a hand-kept `Set` drifts in the direction nobody sees.
// The table of which key belongs to which shape is the same kind of fact and lives here too
// (`BLOCK_STYLE_KEYS`), so the Inspector, the file reader and the renderer cannot hold three
// opinions about whether a seat pad has a plinth.
//
// This module imports only a TYPE from `scene-spec`, plus `geometry` and `foot-cells` —
// neither of which imports `scene-spec` at run time — so `scene-spec` can import it back
// without a cycle.

import type { Shape } from './scene-spec';
import { footArea, footFromPart, footIntersectionArea } from './geometry';
import { WORKTOP } from './foot-cells';

/** The seven shapes that are building blocks: pieces a person assembles a room's storage
 *  and workspace from, and that a photograph is never asked to produce.
 *
 *  Declared HERE as well as in `SHAPES` (which spreads nothing from it, because `SHAPES`
 *  is a literal list the compiler derives `Shape` from); `tests/block-forms.test.ts`
 *  asserts every id below is a `Shape`, so a rename in one place is a red there. */
export const BLOCK_SHAPES = [
  'worktop', 'screen', 'drawer-unit', 'open-shelf', 'door-cabinet', 'slat-panel', 'seat-pad',
] as const;
export type BlockShape = (typeof BLOCK_SHAPES)[number];

/** A worktop's support: four slim legs, two full-depth end panels, or none — the slab on
 *  its own, meant to sit on drawer units or screens. */
export const BLOCK_ENDS = ['legs', 'panel', 'none'] as const;
export type BlockEnds = (typeof BLOCK_ENDS)[number];

/** A screen's top band: frosted glass, clear glass, or none. */
export const BLOCK_BANDS = ['frosted', 'glass', 'none'] as const;
export type BlockBand = (typeof BLOCK_BANDS)[number];

export type BlockStyle = {
  ends?: BlockEnds;
  band?: BlockBand;
  lock?: boolean;
  back?: boolean;
  plinth?: boolean;
  backing?: boolean;
};

export type BlockStyleKey = keyof BlockStyle;

/** Which options each block has. A shape absent here (or mapped to `[]`) has none: a seat
 *  pad is a cushion and there is nothing to choose. */
export const BLOCK_STYLE_KEYS: Readonly<Record<BlockShape, readonly BlockStyleKey[]>> = {
  worktop: ['ends'],
  screen: ['band'],
  'drawer-unit': ['lock'],
  'open-shelf': ['back'],
  'door-cabinet': ['plinth'],
  'slat-panel': ['backing'],
  'seat-pad': [],
};

/** What each option is when a part has made no choice. One table, so "the default" is not
 *  restated in a renderer, the Inspector and the file reader. */
const DEFAULTS: Required<BlockStyle> = {
  ends: 'legs',
  band: 'frosted',
  lock: true,
  back: true,
  plinth: true,
  backing: false,
};

/** True for a shape that is one of the building blocks. */
export function isBlockShape(shape: Shape | string): shape is BlockShape {
  return (BLOCK_SHAPES as readonly string[]).includes(shape);
}

/** The options a shape has, in the order the Inspector shows them. `[]` for anything that
 *  is not a block, or a block with nothing to choose. */
export function blockStyleKeys(shape: Shape | string): readonly BlockStyleKey[] {
  return isBlockShape(shape) ? BLOCK_STYLE_KEYS[shape] : [];
}

/** A block as the join rule needs it: where it stands and how big it is. */
export type PlacedBlock = {
  shape: Shape | string;
  pos: readonly [number, number, number];
  rot: number;
  dimMM: readonly [number, number, number];
  circle?: boolean;
};

/** A worktop's slab, in metres: 25 mm, however tall the piece, and never more than a
 *  fifth of a short one. Here rather than in `block-forms.ts` because the join rule needs
 *  it and `scene-spec` imports this module; `worktopTop` there reads this. */
export function worktopSlabM(heightMM: number): number {
  return Math.min(WORKTOP.top, (heightMM / 1000) * 0.2);
}

/** The height a block's material actually occupies, metres. Every block stands on its
 *  origin; a worktop's box reaches the floor so it stands where a desk would, but its
 *  material is the slab at the top — the drawer units and screens under it are in the
 *  air it leaves, not inside it. (Its legs or end panels are at its ends, where nothing
 *  else stands either.) */
export function blockBody(b: PlacedBlock): [number, number] {
  const y = b.pos[1];
  const h = b.dimMM[2] / 1000;
  return b.shape === 'worktop' ? [y + h - worktopSlabM(b.dimMM[2]), y + h] : [y, y + h];
}

/** How much of the smaller block's body is inside the other one: the volume share at or
 *  above which two blocks are NESTED rather than joined. A worktop over its pedestals, a
 *  screen along a worktop's back edge or a drawer unit butted into a cabinet's end share
 *  a sliver; a drawer unit dropped into a cabinet shares all of itself. */
export const NESTED_SHARE = 0.5;

/** Are these both building blocks? The question a "keep pushing until they touch" step
 *  asks — a press is not where a join is judged; the placement it ends at is. */
export function bothBlocks(a: { shape: Shape | string }, b: { shape: Shape | string }): boolean {
  return isBlockShape(a.shape) && isBlockShape(b.shape);
}

/** Is one block mostly INSIDE the other? Material in the same place, which no build
 *  needs: two cabinets on one spot, a drawer unit swallowed by a cabinet. */
export function blocksNest(a: PlacedBlock, b: PlacedBlock): boolean {
  const fa = footFromPart([...a.pos], a.rot, [...a.dimMM], a.circle, a.shape as Shape);
  const fb = footFromPart([...b.pos], b.rot, [...b.dimMM], b.circle, b.shape as Shape);
  const [a0, a1] = blockBody(a);
  const [b0, b1] = blockBody(b);
  const rise = Math.min(a1, b1) - Math.max(a0, b0);
  if (rise <= 0) return false;
  const shared = footIntersectionArea(fa, fb) * rise;
  const smaller = Math.min(footArea(fa) * (a1 - a0), footArea(fb) * (b1 - b0));
  return smaller > 0 && shared / smaller >= NESTED_SHARE;
}

/** Two building blocks may stand inside each other. That is what building with them IS —
 *  a worktop's ends drop over the drawer units it rests on, a seat pad lies along a
 *  cabinet, a screen clips to a worktop's back edge — and a builder who had to keep every
 *  block a hair apart could not make a workstation at all. Only block against block: a
 *  block still collides with a sofa, and a sofa with it. And only a JOIN: a block mostly
 *  inside another (`blocksNest`) is a crash like any other. The drag (`collidesAt`), the
 *  room report's clash rule and the solver's overlap term all ask this one question, so a
 *  pair the drag lets through is a pair Room check calls fine and Suggest does not price. */
export function blocksJoin(a: PlacedBlock, b: PlacedBlock): boolean {
  return bothBlocks(a, b) && !blocksNest(a, b);
}

/** Does `over` stand clear above `owner`'s top, so `owner`'s fronts open under it? A
 *  worktop's slab over the drawer units carrying it: the drawers pull out beneath the
 *  overhang. Block against block only — the access-zone rule asks it of both consumers,
 *  `lib/clearance.ts` and `lib/layout-score.ts`, so a pedestal Room check calls fine is
 *  one Suggest does not pull out from under its desk. */
export function blockClearsAbove(owner: PlacedBlock, over: PlacedBlock): boolean {
  return bothBlocks(owner, over) && blockBody(over)[0] >= blockBody(owner)[1] - 0.01;
}

/** One option's value, or `undefined` when `v` is not in that option's vocabulary. The
 *  single validator: the resolver below and the scene-file reader both ask it, so a value
 *  one accepts the other cannot refuse. */
export function readBlockOption<K extends BlockStyleKey>(key: K, v: unknown): Required<BlockStyle>[K] | undefined {
  switch (key) {
    case 'ends':
      return (typeof v === 'string' && (BLOCK_ENDS as readonly string[]).includes(v) ? v : undefined) as Required<BlockStyle>[K] | undefined;
    case 'band':
      return (typeof v === 'string' && (BLOCK_BANDS as readonly string[]).includes(v) ? v : undefined) as Required<BlockStyle>[K] | undefined;
    default:
      return (typeof v === 'boolean' ? v : undefined) as Required<BlockStyle>[K] | undefined;
  }
}

/** The full, resolved options for a block: every key that APPLIES to `shape`, each the
 *  stored value if it is a legal one and the shape's default otherwise. Keys that do not
 *  apply to the shape are absent from the answer, so `'ends' in blockStyleFor('screen')`
 *  is false and a caller cannot read an option the piece does not have.
 *
 *  Never throws and never trusts: `style` may be whatever a stored room or an imported
 *  file held, and a wrong value falls back to the default rather than reaching a renderer. */
export function blockStyleFor(shape: Shape | string, style?: BlockStyle | null): BlockStyle {
  const out: Record<string, unknown> = {};
  const stored = (style ?? {}) as Record<string, unknown>;
  for (const key of blockStyleKeys(shape)) {
    out[key] = readBlockOption(key, stored[key]) ?? DEFAULTS[key];
  }
  return out as BlockStyle;
}
