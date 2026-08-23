// What every "take this away with you" path needs, in one place.
//
// Three things had accumulated copies: a slug for the filename, the mapping that
// applies the user's live transforms, and a furniture CSV. The transform mapping
// is the one that matters — an export built from the base parts silently ships
// pre-drag geometry — and it had FOUR copies: the export menu, the plan page, the
// Room panel's list, and the Inspector's snapshot. Four chances to hand someone a
// floor plan of a room nobody arranged.
//
// The CSV also existed twice with DIFFERENT content models and the SAME
// filename: the Room panel wrote a Qty-aggregated list, the export menu wrote a
// flat per-instance one, and both downloaded `<room>-furniture.csv`. Aggregated
// wins — the file exists to be taken shopping, and "2 × dining chair" is what a
// shopping list says.

import { csvBlob } from './csv';
import { formatDim } from './units';
import type { DimUnit } from './store';
import type { ScenePart } from './scene-spec';

/** Downloads carry the room's name, so a folder of exports from three rooms is
 *  still readable a week later. */
export function fileSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'room'
  );
}

/**
 * The scene as the user has actually arranged it: base parts with their position,
 * rotation and size overrides applied. EVERY export must go through this — the
 * overrides in `useStudio` are the layer that wins, and a part read straight from
 * `useScene` is the piece before anyone touched it.
 */
export function applyTransforms(
  parts: ScenePart[],
  overrides: {
    positions: Record<string, ScenePart['pos']>;
    rotations: Record<string, number>;
    dims: Record<string, ScenePart['dimMM']>;
  },
): ScenePart[] {
  return parts.map((p) => ({
    ...p,
    pos: overrides.positions[p.id] ?? p.pos,
    rot: overrides.rotations[p.id] ?? p.rot,
    dimMM: overrides.dims[p.id] ?? p.dimMM,
  }));
}

/** Identical pieces — same name, size and colour — collapse to one line with a count. */
export function groupForList(parts: ScenePart[]): Array<{ part: ScenePart; count: number }> {
  const map = new Map<string, { part: ScenePart; count: number }>();
  for (const p of parts) {
    const key = `${p.name}|${p.dimMM.join('x')}|${p.color ?? ''}`;
    const e = map.get(key);
    if (e) e.count += 1;
    else map.set(key, { part: p, count: 1 });
  }
  return [...map.values()].sort((a, b) => a.part.name.localeCompare(b.part.name));
}

/**
 * The one furniture CSV. `lib/csv` owns the escaping — formula injection,
 * quoting, CRLF and the BOM — so a piece named `=HYPERLINK(...)` is written as
 * text rather than evaluated when the file is opened.
 */
export function furnitureCsvBlob(parts: ScenePart[], dimUnit: DimUnit): Blob {
  return csvBlob([
    ['Qty', 'Name', 'Category', `Width (${dimUnit})`, `Depth (${dimUnit})`, `Height (${dimUnit})`, 'Colour'],
    ...groupForList(parts).map(({ part: p, count }) => [
      count,
      p.name,
      p.category,
      formatDim(p.dimMM[0], dimUnit),
      formatDim(p.dimMM[1], dimUnit),
      formatDim(p.dimMM[2], dimUnit),
      p.color ? p.color.toUpperCase() : '',
    ]),
  ]);
}
