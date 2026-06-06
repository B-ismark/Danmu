// One-tap room themes. Each theme recolours the whole scene with a coherent
// palette + sets a lighting mood. Colours drive part.color (the recolour path
// the 3D scene already honours), so a theme reads as a full redecoration.

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
    id: 'coastal',
    label: 'Coastal',
    lighting: 'cool',
    swatch: ['#DCE4E2', '#A9C4C0', '#7C9C8E'],
    tones: { wood: '#D8C7A8', soft: '#DCE4E2', accent: '#7C9C8E', neutral: '#C8D2CE' },
  },
  {
    id: 'heritage',
    label: 'Heritage',
    lighting: 'evening',
    swatch: ['#C99A5B', '#8A4B2A', '#3E2417'],
    tones: { wood: '#6F4A2F', soft: '#9A5A3C', accent: '#B08D4F', neutral: '#7A5238' },
  },
  {
    id: 'studio',
    label: 'Studio Loft',
    lighting: 'cool',
    swatch: ['#D8D6D2', '#9A9893', '#3A3934'],
    tones: { wood: '#5B554E', soft: '#9A9893', accent: '#3A3934', neutral: '#7C7A75' },
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
