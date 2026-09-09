// The known room: one synthetic bedroom, its ten pieces, and the pipeline that
// measures them. Shared fixture, not a suite — vitest's `include` is
// `tests/**/*.test.{ts,tsx}`, so nothing here is collected.
//
// WHY IT MOVED HERE. All of this lived at module scope in
// `tests/detect-pipeline.test.ts`, where `boxFor` and `shots` read `CAL` and `ROOM`
// off module scope and took no camera argument. That is fine for one camera and
// impossible for two, and `tests/off-square-cost.test.ts` needs to run the same
// room past a camera that is not square to the wall. The alternative was a second
// copy of the truth table, which is the drift this repo keeps naming.
//
// The extraction had one strong safety property and it was used: the printed table
// in `detect-pipeline.test.ts` had to come out BYTE-IDENTICAL afterwards, and every
// one of its assertions — nine of the ten pieces bounded at 1e-9 — had to pass
// untouched. No judgement call about whether the move was faithful.

import { refineDetections, type CalMap, type RoomDims } from '@/lib/detect-refine';
import { judgeLabels } from '@/lib/label-repair';
import { toRecord, type SavedDetection } from '@/lib/detection-record';
import { buildSceneFromRoom, type Category, type Shape } from '@/lib/scene-spec';
import { anchorFor } from '@/lib/physics';
import type { CameraCal } from '@/lib/photo-geometry';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot, RoomData } from '@/lib/storage';
import {
  ALONG,
  bboxOfCeilingDisc,
  bboxOfFloorObject,
  bboxOfWallPanel,
  extent,
  project,
  yawedPoint,
  type Box,
} from './project';

// ── The room ──────────────────────────────────────────────────────────────────
//
// 7 × 6 m rather than a typical bedroom, because the FRAME is the binding
// constraint, not the furniture. A camera 1.5 m up sees floor only past 1.51 m and
// ceiling only past 1.21 m (see placeCeilingObject), so a small room leaves no
// distance at which a piece is both fully inside the walls and fully inside the
// picture. Every fixture asserts `inFrame`, so shrinking this room fails loudly
// rather than quietly measuring things that were never photographed.
export const ROOM: RoomDims = { width: 7, depth: 6, height: 2.7 };

// A ~106° phone ultrawide — the only common lens that frames floor, wall AND
// ceiling from one level shot. The nominal 66° sees walls and nothing else.
export const CAL: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
export const CALS: CalMap = { n: CAL, e: CAL, s: CAL, w: CAL };

export type Truth = {
  name: string;
  /** What a detector would call it. Deliberately shared by the two bedside tables:
   *  that is what makes them a merge hazard rather than a formality. */
  label: string;
  category: Category;
  shape: Shape;
  /** Ground-truth centre, metres, room-centred. */
  x: number;
  z: number;
  /** Ground-truth centre height for a wall piece; ignored for floor and ceiling. */
  y?: number;
  /** Ground-truth size, mm, [W, D, H]. */
  dimMM: [number, number, number];
  /** Every slot this piece is visible in. Two entries means one physical object
   *  photographed twice, which is what the cross-slot merge exists for. */
  slots: CaptureSlot[];
};

export const TRUTH: Truth[] = [
  { name: 'wardrobe', label: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', x: -1.5, z: -2.7, dimMM: [1200, 600, 2000], slots: ['n'] },
  { name: 'nightstand-L', label: 'bedside table', category: 'nightstand', shape: 'nightstand', x: 0.8, z: -2.8, dimMM: [450, 400, 550], slots: ['n'] },
  { name: 'nightstand-R', label: 'bedside table', category: 'nightstand', shape: 'nightstand', x: 1.35, z: -2.8, dimMM: [450, 400, 550], slots: ['n'] },
  { name: 'sofa', label: 'three-seat sofa', category: 'sofa', shape: 'sofa', x: 3.075, z: 0.4, dimMM: [2000, 850, 800], slots: ['e'] },
  { name: 'plant', label: 'potted plant', category: 'plant', shape: 'plant', x: 3.1, z: -2.0, dimMM: [400, 400, 900], slots: ['e'] },
  { name: 'tv', label: '55 inch tv', category: 'tv', shape: 'tv', x: 3.5, z: 1.2, y: 1.2, dimMM: [1200, 80, 700], slots: ['e'] },
  { name: 'painting', label: 'framed print', category: 'painting', shape: 'painting', x: -3.5, z: -0.6, y: 1.5, dimMM: [700, 40, 500], slots: ['w'] },
  { name: 'curtain', label: 'linen curtain', category: 'curtain', shape: 'curtain', x: -1.0, z: 3.0, y: 1.45, dimMM: [1400, 80, 2300], slots: ['s'] },
  { name: 'fan', label: 'ceiling fan', category: 'fan', shape: 'fan', x: 0, z: -2.2, dimMM: [1000, 1000, 200], slots: ['n'] },
  // The cross-slot case: one lamp in the NE quadrant, in both photos.
  { name: 'lamp', label: 'floor lamp', category: 'lamp', shape: 'lamp-floor', x: 2.0, z: -2.2, dimMM: [300, 300, 1700], slots: ['n', 'e'] },
];

/** The box a perfect detector would draw around this piece in this slot's photo.
 *  Which projection is used follows from the piece's own anchor — the same table
 *  `geoRefine` reads to choose the inverse. */
export function boxFor(t: Truth, slot: CaptureSlot, cal: CameraCal): Box {
  const anchor = anchorFor(t.category, t.shape);
  const wM = t.dimMM[0] / 1000;
  const hM = t.dimMM[2] / 1000;
  if (anchor === 'ceiling') return bboxOfCeilingDisc(slot, t.x, t.z, wM, cal, ROOM.height);
  if (anchor === 'floor') return bboxOfFloorObject(slot, t.x, t.z, wM, hM, cal);
  return bboxOfWallPanel(slot, t.x, t.y ?? 1.2, t.z, wM, hM, cal);
}

export type Shot = { truth: Truth; slot: CaptureSlot; det: Detection };

/** `keep` drops a (piece, slot) shot before it reaches the pipeline. Used to
 *  exclude a box that has left the frame: a real detector can only ever hand over
 *  a box it could see, so feeding one is measuring something that was never
 *  photographed — `tests/helpers/project.ts` says so at `inFrame`, and the sweep
 *  was counting them and then running them anyway. */
export function shots(
  boxOf: (t: Truth, slot: CaptureSlot) => Box,
  keep: (t: Truth, slot: CaptureSlot, box: Box) => boolean = () => true,
): Shot[] {
  return TRUTH.flatMap((truth) =>
    truth.slots
      .filter((slot) => keep(truth, slot, boxOf(truth, slot)))
      .map((slot) => ({
      truth,
      slot,
      det: {
        label: truth.label,
        conf: 0.9,
        box: boxOf(truth, slot),
        category: truth.category,
        slot,
        shape: truth.shape,
        // No dimMM and no position, deliberately. That is the on-device detector's
        // output shape, and it means every number this harness reports came from
        // geometry rather than from a hint.
        } as Detection,
      })),
  );
}

export function roomData(records: SavedDetection[]): RoomData {
  return {
    id: 'harness',
    createdAt: 0,
    name: 'Harness room',
    layoutId: 'rect',
    width: ROOM.width,
    depth: ROOM.depth,
    height: ROOM.height,
    detectedObjects: records,
  };
}

/**
 * Match every truth to at most one row, one-to-one, nearest pair first.
 *
 * **`nearest` per truth is not this**, and the difference is material wherever the
 * errors are large: two truths that share a label — the two bedside tables, on
 * purpose — can both pick the same row, and the one that is not really that row
 * reports a spuriously small error. The published off-square position figures were
 * biased optimistic by exactly that, at the angles where the estimates move far
 * enough for the mis-attribution to happen.
 *
 * A helper's documented caveat is scoped to the context it was written in:
 * `nearest`'s own comment says two pieces share a label deliberately, and in
 * `detect-pipeline.test.ts`, where every error is ~0, taking the shortcut is
 * harmless. Reused in a sweep whose whole point is large errors, it changes the
 * answer.
 *
 * Greedy over the globally shortest same-label pair, which is exact for this
 * fixture (ten pieces, at most two sharing a label) and does not need the
 * assignment problem solved properly.
 */
export function assignOneToOne<T extends { label?: string; x: number; z: number }>(
  truths: readonly Truth[],
  pool: readonly T[],
): Array<T | undefined> {
  const out: Array<T | undefined> = truths.map(() => undefined);
  const takenTruth = new Set<number>();
  const takenRow = new Set<number>();
  type Pair = { ti: number; ri: number; d: number };
  const pairs: Pair[] = [];
  truths.forEach((t, ti) =>
    pool.forEach((p, ri) => {
      if (p.label !== undefined && p.label !== t.label) return;
      pairs.push({ ti, ri, d: Math.hypot(p.x - t.x, p.z - t.z) });
    }),
  );
  pairs.sort((a, b) => a.d - b.d);
  for (const { ti, ri } of pairs) {
    if (takenTruth.has(ti) || takenRow.has(ri)) continue;
    takenTruth.add(ti);
    takenRow.add(ri);
    out[ti] = pool[ri];
  }
  return out;
}

/** Nearest same-label candidate to a truth, by XZ. Same-label rather than
 *  same-index because the merge legitimately removes rows, and nearest rather than
 *  first because two pieces share the label 'bedside table' on purpose. */
export function nearest<T extends { label?: string; x: number; z: number }>(t: Truth, pool: T[]): T | undefined {
  const same = pool.filter((p) => p.label === undefined || p.label === t.label);
  if (same.length === 0) return undefined;
  return same.reduce((best, p) =>
    Math.hypot(p.x - t.x, p.z - t.z) < Math.hypot(best.x - t.x, best.z - t.z) ? p : best,
  );
}


// ── Running the whole thing, once per camera ──────────────────────────────────

export type Run = {
  IN: Shot[];
  REFINED: Detection[];
  VERDICTS: ReturnType<typeof judgeLabels>;
  PARTS: ReturnType<typeof buildSceneFromRoom>;
};

/** Boxes → detections → refined, and nothing after it.
 *
 *  For a sweep that only counts ROWS — "did the cross-slot lamp split" — where
 *  `judgeLabels` and `buildSceneFromRoom` are work nothing reads. The split probe
 *  runs up to 81 of them, and a measurement harness slow enough to discourage
 *  sweeping wider is a measurement harness that stops being used. */
export function refinedOnly(
  boxOf: (t: Truth, slot: CaptureSlot) => Box,
  cals: CalMap,
  keep?: (t: Truth, slot: CaptureSlot, box: Box) => boolean,
): Detection[] {
  return refineDetections(
    shots(boxOf, keep).map((s) => s.det),
    cals,
    ROOM,
  );
}

/** Truth table → boxes → detections → refined → verdicts → parts.
 *
 *  `boxOf` is the only seam: hand it `squareOn(CAL)` for the baseline, or a yawed
 *  one to measure what off-square framing costs. `cals` is what the INVERSE is told
 *  about the camera — deliberately separate, because the whole measurement is what
 *  happens when the projector and the placer disagree.
 *
 *  **Neither has a default, and that is the point.** They used to default to
 *  `boxFor` and `CALS`, so `runPipeline(undefined, otherCals)` would project
 *  through one camera and invert through another with no diagnostic — in the very
 *  parameter pair whose separation is documented as deliberate. `boxFor`'s own
 *  `cal = CAL` default was the same hole one level down. A caller names both, and
 *  `squareOn(cal)` is how it says "the square-on projector for this camera" in one
 *  expression. */
export function runPipeline(
  boxOf: (t: Truth, slot: CaptureSlot) => Box,
  cals: CalMap,
  keep?: (t: Truth, slot: CaptureSlot, box: Box) => boolean,
): Run {
  const IN = shots(boxOf, keep);
  const REFINED = refineDetections(
    IN.map((s) => s.det),
    cals,
    ROOM,
  );
  const VERDICTS = judgeLabels(REFINED, cals, ROOM);
  const PARTS = buildSceneFromRoom(
    roomData(REFINED.map((d, i) => toRecord(d, i, false, () => `uid-${i}`))),
  );
  return { IN, REFINED, VERDICTS, PARTS };
}

// ── The off-square projector ──────────────────────────────────────────────────

/** A piece's world corners. `depthM > 0` gives the REAL box — eight corners — which
 *  is the thing `bboxOfFloorObject` cannot express: it offsets along the wall only,
 *  so a 600 mm-deep wardrobe is a flat card and its silhouette inflation is
 *  invisible to the harness. */
function floorCorners(
  slot: CaptureSlot,
  x: number,
  z: number,
  wM: number,
  hM: number,
  depthM: number,
): Array<[number, number, number]> {
  const [ax, az] = ALONG[slot];
  // The view axis, perpendicular to the wall-parallel one in the XZ plane.
  const [nx, nz] = [-az, ax];
  const out: Array<[number, number, number]> = [];
  for (const sw of [-1, 1]) {
    for (const sd of depthM > 0 ? [-1, 1] : [0]) {
      for (const y of [0, hM]) {
        out.push([
          x + ax * sw * (wM / 2) + nx * sd * (depthM / 2),
          y,
          z + az * sw * (wM / 2) + nz * sd * (depthM / 2),
        ]);
      }
    }
  }
  return out;
}

/** A wall piece's world corners, `depthM` deep INWARD from the wall plane — a TV
 *  hangs with its back against the plaster, so the truth point is the mount and the
 *  body projects into the room.
 *
 *  **This took no depth at all, in the very commit whose subject was that the
 *  fixture models furniture as a depthless card.** So `realDepth: true` could not
 *  change a wall piece by construction, and the assertion that wall anchors were
 *  exact to 1e-9 was a tautology — published in `Design.md` and in that commit's
 *  own body as "the other half of the diagnosis". The lesson is the one the commit
 *  was about: a fixture that cannot express the defect proves nothing, and writing
 *  the fix for one anchor does not confer immunity while writing the next.
 *
 *  The inward normal is `[-az, ax]`, the same one `floorCorners` uses — for slot n,
 *  `ALONG` is +X and the wall is at −Z, so the room is at +Z. */
function wallCorners(
  slot: CaptureSlot,
  x: number,
  y: number,
  z: number,
  wM: number,
  hM: number,
  depthM: number,
): Array<[number, number, number]> {
  const [ax, az] = ALONG[slot];
  const [nx, nz] = [-az, ax];
  const out: Array<[number, number, number]> = [];
  for (const sw of [-1, 1]) {
    for (const sd of depthM > 0 ? [0, 1] : [0]) {
      for (const dy of [-hM / 2, hM / 2]) {
        out.push([
          x + ax * sw * (wM / 2) + nx * sd * depthM,
          y + dy,
          z + az * sw * (wM / 2) + nz * sd * depthM,
        ]);
      }
    }
  }
  return out;
}

export type YawOptions = {
  /** Camera yaw in radians, positive turning the lens toward its own right. */
  yawRad: number;
  /** Model floor pieces as real boxes rather than depthless cards. */
  realDepth?: boolean;
};

/**
 * `boxFor`, but with the camera turned off-square and optionally with the floor
 * pieces given their real depth.
 *
 * All three anchors yaw. Ceiling discs used to fall through to the square-on
 * helper, on the stated grounds that a ceiling fan is "the one anchor a yaw about
 * the vertical leaves alone in the axis that matters" — which is the opposite of
 * true: `placeCeilingObject` reads the box's horizontal centre through `tanX` and
 * refuses a decode whose distance exceeds the wall's, so yaw moves the fan
 * laterally and can make it vanish. Exempting it hid the largest single error in
 * the sweep. `bboxOfCeilingDisc` takes the yaw itself now, rotating its 720 rim
 * samples, so the circle's tangent silhouette is still exact.
 *
 * At `yawRad: 0` with `realDepth` off this must agree with `boxFor` exactly —
 * asserted in `tests/off-square-cost.test.ts`, which is what validates this builder
 * against the proven one rather than trusting that they were written to match.
 */
export function boxForYawed(t: Truth, slot: CaptureSlot, cal: CameraCal, opts: YawOptions): Box {
  const anchor = anchorFor(t.category, t.shape);
  const wM = t.dimMM[0] / 1000;
  const dM = t.dimMM[1] / 1000;
  const hM = t.dimMM[2] / 1000;
  if (anchor === 'ceiling') {
    return bboxOfCeilingDisc(slot, t.x, t.z, wM, cal, ROOM.height, opts.yawRad);
  }

  const corners =
    anchor === 'floor'
      ? floorCorners(slot, t.x, t.z, wM, hM, opts.realDepth ? dM : 0)
      : wallCorners(slot, t.x, t.y ?? 1.2, t.z, wM, hM, opts.realDepth ? dM : 0);

  // Turn the camera by rotating the world. NOT negated — see `yawedPoint`, where
  // the direction is worked out, and the hand-derived assertion in
  // `tests/off-square-cost.test.ts`, which caught it being negated here.
  return extent(corners.map((p) => project(slot, ...yawedPoint(p, opts.yawRad), cal)));
}

/** The square-on, depthless projector — `boxFor` with an explicit camera. Named so a
 *  caller reads which of the two it is asking for, and the reason `boxFor` needs no
 *  default: this is what `runPipeline`'s baseline callers pass. It was exported and
 *  called by nobody for one commit, which is rule 1's shape — plumbing with no
 *  feature — and the fix was to use it rather than to delete it, because the thing
 *  it replaces is a defaultable seam. */
export const squareOn = (cal: CameraCal) => (t: Truth, slot: CaptureSlot) => boxFor(t, slot, cal);

/** The off-square projector, as the callback `runPipeline` takes. */
export const offSquare =
  (cal: CameraCal, opts: YawOptions) => (t: Truth, slot: CaptureSlot) =>
    boxForYawed(t, slot, cal, opts);
