// The paint palette for furniture and walls — one list, read by the Inspector's
// swatch grid and by the eyedropper's sampler, which names a colour it recognises.

// Curated palette — thirteen dabs and the mixer, two rows of seven.
//
// Two rows is the brief, and the cut is what makes it a palette rather than a chart:
// the first row is the room's quiet half — whites, a stone, the woods and a near-black,
// light to dark — and the second the colour you choose a piece FOR. Where the old 24
// had two near-identical charcoals and two oaks a shade apart, each dab here is one a
// person can tell from its neighbour at a glance. Anything else is the mixer, which is
// the fourteenth cell rather than a row of its own.
//
// The names are what a screen reader announces and what the tooltip shows: "#E8E5DB"
// told nobody anything.
export type Swatch = { hex: string; name: string };
export const SWATCHES: Swatch[] = [
  // The quiet row
  { hex: '#E8E5DB', name: 'Chalk' },
  { hex: '#EDE6D6', name: 'Cream' },
  { hex: '#D6C7AE', name: 'Linen' },
  { hex: '#C9A87C', name: 'Warm oak' },
  { hex: '#9A6A48', name: 'Teak' },
  { hex: '#5D3820', name: 'Espresso' },
  { hex: '#3A3733', name: 'Charcoal' },
  // The colour row, ending in the mixer
  { hex: '#8FA98C', name: 'Sage' },
  { hex: '#A9C4C0', name: 'Eucalyptus' },
  { hex: '#4F6D8C', name: 'Denim' },
  { hex: '#C57B53', name: 'Terracotta' },
  { hex: '#C44A3A', name: 'Paprika' },
  { hex: '#D8C36A', name: 'Ochre' },
];
/** Seven a row, and the mixer takes the last cell of the second. */
export const SWATCH_COLUMNS = 7;

export const SWATCH_NAME = new Map(SWATCHES.map((s) => [s.hex.toLowerCase(), s.name] as const));
