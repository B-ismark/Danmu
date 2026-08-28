// One-tap room themes. Each theme recolours the whole scene with a coherent
// palette + sets a lighting mood. Colours drive part.color (the recolour path
// the 3D scene already honours), so a theme reads as a full redecoration.
//
// **Four, not five.** `Coastal` and `Studio Loft` both set `cool`, so from the
// Lighting row's point of view — the row sitting in the same section — they were one
// option taking two of the four swatch slots a 208px rail affords. They are
// `Cool Neutral`, which keeps the useful half of each: Coastal's pale cool upholstery
// and its sage accent, which is the hue that distinguished it, and Studio Loft's
// charcoal case goods and mid grey, which is what gave that one its weight.
//
// **The merge stands on that mood overlap alone.** An earlier version of this comment
// also called the two near-duplicates on COLOUR — "pressing one after the other
// changed the mid-tone and nothing else". That was never measured and it is false:
// mean `deltaEOk` across the four painted roles puts the merged pair at 0.304, the
// third most DISTINCT of the original ten pairs, while the closest were
// `warm-min`/`coastal` at 0.073 and `heritage`/`afro-mod` at 0.078. The metric is the
// wrong instrument rather than the set being wrong — it is dominated by lightness, so
// it scores beige against sage as similar. Full matrix in `tests/themes.test.ts`.
//
// **The mood criterion is not fully satisfied by what shipped:** `Warm Minimal` and
// `Afro-Modern` both still set `day`, at 0.266 — CLOSER than the pair that went. Left
// alone deliberately: four swatches is the fit ceiling, and rust against beige is the
// loudest contrast in the set. It is the open end of this argument rather than a set
// with one option per mood.
//
// A theme still sets a mood on the way past: one tap, whole look. What changed with
// it is that the chip no longer UNTICKS itself when you then move the light —
// `activeTheme` in `PartTree.tsx` tests the colours and not the lighting. The two
// controls in that section were each cancelling the other's report.

import type { Lighting } from './store';

type Tones = {
  /** case goods — tables, desks, shelves, wardrobes, beds, nightstands, doors */
  wood: string;
  /** upholstery / soft goods — sofas, chairs, ottomans, rugs, curtains, beds linens */
  soft: string;
  /** accents — lamps, plant pots, small decor */
  accent: string;
  /** everything else */
  neutral: string;
};

export type Theme = { id: string; label: string; lighting: Lighting; swatch: [string, string, string]; tones: Tones };

export const THEMES: Theme[] = [
  {
    id: 'warm-min',
    label: 'Warm Minimal',
    lighting: 'day',
    swatch: ['#E8DCC8', '#C9A87C', '#6F5436'],
    tones: { wood: '#C9A87C', soft: '#E6DAC6', accent: '#C57B53', neutral: '#D8CDBA' },
  },
  {
    id: 'cool-neutral',
    label: 'Cool Neutral',
    lighting: 'cool',
    // Illustrative rather than exhaustive, as every row here is: three of the four
    // tones would not read as a palette at 18px. Pale cool, sage, charcoal.
    swatch: ['#DCE4E2', '#A9C4C0', '#5B554E'],
    tones: { wood: '#5B554E', soft: '#DCE4E2', accent: '#7C9C8E', neutral: '#7C7A75' },
  },
  {
    id: 'heritage',
    label: 'Heritage',
    lighting: 'evening',
    swatch: ['#C99A5B', '#8A4B2A', '#3E2417'],
    tones: { wood: '#6F4A2F', soft: '#9A5A3C', accent: '#B08D4F', neutral: '#7A5238' },
  },
  {
    id: 'afro-mod',
    label: 'Afro-Modern',
    lighting: 'day',
    swatch: ['#D98E5A', '#B5482E', '#2E2A26'],
    tones: { wood: '#7A4327', soft: '#C16B43', accent: '#B5482E', neutral: '#8A5A3C' },
  },
];

const WOOD = new Set(['table', 'desk', 'shelf', 'wardrobe', 'bed', 'nightstand', 'door', 'bookshelf']);
const SOFT = new Set(['sofa', 'chair', 'armchair', 'ottoman', 'rug', 'curtain']);
const ACCENT = new Set(['lamp', 'plant', 'painting', 'mirror']);

export function themeColorFor(category: string, theme: Theme): string {
  if (WOOD.has(category)) return theme.tones.wood;
  if (SOFT.has(category)) return theme.tones.soft;
  if (ACCENT.has(category)) return theme.tones.accent;
  return theme.tones.neutral;
}
