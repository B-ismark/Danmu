// What the floor is made of — the room's one choice of material, beside its walls'
// paint. Pure data and validation; the textures it names are drawn in
// `lib/textures.ts` and spread in `components/three/RoomShell.tsx`.
//
// ── Three choices, each a real one ───────────────────────────────────────────
//
//   · KIND  — the material: planks, herringbone, tile, stone, concrete, carpet.
//   · SIZE  — the module a fitter would name: a board's width, a tile's side. A
//             short list per kind rather than a free number, because a floor is
//             bought in a handful of standard widths and a 37 mm plank is not a
//             floor anyone lays. It also keeps every texture one of a few, so they
//             can be generated once and kept.
//   · GROUT — tile and stone only: matching (the joint all but disappears) or
//             contrasting (the grid is the look). Dark only, never light: the tone
//             map MULTIPLIES the chosen colour (see `lib/textures.ts`), so a joint
//             can be drawn darker than its tile and never paler. A pale grout on a
//             dark tile would need a second colour, and that is a different shader.
//
// Colour is the user's, as for walls and furniture, and each kind offers its own
// short palette because "oak" and "terracotta" are not the same list.
//
// **A floor nobody chose is the floor the app always had** — planks, 200 mm, the
// pale board tone — so every room saved before this existed opens unchanged, and
// `floor` is optional everywhere it is stored.

export const FLOOR_KINDS = ['planks', 'herringbone', 'tile', 'stone', 'concrete', 'carpet'] as const;
export type FloorKind = (typeof FLOOR_KINDS)[number];

export const GROUTS = ['match', 'dark'] as const;
export type Grout = (typeof GROUTS)[number];

/** A room's floor. Every field but `kind` falls back to that kind's default. */
export type FloorFinish = {
  kind: FloorKind;
  /** Hex colour; absent = the kind's first swatch. */
  color?: string;
  /** Board width or tile side, mm — one of the kind's `sizes`. */
  sizeMM?: number;
  grout?: Grout;
};

export type FloorSwatch = { readonly hex: string; readonly name: string };
export type FloorSize = { readonly mm: number; readonly name: string };

export type FloorKindSpec = {
  readonly label: string;
  /** One line under the choice, saying what is being picked. */
  readonly note: string;
  /** What the size is OF, for the control's label. Null: the kind has no module. */
  readonly sizeOf: string | null;
  readonly sizes: readonly FloorSize[];
  readonly defaultSizeMM: number | null;
  readonly grout: boolean;
  /** The material's roughness at its roughest; the roughness map scales it down. */
  readonly roughness: number;
  /** Strength of the relief, for `normalScale`. */
  readonly relief: number;
  /** First swatch is the default colour. At most six, so the row and its mixer are
   *  one line of seven in the narrowest rail (`tests/floor-finish.test.ts`). */
  readonly swatches: readonly FloorSwatch[];
};

const WOOD: readonly FloorSwatch[] = [
  // The board tone the floor always had: first, so an unchosen floor is unchanged.
  { hex: '#E6E1D6', name: 'Pale oak' },
  { hex: '#EEEBE4', name: 'Whitewash' },
  { hex: '#DCC29A', name: 'Natural oak' },
  { hex: '#CC9C66', name: 'Honey' },
  { hex: '#6B4A33', name: 'Walnut' },
  { hex: '#43342A', name: 'Smoked' },
];

export const FLOOR_SPEC: Record<FloorKind, FloorKindSpec> = {
  planks: {
    label: 'Planks',
    note: 'Long boards, joints staggered.',
    sizeOf: 'Board width',
    sizes: [
      { mm: 120, name: 'Narrow' },
      { mm: 200, name: 'Classic' },
      { mm: 250, name: 'Wide' },
      { mm: 300, name: 'Extra wide' },
    ],
    defaultSizeMM: 200,
    grout: false,
    roughness: 0.92,
    relief: 0.8,
    swatches: WOOD,
  },
  herringbone: {
    label: 'Herringbone',
    note: 'Short blocks laid in a zigzag, five times as long as wide.',
    sizeOf: 'Block width',
    sizes: [
      { mm: 70, name: 'Petite' },
      { mm: 90, name: 'Classic' },
      { mm: 120, name: 'Wide' },
    ],
    defaultSizeMM: 90,
    grout: false,
    roughness: 0.88,
    relief: 0.8,
    swatches: WOOD,
  },
  tile: {
    label: 'Ceramic tile',
    note: 'Glazed squares with grout joints.',
    sizeOf: 'Tile size',
    sizes: [
      { mm: 100, name: 'Mosaic' },
      { mm: 200, name: 'Small' },
      { mm: 300, name: 'Standard' },
      { mm: 600, name: 'Large' },
      { mm: 900, name: 'XL' },
    ],
    defaultSizeMM: 300,
    grout: true,
    roughness: 0.9,
    relief: 0.6,
    swatches: [
      { hex: '#F2F0EB', name: 'White' },
      { hex: '#BDB9B1', name: 'Warm grey' },
      { hex: '#D08A62', name: 'Terracotta' },
      { hex: '#A3B8A0', name: 'Sage' },
      { hex: '#7F9BB0', name: 'Blue' },
      { hex: '#4A4845', name: 'Charcoal' },
    ],
  },
  stone: {
    label: 'Stone',
    note: 'Honed slabs with soft veining.',
    sizeOf: 'Slab size',
    sizes: [
      { mm: 400, name: 'Small' },
      { mm: 600, name: 'Standard' },
      { mm: 800, name: 'Large' },
    ],
    defaultSizeMM: 600,
    grout: true,
    roughness: 0.9,
    relief: 0.5,
    swatches: [
      { hex: '#EFECE6', name: 'White marble' },
      { hex: '#DCCDB4', name: 'Travertine' },
      { hex: '#C9C1B1', name: 'Limestone' },
      { hex: '#A9A69F', name: 'Grey stone' },
      { hex: '#5C5955', name: 'Slate' },
    ],
  },
  concrete: {
    label: 'Concrete',
    note: 'Poured and polished, no joints.',
    sizeOf: null,
    sizes: [],
    defaultSizeMM: null,
    grout: false,
    roughness: 0.75,
    relief: 0.5,
    swatches: [
      { hex: '#D2CEC7', name: 'Concrete' },
      { hex: '#E6E1D8', name: 'Pale' },
      { hex: '#C7B6A2', name: 'Warm' },
      { hex: '#8F8C86', name: 'Graphite' },
    ],
  },
  carpet: {
    label: 'Carpet',
    note: 'Wall-to-wall loop pile.',
    sizeOf: null,
    sizes: [],
    defaultSizeMM: null,
    grout: false,
    roughness: 1,
    relief: 1,
    swatches: [
      { hex: '#DDD4C5', name: 'Oatmeal' },
      { hex: '#B3ACA2', name: 'Pebble' },
      { hex: '#97A585', name: 'Moss' },
      { hex: '#7D8C99', name: 'Slate blue' },
      { hex: '#B87A6A', name: 'Clay' },
      { hex: '#45423F', name: 'Charcoal' },
    ],
  },
};

export const DEFAULT_FLOOR: FloorFinish = { kind: 'planks' };

/** Every field filled in, for a renderer that must not guess. */
export type ResolvedFloor = { kind: FloorKind; color: string; sizeMM: number | null; grout: Grout };

export function resolveFloor(f: FloorFinish | undefined): ResolvedFloor {
  const kind = f?.kind ?? DEFAULT_FLOOR.kind;
  const spec = FLOOR_SPEC[kind];
  return {
    kind,
    color: f?.color ?? spec.swatches[0].hex,
    sizeMM: spec.defaultSizeMM === null ? null : nearestSize(spec, f?.sizeMM ?? spec.defaultSizeMM),
    grout: spec.grout ? (f?.grout ?? 'match') : 'match',
  };
}

function nearestSize(spec: FloorKindSpec, mm: number): number {
  let best = spec.sizes[0].mm;
  for (const s of spec.sizes) if (Math.abs(s.mm - mm) < Math.abs(best - mm)) best = s.mm;
  return best;
}

/** A change of material keeps nothing that belonged to the old one: oak in a tile's
 *  palette is a colour nobody picked for a tile. */
export function withKind(kind: FloorKind): FloorFinish {
  return { kind };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Reads a floor from bytes someone else produced — a saved record or a room file.
 *  Lossy on purpose and never silent: what it could not keep is pushed onto
 *  `dropped`. A size off the kind's list snaps to the nearest one (the same rule as
 *  `clampDims`: an odd number is a hint, not a refusal); an unknown kind is the
 *  whole floor gone, because a size and a colour mean nothing without one. */
export function readFloorFinish(v: unknown, dropped?: string[]): FloorFinish | null {
  if (v === undefined) return null;
  if (typeof v !== 'object' || v === null) {
    dropped?.push("the floor's material was unreadable, so the default floor was used");
    return null;
  }
  const o = v as Record<string, unknown>;
  const kind = (FLOOR_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as FloorKind) : null;
  if (!kind) {
    dropped?.push("the floor's material was unreadable, so the default floor was used");
    return null;
  }
  const spec = FLOOR_SPEC[kind];
  const out: FloorFinish = { kind };
  if (o.color !== undefined) {
    if (typeof o.color === 'string' && HEX.test(o.color)) out.color = o.color;
    else dropped?.push("the floor's colour was unreadable, so its default was used");
  }
  if (o.sizeMM !== undefined && spec.defaultSizeMM === null) dropped?.push(`the ${spec.label.toLowerCase()} floor has no module size, so the one given was left out`);
  if (o.sizeMM !== undefined && spec.defaultSizeMM !== null) {
    if (typeof o.sizeMM === 'number' && Number.isFinite(o.sizeMM)) {
      const snapped = nearestSize(spec, o.sizeMM);
      if (snapped !== o.sizeMM) dropped?.push(`the floor's ${spec.sizeOf?.toLowerCase()} was not a standard one, so the nearest was used`);
      out.sizeMM = snapped;
    } else dropped?.push(`the floor's ${spec.sizeOf?.toLowerCase()} was unreadable, so its default was used`);
  }
  if (o.grout !== undefined && !spec.grout) dropped?.push(`the ${spec.label.toLowerCase()} floor has no grout, so the one given was left out`);
  if (o.grout !== undefined && spec.grout) {
    if ((GROUTS as readonly unknown[]).includes(o.grout)) out.grout = o.grout as Grout;
    else dropped?.push("the floor's grout was unreadable, so matching grout was used");
  }
  return out;
}
