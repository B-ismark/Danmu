// What a scan like the one that came back "mostly too small" gets wrong, and why.
//
// The report: four landscape photos of a small bedroom, taken from the middle of it,
// uploaded rather than shot in the app (so no tilt, no height and no lens came with
// them), and the room-size step skipped. Looking at those photos, three things stand
// out and none of them is in `tests/detect-pipeline.test.ts`'s known room:
//
//   · the phone is tilted UP in every one — 8° to 20°, the ceiling taking a third of
//     the frame — where that harness is level and the earlier sweep only ever tilted
//     DOWN;
//   · pieces are routinely CUT by the frame edge: a wardrobe running off the left, a
//     fridge and a bed running off the bottom, a rack off the right. A detector can
//     only draw what it can see, so those boxes stop at the edge;
//   · the room is the skip's 6 × 4 × 2.8 m, not the real one.
//
// This builds that scan — a 5.0 × 4.6 × 2.6 m room, a 94° lens held 1.3 m up — and
// runs it through the real pipeline twice over: once as the app would read it
// today, and then with the true value of one assumption at a time put back. The
// table it prints is the point. It says which assumption the error comes from, so
// the fix goes to the biggest one rather than the most obvious one.
//
// **The fixture is shaped like the photos, not copied from them.** The positions are
// read off by eye, and the tilt, lens, height and room size cannot be read off at all
// — which is the problem being measured. What it has to get right is the kind of
// input: tilted up, cut at the edges, one wall per photo, the floor line out of shot
// in three photos of four. It is a picture of the right composition, which is what
// `tests/vanishing-point.test.ts` found a fixture has to be.
//
// Each piece is seen in exactly one photo, on purpose. The same desk from two walls is
// a real case and a different question — which sighting to keep — and it has its own
// suite (`tests/repeat-sightings.test.ts`). Here it would only blur which assumption
// an error came from.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { refineDetections, type CalMap, type RoomDims } from '@/lib/detect-refine';
import { toRecord } from '@/lib/detection-record';
import { buildSceneFromRoom, defaultDepthFor, type Category, type Shape } from '@/lib/scene-spec';
import { anchorFor, CURTAIN_STANDOFF } from '@/lib/physics';
import { calForPhoto, calFromHfov, wallFrame, wallRowAtHeight, type CameraCal } from '@/lib/photo-geometry';
import { footprintForLayout } from '@/lib/footprint';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot, RoomData } from '@/lib/storage';
import { ALONG, bboxOfWallSolid, extent, floorBoxCorners, project, type Box } from './helpers/project';

// ── The real room and the real camera ───────────────────────────────────────

const TRUE_ROOM: RoomDims = { width: 5.0, depth: 4.6, height: 2.6, footprint: footprintForLayout('rect', 5.0, 4.6) };
const ASPECT = 4 / 3;
const TRUE_HFOV = 94;
const TRUE_HEIGHT = 1.3;
/** Degrees the lens points UP, per photo. `CameraCal.tiltRad` is positive DOWN. */
const TILT_UP_DEG: Record<CaptureSlot, number> = { n: 8, e: 20, s: 10, w: 8 };
const SLOTS: CaptureSlot[] = ['n', 'e', 's', 'w'];

const trueCal = (slot: CaptureSlot): CameraCal =>
  calFromHfov(TRUE_HFOV, ASPECT, { height: TRUE_HEIGHT, tiltRad: (-TILT_UP_DEG[slot] * Math.PI) / 180 });

// ── The room the app assumes when the size step is skipped ──────────────────
//
// Read out of the page rather than typed again here, so a change to what the skip
// assumes moves this measurement with it.
const layoutPick = readFileSync('app/onboarding/layout-pick/page.tsx', 'utf8');
const rectPreset = layoutPick.match(/id: 'rect' as const,[^}]*width: ([\d.]+), depth: ([\d.]+)/);
const presetHeight = layoutPick.match(/const HEIGHT = ([\d.]+);/);
if (!rectPreset || !presetHeight) throw new Error('layout-pick no longer declares the rect preset this reads');
const SKIPPED_ROOM: RoomDims = {
  width: Number(rectPreset[1]),
  depth: Number(rectPreset[2]),
  height: Number(presetHeight[1]),
  footprint: footprintForLayout('rect', Number(rectPreset[1]), Number(rectPreset[2])),
};

// ── The pieces ──────────────────────────────────────────────────────────────

type Piece = {
  label: string;
  category: Category;
  shape: Shape;
  /** The one photo it is in, which is also the wall it stands against or hangs on. */
  slot: CaptureSlot;
  /** Along the wall, metres, positive to the photo's right. */
  lateral: number;
  /** Floor piece: gap between its back and the wall. Wall piece: ignored. */
  gap?: number;
  /** Wall piece: centre height, metres. */
  y?: number;
  /** Width and height, mm. Depth is the catalogue's own, so the only thing a
   *  perfect run has to recover is what the photograph actually shows. */
  w: number;
  h: number;
};

const PIECES: Piece[] = [
  // Photo 1: the shoe-rack wall.
  { label: 'shoe rack', category: 'shelf', shape: 'shoe-rack', slot: 'n', lateral: -0.55, gap: 0.02, w: 700, h: 1100 },
  { label: 'mini fridge', category: 'fridge', shape: 'fridge', slot: 'n', lateral: 0.35, gap: 0.05, w: 500, h: 850 },
  { label: 'cube wardrobe', category: 'wardrobe', shape: 'wardrobe', slot: 'n', lateral: -2.0, gap: 0, w: 1000, h: 1800 },
  { label: 'palm print', category: 'painting', shape: 'painting', slot: 'n', lateral: -0.05, y: 1.55, w: 500, h: 400 },
  { label: 'garment rack', category: 'wardrobe', shape: 'wardrobe', slot: 'n', lateral: 1.55, gap: 0, w: 900, h: 1600 },
  // Photo 2: the window wall, mostly ceiling, no floor in shot.
  { label: 'curtain', category: 'curtain', shape: 'curtain', slot: 'e', lateral: -0.4, y: 1.25, w: 1400, h: 2300 },
  { label: 'clothes rack', category: 'shelf', shape: 'bookshelf', slot: 'e', lateral: -1.6, gap: 0.02, w: 800, h: 1500 },
  // Photo 3: the bed wall.
  { label: 'bed', category: 'bed', shape: 'bed-double', slot: 's', lateral: -0.4, gap: 0, w: 1500, h: 1000 },
  { label: 'barred window', category: 'other', shape: 'window', slot: 's', lateral: 0.1, y: 1.55, w: 1000, h: 1000 },
  { label: 'desk', category: 'desk', shape: 'desk-standard', slot: 's', lateral: 1.0, gap: 0, w: 1200, h: 750 },
  // Photo 4: the door wall.
  { label: 'tall wardrobe', category: 'wardrobe', shape: 'wardrobe', slot: 'w', lateral: -0.2, gap: 0, w: 1000, h: 1700 },
  { label: 'door', category: 'door', shape: 'door', slot: 'w', lateral: 0.9, y: 1.0, w: 800, h: 2000 },
  { label: 'office chair', category: 'chair', shape: 'chair-office', slot: 'w', lateral: -0.9, gap: 1.0, w: 600, h: 1000 },
  { label: 'computer desk', category: 'desk', shape: 'desk-standard', slot: 'w', lateral: -1.65, gap: 0, w: 1200, h: 750 },
];

const isFloor = (p: Piece) => anchorFor(p.category, p.shape) === 'floor';
const depthM = (p: Piece) => defaultDepthFor(p.category, p.shape) / 1000;
const wallD = (slot: CaptureSlot) => wallFrame(slot, TRUE_ROOM.footprint)!.distance;

/** The piece's true centre in plan: in front of its wall by the gap and half its
 *  depth for a floor piece; half its depth off the plaster for a wall piece, which
 *  is where a placer puts a body whose back is on the wall. A curtain hangs a rod's
 *  width further out, which is where the room hangs it too (`CURTAIN_STANDOFF`). */
function truthCentre(p: Piece): { x: number; z: number } {
  const [ax, az] = ALONG[p.slot];
  const [fx, fz] = [az, -ax]; // the way the photo looks
  const off = isFloor(p) ? (p.gap ?? 0) : p.shape === 'curtain' ? CURTAIN_STANDOFF : 0;
  const fwd = wallD(p.slot) - off - depthM(p) / 2;
  return { x: fx * fwd + ax * p.lateral, z: fz * fwd + az * p.lateral };
}

/** The box a perfect detector draws: every corner of the solid, projected through
 *  the true camera, and — unless `uncut` — clipped to the frame, because nothing
 *  outside the picture can be drawn round. */
function boxOf(p: Piece, uncut: boolean): Box | null {
  const cal = trueCal(p.slot);
  let raw: Box;
  if (isFloor(p)) {
    const c = truthCentre(p);
    const corners = floorBoxCorners(p.slot, c.x, c.z, p.w / 1000, p.h / 1000, depthM(p));
    raw = extent(corners.map((q) => project(p.slot, ...q, cal)));
  } else {
    raw = bboxOfWallSolid(p.slot, p.slot, p.lateral, p.y ?? 1.2, wallD(p.slot), p.w / 1000, p.h / 1000, depthM(p), cal);
  }
  if (uncut) return raw;
  const u0 = Math.max(0, raw[0]);
  const v0 = Math.max(0, raw[1]);
  const u1 = Math.min(1, raw[0] + raw[2]);
  const v1 = Math.min(1, raw[1] + raw[3]);
  // A sliver at the edge is not something a detector finds.
  if (u1 - u0 < 0.03 || v1 - v0 < 0.03) return null;
  return [u0, v0, u1 - u0, v1 - v0];
}

const EDGE = 1e-9;
/** Which edges of the frame cut this piece's box. */
function cutEdges(p: Piece): string {
  const raw = boxOf(p, true)!;
  const out: string[] = [];
  if (raw[0] < -EDGE) out.push('left');
  if (raw[0] + raw[2] > 1 + EDGE) out.push('right');
  if (raw[1] < -EDGE) out.push('top');
  if (raw[1] + raw[3] > 1 + EDGE) out.push('bottom');
  return out.join('+') || '—';
}

/** Where the wall's foot lands in the photo, if the floor-line finder could see it.
 *  `findFloorLine` searches rows 55–97% of the height, so a line below that is a line
 *  it cannot find, and this reports it as the finder would: not at all. It is
 *  generous in the other direction — it assumes the finder picks the real line and not
 *  the top of a rug — which is the favourable reading of the app, on purpose. */
function visibleFloorLine(slot: CaptureSlot): number | null {
  const v = wallRowAtHeight(0, wallD(slot), trueCal(slot));
  return v !== null && v >= 0.55 && v < 0.97 ? v : null;
}

// ── One run ─────────────────────────────────────────────────────────────────

/** Which of the unknowns the app is handed the truth for. */
type Known = { room?: boolean; tilt?: boolean; height?: boolean; lens?: boolean; uncut?: boolean };

type Row = { piece: Piece; cut: string; widthErr: number; heightErr: number; posErrM: number } | { piece: Piece; missing: true };

function run(known: Known): Row[] {
  const room = known.room ? TRUE_ROOM : SKIPPED_ROOM;
  const cals: CalMap = {};
  for (const slot of SLOTS) {
    const truth = trueCal(slot);
    cals[slot] = calForPhoto(
      {
        aspect: ASPECT,
        view: {
          ...(known.tilt ? { tiltRad: truth.tiltRad } : {}),
          ...(known.height ? { height: TRUE_HEIGHT } : {}),
        },
        exifHfov: known.lens ? TRUE_HFOV : null,
        vanishing: null,
        floorLine: visibleFloorLine(slot),
      },
      slot,
      room.footprint,
    );
  }
  const seen = PIECES.map((piece) => ({ piece, box: boxOf(piece, !!known.uncut) }));
  const dets: Detection[] = seen
    .filter((s): s is { piece: Piece; box: Box } => s.box !== null)
    .map(({ piece, box }) => ({
      label: piece.label,
      conf: 0.9,
      box,
      category: piece.category,
      shape: piece.shape,
      slot: piece.slot,
    }) as Detection);
  const refined = refineDetections(dets, cals, room);
  const data: RoomData = {
    id: 'tilted',
    createdAt: 0,
    name: 'Tilted scan',
    layoutId: 'rect',
    width: room.width,
    depth: room.depth,
    height: room.height,
    detectedObjects: refined.map((d, i) => toRecord(d, i, true, () => `uid-${i}`)),
  };
  const parts = buildSceneFromRoom(data);
  return PIECES.map((piece) => {
    const i = refined.findIndex((d) => d.label === piece.label);
    const part = i < 0 ? undefined : parts.find((p) => p.id === `uid-${i}`);
    if (!part) return { piece, missing: true as const };
    const c = truthCentre(piece);
    return {
      piece,
      cut: cutEdges(piece),
      widthErr: part.dimMM[0] / piece.w - 1,
      heightErr: part.dimMM[2] / piece.h - 1,
      posErrM: Math.hypot(part.pos[0] - c.x, part.pos[2] - c.z),
    };
  });
}

type Measured = Extract<Row, { widthErr: number }>;
const measured = (rows: Row[]) => rows.filter((r): r is Measured => !('missing' in r));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;

type Summary = { medWidth: number; medHeight: number; medPos: number; tooSmall: number; n: number };
function summarise(rows: Row[], which: (r: Measured) => boolean = () => true): Summary {
  const m = measured(rows).filter(which);
  return {
    medWidth: median(m.map((r) => r.widthErr)),
    medHeight: median(m.map((r) => r.heightErr)),
    medPos: median(m.map((r) => r.posErrM)),
    tooSmall: m.filter((r) => r.widthErr < -0.1 || r.heightErr < -0.1).length,
    n: m.length,
  };
}

// ── The runs ────────────────────────────────────────────────────────────────

const TODAY = run({});
const ORACLE = run({ room: true, tilt: true, height: true, lens: true, uncut: true });
const ALL_BUT_CUTS = run({ room: true, tilt: true, height: true, lens: true });

/** Each unknown put right on its own, everything else as the app reads it today. */
const ALONE: Array<[string, Known]> = [
  ['true room size', { room: true }],
  ['true tilt', { tilt: true }],
  ['true camera height', { height: true }],
  ['true lens', { lens: true }],
  ['uncut boxes', { uncut: true }],
];
/** …and put right one after another, in the order the fixes would land. */
const CUMULATIVE: Array<[string, Known]> = [
  ['+ uncut boxes', { uncut: true }],
  ['+ true room size', { uncut: true, room: true }],
  ['+ true lens', { uncut: true, room: true, lens: true }],
  ['+ true tilt', { uncut: true, room: true, lens: true, tilt: true }],
  ['+ true height (= oracle)', { uncut: true, room: true, lens: true, tilt: true, height: true }],
];

const cutRows = (r: Measured) => r.cut !== '—';
const wholeRows = (r: Measured) => r.cut === '—';

function line(name: string, rows: Row[]): string {
  const all = summarise(rows);
  const cut = summarise(rows, cutRows);
  const whole = summarise(rows, wholeRows);
  return [
    name.padEnd(26),
    pct(all.medWidth).padStart(6),
    pct(all.medHeight).padStart(6),
    `${all.medPos.toFixed(2)} m`.padStart(7),
    `${all.tooSmall}/${all.n}`.padStart(6),
    pct(whole.medWidth).padStart(8),
    pct(cut.medWidth).padStart(7),
  ].join('  ');
}

console.log(
  [
    '',
    'Tilted-up scan, 14 pieces, 4 photos (tests/scan-tilted-room.test.ts)',
    '',
    `${'piece'.padEnd(14)} ${'photo'.padEnd(5)} ${'cut by'.padEnd(12)} ${'width'.padStart(6)} ${'height'.padStart(7)} ${'off by'.padStart(7)}`,
    ...TODAY.map((r) =>
      'missing' in r
        ? `${r.piece.label.padEnd(14)} ${r.piece.slot.padEnd(5)} (not in the room)`
        : `${r.piece.label.padEnd(14)} ${r.piece.slot.padEnd(5)} ${r.cut.padEnd(12)} ${pct(r.widthErr).padStart(6)} ${pct(r.heightErr).padStart(7)} ${`${r.posErrM.toFixed(2)} m`.padStart(7)}`,
    ),
    '',
    `${'medians'.padEnd(26)}  ${'width'.padStart(6)}  ${'height'.padStart(6)}  ${'off by'.padStart(7)}  ${'small'.padStart(6)}  ${'uncut w'.padStart(8)}  ${'cut w'.padStart(7)}`,
    line('today', TODAY),
    '— one unknown put right —',
    ...ALONE.map(([name, k]) => line(name, run(k))),
    '— put right in turn —',
    ...CUMULATIVE.map(([name, k]) => line(name, run(k))),
    line('everything but the cuts', ALL_BUT_CUTS),
    '',
    '"small" counts pieces more than 10% too narrow or too short; "cut w" is the',
    'width error of the pieces a frame edge cut, "uncut w" of the rest.',
    '',
  ].join('\n'),
);

describe('a scan tilted up, cut at the edges, with the size skipped', () => {
  it('is a fixture the pipeline can read exactly when it is told everything', () => {
    // Without this the table measures the fixture. Every piece is found, and with
    // the true room, camera and uncut boxes each comes back at its own size and
    // where it stands.
    const rows = measured(ORACLE);
    expect(rows).toHaveLength(PIECES.length);
    for (const r of rows) {
      expect(Math.abs(r.widthErr), r.piece.label).toBeLessThan(0.01);
      expect(Math.abs(r.heightErr), r.piece.label).toBeLessThan(0.01);
      expect(r.posErrM, r.piece.label).toBeLessThan(0.05);
    }
  });

  it('cuts the pieces the photos cut, and leaves the floor line out of three photos of four', () => {
    // The two properties the scan had that the known room does not. If a fixture
    // edit loses either, the table stops describing that scan.
    // Cut, not cropped out: a detector still finds every one of them.
    for (const p of PIECES) expect(boxOf(p, false), p.label).not.toBeNull();
    const cut = PIECES.filter((p) => cutEdges(p) !== '—').map((p) => p.label);
    expect(cut.length).toBeGreaterThanOrEqual(5);
    expect(SLOTS.filter((s) => visibleFloorLine(s) === null)).toHaveLength(3);
    for (const slot of SLOTS) expect(trueCal(slot).tiltRad!).toBeLessThan(0);
  });
});
