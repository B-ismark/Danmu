// Scene spec — single source of truth for parts in the 3D + 2D views.
// Either default (hand-curated demo room) or built from AI detections across all 4 wall captures.

import { ROOM } from './parts-catalog';
import { footprintForLayout, clampIntoFootprint, type LayoutId } from './footprint';
import {
  anchorFor,
  groundY,
  isFloorStanding,
  wallAffinity,
  snapToWall,
  pullToward,
  findSupportUnder,
  isTabletopProne,
} from './physics';
import type { CaptureSlot, RoomData } from './storage';
import { clampDims } from './dimension-ranges';
import { obbFromPart, obbOverlap } from './geometry';

export type Shape =
  | 'sofa' | 'tv' | 'closet' | 'rug' | 'plant'
  // chairs
  | 'chair-dining' | 'chair-office' | 'chair-armchair' | 'ottoman'
  // beds
  | 'bed-single' | 'bed-double'
  // tables / desks
  | 'desk-standard' | 'desk-l' | 'coffee-table' | 'side-table' | 'nightstand'
  // lamps
  | 'lamp-floor' | 'lamp-table' | 'lamp-pendant'
  // wall-hung
  | 'mirror' | 'mirror-oval' | 'painting' | 'ac-unit' | 'window'
  // others
  | 'monitor' | 'laptop' | 'fan' | 'fridge' | 'wardrobe' | 'curtain'
  | 'bookshelf' | 'shoe-rack' | 'door'
  // appliances
  | 'soundbar' | 'radiator' | 'air-purifier' | 'washing-machine' | 'microwave' | 'water-dispenser'
  | 'box' | 'cylinder' | 'plane';
// Decor collection — small props the user can add to / remove from a furniture
// surface. Positions are local-metre offsets from the part centre.
export type DecorKind = 'books' | 'vase' | 'plant' | 'bowl' | 'candle';
export type DecorItem = { id: string; kind: DecorKind; x: number; z: number };

export type Category =
  | 'sofa' | 'tv' | 'chair' | 'table' | 'lamp' | 'plant' | 'shelf' | 'rug'
  | 'bed' | 'desk' | 'monitor' | 'fan' | 'fridge' | 'wardrobe' | 'curtain'
  | 'mirror' | 'painting' | 'nightstand' | 'ottoman' | 'ac' | 'door'
  | 'other';

export type ScenePart = {
  id: string;
  category: Category;
  name: string;
  shape: Shape;
  /** default scene transform — overridable via studio store */
  pos: [number, number, number];
  rot: number;
  dimMM: [number, number, number];
  /** locked = preserved from photo (blue tint). false = new build (orange/dashed). */
  locked: boolean;
  /** circular footprint in plan */
  circle?: boolean;
  /** wall-mounted */
  wallMounted?: boolean;
  /** original detection bbox if scene came from detection */
  fromDetection?: { slot: CaptureSlot; bbox: [number, number, number, number]; conf: number };
  /** Body colour (#rrggbb). From photo sampling on detection, or the user's
   *  recolour. When absent the renderer falls back to the per-shape default. */
  color?: string;
  /** Surface finish (sheen). Overrides material roughness/metalness on the
   *  part's meshes via Draggable's FinishApplier. 'auto' / undefined keeps each
   *  shape's hand-tuned default. */
  finish?: 'auto' | 'matte' | 'satin' | 'polished' | 'metal';
  /** User-managed decor collection placed on the part's top surface. When
   *  undefined, an auto-suggested arrangement is shown; once the user edits it
   *  this array (possibly empty) takes over. See components/three/Dressing.tsx. */
  decor?: DecorItem[];
  /** group id — parts sharing one move together (multi-select merge). */
  groupId?: string;
  /** Reference into the local mesh cache (lib/mesh-cache.ts). When set, the 3D
   *  scene renders the cached GLB instead of the primitive shape. */
  meshHash?: string;
};

// ─── Default scene (used until detection runs) ────────────────────────────
// Contextually-sensible starter furniture per layout. The room SHAPE hints at a
// use: rectangle → living room, L → living + reading nook, T → living + dining,
// U → bedroom, open plan → living + dining loft. Coordinates are parametric on
// the room's width/depth so the set fits whatever footprint was chosen. Nothing
// is locked — it's all a starting point the user edits.
export function defaultScene(layoutId: LayoutId = 'rect', w: number = ROOM.width, d: number = ROOM.depth): ScenePart[] {
  let n = 0;
  const mk = (
    category: Category,
    name: string,
    shape: Shape,
    dimMM: [number, number, number],
    pos: [number, number, number],
    rot = 0,
    extra: Partial<ScenePart> = {},
  ): ScenePart => ({ id: `${category}-${++n}`, category, name, shape, pos, rot, dimMM, locked: false, ...extra });

  const hw = w / 2;
  const hd = d / 2;

  // Living-room core — TV on the back wall, sofa facing it, coffee table + rug
  // between, plant + lamp in the corners. cx shifts the whole cluster sideways
  // so it can share an open plan with a dining set.
  const living = (cx = 0): ScenePart[] => [
    mk('tv', 'TV', 'tv', [1450, 60, 820], [cx, 1.3, -hd + 0.06], 0, { wallMounted: true }),
    mk('sofa', 'Sofa', 'sofa', [2200, 950, 880], [cx, 0, hd - 0.95], Math.PI),
    mk('table', 'Coffee table', 'coffee-table', [1100, 600, 420], [cx, 0, hd - 2.1]),
    mk('rug', 'Area rug', 'rug', [2400, 1600, 5], [cx, 0, hd - 1.7]),
    mk('plant', 'Plant', 'plant', [400, 400, 1600], [cx - 1.4, 0, -hd + 0.5], 0, { circle: true }),
    mk('lamp', 'Floor lamp', 'lamp-floor', [300, 300, 1700], [cx + 1.4, 0, hd - 0.7], 0, { circle: true }),
  ];

  // Dining set — table + 4 chairs, centred on (cx, cz).
  const dining = (cx: number, cz: number): ScenePart[] => [
    mk('table', 'Dining table', 'desk-standard', [1500, 850, 750], [cx, 0, cz]),
    mk('chair', 'Dining chair', 'chair-dining', [480, 520, 850], [cx - 0.55, 0, cz], Math.PI / 2),
    mk('chair', 'Dining chair', 'chair-dining', [480, 520, 850], [cx + 0.55, 0, cz], -Math.PI / 2),
    mk('chair', 'Dining chair', 'chair-dining', [480, 520, 850], [cx, 0, cz - 0.6], 0),
    mk('chair', 'Dining chair', 'chair-dining', [480, 520, 850], [cx, 0, cz + 0.6], Math.PI),
  ];

  switch (layoutId) {
    case 'l':
      // Living + a reading nook (armchair, side table, bookshelf) in the wing.
      return [
        ...living(0),
        mk('chair', 'Armchair', 'chair-armchair', [800, 800, 900], [hw - 0.9, 0, hd - 0.9], -Math.PI / 1.4),
        mk('table', 'Side table', 'side-table', [450, 450, 550], [hw - 0.5, 0, hd - 1.7]),
        mk('shelf', 'Bookshelf', 'bookshelf', [900, 350, 1800], [-hw + 0.25, 0, 0], Math.PI / 2),
      ];
    case 't':
      // Living on the left, a small dining set on the right.
      return [...living(-w * 0.22), ...dining(w * 0.26, -hd + 1.3)];
    case 'u':
      // Bedroom — double bed, two nightstands, wardrobe on the side wall.
      return [
        mk('bed', 'Double bed', 'bed-double', [2000, 1600, 600], [0, 0, -hd + 1.0]),
        mk('nightstand', 'Nightstand', 'nightstand', [450, 400, 550], [-1.25, 0, -hd + 0.35]),
        mk('nightstand', 'Nightstand', 'nightstand', [450, 400, 550], [1.25, 0, -hd + 0.35]),
        mk('wardrobe', 'Wardrobe', 'wardrobe', [1800, 600, 2100], [hw - 0.35, 0, 0.6], -Math.PI / 2),
        mk('plant', 'Plant', 'plant', [400, 400, 1600], [-hw + 0.5, 0, hd - 0.6], 0, { circle: true }),
      ];
    case 'open':
      // Open-plan loft — living one side, dining the other, a bookshelf wall.
      return [
        ...living(-w * 0.2),
        ...dining(w * 0.26, -hd + 1.5),
        mk('shelf', 'Bookshelf', 'bookshelf', [1200, 350, 1800], [hw - 0.25, 0, hd - 1.5], -Math.PI / 2),
      ];
    default:
      return living(0);
  }
}

// ─── Local model library ──────────────────────────────────────────────────
// Curated list of common room items the user can drop in directly (no AI call).
// Each entry maps to a procedural primitive in components/three/DynamicPart.tsx.
// `group` only drives section headers in the Add-model picker.
export type LibraryItem = {
  label: string;
  group: 'Seating' | 'Tables' | 'Storage' | 'Bedroom' | 'Lighting' | 'Decor' | 'Tech' | 'Appliances' | 'Real sizes';
  category: Category;
  shape: Shape;
  dimMM: [number, number, number];
};

/** drag-and-drop MIME for dragging catalog items onto the 3D canvas. */
export const DND_MIME = 'application/x-danmu-item';

// Parametric shapes rebuild their geometry from the CURRENT dimensions (adding
// modules — pleats, shelves, bays, seats — rather than stretching one mesh). For
// these, Draggable does NOT group-scale the mesh: the geometry owns its size, so
// resizing reads correct + never distorts. All other shapes still group-scale.
const PARAMETRIC_SHAPES = new Set<Shape>([
  'sofa', 'curtain', 'wardrobe', 'closet', 'bookshelf', 'shoe-rack',
]);
export function isParametric(shape: Shape): boolean {
  return PARAMETRIC_SHAPES.has(shape);
}

// Categories whose flat top surface can hold a decor collection (vase, books…).
const DECOR_CATEGORIES = new Set<Category>(['table', 'desk', 'nightstand', 'shelf', 'wardrobe', 'ottoman']);
export function supportsDecor(category: Category, shape: Shape): boolean {
  if (shape === 'shoe-rack') return false; // angled tiers, no flat top
  return DECOR_CATEGORIES.has(category);
}

export const DECOR_KINDS: DecorKind[] = ['books', 'vase', 'plant', 'bowl', 'candle'];

function seededRand(s: string): () => number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded suggested decor arrangement for a decor-capable part. */
export function autoSurfaceDecor(category: Category, shape: Shape, dim: [number, number, number], id: string): DecorItem[] {
  if (!supportsDecor(category, shape)) return [];
  const w = dim[0] / 1000;
  const d = dim[1] / 1000;
  const rand = seededRand(id);
  const n = shape === 'nightstand' || category === 'ottoman' ? 1 : 2 + Math.floor(rand() * 2);
  const out: DecorItem[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `${id}-d${i}`,
      kind: DECOR_KINDS[Math.floor(rand() * DECOR_KINDS.length)],
      x: (rand() - 0.5) * w * 0.66,
      z: (rand() - 0.5) * d * 0.55,
    });
  }
  return out;
}

export const PART_LIBRARY: LibraryItem[] = [
  // Seating
  { label: 'Sofa · 3-seat', group: 'Seating', category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880] },
  { label: 'Armchair', group: 'Seating', category: 'chair', shape: 'chair-armchair', dimMM: [700, 700, 900] },
  { label: 'Dining chair', group: 'Seating', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850] },
  { label: 'Office chair', group: 'Seating', category: 'chair', shape: 'chair-office', dimMM: [600, 600, 1100] },
  { label: 'Ottoman', group: 'Seating', category: 'ottoman', shape: 'ottoman', dimMM: [550, 400, 420] },
  // Tables
  { label: 'Coffee table', group: 'Tables', category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420] },
  { label: 'Side table', group: 'Tables', category: 'table', shape: 'side-table', dimMM: [450, 450, 550] },
  { label: 'Dining / desk table', group: 'Tables', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750] },
  { label: 'L-shaped desk', group: 'Tables', category: 'desk', shape: 'desk-l', dimMM: [1600, 1400, 750] },
  { label: 'Nightstand', group: 'Tables', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] },
  // Storage
  { label: 'Wardrobe · 4-bay', group: 'Storage', category: 'wardrobe', shape: 'wardrobe', dimMM: [2400, 600, 2200] },
  { label: 'Bookshelf', group: 'Storage', category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800] },
  { label: 'Shoe rack', group: 'Storage', category: 'shelf', shape: 'shoe-rack', dimMM: [800, 300, 900] },
  // Bedroom
  { label: 'Single bed', group: 'Bedroom', category: 'bed', shape: 'bed-single', dimMM: [1900, 1000, 600] },
  { label: 'Double bed', group: 'Bedroom', category: 'bed', shape: 'bed-double', dimMM: [2000, 1600, 600] },
  // Lighting
  { label: 'Floor lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-floor', dimMM: [300, 300, 1700] },
  { label: 'Table lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500] },
  { label: 'Pendant lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-pendant', dimMM: [350, 350, 400] },
  // Decor
  { label: 'Rug', group: 'Decor', category: 'rug', shape: 'rug', dimMM: [2400, 1600, 5] },
  { label: 'Potted plant', group: 'Decor', category: 'plant', shape: 'plant', dimMM: [400, 400, 1600] },
  { label: 'Mirror · rectangular', group: 'Decor', category: 'mirror', shape: 'mirror', dimMM: [600, 30, 1400] },
  { label: 'Mirror · oval', group: 'Decor', category: 'mirror', shape: 'mirror-oval', dimMM: [600, 30, 1100] },
  { label: 'Painting', group: 'Decor', category: 'painting', shape: 'painting', dimMM: [800, 30, 600] },
  { label: 'Curtain', group: 'Decor', category: 'curtain', shape: 'curtain', dimMM: [1600, 80, 2200] },
  { label: 'Window', group: 'Decor', category: 'other', shape: 'window', dimMM: [1200, 60, 1200] },
  // Tech
  { label: 'TV · 65"', group: 'Tech', category: 'tv', shape: 'tv', dimMM: [1450, 60, 820] },
  { label: 'Monitor', group: 'Tech', category: 'monitor', shape: 'monitor', dimMM: [600, 200, 400] },
  { label: 'Laptop', group: 'Tech', category: 'monitor', shape: 'laptop', dimMM: [340, 240, 220] },
  // Appliances
  { label: 'Fridge', group: 'Appliances', category: 'fridge', shape: 'fridge', dimMM: [600, 650, 1700] },
  { label: 'Washing machine', group: 'Appliances', category: 'fridge', shape: 'washing-machine', dimMM: [600, 600, 850] },
  { label: 'Microwave', group: 'Appliances', category: 'fridge', shape: 'microwave', dimMM: [500, 380, 300] },
  { label: 'Water dispenser', group: 'Appliances', category: 'fridge', shape: 'water-dispenser', dimMM: [330, 330, 1000] },
  { label: 'Air purifier', group: 'Appliances', category: 'fridge', shape: 'air-purifier', dimMM: [300, 300, 620] },
  { label: 'Radiator', group: 'Appliances', category: 'fridge', shape: 'radiator', dimMM: [800, 120, 580] },
  { label: 'Soundbar', group: 'Tech', category: 'tv', shape: 'soundbar', dimMM: [1000, 110, 90] },
  { label: 'Ceiling fan', group: 'Appliances', category: 'fan', shape: 'fan', dimMM: [1000, 1000, 200] },
  { label: 'AC unit', group: 'Appliances', category: 'ac', shape: 'ac-unit', dimMM: [800, 220, 280] },
  { label: 'Door', group: 'Appliances', category: 'door', shape: 'door', dimMM: [900, 50, 2100] },
];

// ─── Detection → scene builder ────────────────────────────────────────────
// Map detected category to a sensible primitive + default mm dimensions.
const CATEGORY_DEFAULTS: Record<
  Category,
  { shape: Shape; dim: [number, number, number]; circle?: boolean; wallMounted?: boolean }
> = {
  sofa: { shape: 'sofa', dim: [2200, 950, 880] },
  tv: { shape: 'tv', dim: [1450, 60, 820], wallMounted: true },
  chair: { shape: 'chair-dining', dim: [500, 500, 850] },
  table: { shape: 'desk-standard', dim: [1200, 600, 750] },
  desk: { shape: 'desk-standard', dim: [1400, 700, 750] },
  lamp: { shape: 'lamp-floor', dim: [300, 300, 1700], circle: true },
  plant: { shape: 'plant', dim: [400, 400, 1600], circle: true },
  shelf: { shape: 'bookshelf', dim: [900, 350, 1800] },
  wardrobe: { shape: 'wardrobe', dim: [2000, 600, 2100] },
  rug: { shape: 'rug', dim: [2400, 1600, 5] },
  bed: { shape: 'bed-single', dim: [1900, 1000, 600] },
  monitor: { shape: 'monitor', dim: [600, 200, 400] },
  fan: { shape: 'fan', dim: [1000, 1000, 200], circle: true, wallMounted: true },
  fridge: { shape: 'fridge', dim: [550, 550, 850] },
  curtain: { shape: 'curtain', dim: [1600, 80, 2200], wallMounted: true },
  mirror: { shape: 'mirror', dim: [600, 30, 1400], wallMounted: true },
  painting: { shape: 'painting', dim: [800, 30, 600], wallMounted: true },
  nightstand: { shape: 'nightstand', dim: [450, 400, 550] },
  ottoman: { shape: 'ottoman', dim: [550, 400, 420] },
  ac: { shape: 'ac-unit', dim: [800, 220, 280], wallMounted: true },
  door: { shape: 'door', dim: [900, 50, 2100], wallMounted: true },
  other: { shape: 'box', dim: [600, 600, 800] },
};

/** The shapes a detector — cloud or on-device — is allowed to name, in the order
 *  the detection prompt lists them.
 *
 *  ONE list, exported, because there were three that had drifted apart:
 *    · `'window'` was missing here while lib/local-detect.ts maps a detected
 *      window onto it, so the gate in buildSceneFromRoom rejected the hint and a
 *      window rendered as a plain box — even though WindowGeo exists.
 *    · `'shoe-rack'` was here but absent from the prompt's catalog, so the cloud
 *      path could never produce a shape this gate would accept.
 *  lib/detection.ts now interpolates this array into the prompt instead of
 *  restating it.
 *
 *  `'closet'` is deliberately NOT here: it is a legacy alias for `'wardrobe'`
 *  that persisted rooms may still hold (ShapeDispatch and the dimension ranges
 *  keep handling it), but nothing should mint a new one. */
export const CATALOG_SHAPES_ORDERED: readonly Shape[] = [
  'sofa', 'tv', 'wardrobe', 'rug', 'plant',
  'chair-dining', 'chair-office', 'chair-armchair', 'ottoman',
  'bed-single', 'bed-double',
  'desk-standard', 'desk-l', 'coffee-table', 'side-table', 'nightstand',
  'lamp-floor', 'lamp-table', 'lamp-pendant',
  'mirror', 'mirror-oval', 'painting', 'ac-unit', 'window',
  'monitor', 'laptop', 'fan', 'fridge', 'curtain',
  'bookshelf', 'shoe-rack', 'door',
  'soundbar', 'radiator', 'air-purifier', 'washing-machine', 'microwave', 'water-dispenser',
] as const;

const CATALOG_SHAPES = new Set<Shape>(CATALOG_SHAPES_ORDERED);

/** Refine the default shape based on label keywords — turns a generic chair into
 *  an office chair if the AI detected it as such. */
function refineShape(category: Category, label: string): Shape {
  const l = label.toLowerCase();
  switch (category) {
    case 'chair':
      if (/ottoman|footstool|pouf/.test(l)) return 'ottoman';
      if (/office|swivel|desk chair|computer chair|gaming/.test(l)) return 'chair-office';
      if (/arm|lounge|accent|recliner|wingback|easy/.test(l)) return 'chair-armchair';
      return 'chair-dining';
    case 'bed':
      if (/double|queen|king|matrimonial/.test(l)) return 'bed-double';
      return 'bed-single';
    case 'desk':
      if (/l-shape|l shape|corner/.test(l)) return 'desk-l';
      return 'desk-standard';
    case 'table':
      if (/coffee|center/.test(l)) return 'coffee-table';
      if (/side|end|accent|console/.test(l)) return 'side-table';
      if (/night|bedside/.test(l)) return 'nightstand';
      if (/l-shape|corner/.test(l)) return 'desk-l';
      return 'desk-standard';
    case 'lamp':
      if (/pendant|ceiling|chandelier|bulb|hanging/.test(l)) return 'lamp-pendant';
      if (/table|desk|bedside|nightstand/.test(l)) return 'lamp-table';
      return 'lamp-floor';
    case 'shelf':
      if (/wardrobe|closet|cabinet|cupboard/.test(l)) return 'wardrobe';
      if (/shoe|footwear/.test(l)) return 'shoe-rack';
      return 'bookshelf';
    case 'monitor':
      if (/laptop|notebook|macbook|ultrabook|chromebook/.test(l)) return 'laptop';
      return 'monitor';
    case 'mirror':
      if (/oval|round|circular|arch|ellipse/.test(l)) return 'mirror-oval';
      return 'mirror';
    default:
      return CATEGORY_DEFAULTS[category]?.shape ?? 'box';
  }
}

/** Place a detection from a given slot into world space.
 *  Cameras stand at room center facing each wall. bbox.x along wall, no depth → snap to wall.
 *  Returns { pos, rot } in scene coords. */
function placementForSlot(
  slot: CaptureSlot,
  bbox: [number, number, number, number],
  dimMM: [number, number, number],
  wallMounted: boolean,
  shape: Shape,
  room: { width: number; depth: number; height: number } = ROOM,
): { pos: [number, number, number]; rot: number } {
  const cx = bbox[0] + bbox[2] / 2;
  const w = room.width;
  const d = room.depth;
  const dM = dimMM[1] / 1000;
  const hM = dimMM[2] / 1000;

  // Ceiling-mounted (fan) → at ceiling, snap to room center area
  if (shape === 'fan') {
    return { pos: [(cx - 0.5) * (w * 0.5), room.height - 0.15, 0], rot: 0 };
  }

  // Curtain hangs from above window height → top edge at ceiling, anchored to wall
  const yPos = wallMounted
    ? shape === 'curtain'
      ? room.height - hM / 2 - 0.05
      : Math.max(1.2, room.height - hM / 2 - 0.2)
    : 0;

  switch (slot) {
    case 'n':
      return { pos: [(cx - 0.5) * (w * 0.85), yPos, -d / 2 + dM / 2 + 0.05], rot: 0 };
    case 's':
      return { pos: [(0.5 - cx) * (w * 0.85), yPos, d / 2 - dM / 2 - 0.05], rot: Math.PI };
    case 'e':
      return { pos: [w / 2 - dM / 2 - 0.05, yPos, (cx - 0.5) * (d * 0.85)], rot: -Math.PI / 2 };
    case 'w':
      return { pos: [-w / 2 + dM / 2 + 0.05, yPos, (0.5 - cx) * (d * 0.85)], rot: Math.PI / 2 };
  }
}

export function buildSceneFromRoom(room: RoomData): ScenePart[] {
  const dets = room.detectedObjects ?? [];
  if (dets.length === 0)
    return defaultScene((room.layoutId ?? 'rect') as LayoutId, room.width ?? ROOM.width, room.depth ?? ROOM.depth);

  const parts: ScenePart[] = [];
  const counters: Record<string, number> = {};

  // The USER's room dims, not the demo defaults — detection positions come back
  // in metres relative to the real room, so placing them against ROOM's default
  // 5.6×4.2 box silently mis-scaled every layout that wasn't that exact size.
  const rw = room.width ?? ROOM.width;
  const rd = room.depth ?? ROOM.depth;
  const rh = room.height ?? ROOM.height;

  // Non-rectangular rooms: keep detected items inside the actual footprint
  // (detection still reasons about a rectangle, so an item can land in the
  // void of an L/U/T notch — pull it back in). A saved custom footprint wins.
  const footprint =
    room.footprint && room.footprint.length >= 3
      ? (room.footprint as [number, number][])
      : footprintForLayout((room.layoutId ?? 'rect') as LayoutId, rw, rd);

  for (const d of dets) {
    const slot = (d.label as string).match(/__slot:([nesw])$/)?.[1] as CaptureSlot | undefined;
    const realSlot: CaptureSlot = slot ?? 'n';
    const cleanLabel = (d.label as string).replace(/__slot:[nesw]$/, '');
    const cat = ((d as { category?: Category }).category ?? 'other') as Category;
    const cfg = CATEGORY_DEFAULTS[cat] ?? CATEGORY_DEFAULTS.other;
    counters[cat] = (counters[cat] ?? 0) + 1;
    // Prefer the detection's own stable key. The positional `${cat}-${n}` is an
    // ordinal, not an identity, and every per-part user edit — positions,
    // rotations, dims, hidden — is stored in a map keyed by this string. So
    // re-running detection with a different set of objects used to re-point the
    // old `sofa-1`'s saved transform at whatever the new `sofa-1` happened to be,
    // and deleting one detection shifted every id after it.
    //
    // Rooms detected before `uid` shipped have none, and fall back to the ordinal
    // — which keeps their existing transforms attached rather than orphaning every
    // one of them in the name of the fix.
    const id = (d as { uid?: string }).uid ?? `${cat}-${counters[cat]}`;
    const aiShape = (d as { shape?: string }).shape as Shape | undefined;
    // Label-based refinement takes priority over the AI's generic shape: the
    // detector often returns shape:'monitor' for a laptop or shape:'mirror' for
    // an oval mirror. When the label maps to a *specific* variant (anything other
    // than the category's generic default), trust the label; only fall back to
    // the raw AI shape when the label is generic.
    const labelShape = refineShape(cat, cleanLabel);
    const catDefaultShape = CATEGORY_DEFAULTS[cat]?.shape ?? 'box';
    const refined: Shape =
      labelShape !== catDefaultShape
        ? labelShape
        : aiShape && CATALOG_SHAPES.has(aiShape) && aiShape !== 'box'
          ? aiShape
          : labelShape;
    // AI-estimated dims are a HINT, never the source of truth — clamp them into
    // the shape's real-world range (lib/dimension-ranges). A wild estimate
    // (3.5 m sofa, 80 mm fridge) collapses to the nearest credible size.
    const aiDim = (d as { dimMM?: [number, number, number] }).dimMM;
    const dim = clampDims(
      cat,
      refined,
      aiDim && aiDim.every((n) => Number.isFinite(n) && n > 0) ? (aiDim as [number, number, number]) : cfg.dim,
    );
    // Prefer AI-estimated position/yaw when present and in-room; otherwise snap to wall.
    const aiPos = (d as { position?: { x: number; y: number; z: number } }).position;
    const aiYaw = (d as { yaw?: number }).yaw;
    let placement: { pos: [number, number, number]; rot: number };
    const w = rw / 2;
    const dHalf = rd / 2;
    const h = rh;
    if (
      aiPos &&
      typeof aiPos.x === 'number' &&
      typeof aiPos.y === 'number' &&
      typeof aiPos.z === 'number' &&
      Math.abs(aiPos.x) <= w + 0.2 &&
      Math.abs(aiPos.z) <= dHalf + 0.2 &&
      aiPos.y >= 0 &&
      aiPos.y <= h
    ) {
      placement = {
        pos: [aiPos.x, aiPos.y, aiPos.z],
        rot: typeof aiYaw === 'number' ? aiYaw : 0,
      };
    } else {
      placement = placementForSlot(realSlot, d.box, dim, !!cfg.wallMounted, refined, { width: rw, depth: rd, height: rh });
    }
    // Gravity: floor-standing items must touch the floor. Wall-mounted / ceiling
    // items snap to their canonical mounting height for the current part height.
    placement.pos[1] = groundY(cat, refined, dim, rh);

    // Logical placement: certain items only make sense against walls (door, fridge,
    // wardrobe, TV) or in the middle (rugs, coffee tables). Nudge accordingly.
    // snapToWall is footprint-edge exact, so L/T/U inner walls count too.
    const aff = wallAffinity(cat);
    // Named `bounds`, not `room` — that shadowed this function's own `room`
    // parameter for the rest of the block.
    const bounds = { width: rw, depth: rd };
    if (aff === 'must-wall') {
      const snapped = snapToWall(placement.pos, dim, footprint);
      placement.pos[0] = snapped.x;
      placement.pos[2] = snapped.z;
      if (snapped.rot !== undefined && (typeof aiYaw !== 'number' || Math.abs(aiYaw) < 0.05)) {
        placement.rot = snapped.rot;
      }
    } else if (aff === 'prefers-wall') {
      const halfW = bounds.width / 2;
      const halfD = bounds.depth / 2;
      const distFromWall = Math.min(
        halfD + placement.pos[2],
        halfD - placement.pos[2],
        halfW + placement.pos[0],
        halfW - placement.pos[0],
      );
      // Always snap via footprint-aware snapToWall — works for L/T/U inner edges too.
      if (distFromWall > 0.2) {
        const snapped = snapToWall(placement.pos, dim, footprint);
        placement.pos[0] = snapped.x;
        placement.pos[2] = snapped.z;
        if (snapped.rot !== undefined && (typeof aiYaw !== 'number' || Math.abs(aiYaw) < 0.05)) {
          placement.rot = snapped.rot;
        }
      }
    } else if (aff === 'prefers-middle') {
      // gentle pull toward room center (only if AI placed it near a wall by mistake).
      const halfW = bounds.width / 2;
      const halfD = bounds.depth / 2;
      const distFromWall = Math.min(
        halfD + placement.pos[2],
        halfD - placement.pos[2],
        halfW + placement.pos[0],
        halfW - placement.pos[0],
      );
      if (distFromWall < 0.6) {
        const pulled = pullToward(placement.pos, [0, 0], 0.4);
        placement.pos[0] = pulled[0];
        placement.pos[2] = pulled[1];
      }
    }
    // Keep the footprint (XZ) inside non-rectangular rooms.
    const [fpx, fpz] = clampIntoFootprint(placement.pos[0], placement.pos[2], footprint);
    placement.pos[0] = fpx;
    placement.pos[2] = fpz;

    parts.push({
      id,
      category: cat,
      name: cleanLabel || cat,
      shape: refined,
      pos: placement.pos,
      rot: placement.rot,
      dimMM: dim,
      locked: d.locked,
      circle: cfg.circle,
      wallMounted: cfg.wallMounted,
      fromDetection: { slot: realSlot, bbox: d.box, conf: d.conf },
      meshHash: (d as { meshHash?: string }).meshHash,
      color: (d as { color?: string }).color,
    });
  }

  // ─── Settle pass ─────────────────────────────────────────────────────────
  // The per-part placement above respects wall affinity + anchor type, but the
  // AI frequently puts a monitor at wall-mid Y (~1.4m) even though there's a
  // desk under it. Do a second pass to:
  //   1. Snap tabletop-prone parts (monitor, lamp, plant, ottoman, "other") onto
  //      the highest supporting surface under their XZ footprint when one exists
  //      and the surface is taller than 0.3m (i.e. a real table, not a rug).
  //   2. For any floor-standing part whose Y ended up > 0 with no support
  //      beneath, drop it to the floor — recovers from bad AI Y estimates.
  //   3. Ceiling clamp — no part top should poke through the ceiling.
  const CEILING_PAD = 0.02;
  const cap = rh - CEILING_PAD;
  for (const p of parts) {
    if (p.category !== 'rug') {
      const support =
        p.wallMounted ? null : findSupportUnder(parts, p.id, p.pos[0], p.pos[2], p.dimMM);

      if (!p.wallMounted && isTabletopProne(p.category) && support !== null && support > 0.3) {
        p.pos[1] = support;
      } else if (!p.wallMounted && isFloorStanding(p.category, p.shape) && p.pos[1] > 0.05) {
        p.pos[1] = support !== null && support > 0.3 ? support : 0;
      }
    }

    // Ceiling clamp — semantics differ for floor vs wall/ceiling-mounted parts.
    // Floor-standing items have pos[1] = bottom of bounding box; wall-mounted
    // items have pos[1] = mesh center. Keep both under the ceiling.
    const h = p.dimMM[2] / 1000;
    if (p.wallMounted || p.shape === 'fan' || p.shape === 'lamp-pendant') {
      const top = p.pos[1] + h / 2;
      if (top > cap) p.pos[1] = cap - h / 2;
    } else {
      if (p.pos[1] + h > cap) p.pos[1] = Math.max(0, cap - h);
    }
  }

  return parts;
}

/** Whether a part renders as a wall/ceiling-mounted item (geometry centred on
 *  the group origin) rather than floor-anchored. SHAPE-aware: a mirror/tv/etc.
 *  is wall-mounted even if the AI labelled it with an off category — relying on
 *  category alone let a "mirror" come back as category:other → wallMounted:false
 *  → centred geometry sinking half-way through the floor. */
export function isWallMountedPart(cat: Category, shape: Shape): boolean {
  return anchorFor(cat, shape) !== 'floor';
}

/** Compute a sane spawn transform for a NEW part added at the room centre.
 *  Mirrors the gravity rules used by the detection builder so added items never
 *  spawn buried in the floor (wall-mounted) or floating in mid-air.
 *    • wall/ceiling-mounted → canonical mounting height (groundY)
 *    • small tabletop-prone items (lamp, monitor, plant…) → rest on a surface
 *      under the centre if one exists, else the floor
 *    • everything else (sofa, bed, table, wardrobe, chair…) → ALWAYS the floor,
 *      so adding a piece never lands it stacked on whatever happens to sit at
 *      room centre (e.g. the starter coffee table).
 */
export function placeNewPart(
  cat: Category,
  shape: Shape,
  dimMM: [number, number, number],
  room: { width: number; depth: number; height: number },
  existing: ScenePart[],
): { pos: [number, number, number]; wallMounted: boolean } {
  const wallMounted = isWallMountedPart(cat, shape);
  if (wallMounted) {
    const h = dimMM[2] / 1000;
    // Centre-anchored: clamp so the bottom edge never dips below the floor and
    // the top never passes the ceiling, regardless of the canonical height.
    let y = groundY(cat, shape, dimMM, room.height);
    y = Math.max(h / 2 + 0.02, Math.min(room.height - h / 2 - 0.02, y));
    return { pos: [0, y, 0], wallMounted };
  }
  // Only small "goes on a table" items seek a surface; everything else floors.
  const support = isTabletopProne(cat) ? findSupportUnder(existing, '__new__', 0, 0, dimMM) : null;
  const y = support !== null && support > 0.3 ? support : 0;
  return { pos: [0, y, 0], wallMounted };
}

/** Y-aware collision. Used for placement clamping. Rugs/mats exempt.
 *  Allows stacking — if one part's vertical extent doesn't overlap the other's, no collision.
 *  This lets users put a lamp on a desk, monitor on a desk, etc. */
export function collidesAt(
  parts: ScenePart[],
  movingId: string,
  pos: [number, number, number],
  rot: number,
  dimMM: [number, number, number],
): boolean {
  const mover = parts.find((p) => p.id === movingId);
  if (!mover) return false;
  if (mover.category === 'rug') return false;
  const mh = dimMM[2] / 1000;
  // Mover y-bottom (pos.y is the floor anchor in our scene; for wall-mounted it's mid-height).
  const myBottom = pos[1];
  const myTop = pos[1] + mh;
  const me = obbFromPart(pos, rot, dimMM);
  for (const o of parts) {
    if (o.id === movingId) continue;
    if (o.category === 'rug') continue;
    if (o.wallMounted) continue;
    const oh = o.dimMM[2] / 1000;
    const oyBottom = o.pos[1];
    const oyTop = o.pos[1] + oh;

    // Vertical separation → no collision (stacking allowed).
    const yOverlap = !(myTop <= oyBottom + 0.005 || myBottom >= oyTop - 0.005);
    if (!yOverlap) continue;

    // XZ overlap — exact rotated-rectangle test (SAT). The tiny negative pad
    // lets flush side-by-side placement read as touching, not colliding.
    if (obbOverlap(me, obbFromPart(o.pos, o.rot, o.dimMM), -0.01)) return true;
  }
  return false;
}
