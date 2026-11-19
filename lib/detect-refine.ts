// The pure post-process between a detector and the scene builder: measure, then
// merge. Both steps are shared by the cloud path and the on-device one.
//
// This is where CLAUDE.md rule 2 — "dimensions come from code, not AI" — is
// actually applied to a photograph: the AI's guessed position and size are
// discarded and recomputed from the calibrated camera. It sat as a private
// function inside app/onboarding/detect/page.tsx, where nothing could test the
// one decision it makes (which projection measures this object), so it moved
// here. It is pure — no React, no DOM, no fetch.
//
// `dedupeDetections` moved here from lib/detection.ts for two reasons. It has to
// run AFTER the measurement, not inside the Gemini call (see `refineDetections`),
// and it is not a cloud concern at all: the on-device detector needs the same
// merge, and nothing about the local path should sit behind a module that pulls
// in the Gemini SDK.

import { anchorFor, seeksSurface } from './physics';
import {
  AS_READ,
  cutByFrame,
  frameCuts,
  locateOnWall,
  placeCeilingObject,
  placeFloorObject,
  placeWallObject,
  type CameraCal,
  type MeasuredPlane,
  type ReadBounds,
} from './photo-geometry';
import type { Detection } from './detection';
import { defaultAxisFor, defaultDepthFor, isRoundPart, sceneShapeFor, type Category, type Shape } from './scene-spec';
import type { CaptureSlot } from './storage';
import type { Footprint } from './footprint';

/** Room extent in METRES. `depth` is the N–S dimension.
 *
 *  `height` is required, not optional, and that is the point: it is the only thing
 *  that locates the ceiling plane, so a caller that forgot it would silently stop
 *  measuring every fan and pendant in the room rather than fail to compile. */
export type RoomDims = {
  width: number;
  depth: number;
  height: number;
  /** The room's own outline. Required, not optional, and for the same reason `height`
   *  is: `onFramedSurface` bounds a decoded lateral offset against the wall's real
   *  ends, and a caller that omitted this would get the bounding box back — which is
   *  exactly the defect it exists to fix, silently. `roomFootprint` derives it from a
   *  saved room in one line. */
  footprint: Footprint;
};

/** One calibrated camera per wall the user actually photographed. A slot with no
 *  entry has no calibration — a normal outcome for a partial capture, not a
 *  failure, and `geoRefine` returns such detections untouched. */
export type CalMap = Partial<Record<CaptureSlot, CameraCal>>;

// Replace the AI's guessed position/size with values computed from projective
// geometry: bbox bottom edge → floor position; angular size × distance → real
// W and H. Depth genuinely cannot be observed from one photo, so it comes from
// the category's typical depth narrowed by the shape's range — never a literal —
// and clampDims gates everything downstream. AI keeps naming and classifying only.
//
// For a FLOOR or WALL piece that default is no longer only a filler for the axis
// nobody measured: both placers READ it, because a bbox edge is a corner of a solid
// rather than a point on a plane — a floor piece's bottom row is its near face, and
// a wall piece's back is on the plaster with its body in the room. So both branches
// stop preferring `d.dimMM[1]`, and that is rule 2 rather than tidiness: the AI's
// depth guess would otherwise move a measurement. The same catalogue number is what
// the piece is drawn with, so a hint kept for the render beside a default used for
// the maths cannot leave the two disagreeing.
//
// The CEILING branch is the one place `d.dimMM[1]` still wins, and it is not an
// oversight: `placeCeilingObject` reads a disc's width off its box and takes no
// depth, so nothing there turns a depth into a measurement.
/** Which placer reads a row of this word: the plane it is measured on.
 *
 *  Its anchor's, with one exception. A curtain whose shape resolves to the ceiling is
 *  still CLOTH ON A WALL — the exception predates the ceiling placer and survives it,
 *  because the question is "which plane is this object on", and cloth is on the wall
 *  plane whatever the anchor table calls it. One definition, because every reader of
 *  a measurement has to agree with the placer that made it: the label check judging
 *  such a curtain as a ceiling piece called its height unmeasured and its width cut,
 *  while the wall placer had measured the one and grown the other. */
export function measuredPlane(category: Category, shape: Shape): MeasuredPlane {
  const anchor = anchorFor(category, shape);
  if (anchor === 'ceiling' && category !== 'curtain') return 'ceiling';
  return anchor === 'floor' ? 'floor' : 'wall';
}

export function geoRefine(d: Detection, cals: CalMap, room: RoomDims): Detection {
  return geoMeasure(d, cals, room).row;
}

/** `geoRefine`, with which way the size it wrote can be wrong (`ReadBounds`): the
 *  placer's own answer, carried out beside the row for the one reader that needs it —
 *  `lib/label-repair.ts`, judging a word against the size. `row` is the input itself
 *  whenever nothing was measured, as `geoRefine`'s is, so the identity test there still
 *  holds; the bounds are then `AS_READ` and describe nothing. A ceiling row's are
 *  `AS_READ` too: its width is read on a plane it is on by assumption, and it has no
 *  height to bound.
 *
 *  `distanceDoubt` is the placer's too (`GeoPlacement.distanceDoubt`), for the hard
 *  merge: zero for a row nothing measured, and for a ceiling row, which is on its slab
 *  by assumption like a wall row on its wall. */
export function geoMeasure(
  d: Detection,
  cals: CalMap,
  room: RoomDims,
): { row: Detection; bounds: ReadBounds; distanceDoubt: number } {
  const unmeasured = { row: d, bounds: AS_READ, distanceDoubt: 0 };
  const cal = cals[d.slot];
  if (!cal) return unmeasured;
  const cat = (d.category ?? 'other') as Category;
  // The shape the room will BUILD this row as, by the room's own rule — never the
  // raw hint with `box` for a blank. The on-device detector names almost no shapes,
  // so that blank was the normal case, and a `ceiling light` came through as a lamp
  // shaped like a box: a floor piece. Its box is above the horizon, so the floor
  // placer refused it, and the room then built the pendant the label says it is and
  // hung it by the wall of whichever photo saw it — one per photo. A row measured as
  // one shape and built as another is measured on the wrong plane, with the wrong
  // depth, and compared for repeats as something it is not.
  const shape = sceneShapeFor(cat, d.label, d.shape);
  const plane = measuredPlane(cat, shape);
  const catalogueDepth = defaultDepthFor(cat, shape);
  // Named for its only consumer. It was `hintedDepth`, read by two branches of
  // three; a name that outlives the second consumer reads as a ladder the other
  // branches are also on.
  const ceilingDepth = d.dimMM?.[1] ?? catalogueDepth;

  if (plane === 'ceiling') {
    const g = placeCeilingObject(d.box, d.slot, room, cal);
    if (!g) return unmeasured;
    // Width is measured. HEIGHT IS NOT — the bbox of something seen from below
    // has a foreshortened diameter in it, not a thickness (see
    // `placeCeilingObject`), so it falls back the same way depth does.
    const row: Detection = {
      ...d,
      position: g.position,
      yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw,
      dimMM: [g.widthMM, ceilingDepth, d.dimMM?.[2] ?? defaultAxisFor(cat, shape, 2)],
    };
    return { row, bounds: AS_READ, distanceDoubt: 0 };
  }

  // ONE footprint for both placers, because it answers one question — what shape is
  // this piece in plan — and the two placers differ only in what pins its depth
  // axis. Roundness is read off the SAME (category, shape) pair as the depth, so the
  // number a piece is measured by and the footprint it is inverted as cannot
  // disagree — and both are the shape the room builds, so a round table named only
  // by its word is measured round.
  //
  // `whole` is the same catalogue again, for the sides the photo's edge cut off: what
  // the box did not see is not a size the camera measured, and a cut piece read as
  // its visible part is the scan coming back too small (`PieceFootprint.whole`).
  const foot = {
    depthM: catalogueDepth / 1000,
    round: isRoundPart(shape),
    whole: { widthM: defaultAxisFor(cat, shape, 0) / 1000, heightM: defaultAxisFor(cat, shape, 2) / 1000 },
  };
  const g =
    plane === 'floor'
      ? placeFloorObject(d.box, d.slot, room, cal, foot, d.footHidden === true)
      : placeWallObject(d.box, d.slot, room, cal, foot);
  if (!g) return unmeasured;
  const row: Detection = {
    ...d,
    position: g.position,
    yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw,
    dimMM: [g.widthMM, catalogueDepth, g.heightMM],
  };
  return { row, bounds: g.bounds, distanceDoubt: g.distanceDoubt };
}

/** How far below another piece's foot a row's must sit before the other is nearer the
 *  lens, as a share of the photo's height. A floor point's image row is set by its
 *  distance alone, so lower is nearer; the margin keeps two pieces standing side by side
 *  on one line from hiding each other on a pixel's difference. */
const NEARER_BY = 0.02;
/** How far inside the nearer box the hidden row's foot must be, so a foot resting on
 *  the very top edge of a low piece in front is not called hidden behind it. */
const INSIDE_BY = 0.01;
/** How far a row may reach past either side of the nearer box and still count as behind
 *  it, as a share of the photo's width — a detector's edge, not a piece's. */
const SPANNED_BY = 0.01;
/** The shortest typical piece that can hide another's foot, mm. A rug lies on the floor
 *  rather than standing in front of anything, and a sofa on one has its foot in plain
 *  view, inside the rug's box. */
export const OCCLUDER_MIN_HEIGHT_MM = 300;

/** Mark the floor rows whose foot a nearer floor piece in the same photo hides.
 *
 *  From the foot of a bed, the nightstands either side of its head are seen from the
 *  mattress up: their boxes end where the bed starts, and the floor placer read that
 *  row as where they stand — nearer and smaller than they are, so the label check
 *  called two real nightstands the wrong size. The photo did not show their foot, which
 *  is the case the frame cutting a box already has an answer for (`placeFloorObject`'s
 *  `cut.bottom`): read it standing as far back as the room lets it, and say which way
 *  each size can be wrong (`ReadBounds`).
 *
 *  The test is the boxes' own: another floor piece, tall enough to hide anything, whose
 *  foot is lower in the photo (so nearer the lens), with this row's foot inside its box
 *  and this row's whole width inside its width. **The whole width, not most of it:** a
 *  piece that reaches past the nearer one's side shows its foot there — the nightstand
 *  standing clear beside a bed on the tiles, the far one of twin beds seen end-on — and
 *  a floor box's bottom edge is the front face's, which runs nearly the box's full width,
 *  so half a width covered still leaves the foot in view.
 *
 *  **A row the frame cuts at a side is never marked.** Its outline leaves the picture
 *  there, so its nearer corner may be out of shot and the box's lower edge is where the
 *  outline crosses the frame — the frame-cut reading's question, not this one — and
 *  "inside the nearer box's width" means nothing at an edge both boxes share. With its
 *  side lost to the frame and its foot lost too, nothing is left to read the piece at a
 *  place by, and the doubt that honestly follows sweeps it across the photo onto
 *  whatever else stands on that line of sight: the far one of twin beds, seen past the
 *  near one's corner, was unticked as a repeat of it (§ 49.16's pair).
 *
 *  **Not something standing ON the nearer piece.** A table lamp on a nightstand, a
 *  monitor on a desk: its box sits inside its support's, with its foot above the
 *  support's, and every test above says hidden. It is not behind anything — it is on
 *  top — so a piece that goes on a surface rather than the floor (`seeksSurface`, read
 *  at the kind's catalogue size, as the Library places it) is never marked.
 *
 *  **Not the same piece boxed twice.** The on-device and cloud lists are marked
 *  together, before any merge, and a tighter box of one nightstand inside a looser box
 *  of the same nightstand passes every test too. Two boxes of one kind that overlap as
 *  much as the merge's own same-object rule asks (`SAME_BOX_IOU`) are one thing there,
 *  so they are one thing here; below it the merge keeps them as two, and so does this.
 *
 *  **Every row on the list can hide another, ticked or not.** A tick says whether the
 *  person wants a piece in the room, not whether it is in the photograph: an unticked
 *  bed — one they mean to replace — still stands in front of the nightstand, and a row
 *  linked as another's sighting is that piece, seen. Deleting a row is how a box is
 *  said not to be there at all, and a deleted row hides nothing.
 *
 *  A row whose mark does not change comes back as the same object. */
export function markHiddenFeet(dets: readonly Detection[]): Detection[] {
  return dets.map((d, i) => withFootHidden(d, footHiddenIn(d, dets, i)));
}

/** Whether a nearer piece in `list` hides `row`'s foot — `markHiddenFeet`'s answer for
 *  one row, for a caller measuring a row the list does not hold: the same box under
 *  another word, which is what a rename or a repair offers. `self` is the list's own row
 *  that `row` stands in for, skipped by identity so a box never hides itself. */
export function footHiddenAmong(row: Detection, list: readonly Detection[], self: Detection = row): boolean {
  return footHiddenIn(row, list, list.indexOf(self));
}

/** `d` carrying `hidden` as its mark, or `d` itself when it already does. */
export function withFootHidden(d: Detection, hidden: boolean): Detection {
  if (hidden === (d.footHidden === true)) return d;
  if (hidden) return { ...d, footHidden: true };
  const { footHidden: _drop, ...rest } = d;
  void _drop;
  return rest;
}

/** A floor row's kind, as the hiding test reads it: its catalogue height, and whether it
 *  goes on a surface rather than the floor. Null for a row that is not read on the floor. */
function floorKind(d: Detection): { tall: number; onSurface: boolean } | null {
  const cat = (d.category ?? 'other') as Category;
  const shape = sceneShapeFor(cat, d.label, d.shape);
  if (measuredPlane(cat, shape) !== 'floor') return null;
  const dims: [number, number, number] = [defaultAxisFor(cat, shape, 0), defaultAxisFor(cat, shape, 1), defaultAxisFor(cat, shape, 2)];
  return { tall: dims[2], onSurface: seeksSurface(cat, shape, dims) };
}

function footHiddenIn(d: Detection, list: readonly Detection[], self: number): boolean {
  const own = floorKind(d);
  if (!own || own.onSurface) return false;
  const sides = frameCuts(d.box);
  if (sides.left || sides.right) return false;
  const [x, , w] = d.box;
  const foot = d.box[1] + d.box[3];
  return list.some((o, j) => {
    if (j === self || o.slot !== d.slot) return false;
    const kind = floorKind(o);
    if (!kind || kind.tall < OCCLUDER_MIN_HEIGHT_MM) return false;
    if (o.category === d.category && boxIoU(o.box, d.box) >= SAME_BOX_IOU) return false;
    const [ox, oy, ow, oh] = o.box;
    if (!(oy + oh > foot + NEARER_BY) || !(oy < foot - INSIDE_BY)) return false;
    return x >= ox - SPANNED_BY && x + w <= ox + ow + SPANNED_BY;
  });
}

/** Whether the photo showed where this row stands: false when the frame cut its foot
 *  off or a nearer piece hides it. Either way `placeFloorObject` reads the row as far
 *  back as the room allows, with its sizes as bounds, so nothing that ranks or averages
 *  sightings may count it as a reading of where the piece is. One predicate, so the
 *  three places that ask cannot disagree about which rows those are. */
export function footUnseen(d: Detection): boolean {
  return cutByFrame(d.box) || d.footHidden === true;
}

/** The list with every row's mark worked out from the list itself, and each row whose
 *  mark changed measured again under the new one. Returns `dets` itself when nothing
 *  changed.
 *
 *  A row's place and size depend on the OTHER rows now — on whether a nearer piece
 *  hides its foot — so a list whose rows change has to be settled again: a box drawn by
 *  hand above a mattress, a bed deleted from in front of a nightstand, a list reopened
 *  from storage, which never saves the mark. Everything that measures, judges, compares
 *  or saves a row reads the settled list, so the size the room builds and the verdict
 *  beside it come from one reading. A row the geometry cannot measure keeps its place
 *  and takes only the mark. */
export function settleHiddenFeet(dets: readonly Detection[], cals: CalMap, room: RoomDims | null): Detection[] {
  if (!room) return dets as Detection[];
  let changed = false;
  const out = markHiddenFeet(dets).map((m, i) => {
    if (m === dets[i]) return m;
    changed = true;
    return geoMeasure(m, cals, room).row;
  });
  return changed ? out : (dets as Detection[]);
}

/** WHERE a wall row is, when `geoRefine` could not measure it — position and heading,
 *  never size. Returns the row itself when there is nothing to locate: a floor or
 *  ceiling piece, an uncalibrated photo, or a line of sight that meets no wall.
 *
 *  Its own function rather than a fourth branch of `geoRefine`, because the two answer
 *  different questions and a caller needs to be able to ask the first alone.
 *  `geoRefine` returning the SAME object is how `lib/label-repair.ts` knows a row went
 *  unmeasured, and a return-wall piece has to stay unmeasured there: its size was read
 *  against the wrong wall, so a verdict on its label would be a verdict on nothing.
 *  Folding the location in would hand back a new object and a measured-looking row.
 *
 *  The size stays whatever the row already had — the cloud path's hint, or nothing —
 *  and `buildSceneFromRoom` clamps it like any other hint. The heading follows
 *  `geoRefine`'s precedent: the model's own yaw wins where it gave one. */
export function geoLocate(d: Detection, cals: CalMap, room: RoomDims): Detection {
  const cal = cals[d.slot];
  if (!cal) return d;
  const cat = (d.category ?? 'other') as Category;
  const shape = sceneShapeFor(cat, d.label, d.shape);
  if (measuredPlane(cat, shape) !== 'wall') return d;
  const g = locateOnWall(d.box, d.slot, room.footprint, cal, {
    depthM: defaultDepthFor(cat, shape) / 1000,
    round: isRoundPart(shape),
  });
  if (!g) return d;
  return { ...d, position: g.position, yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw };
}

/** Measure a row where the camera can, and otherwise locate it where it can — the one
 *  call every path that turns a photo into rows makes. A row `geoRefine` measured comes
 *  back measured; one it refused comes back from `geoLocate`, which adds a position and
 *  nothing else. */
export function geoPlace(d: Detection, cals: CalMap, room: RoomDims): Detection {
  const measured = geoRefine(d, cals, room);
  return measured === d ? geoLocate(d, cals, room) : measured;
}

/** How close two same-category detections have to be, in metres, before they are
 *  judged one object seen twice.
 *
 *  Tiered, because one number cannot serve both ends of the catalogue. At the flat
 *  0.6 m this replaces, four identical dining chairs 0.55 m apart collapsed to
 *  TWO — real furniture deleted by the rule whose whole job is deleting
 *  duplicates — and loosening the number to better catch a bed seen from two
 *  walls would have eaten more of them.
 *
 *  What each tier answers is "how close can two DIFFERENT items of this category
 *  legitimately sit", so it tracks the item's own footprint: dining chairs tuck
 *  against each other, wardrobes do not. The other direction is one object
 *  measured from two walls, where the two estimates disagree by roughly the
 *  calibration error, so a tight tier means such a pair survives as two rows.
 *  That is the safe way to be wrong, and this file already argues why: a
 *  duplicate the user deletes in one tap beats a real piece that never appears.
 *
 *  Not derived from the catalogue's own widths, though it could be — half a
 *  typical width lands close to these numbers. Three named bands are easier to
 *  reason about at a glance than a formula whose output nobody can predict, and
 *  the merge distance is not the same quantity as the furniture's size: it is
 *  about how far two MEASUREMENTS of one thing can drift. */
type MergeTier = 'tight' | 'medium' | 'loose';

const MERGE_M: Record<MergeTier, number> = { tight: 0.35, medium: 0.6, loose: 0.9 };

/** Anything not named here is `medium`, which is the flat value this replaced. */
const MERGE_TIER: Partial<Record<Category, MergeTier>> = {
  // Small things that legitimately sit shoulder to shoulder: dining chairs at
  // ~0.5 m centres, two table lamps on one sideboard, a cluster of pots, dual
  // monitors, a gallery wall of frames, a pair of nightstands.
  chair: 'tight',
  nightstand: 'tight',
  ottoman: 'tight',
  lamp: 'tight',
  plant: 'tight',
  monitor: 'tight',
  painting: 'tight',
  mirror: 'tight',
  // Metre-and-a-half-plus footprints. Two of these are never 0.9 m apart, and
  // being large they are also the ones a single wall photo clips, so two views
  // of one item disagree the most.
  sofa: 'loose',
  bed: 'loose',
  wardrobe: 'loose',
  rug: 'loose',
  curtain: 'loose',
};

/** Exported for tests, and because a wrong tier is a piece of furniture the user
 *  loses without being told. */
export function mergeDistanceFor(category: Category): number {
  return MERGE_M[MERGE_TIER[category] ?? 'medium'];
}

/** How much two boxes in the same photo overlap, as intersection over union.
 *
 *  The standard measure, and it is here because the fixed 12%-of-the-image centre
 *  distance it replaces was SCALE-BLIND. Two bedside tables 0.55 m apart against a
 *  far wall image as two 7%-wide boxes 9% apart — they do not touch, and there is a
 *  visible gap between them, and the old rule merged them because 9% < 12%. That is
 *  the same failure as the flat 0.6 m cross-slot distance: one absolute number
 *  standing in for a question about proportion. A duplicate box from one detector
 *  overlaps its twin almost entirely; two small neighbours overlap not at all, at
 *  any distance from the camera.
 *
 *  Deliberately NOT intersection-over-minimum, which would also merge a box nested
 *  inside a much larger one — a shelf inside a bookcase, both called 'shelf'. IoU
 *  keeps both, and keeping both is the safe way to be wrong here: a duplicate the
 *  user deletes in one tap beats a real piece that never appears. */
function boxIoU(a: Detection['box'], b: Detection['box']): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** Two boxes in one photo are the same object at or above this overlap. Mid-range
 *  for non-maximum suppression, which normally runs 0.5–0.7; the low end, because
 *  the two boxes here come from one pass over one image rather than from a sliding
 *  window, so a genuine double-box is nearly coincident and anything ambiguous is
 *  better kept. */
const SAME_BOX_IOU = 0.5;

/** Words the two detectors use for the same thing. The on-device path runs two
 *  models over every photo — Open Images names (`Couch`, `Houseplant`, `Bookcase`)
 *  and the world prompts (`Sofa`, `Potted plant`, `Bookshelf`) — so one sofa seen from
 *  two walls could come back as a couch in one photo and a sofa in the other, and
 *  rule 2's label test kept both. Only TRUE synonyms: a loveseat beside a sofa, or a
 *  ceiling fan above a standing one, are two pieces, and that asymmetry is the
 *  reason the label test exists. */
const SAME_THING: readonly (readonly string[])[] = [
  ['sofa', 'couch', 'studio couch'],
  ['tv', 'television'],
  ['plant', 'houseplant', 'potted plant'],
  ['bookshelf', 'bookcase'],
  ['fan', 'electric fan', 'mechanical fan', 'standing fan'],
  ['dining table', 'kitchen & dining room table'],
  ['cabinet', 'storage cabinet', 'cupboard', 'cabinetry'],
  ['curtain', 'window curtain'],
  ['clothes rail', 'clothes rack', 'hanging clothes'],
  ['nightstand', 'bedside table'],
  ['fridge', 'refrigerator'],
];
const CANONICAL = new Map(SAME_THING.flatMap((g) => g.map((w) => [w, g[0]] as const)));

/** A label reduced to the word rule 2 compares: lowercased, trimmed, synonyms folded. */
export function sameThingKey(label: string): string {
  const l = label.toLowerCase().trim();
  return CANONICAL.get(l) ?? l;
}

/** Drop near-identical detections. Two rules:
 *
 *  1. Same slot + same category + bounding boxes overlapping by `SAME_BOX_IOU` —
 *     one object boxed twice in the same photo.
 *  2. Same label + same category, in ANY slot including the same one, but only
 *     when their estimated 3D positions agree to within that category's own merge
 *     distance — one object seen from two walls, or boxed twice in one photo
 *     without the boxes overlapping enough for rule 1.
 *
 *  Rule 2 carries no slot test on purpose. Its headline case is cross-slot, but a
 *  detector that boxes one sofa as two non-overlapping halves in a single photo is
 *  caught here rather than by rule 1, and both are the same question: do these two
 *  rows measure to one place. `tests/detect-pipeline.test.ts` depends on the wider
 *  reading — its gallery-pair fixtures are same-slot.
 *
 *  Rule 2 is the ONLY mechanism for the cross-slot case, deliberately. The prompt
 *  used to ask the model to name the other slots in an `alsoSeenIn` field, which no
 *  code ever read. Two independent measurements landing in the same place is better
 *  evidence than the model's own opinion about which walls it saw something in — and
 *  asking for that opinion would put AI judgement back into the decision
 *  `refineDetections` just moved onto measurements.
 *
 *  Rule 2 used to match on the label alone, with no positional test at all, so any
 *  two objects the model named identically collapsed into one: four matching
 *  dining chairs, a pair of bedside tables, two curtains on the same wall. On the
 *  one path in the product that spends the user's quota, that quietly threw away
 *  correct results. When either detection has no `position` there is nothing to
 *  compare, and we keep both — a duplicate the user can delete beats a real piece
 *  of furniture that never appears.
 *
 *  **The label test that survives at the bottom of rule 2 is a decision, not a
 *  leftover.** Dropping it — so that position alone decides — was proposed, priced
 *  and refused: see the second describe block in `tests/detect-pipeline.test.ts`,
 *  which holds both directions as tests. It costs a real piece of furniture on
 *  every run where two same-category pieces sit closer than their tier (two
 *  paintings 0.30 m apart against painting's 0.35 m), and buys back a duplicate
 *  that is one tap from gone. Same asymmetry as everywhere else in this file.
 *
 *  `measured` names the rows the camera sized. Without it the first sighting of a pair
 *  survives, which is the old rule and the right one for rows that are all measured or
 *  all hints; with it, a measured sighting replaces an unmeasured one it merges with.
 *  It decides which row is handed back and never which rows merge, so the same list
 *  gives the same number of rows with the set or without it.
 *
 *  `doubt` is how far each row's centre may be from where its photo put it
 *  (`GeoPlacement.distanceDoubt`), and rule 2 adds both rows' to their distance before it
 *  asks the tier: two rows are one place only if they would still be one place wherever
 *  the photos put them. **A bound is not a measurement, and it stops every piece that
 *  runs past it on one line.** Two dining chairs one behind the other, both read past the
 *  far wall on a lens assumed narrower than it was, were both stopped a quarter of a metre
 *  off the plaster, on the same spot, and the second was deleted; so was a chair the
 *  bottom of the frame cut, placed at the far end of where it could stand and so onto the
 *  chair across the table; and so was a single bed seen from its side, held half its
 *  catalogue LENGTH off the wall and so half a metre toward its twin (§ 46.3, § 46.1). A
 *  row the frame cut at its foot has no reading to be sure of, so it never merges by
 *  place. What rule 2 no longer takes ACROSS photos it leaves to `lib/repeat-sightings.ts`,
 *  which starts the repeat unticked and says why — the rule this file argues throughout,
 *  applied to the case that broke it. Within one photo there is no such hand-off: that
 *  pass never compares two rows of the same photo, since two boxes rule 1 did not merge
 *  are two things there, so a same-photo pair the doubt keeps apart stays two ticked rows.
 *  That is the chairs one behind the other, and right; how often it is one piece boxed
 *  twice is not measured. A refusal can also make a row found a group of its own that a
 *  later sighting then joins, where before it would have stood alone; the population test
 *  in `tests/repeat-sightings.test.ts` bounds that, since every such join it made wrongly
 *  would be a piece with no row, and it counts those. A doubt of a few centimetres, a
 *  shallow sofa's centre held on its wall, costs a merge those few centimetres and no
 *  more. Without the map every distance counts as read, which is the rule as it was.
 *
 *  Exported for tests: this is pure logic that decides what the user gets from the
 *  one call that spends their quota. */
export function dedupeDetections(
  items: Detection[],
  measured?: ReadonlySet<Detection>,
  doubt?: ReadonlyMap<Detection, number>,
): Detection[] {
  // A group is compared through the row that FOUNDED it across photos, and through
  // every row in it within one, and hands back its survivor.
  const groups: Detection[][] = [];
  const out: Detection[] = [];
  for (const d of items) {
    const at = groups.findIndex((g) => {
      const o = g[0];
      if (o.category !== d.category) return false;
      // Same photo — heavily overlapping boxes mean one object boxed twice. Asked of
      // every sighting in the group, not only its founder: a print founded from the
      // north photo and joined from the east one is still boxed twice in the east
      // photo, and asking the founder alone could not see it — two photos, and
      // `wall art` is not `painting` — so the print came out twice. A box that
      // overlaps a group's own box that heavily cannot reach anywhere new, which is
      // why this one rule may ask the members and the one below may not.
      if (g.some((m) => m.slot === d.slot && boxIoU(m.box, d.box) >= SAME_BOX_IOU)) return true;
      // Different photos — same name AND same place.
      if (sameThingKey(o.label) !== sameThingKey(d.label)) return false;
      if (!o.position || !d.position) return false;
      const dist = Math.hypot(o.position.x - d.position.x, o.position.z - d.position.z);
      return dist + (doubt?.get(o) ?? 0) + (doubt?.get(d) ?? 0) < mergeDistanceFor(d.category);
    });
    if (at < 0) {
      groups.push([d]);
      out.push(d);
      continue;
    }
    groups[at].push(d);
    // Which sighting SURVIVES is the second half of the merge, and first-come was only
    // ever safe while every row with a position had been measured. A located row has a
    // position and no size of its own, so when it arrived first — the east photo before
    // the north one — it ate the measurement and the piece went into the room at its
    // catalogue size. The measured row takes its place, in its place in the list.
    //
    // And ONLY its place: later rows are still compared against the founder, and the
    // members, never the survivor. They used to be compared against the survivor, so a
    // measurement arriving mid-group moved the group — to another photo, which lost the
    // same-photo rule for the founder's own double box, and up to a tier's distance
    // across the floor, where it swallowed a second bed the founder was never near.
    // The members are every row that joined, whichever survives, so choosing a
    // survivor never changes a count.
    //
    // And a sighting that saw the piece WHOLE outranks one the photo's edge cut off, one
    // step down the same ladder: a cut row is measured, but on its cut side its size is
    // the catalogue's, grown from the edge it did see (`PieceFootprint.whole`). Before
    // that growth a cut row was refused outright and so never competed; now it has a
    // position, and first-come handed the room the typical size where another photo had
    // measured the real one.
    if (survivorRank(d, measured) > survivorRank(out[at], measured)) out[at] = d;
  }
  return out;
}

/** How much of a piece a row measured: nothing (located, or no measurement asked
 *  for), some of it (the photo's edge cut it off), or all of it. */
function survivorRank(d: Detection, measured: ReadonlySet<Detection> | undefined): number {
  if (!measured?.has(d)) return 0;
  return footUnseen(d) ? 1 : 2;
}

/** Detector output → what the review screen shows. The ORDER is the point.
 *
 *  Measurement first: `dedupeDetections` compares 3D centres, so running it
 *  before the geometry pass compared the AI's guessed positions — the very
 *  numbers `geoRefine` exists to replace. A merge decides what exists in the
 *  room, and deciding it on AI geometry is CLAUDE.md rule 2 violated one layer
 *  above where rule 2 is enforced.
 *
 *  `room` is null when the room's own dimensions are unknown, in which case
 *  nothing can be measured and only the cloud path's self-reported positions are
 *  available to merge on. That is the old behaviour, kept deliberately: an
 *  unmeasurable photo is not a reason to stop merging.
 *
 *  Runs before any uid is minted, so there is no survivorship question to get
 *  wrong here — see the note on `confirmed` in app/onboarding/detect/page.tsx. */
export function refineDetections(dets: Detection[], cals: CalMap, room: RoomDims | null): Detection[] {
  if (!room) return dedupeDetections(dets);
  dets = markHiddenFeet(dets);
  // `geoPlace` written out, because the merge needs to know which rows it measured, and
  // how sure each one's place is, and `geoPlace`'s answer cannot say: a located row is a
  // new object too.
  const measured = new Set<Detection>();
  const doubt = new Map<Detection, number>();
  const placed = dets.map((d) => {
    const g = geoMeasure(d, cals, room);
    if (g.row === d) return geoLocate(d, cals, room);
    measured.add(g.row);
    if (g.distanceDoubt > 0) doubt.set(g.row, g.distanceDoubt);
    return g.row;
  });
  // Marked again on the list that survived the merge, because that is the list every
  // later reader marks: one whose bed merged into another photo's sighting has nothing
  // left in front of it, and a reading kept from before the merge would be judged,
  // compared and saved against a list that cannot explain it.
  return settleHiddenFeet(dedupeDetections(placed, measured, doubt), cals, room);
}
