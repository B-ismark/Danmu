// Scene-side semantic colours — one home for the values the 3D layer and the
// panels that edit it must agree on.
//
// Why hex literals rather than CSS tokens: Three.js materials take a colour
// value, not a computed custom property, so the 3D layer cannot read
// `var(--accent)`. These are therefore deliberate duplicates of the tokens in
// app/globals.css and must be kept numerically in sync with them by hand —
// which is exactly why they live in ONE file instead of being re-declared in
// DynamicPart, Highlight, RoomShell, WallHandles and MeasureGuides. Before this
// existed there were four different blues for two semantics, so "kept as-is"
// rendered in three different colours depending on which shape you selected.
//
// Related but separate: lib/themes.ts is the user-facing restyle palette (whole
// -room recolour presets). It is already centralised and owns different values
// on purpose — do not merge the two.

import type { Category, Shape } from './scene-spec';

export const SCENE = {
  /** selection highlight — matches --accent */
  accent: '#E2613A',
  /** hover highlight. Sage, not the old construction blue: it has to read as
   *  clearly distinct from the terracotta selection without importing a cold
   *  CAD hue the brand does not use. Matches --accent-2. */
  accentHover: '#5E8B6E',
  /** drag position collides or leaves the room — matches --danger */
  invalid: '#C8472A',
  /** "kept as-is". Warm aubergine, matching --locked; replaced an institutional
   *  blue (#3A78C2 / #6E94C8 / #7AA4D2) that belonged to no part of the brand. */
  locked: '#7A4B63',
  /** lighter aubergine for tinting a locked part's own material */
  lockedTint: '#9B7488',
  /** default wall paint before the user picks one */
  wall: '#ECE9E1',
  floor: '#D8C9B4',
  ceiling: '#F5F1E8',
  /** An alignment guide from `lib/item-snap.ts`: "this edge is locked to that
   *  one". A separate semantic from selection / hover / invalid, and it must read
   *  as none of them — so a green, deliberately outside the brand's sage.
   *
   *  Mirrors `--snap-edge`. The 2D plan draws the same guide from the CSS token
   *  directly, because it is SVG in the document and can; this copy exists for the
   *  same reason every other entry here does — a Three.js material cannot. */
  snapEdge: '#1E9E54',
  /** …and the centre-line variant, drawn dashed and a shade lighter. Mirrors
   *  `--snap-center`. */
  snapCenter: '#27A06A',
} as const;

// ─── Furniture detail ───────────────────────────────────────────────────────
// The parts of a piece that are NOT its body: legs, brackets, hardware, and the
// outline every Box draws. They are deliberately absent from `BY_SHAPE` — these
// are not recolourable, because repainting a sofa should not repaint its feet,
// and the Inspector's "Default for this piece" swatch must keep showing the body.
//
// They are here anyway, for the reason the rest of this file exists: each was a
// literal repeated across several renderers, so it was several values pretending
// to be one, and the one that drifts is never the one you are looking at.
export const DETAIL = {
  /** The outline every `Box` draws, at whatever `edgeOpacity` the caller asks for.
   *  `components/three/Box.tsx` is its only writer — it lives out here so that a
   *  renderer wanting a different edge has to change the edge, not invent one. */
  edge: '#3A352E',
  /** Dark walnut — table legs, chair frames, a mirror's surround. */
  darkWood: '#3A2818',
  /** Near-black hardware — castors, brackets, a monitor's stem. */
  hardware: '#222222',
} as const;

// ─── Decor accents ──────────────────────────────────────────────────────────
// The small things `components/three/Dressing.tsx` scatters on a surface. Unlike
// DETAIL these ARE the object's whole body colour — but one drawn at random per
// item from a set, which is the one thing a single per-shape default cannot say.
export const DECOR = {
  /** Book spines. Two lists once: `Dressing`'s stack of six and
   *  `BookshelfGeo`'s row of eight, so the books ON a shelf and the books
   *  BESIDE it were different books. */
  book: ['#7A2A2A', '#2A4A7A', '#5D3820', '#A88A4A', '#3A5A3A', '#6A3A6A', '#8A6A2A', '#3A6A6A'],
  pot: ['#B5774D', '#C9B79C', '#3E5A52', '#8A8A86'],
  vase: ['#D9CFC0', '#6E8C84', '#B5734D', '#2E2A26'],
  pillow: ['#C9A98E', '#8FA98C', '#C57B53', '#3F5670', '#D6C7AE'],
} as const;

// ─── Exported-artifact palette ──────────────────────────────────────────────
// lib/plan-export.ts draws to a <canvas>, which cannot read a custom property
// either — so it reads these rather than carrying its own hex set. It used to
// carry sixteen literals including #3E8FD8, the cold CAD blue this file records
// as deliberately removed from the brand.
export const PLAN = {
  /** page — matches --paper */
  paper: '#FBF8F2',
  /** the floor inside the footprint */
  floor: '#FFFFFF',
  /** titles, wall stroke, badge numerals — matches --ink */
  ink: '#2A2520',
  /** secondary type (scale bar, dimension labels) — matches --ink-2 */
  ink2: '#5A5147',
  /** dimension lines + ticks — matches --hairline-strong, flattened to opaque */
  rule: '#A9A296',
  /** furniture outline */
  outline: '#3A3A36',
  /** furniture fill when the piece has no colour of its own, and the legend
   *  index — terracotta, matching --accent, NOT the retired CAD blue. */
  accent: SCENE.accent,
} as const;

// ─── Default body colour ────────────────────────────────────────────────────
// The albedo a part renders with when the user has not recoloured it. Keyed by
// SHAPE first (a dining chair and an office chair are both `chair` but do not
// look alike), with a per-CATEGORY fallback for the generic primitives.
//
// This has to be the SAME table the renderer uses, because the Inspector shows
// it as a swatch labelled "Default for this piece". It previously was not: the
// lookup was keyed on material-group names ('seating', 'soft', 'screen'…) while
// every caller passed a Category ('sofa', 'tv', 'chair'…), so eighteen of the
// twenty-two categories fell through to one tan default and the swatch showed a
// colour the furniture was not. The parameter was typed `string`, so nothing
// caught it. Both maps below are exhaustive `Record`s over their union — adding
// a shape or a category now fails the build until it has a colour.

const BY_SHAPE: Record<Shape, string> = {
  // seating
  sofa: '#C9A98E',
  'chair-dining': '#5D3820',
  'chair-office': '#3A3A3A',
  'chair-armchair': '#E8C7AE',
  ottoman: '#A88A6E',
  // beds
  'bed-single': '#6F4F35',
  'bed-double': '#6F4F35',
  // tables / desks
  'desk-standard': '#5D3820',
  'desk-l': '#5D3820',
  'coffee-table': '#5D3820',
  'side-table': '#9A7848',
  nightstand: '#5D3820',
  // storage
  wardrobe: '#E8B833',
  closet: '#E8B833',
  bookshelf: '#9A7848',
  'shoe-rack': '#8A6A45',
  // lighting
  'lamp-floor': '#E8E0CB',
  'lamp-table': '#E8E0CB',
  'lamp-pendant': '#E8B833',
  // wall-hung
  mirror: '#5D3820',
  'mirror-oval': '#5D3820',
  painting: '#A88A6E',
  'ac-unit': '#F2F1EB',
  window: '#F4F1EA',
  door: '#5D3820',
  curtain: '#D4CDB8',
  // screens
  tv: '#0D0D0F',
  monitor: '#1E1E22',
  laptop: '#3A3D42',
  // soft goods / greenery
  rug: '#C8A88A',
  plant: '#B07555',
  // appliances
  fridge: '#E8E5DB',
  fan: '#C9A98E',
  soundbar: '#2B2B2E',
  radiator: '#ECEAE3',
  'air-purifier': '#EDEDEA',
  'washing-machine': '#EFEFEC',
  microwave: '#3A3A3D',
  'water-dispenser': '#EDEDEA',
  // generic primitives — resolved by category instead (see defaultBodyColor)
  box: '#C9A98E',
  cylinder: '#C9A98E',
  plane: '#C9A98E',
};

/** Generic primitives ('box' / 'cylinder' / 'plane') carry no look of their own,
 *  so they take the colour of their category's canonical shape — a low-confidence
 *  detection labelled "bed" reads as a bed rather than as anonymous tan. */
const BY_CATEGORY: Record<Category, string> = {
  sofa: BY_SHAPE.sofa,
  tv: BY_SHAPE.tv,
  chair: BY_SHAPE['chair-dining'],
  table: BY_SHAPE['coffee-table'],
  desk: BY_SHAPE['desk-standard'],
  lamp: BY_SHAPE['lamp-floor'],
  plant: BY_SHAPE.plant,
  shelf: BY_SHAPE.bookshelf,
  rug: BY_SHAPE.rug,
  bed: BY_SHAPE['bed-single'],
  monitor: BY_SHAPE.monitor,
  fan: BY_SHAPE.fan,
  fridge: BY_SHAPE.fridge,
  wardrobe: BY_SHAPE.wardrobe,
  curtain: BY_SHAPE.curtain,
  mirror: BY_SHAPE.mirror,
  painting: BY_SHAPE.painting,
  nightstand: BY_SHAPE.nightstand,
  ottoman: BY_SHAPE.ottoman,
  ac: BY_SHAPE['ac-unit'],
  door: BY_SHAPE.door,
  other: '#C9A98E',
};

const GENERIC = new Set<Shape>(['box', 'cylinder', 'plane']);

/** The albedo this part renders with when it has no `color` of its own. Both
 *  arguments are required — the shape is what actually decides the look, and
 *  passing the category alone is the bug this signature exists to prevent. */
export function defaultBodyColor(category: Category, shape: Shape): string {
  if (GENERIC.has(shape)) return BY_CATEGORY[category] ?? BY_SHAPE[shape];
  return BY_SHAPE[shape] ?? BY_CATEGORY[category] ?? BY_CATEGORY.other;
}

/** Default wall paint. Kept as its own export because a wall is not a part and
 *  has no shape. */
export function wallColor(): string {
  return SCENE.wall;
}
