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

import { describe, expect, it } from 'vitest';
import { refineDetections, type CalMap, type RoomDims } from '@/lib/detect-refine';
import { toRecord } from '@/lib/detection-record';
import { clampDims } from '@/lib/dimension-ranges';
import { buildSceneFromRoom, defaultDepthFor, type Category, type Shape } from '@/lib/scene-spec';
import { anchorFor, CURTAIN_STANDOFF } from '@/lib/physics';
import { calForPhoto, calFromHfov, wallFrame, wallRowAtHeight, type CameraCal } from '@/lib/photo-geometry';
import { footprintForLayout } from '@/lib/footprint';
import { PRESET_HEIGHT, presetById } from '@/lib/room-presets';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot, RoomData } from '@/lib/storage';
import { ALONG, bboxOfWallSolid, extent, floorBoxCorners, framedExtent, project, type Box } from './helpers/project';

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
// Read from the presets module rather than typed again here, so a change to what
// the skip assumes moves this measurement with it.
const rectPreset = presetById('rect');
const SKIPPED_ROOM: RoomDims = {
  width: rectPreset.width,
  depth: rectPreset.depth,
  height: PRESET_HEIGHT,
  footprint: footprintForLayout('rect', rectPreset.width, rectPreset.depth),
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
  { label: 'garment rack', category: 'wardrobe', shape: 'clothes-rack', slot: 'n', lateral: 1.55, gap: 0, w: 900, h: 1600 },
  // Photo 2: the window wall, mostly ceiling, no floor in shot.
  { label: 'curtain', category: 'curtain', shape: 'curtain', slot: 'e', lateral: -0.4, y: 1.25, w: 1400, h: 2300 },
  { label: 'clothes rack', category: 'shelf', shape: 'clothes-rack', slot: 'e', lateral: -1.6, gap: 0.02, w: 800, h: 1500 },
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
 *  the true camera — before the frame has any say. */
function rawBoxOf(p: Piece): Box {
  if (isFloor(p)) return extent(floorOutline(p));
  return bboxOfWallSolid(p.slot, p.slot, p.lateral, p.y ?? 1.2, wallD(p.slot), p.w / 1000, p.h / 1000, depthM(p), trueCal(p.slot));
}
function floorOutline(p: Piece): Array<[number, number]> {
  const c = truthCentre(p);
  const corners = floorBoxCorners(p.slot, c.x, c.z, p.w / 1000, p.h / 1000, depthM(p));
  return corners.map((q) => project(p.slot, ...q, trueCal(p.slot)));
}

/** …and the box it can actually draw, because nothing outside the picture can be drawn
 *  round. A floor piece's is its outline inside the frame (`framedExtent`): clipping the
 *  whole box keeps the column of a foot the frame hid, a side further out than any the
 *  photo shows (§ 49.20). A wall piece's is still its box clipped, which is what the wall
 *  placer reads its side face as (§ 49.22). */
function boxOf(p: Piece): Box | null {
  const box = isFloor(p) ? framedExtent(floorOutline(p)) : clipped(rawBoxOf(p));
  // A sliver at the edge is not something a detector finds.
  if (!box || box[2] < 0.03 || box[3] < 0.03) return null;
  return box;
}
function clipped([u, v, w, h]: Box): Box {
  const [u0, v0] = [Math.max(0, u), Math.max(0, v)];
  return [u0, v0, Math.min(1, u + w) - u0, Math.min(1, v + h) - v0];
}

/** How much wider a frame this photo would have needed for nothing in it to be cut.
 *
 *  The oracle cannot simply hand the pipeline the raw boxes: they run outside 0–1,
 *  and a box that reaches the edge of the picture is exactly what the placers now
 *  read as CUT and grow to a typical size. So it is handed the photo the same camera
 *  would have taken with a wider lens from the same spot — every coordinate pulled
 *  in about the centre by `s`, and `k` pushed out by the same `s`. The two cancel in
 *  `ray()` (tanX = (u − ½)·k), so every box describes the same lines of sight it did,
 *  and none of them touches an edge. It is the same picture with more margin, which
 *  is the one thing a perfect detector on a real photo cannot have. */
const MARGIN = 0.02;
function wholeScale(slot: CaptureSlot): number {
  let dev = 0;
  for (const p of PIECES) {
    if (p.slot !== slot) continue;
    const [u, v, w, h] = rawBoxOf(p);
    dev = Math.max(dev, Math.abs(u - 0.5), Math.abs(u + w - 0.5), Math.abs(v - 0.5), Math.abs(v + h - 0.5));
  }
  return Math.max(1, dev / (0.5 - MARGIN));
}
const inWiderFrame = ([u, v, w, h]: Box, s: number): Box => [0.5 + (u - 0.5) / s, 0.5 + (v - 0.5) / s, w / s, h / s];
const hfovOf = (k: number) => ((2 * Math.atan(k / 2)) * 180) / Math.PI;

const EDGE = 1e-9;
/** Which edges of the frame cut this piece's box. */
function cutEdges(p: Piece): string {
  const raw = rawBoxOf(p);
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

/** Which of the unknowns the app is handed the truth for. `whole` is the wider
 *  frame above, and it needs the lens: a frame `s` times wider IS a different lens,
 *  so handing the pipeline whole boxes and letting it assume one would be measuring
 *  a camera nobody held. */
type Known = { room?: boolean; tilt?: boolean; height?: boolean; lens?: boolean; whole?: boolean };

type Row = { piece: Piece; cut: string; widthErr: number; heightErr: number; posErrM: number } | { piece: Piece; missing: true };

function run(known: Known): Row[] {
  if (known.whole && !known.lens) throw new Error('whole boxes are a wider lens, so they need the lens');
  const room = known.room ? TRUE_ROOM : SKIPPED_ROOM;
  const scale = (slot: CaptureSlot) => (known.whole ? wholeScale(slot) : 1);
  const cals: CalMap = {};
  for (const slot of SLOTS) {
    const truth = trueCal(slot);
    const line = visibleFloorLine(slot);
    cals[slot] = calForPhoto(
      {
        aspect: ASPECT,
        view: {
          ...(known.tilt ? { tiltRad: truth.tiltRad } : {}),
          ...(known.height ? { height: TRUE_HEIGHT } : {}),
        },
        exifHfov: known.lens ? hfovOf(truth.k * scale(slot)) : null,
        vanishing: null,
        floorLine: line === null ? null : 0.5 + (line - 0.5) / scale(slot),
      },
      slot,
      room.footprint,
    );
  }
  const seen = PIECES.map((piece) => ({
    piece,
    box: known.whole ? inWiderFrame(rawBoxOf(piece), scale(piece.slot)) : boxOf(piece),
  }));
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
    // The size the GEOMETRY read, not the size the room is built at: a scanned piece is
    // built at an approximate catalogue size now (`approximateDims`), so this harness
    // reads the refined detection (size clamped as the build used to clamp it, and the
    // position the camera gave, before the build snaps it by the catalogue's depth).
    const at = refined[i].position ?? { x: part.pos[0], z: part.pos[2] };
    const read = clampDims(piece.category, piece.shape, refined[i].dimMM ?? [piece.w, 1, piece.h]);
    return {
      piece,
      cut: cutEdges(piece),
      widthErr: read[0] / piece.w - 1,
      heightErr: read[2] / piece.h - 1,
      posErrM: Math.hypot(at.x - c.x, at.z - c.z),
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

type Summary = { medWidth: number; medHeight: number; medPos: number; tooSmall: number; tooBig: number; meanAbsWidth: number; n: number };
function summarise(rows: Row[], which: (r: Measured) => boolean = () => true): Summary {
  const m = measured(rows).filter(which);
  return {
    medWidth: median(m.map((r) => r.widthErr)),
    medHeight: median(m.map((r) => r.heightErr)),
    medPos: median(m.map((r) => r.posErrM)),
    tooSmall: m.filter((r) => r.widthErr < -0.1 || r.heightErr < -0.1).length,
    tooBig: m.filter((r) => r.widthErr > 0.1 || r.heightErr > 0.1).length,
    meanAbsWidth: m.reduce((a, r) => a + Math.abs(r.widthErr), 0) / m.length,
    n: m.length,
  };
}

// ── The runs ────────────────────────────────────────────────────────────────

const TODAY = run({});
const ALL_BUT_CUTS = run({ room: true, tilt: true, height: true, lens: true });
const ORACLE = run({ room: true, tilt: true, height: true, lens: true, whole: true });

/** Each unknown put right on its own, everything else as the app reads it today.
 *  Whole boxes are not among them: they are a wider lens (see `Known`). */
const ALONE: Array<[string, Known]> = [
  ['true room size', { room: true }],
  ['true tilt', { tilt: true }],
  ['true camera height', { height: true }],
  ['true lens', { lens: true }],
];
/** …and put right one after another, the frame edge last because it is the one
 *  thing no photograph can give back. */
const CUMULATIVE: Array<[string, Known]> = [
  ['+ true room size', { room: true }],
  ['+ true lens', { room: true, lens: true }],
  ['+ true tilt', { room: true, lens: true, tilt: true }],
  ['+ true height', { room: true, lens: true, tilt: true, height: true }],
  ['+ whole boxes (= oracle)', { room: true, lens: true, tilt: true, height: true, whole: true }],
];

const cutRows = (r: Measured) => r.cut !== '—';
const wholeRows = (r: Measured) => r.cut === '—';
const tooSmall = (rows: Row[]) => summarise(rows).tooSmall;
const row = (rows: Row[], label: string) => measured(rows).find((r) => r.piece.label === label);

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
    `${all.tooBig}/${all.n}`.padStart(6),
    pct(all.meanAbsWidth).padStart(6),
    pct(whole.medWidth).padStart(8),
    pct(cut.medWidth).padStart(7),
  ].join('  ');
}

console.log(
  [
    '',
    'Tilted-up scan, 14 pieces, 4 photos (tests/scan-tilted-room.test.ts)',
    '',
    `${''.padEnd(39)}${'as read today'.padEnd(24)}camera + room known`,
    `${'piece'.padEnd(14)} ${'photo'.padEnd(5)} ${'cut by'.padEnd(17)} ${'width'.padStart(6)} ${'height'.padStart(7)} ${'off by'.padStart(7)}   ${'width'.padStart(6)} ${'height'.padStart(7)}`,
    ...TODAY.map((r, i) => {
      const known = ALL_BUT_CUTS[i];
      const head = `${r.piece.label.padEnd(14)} ${r.piece.slot.padEnd(5)} ${cutEdges(r.piece).padEnd(17)}`;
      const today = 'missing' in r ? '(not in the room)'.padEnd(22) : `${pct(r.widthErr).padStart(6)} ${pct(r.heightErr).padStart(7)} ${`${r.posErrM.toFixed(2)} m`.padStart(7)}`;
      const k = 'missing' in known ? '(not in the room)' : `${pct(known.widthErr).padStart(6)} ${pct(known.heightErr).padStart(7)}`;
      return `${head} ${today}   ${k}`;
    }),
    '',
    `${'medians'.padEnd(26)}  ${'width'.padStart(6)}  ${'height'.padStart(6)}  ${'off by'.padStart(7)}  ${'small'.padStart(6)}  ${'big'.padStart(6)}  ${'|w|'.padStart(6)}  ${'uncut w'.padStart(8)}  ${'cut w'.padStart(7)}`,
    line('today', TODAY),
    '— one unknown put right —',
    ...ALONE.map(([name, k]) => line(name, run(k))),
    '— put right in turn —',
    ...CUMULATIVE.map(([name, k]) => line(name, run(k))),
    '',
    '"small" and "big" count pieces more than 10% off in width or height; "|w|" is',
    'the mean width error either way; "cut w" is the width error of the pieces a',
    'frame edge cut, "uncut w" of the rest.',
    '',
  ].join('\n'),
);

describe('a scan tilted up, cut at the edges, with the size skipped', () => {
  it('is a fixture the pipeline can read exactly when it is told everything', () => {
    // Without this the table measures the fixture. Every piece is found, and with
    // the true room, camera and a frame wide enough to cut nothing, each comes back
    // at its own size and where it stands.
    const rows = measured(ORACLE);
    expect(rows).toHaveLength(PIECES.length);
    for (const r of rows) {
      expect(Math.abs(r.widthErr), r.piece.label).toBeLessThan(0.01);
      expect(Math.abs(r.heightErr), r.piece.label).toBeLessThan(0.01);
      expect(r.posErrM, r.piece.label).toBeLessThan(0.12); // wall pieces differ by half the truth's depth less the catalogue's
    }
  });

  it('cuts the pieces the photos cut, and leaves the floor line out of three photos of four', () => {
    // The two properties the scan had that the known room does not. If a fixture
    // edit loses either, the table stops describing that scan.
    // Cut, not cropped out: a detector still finds every one of them.
    for (const p of PIECES) expect(boxOf(p), p.label).not.toBeNull();
    const cut = PIECES.filter((p) => cutEdges(p) !== '—').map((p) => p.label);
    expect(cut.length).toBeGreaterThanOrEqual(5);
    expect(SLOTS.filter((s) => visibleFloorLine(s) === null)).toHaveLength(3);
    for (const slot of SLOTS) expect(trueCal(slot).tiltRad!).toBeLessThan(0);
    // The wider frame really is uncut, or the oracle is measuring the growth.
    for (const p of PIECES) {
      const [u, v, w, h] = inWiderFrame(rawBoxOf(p), wholeScale(p.slot));
      expect(Math.min(u, v, 1 - u - w, 1 - v - h), p.label).toBeGreaterThanOrEqual(MARGIN - 1e-9);
    }
  });

  it('reads a cut-off piece at a typical size rather than the part in the photo', () => {
    // With everything a photo cannot tell us put right, what is left is the frame
    // edge — and a piece the edge cut is grown to its catalogue size from the edge it
    // was seen to end at, rather than read at the sliver that is in the picture.
    // Before that, 7 of these 14 came back more than 10% short on this run alone.
    expect(tooSmall(ALL_BUT_CUTS)).toBe(0);
    // The price is the catalogue's idea of typical, and it is paid by the pieces that
    // are not: an 800 or 900 mm clothes rail grows toward the Library's 1200 mm one.
    // (Before the rail was a shape it was read as a wardrobe, and grew toward a 2 m one
    // until the end of the wall stopped it — 56% over where it is 33% now; the two
    // rails are `clothes-rack` in the fixture because that is what is in the photo.) Four of fourteen are more than 10% over, which is
    // why the scan screen says so on every row it grew.
    expect(summarise(ALL_BUT_CUTS).tooBig).toBe(4);
    // The wall's end is what makes the corner piece exact. The cube wardrobe runs off
    // the left of the shoe-rack photo and stands against the side wall, so the room
    // bounds a growth the catalogue alone would take to 2000 mm.
    const wardrobe = row(ALL_BUT_CUTS, 'cube wardrobe')!;
    expect(cutEdges(wardrobe.piece)).toContain('left');
    expect(Math.abs(wardrobe.widthErr)).toBeLessThan(0.01);
    // As the app reads it today, room skipped and camera guessed: fewer short and
    // more over — 10 short and 4 over before the growth, 6 and 7 after — because the
    // skipped room's walls end half a metre past the real ones. That is the room-size
    // question, not the frame's, and these two numbers are what the next fix moves.
    expect(tooSmall(TODAY)).toBe(6);
    expect(summarise(TODAY).tooBig).toBe(7);
  });
});
