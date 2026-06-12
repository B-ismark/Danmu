// Local shape matching — text → catalog item, no AI. Replaces the old
// flash-lite "describe it / improve all" calls with deterministic token
// scoring over the part library + real-product presets, plus a dimension
// parser ("180cm", "1.2x0.6m", "1700mm tall") so explicit sizes in the text
// override the preset (clamped into the trustable range as always).

import { PART_LIBRARY, type LibraryItem, type Category, type Shape } from './scene-spec';
import { PRODUCT_PRESETS } from './product-presets';
import { clampDims, type Dim3 } from './dimension-ranges';

const ALL: LibraryItem[] = [...PART_LIBRARY, ...PRODUCT_PRESETS];

// Common-language synonyms → catalog vocabulary. Keys are single tokens.
const SYNONYM: Record<string, string> = {
  couch: 'sofa',
  settee: 'sofa',
  loveseat: 'sofa',
  sectional: 'sofa',
  television: 'tv',
  telly: 'tv',
  screen: 'tv',
  refrigerator: 'fridge',
  freezer: 'fridge',
  closet: 'wardrobe',
  armoire: 'wardrobe',
  dresser: 'wardrobe',
  drawers: 'wardrobe',
  bookcase: 'bookshelf',
  shelving: 'bookshelf',
  shelves: 'bookshelf',
  carpet: 'rug',
  mat: 'rug',
  drape: 'curtain',
  drapes: 'curtain',
  artwork: 'painting',
  art: 'painting',
  picture: 'painting',
  poster: 'painting',
  recliner: 'armchair',
  workstation: 'desk',
  bedside: 'nightstand',
  pouf: 'ottoman',
  footstool: 'ottoman',
  plant: 'plant',
  monstera: 'plant',
  ficus: 'plant',
  palm: 'plant',
};

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
    .map((t) => SYNONYM[t] ?? t);
}

function scoreItem(qTokens: string[], item: LibraryItem): number {
  const hay = tokens(`${item.label} ${item.group} ${item.category} ${item.shape}`);
  let score = 0;
  for (const q of qTokens) {
    if (hay.includes(q)) score += 3;
    else if (hay.some((h) => h.startsWith(q) || q.startsWith(h))) score += 1.5;
  }
  return score;
}

/** Top catalog matches for a freeform description. Empty when nothing scores. */
export function searchLibrary(query: string, limit = 5): LibraryItem[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  return ALL.map((item) => ({ item, s: scoreItem(q, item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };

/** Pull explicit dimensions out of freeform text. Supports "120x60cm",
 *  "1.2m × 0.6m", "1700mm tall", "180 cm wide". Returns partial overrides. */
export function parseDims(text: string): { w?: number; d?: number; h?: number } {
  const t = text.toLowerCase();

  // W x D (x H) with one trailing unit: "120x60cm", "2.2 × 0.9 × 0.8 m"
  const multi = t.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*(mm|cm|m)\b/,
  );
  if (multi) {
    const u = UNIT_MM[multi[4]];
    return {
      w: Math.round(parseFloat(multi[1]) * u),
      d: Math.round(parseFloat(multi[2]) * u),
      h: multi[3] ? Math.round(parseFloat(multi[3]) * u) : undefined,
    };
  }

  // Single value + unit, axis from nearby wording.
  const single = t.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/);
  if (single) {
    const v = Math.round(parseFloat(single[1]) * UNIT_MM[single[2]]);
    if (/tall|high|height/.test(t)) return { h: v };
    if (/deep|depth/.test(t)) return { d: v };
    return { w: v };
  }
  return {};
}

export type LocalMatch = {
  label: string;
  category: Category;
  shape: Shape;
  dimMM: Dim3;
};

/** Best catalog match with any explicit sizes from the text applied (then
 *  clamped). Null when the description matches nothing in the catalog. */
export function bestMatch(query: string): LocalMatch | null {
  const [item] = searchLibrary(query, 1);
  if (!item) return null;
  const o = parseDims(query);
  const dim: Dim3 = clampDims(item.category, item.shape, [
    o.w ?? item.dimMM[0],
    o.d ?? item.dimMM[1],
    o.h ?? item.dimMM[2],
  ]);
  return { label: item.label, category: item.category, shape: item.shape, dimMM: dim };
}
