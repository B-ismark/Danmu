// Trustable real-world size ranges per shape — the guard rail between the user
// (or the detection AI) and physically absurd furniture. Three tiers:
//
//   fixed    — manufactured items with tight standard sizes (a laptop is never
//              1.2 m wide). Narrow band around the catalog default.
//   standard — items with conventional sizes but real variety (chairs, beds,
//              fridges). Moderate band.
//   flexible — made-to-measure items (tables, rugs, shelving, curtains, art).
//              Wide band; the user keeps creative control.
//
// All values in mm as [W, D, H]. Every dimension write — AI detection, AI
// refine, the scale gizmo, the inspector's numeric fields — funnels through
// clampDims(), so the scene can never hold a fantasy size.

import type { Category, Shape } from './scene-spec';

export type DimFlex = 'fixed' | 'standard' | 'flexible';
export type Dim3 = [number, number, number];
export type DimRange = { flex: DimFlex; min: Dim3; max: Dim3 };

const R = (flex: DimFlex, min: Dim3, max: Dim3): DimRange => ({ flex, min, max });

const BY_SHAPE: Partial<Record<Shape, DimRange>> = {
  // ── fixed — real products, tight bands ──────────────────────────────────
  tv: R('fixed', [700, 40, 400], [2000, 120, 1150]), // 32" … 88" panels
  monitor: R('fixed', [330, 150, 250], [1000, 300, 600]),
  laptop: R('fixed', [280, 190, 10], [420, 300, 30]),
  soundbar: R('fixed', [600, 60, 50], [1300, 150, 160]),
  microwave: R('fixed', [440, 320, 250], [600, 500, 400]),
  'washing-machine': R('fixed', [550, 500, 800], [700, 700, 900]),
  'water-dispenser': R('fixed', [280, 280, 900], [400, 420, 1200]),
  'air-purifier': R('fixed', [200, 200, 400], [420, 420, 800]),
  radiator: R('fixed', [400, 60, 300], [2000, 200, 900]),
  'ac-unit': R('fixed', [700, 180, 250], [1200, 300, 350]),
  fan: R('fixed', [900, 900, 150], [1500, 1500, 450]),
  door: R('fixed', [620, 35, 1980], [1100, 60, 2400]),
  fridge: R('fixed', [500, 500, 800], [950, 800, 2100]),

  // ── standard — conventional sizes, moderate variety ─────────────────────
  'chair-dining': R('standard', [380, 380, 750], [600, 650, 1100]),
  'chair-office': R('standard', [500, 500, 900], [800, 800, 1400]),
  'chair-armchair': R('standard', [600, 600, 650], [1100, 1100, 1100]),
  ottoman: R('standard', [350, 350, 300], [1200, 1200, 550]),
  nightstand: R('standard', [300, 280, 350], [700, 600, 800]),
  'bed-single': R('standard', [1700, 800, 300], [2100, 1200, 1300]),
  'bed-double': R('standard', [1800, 1350, 300], [2300, 2000, 1400]),
  'lamp-floor': R('standard', [200, 200, 1200], [600, 600, 2000]),
  'lamp-table': R('standard', [120, 120, 250], [450, 450, 800]),
  'lamp-pendant': R('standard', [150, 150, 150], [800, 800, 900]),
  mirror: R('standard', [300, 15, 400], [1200, 60, 2000]),
  'mirror-oval': R('standard', [300, 15, 450], [900, 60, 1800]),
  window: R('standard', [400, 40, 400], [3200, 200, 2400]),

  // ── flexible — made to measure, wide creative range ─────────────────────
  sofa: R('flexible', [1200, 700, 600], [4000, 1800, 1100]),
  'coffee-table': R('flexible', [500, 400, 250], [1800, 1200, 600]),
  'side-table': R('flexible', [250, 250, 350], [800, 800, 800]),
  'desk-standard': R('flexible', [800, 450, 600], [2400, 1200, 900]),
  'desk-l': R('flexible', [1200, 1000, 600], [2600, 2200, 900]),
  wardrobe: R('flexible', [600, 400, 1600], [4000, 800, 2600]),
  closet: R('flexible', [600, 400, 1600], [4000, 800, 2600]),
  bookshelf: R('flexible', [400, 200, 600], [2400, 600, 2600]),
  'shoe-rack': R('flexible', [400, 200, 300], [1500, 500, 1800]),
  rug: R('flexible', [600, 400, 3], [5000, 4000, 40]),
  curtain: R('flexible', [400, 40, 800], [5000, 200, 3200]),
  plant: R('flexible', [100, 100, 150], [1200, 1200, 2600]),
  painting: R('flexible', [150, 15, 150], [2400, 60, 1800]),
  // Generic primitives (low-confidence detections) — wide but bounded.
  box: R('flexible', [50, 50, 50], [4000, 4000, 2800]),
  cylinder: R('flexible', [50, 50, 50], [2000, 2000, 2800]),
  plane: R('flexible', [50, 50, 2], [5000, 5000, 100]),
};

// Category fallback for shapes without an explicit entry (and for detections
// that landed on an off shape).
const BY_CATEGORY: Partial<Record<Category, DimRange>> = {
  sofa: BY_SHAPE.sofa,
  tv: BY_SHAPE.tv,
  chair: R('standard', [380, 380, 400], [1100, 1100, 1400]),
  table: R('flexible', [250, 250, 250], [2600, 1500, 1100]),
  desk: BY_SHAPE['desk-standard'],
  lamp: R('standard', [120, 120, 150], [800, 800, 2000]),
  plant: BY_SHAPE.plant,
  shelf: BY_SHAPE.bookshelf,
  rug: BY_SHAPE.rug,
  bed: R('standard', [1700, 800, 300], [2300, 2000, 1400]),
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
  other: R('flexible', [50, 50, 50], [4000, 4000, 2800]),
};

const FALLBACK: DimRange = R('flexible', [50, 50, 50], [5000, 5000, 2800]);

// Generic primitives carry no size identity of their own — a 'box' that the
// detector labelled category:'bed' should be bounded like a bed.
const GENERIC_SHAPES = new Set<Shape>(['box', 'cylinder', 'plane']);

export function dimRangeFor(category: Category, shape: Shape): DimRange {
  if (GENERIC_SHAPES.has(shape)) return BY_CATEGORY[category] ?? BY_SHAPE[shape] ?? FALLBACK;
  return BY_SHAPE[shape] ?? BY_CATEGORY[category] ?? FALLBACK;
}

/** Clamp [W, D, H] mm into the allowed range for this item. The single gate
 *  every dimension write goes through. */
export function clampDims(category: Category, shape: Shape, dim: Dim3): Dim3 {
  const r = dimRangeFor(category, shape);
  return [
    Math.min(r.max[0], Math.max(r.min[0], dim[0])),
    Math.min(r.max[1], Math.max(r.min[1], dim[1])),
    Math.min(r.max[2], Math.max(r.min[2], dim[2])),
  ];
}

/** True if the given dims already sit inside the allowed range. */
export function dimsWithinRange(category: Category, shape: Shape, dim: Dim3): boolean {
  const r = dimRangeFor(category, shape);
  return dim.every((v, i) => v >= r.min[i] && v <= r.max[i]);
}
