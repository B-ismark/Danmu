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
  // H is the OPEN clamshell height — LaptopGeo raises the lid by it and the
  // catalog ships 220 mm. A closed-lid 30 mm ceiling here silently flattened
  // every laptop the picker, detection or a swap produced into a floor flap.
  laptop: R('fixed', [280, 190, 150], [420, 300, 300]),
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
  'bed-single': R('standard', [800, 1700, 300], [1200, 2100, 1300]),
  'bed-double': R('standard', [1350, 1800, 300], [2000, 2300, 1400]),
  'lamp-floor': R('standard', [200, 200, 1200], [600, 600, 2000]),
  'lamp-table': R('standard', [120, 120, 250], [450, 450, 800]),
  'lamp-pendant': R('standard', [150, 150, 150], [800, 800, 900]),
  mirror: R('standard', [300, 15, 400], [1200, 60, 2000]),
  'mirror-oval': R('standard', [300, 15, 450], [900, 60, 1800]),
  window: R('standard', [400, 40, 400], [3200, 200, 2400]),

  // ── flexible — made to measure, wide creative range ─────────────────────
  // Depth max was 1800, which is a bed. `clampDims` is per-axis, so a size search
  // for `160x200cm` handed the sofa 1600 wide and 2000 deep and the clamp brought
  // the depth only as far down as 1800 — the library then badged a 1.6 × 1.8 m
  // sofa as a legal one, and adding it built one. 1150 is the deepest real
  // single-row sofa (a deep-seat lounge); anything past that is a different piece
  // of furniture, not a wide range.
  //
  // The number is chosen so `max D < min W`, and that is the property worth
  // keeping rather than the constant: per-axis clamping cannot express a ratio, so
  // the only way to guarantee every legal sofa is wider than it is deep is for the
  // deepest legal depth to be under the narrowest legal width. `tests/dimension-
  // ranges.test.ts` asserts that pair, not the literals, because a later widening
  // of either end is exactly how the absurd size gets back in.
  //
  // Deliberately NOT retiered to 'standard'. The tier drives one label in the
  // Inspector ("Made to measure" vs "Typical size range") and is asserted by name
  // in that test; a sofa genuinely is ordered in custom sizes, and the complaint
  // here was the number, not the word.
  sofa: R('flexible', [1200, 700, 600], [4000, 1150, 1100]),
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
  bed: R('standard', [800, 1700, 300], [2000, 2300, 1400]),
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

/** How long a room's side may be, in metres — the outermost dimension in the app,
 *  and the one bound that is not per-item.
 *
 *  It lives here with the furniture ranges because it has the same job and needs
 *  the same discipline: `RoomDimsEditor` wrote `1` and `50` once in a predicate and
 *  twice more into the sentences it shows the user, and `lib/scene-file.ts` needed
 *  a fourth copy to validate an imported room against. A displayed measurement is
 *  derived from the rule, never typed next to it. */
export const ROOM_SIDE_M = { min: 1, max: 50 } as const;

/** How tall a ceiling may be, in metres.
 *
 *  Separate from `ROOM_SIDE_M` because a ceiling is not a side, and sharing that
 *  number let a room be one metre tall: `RoomDimsEditor` gated all three axes with
 *  the side bound, and `lib/scene-file.ts` bounded an imported `height` with it
 *  too. That is not a theoretical hole — a 1.65 m ceiling is what stranded a
 *  ceiling fan at 1.50 m in a 2.80 m room. The fan hung correctly at the ceiling of
 *  a room that short; the ceiling then left without it. `heightForNewCeiling`
 *  (`lib/physics.ts`) is the other half of that fix, and it is the half that
 *  matters — this range only makes the shortest rooms harder to reach by accident.
 *
 *  1.8 m is a low attic a person can still stand up in; 12 m is an atrium. Both
 *  ends reject the absurd rather than second-guessing a real room. */
export const ROOM_HEIGHT_M = { min: 1.8, max: 12 } as const;

/** The three axes of the room shell, in the order the editor lays them out.
 *
 *  The union is DERIVED from this array rather than written beside it, which is
 *  the discipline `SHAPES` / `CATEGORIES` / `DECOR_KINDS` already keep in
 *  `scene-spec.ts`. A hand-written union next to a hand-kept tuple accepts a
 *  duplicated or missing axis without complaint — `['width', 'width', 'height']`
 *  typechecks against `readonly [RoomAxis, RoomAxis, RoomAxis]` — and the drift
 *  goes the one direction nobody notices. */
export const ROOM_AXES = ['width', 'depth', 'height'] as const;

/** One axis of the room shell. */
export type RoomAxis = (typeof ROOM_AXES)[number];

/** The bound for one axis. Two consumers ask — the editor and the scene-file
 *  reader — so neither of them gets to decide for itself which range a ceiling
 *  takes. That decision was made twice and came out wrong both times. */
export function roomAxisRange(axis: RoomAxis): { min: number; max: number } {
  return axis === 'height' ? ROOM_HEIGHT_M : ROOM_SIDE_M;
}

/** Whether this axis may be this many metres. */
export function roomAxisWithin(axis: RoomAxis, metres: number): boolean {
  const r = roomAxisRange(axis);
  return Number.isFinite(metres) && metres >= r.min && metres <= r.max;
}

/** The room shell, in metres. */
export type RoomDims = Record<RoomAxis, number>;

/** Which rule refused a room edit.
 *
 *  A VALUE rather than something the caller re-derives by comparing the number it
 *  just sent against the floor it just passed in — the same reason
 *  `ClearanceIssue.rule` is a value and not a prefix of an id. The two refusals
 *  read differently on screen (`'floor'` names the piece in the way, `'range'`
 *  names the range) and a consumer working it out for itself is a second copy of
 *  the ordering decision made above. */
export type RoomRejection = 'range' | 'floor';

/** Fold a batch of pending per-axis edits into the room, in metres.
 *
 *  `RoomDimsEditor` judged the ONE axis being edited and then wrote all THREE,
 *  taking the other two out of the form rather than out of the room — so a value
 *  the editor had already refused was committed by the next edit to a different
 *  field. Clearing the height box gives `parseFloat('') === NaN`, that batch is
 *  correctly refused, and then one keystroke in Width writes `height: NaN` to the
 *  store and to IndexedDB. An axis nobody edited is not the form's to answer:
 *  everything outside `edits` comes off `current` here, which is why the fix
 *  cannot be "validate all three" (that refuses a width edit on account of a
 *  ceiling the user never touched — and this editor has shipped that too).
 *
 *  All-or-nothing per batch, deliberately: committing the good axes of a mixed
 *  batch changes the room, and the editor resyncs its fields from the room, so
 *  the refused number would be wiped off the screen while the message still
 *  named it. Refusing the batch leaves the bad number where the user can see
 *  what the message is about.
 *
 *  `pending` is what the caller should still be holding afterwards, and it is
 *  here rather than in the component because that is the half nothing could
 *  test. The first version cleared the caller's pending set BEFORE this call, so
 *  a refused batch discarded the good edits beside the bad one: a legal width
 *  typed alongside an illegal height vanished, and fixing the height then
 *  committed height alone and snapped the width field back with nothing said —
 *  a lost edit, silent. So a refusal hands the whole batch back and the form
 *  retries atomically as well as committing atomically. `lib/drag-click.ts` is
 *  the precedent: a decision parked in a component is a decision with no gate.
 *
 *  `rejected` is the FIRST bad axis in `ROOM_AXES` order — not the axis the user
 *  most recently touched. With two illegal fields the message therefore names
 *  the earlier one, and since the editor's `aria-invalid` is single-valued the
 *  other bad field loses its marker until the next commit. That is a deliberate
 *  simplification, not an oversight: it is deterministic, and the alternative
 *  needs the caller to say which field it was, which is a second source of truth
 *  for something the batch already contains. Do not read it as "the axis being
 *  edited".
 *
 *  `floors` is the per-axis minimum the FURNITURE imposes, in metres — plain
 *  numbers, because this module knows about rooms and not about `ScenePart`s and
 *  is not going to start. `lib/room-floor.ts` owns that rule and both consumers of
 *  it (this, and `lib/wall-actions.ts`) read the same function, which is the whole
 *  point: the dims editor and a wall drag are one operation with two entry points,
 *  and § 21 in `docs/what-is-still-open.md` is what happens when only one of them
 *  carries the rule. Omit it and the static range is the only bound, which is what
 *  every caller got before the stop existed. */
export function applyRoomEdits(
  current: RoomDims,
  edits: Partial<Record<RoomAxis, number>>,
  floors?: Partial<Record<RoomAxis, number>>,
): {
  room: RoomDims;
  rejected: RoomAxis | null;
  rejectedBy: RoomRejection | null;
  pending: Partial<Record<RoomAxis, number>>;
} {
  const room = { ...current };
  for (const axis of ROOM_AXES) {
    const v = edits[axis];
    if (v === undefined) continue;
    // A COPY, not `edits` itself. The present caller reads the keys and builds a
    // fresh Set, so returning the argument by reference is harmless today — and a
    // test that builds a fresh `edits` on every call could never tell the day it
    // stopped being harmless, which is the whole shape of a check that cannot
    // fail. A caller that held this and added the next keystroke's axis to it
    // would be mutating the batch the rule handed back. Raised by danmu-cd.
    const floor = floors?.[axis];
    // The furniture stop is checked FIRST and only while it is the binding one.
    // Both orderings are correct arithmetic and they differ only in which sentence
    // the user gets: typing 0.1 into a room holding a 2.4 m sectional is refused
    // either way, and `"Sectional" needs 2.4 m` is an answer they can act on where
    // "outside 2.4–50 m" is a restatement of the field's own arrows. The
    // `floor > min` guard is what keeps that promise honest — below it there is no
    // piece to name, so the static range answers and the caller never has to
    // render a "floor" refusal with nothing pointed at.
    if (floor !== undefined && Number.isFinite(v) && v < floor && floor > roomAxisRange(axis).min)
      return { room: current, rejected: axis, rejectedBy: 'floor', pending: { ...edits } };
    if (!roomAxisWithin(axis, v))
      return { room: current, rejected: axis, rejectedBy: 'range', pending: { ...edits } };
    room[axis] = v;
  }
  return { room, rejected: null, rejectedBy: null, pending: {} };
}

/** True if the given dims already sit inside the allowed range. */
export function dimsWithinRange(category: Category, shape: Shape, dim: Dim3): boolean {
  const r = dimRangeFor(category, shape);
  return dim.every((v, i) => v >= r.min[i] && v <= r.max[i]);
}
