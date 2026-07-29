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
} as const;

/** Default colour for a piece of furniture that has never been recoloured,
 *  keyed by its scene-spec category. Was duplicated as bare hex in DynamicPart
 *  (twice) and again in the Inspector's swatch fallback. */
const CATEGORY_COLORS: Record<string, string> = {
  seating: '#B8907A',
  table: '#C9A98E',
  storage: '#C9A98E',
  bed: '#CBB59C',
  soft: '#D6C7B4',
  lighting: '#E0D6C4',
  appliance: '#D9D5CC',
  screen: '#3A3530',
  decor: '#C4B49C',
  plant: '#6F8F6A',
  rug: '#C2A88C',
  wall: SCENE.wall,
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? '#C9A98E';
}
