// Pipeline regression harness: calibration → geoRefine → label repair → dedupe →
// clamp → snap → settle, over one synthetic room whose real contents are known.
//
// **This is not a detector score.** It says nothing about whether Gemini or the
// on-device model finds a sofa; it assumes a perfect detector and asks what the
// code downstream of it does with a perfect answer. Every error it reports is ours.
//
// The boxes are computed analytically, by projecting known placements through
// tests/helpers/project.ts. No renderer, no GPU, no headless three.js — software GL
// is slow and fragile in CI and the pixels are not what is under test.
//
// **The limit of that shortcut, stated where it applies.** A box produced by
// projecting through a camera model and then inverted by a camera model cannot test
// the projection: the two directions share their assumptions, so a wrong shared
// convention cancels out and nothing here notices. Projection itself is covered by
// tests/photo-geometry.test.ts against hand-computed cases. What this file covers is
// everything AFTER it — which anchor was chosen, what the merge kept, what the label
// check accused, what clampDims and snapToWall and settleParts did to the result.

import { describe, expect, it } from 'vitest';
import { mergeDistanceFor, refineDetections, type CalMap, type RoomDims } from '@/lib/detect-refine';
import { judgeLabels } from '@/lib/label-repair';
import { toRecord, type SavedDetection } from '@/lib/detection-record';
import { buildSceneFromRoom, type Category, type Shape } from '@/lib/scene-spec';
import { anchorFor } from '@/lib/physics';
import { footFromPart, footInsidePoly } from '@/lib/geometry';
import { footprintForLayout } from '@/lib/footprint';
import type { CameraCal } from '@/lib/photo-geometry';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot, RoomData } from '@/lib/storage';
import { bboxOfCeilingDisc, bboxOfFloorObject, bboxOfWallPanel, inFrame, type Box } from './helpers/project';

// ── The room ──────────────────────────────────────────────────────────────────
//
// 7 × 6 m rather than a typical bedroom, because the FRAME is the binding
// constraint, not the furniture. A camera 1.5 m up sees floor only past 1.51 m and
// ceiling only past 1.21 m (see placeCeilingObject), so a small room leaves no
// distance at which a piece is both fully inside the walls and fully inside the
// picture. Every fixture asserts `inFrame`, so shrinking this room fails loudly
// rather than quietly measuring things that were never photographed.
const ROOM: RoomDims = { width: 7, depth: 6, height: 2.7 };

// A ~106° phone ultrawide — the only common lens that frames floor, wall AND
// ceiling from one level shot. The nominal 66° sees walls and nothing else.
const CAL: CameraCal = { k: 2 * Math.tan(((106 / 2) * Math.PI) / 180), aspect: 4 / 3 };
const CALS: CalMap = { n: CAL, e: CAL, s: CAL, w: CAL };

// ── What is actually in it ────────────────────────────────────────────────────

type Truth = {
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

const TRUTH: Truth[] = [
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
function boxFor(t: Truth, slot: CaptureSlot): Box {
  const anchor = anchorFor(t.category, t.shape);
  const wM = t.dimMM[0] / 1000;
  const hM = t.dimMM[2] / 1000;
  if (anchor === 'ceiling') return bboxOfCeilingDisc(slot, t.x, t.z, wM, CAL, ROOM.height);
  if (anchor === 'floor') return bboxOfFloorObject(slot, t.x, t.z, wM, hM, CAL);
  return bboxOfWallPanel(slot, t.x, t.y ?? 1.2, t.z, wM, hM, CAL);
}

type Shot = { truth: Truth; slot: CaptureSlot; det: Detection };

function shots(): Shot[] {
  return TRUTH.flatMap((truth) =>
    truth.slots.map((slot) => ({
      truth,
      slot,
      det: {
        label: truth.label,
        conf: 0.9,
        box: boxFor(truth, slot),
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

function roomData(records: SavedDetection[]): RoomData {
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

/** Nearest same-label candidate to a truth, by XZ. Same-label rather than
 *  same-index because the merge legitimately removes rows, and nearest rather than
 *  first because two pieces share the label 'bedside table' on purpose. */
function nearest<T extends { label?: string; x: number; z: number }>(t: Truth, pool: T[]): T | undefined {
  const same = pool.filter((p) => p.label === undefined || p.label === t.label);
  if (same.length === 0) return undefined;
  return same.reduce((best, p) =>
    Math.hypot(p.x - t.x, p.z - t.z) < Math.hypot(best.x - t.x, best.z - t.z) ? p : best,
  );
}

// ── The run, done once and asserted many times ────────────────────────────────

const IN = shots();
const REFINED = refineDetections(
  IN.map((s) => s.det),
  CALS,
  ROOM,
);
const VERDICTS = judgeLabels(REFINED, CALS, ROOM);
const PARTS = buildSceneFromRoom(roomData(REFINED.map((d, i) => toRecord(d, i, false, () => `uid-${i}`))));

type Row = {
  name: string;
  label: string;
  found: boolean;
  posErrM: number;
  widthErrMM: number;
  verdict: string;
  scenePosErrM: number;
};

const REPORT: Row[] = TRUTH.map((t) => {
  const idx = REFINED.map((d, i) => ({ d, i }))
    .filter(({ d }) => d.label === t.label && d.position)
    .map(({ d, i }) => ({ label: d.label, x: d.position!.x, z: d.position!.z, i }));
  const hit = nearest(t, idx);
  const part = nearest(
    t,
    PARTS.map((p) => ({ label: undefined as string | undefined, x: p.pos[0], z: p.pos[2], id: p.id, cat: p.category })).filter(
      (p) => p.cat === t.category,
    ),
  );
  if (!hit) {
    return { name: t.name, label: t.label, found: false, posErrM: NaN, widthErrMM: NaN, verdict: 'LOST', scenePosErrM: NaN };
  }
  const d = REFINED[hit.i];
  return {
    name: t.name,
    label: t.label,
    found: true,
    posErrM: Math.hypot(hit.x - t.x, hit.z - t.z),
    widthErrMM: (d.dimMM?.[0] ?? 0) - t.dimMM[0],
    verdict: VERDICTS[hit.i].status,
    scenePosErrM: part ? Math.hypot(part.x - t.x, part.z - t.z) : NaN,
  };
});

// ── What each piece is allowed to be off by ───────────────────────────────────
//
// **Not listed means EXACT.** The detector here is perfect and every step after it
// is deterministic arithmetic, so a floor or wall piece coming back even a
// millimetre out is a defect rather than noise. Keeping the bar at zero is the whole
// value of this file: the day one of these numbers moves, something changed.
const ALLOW: Record<string, { posM: number; widthFrac: number; why: string }> = {
  fan: {
    posM: 0.12,
    widthFrac: 0.03,
    why: 'placeCeilingObject reads one bbox row for a plate that spans a range of distances — see its note on why the centre row and not the top',
  },
};
const EXACT = { posM: 1e-9, widthFrac: 1e-9 };
const allowanceFor = (name: string) => ALLOW[name] ?? EXACT;

/** How far the SCENE BUILDER is allowed to move a piece from where it was measured.
 *  This is deliberate movement, not error: snapToWall puts a wardrobe's back against
 *  the plaster and settleParts resolves what is left. The cap is here to catch a
 *  piece being flung across the room, which is what a footprint or affinity bug
 *  looks like. The largest today is the curtain at 0.150 m. */
const SNAP_M = 0.2;

describe('detection pipeline over a known room', () => {
  // Printed unconditionally, because "the harness reports a number" is the point and
  // a number only visible on failure is not reported.
  const fmt = (n: number) => (Number.isNaN(n) ? '  --  ' : n.toFixed(4).padStart(7));
  console.log(
    [
      `\ndetect pipeline · in=${IN.length} refined=${REFINED.length} parts=${PARTS.length} truth=${TRUTH.length}`,
      ...REPORT.map(
        (r) =>
          `  ${r.name.padEnd(14)} ${r.found ? 'ok  ' : 'LOST'}  pos ${fmt(r.posErrM)} m  dW ${String(Math.round(r.widthErrMM)).padStart(5)} mm  ${r.verdict.padEnd(10)} scene ${fmt(r.scenePosErrM)} m`,
      ),
    ].join('\n'),
  );

  it('merges exactly the one object that was photographed twice', () => {
    // 11 detections in for 10 pieces: the lamp appears in both the N and E photos.
    // Both halves of this matter. Fewer than 10 out means the merge deleted real
    // furniture — the failure that is invisible to the user, since a piece that
    // never appears leaves no trace. More than 10 means it kept a duplicate, which
    // the user can delete in one tap.
    expect(IN.length).toBe(TRUTH.length + 1);
    expect(REFINED.length).toBe(TRUTH.length);
    expect(PARTS.length).toBe(TRUTH.length);
  });

  it('every fixture is fully inside its own photo', () => {
    // A synthetic box hanging off the edge of the frame is not a hard case, it is an
    // impossible one — a real detector can only box what it could see. This guards
    // the FIXTURES, not the code: shrink the room or move a piece nearer and this
    // fails here rather than as a mystery 2 m position error downstream.
    for (const s of IN) {
      expect(inFrame(s.det.box), `${s.truth.name} in slot ${s.slot}: ${s.det.box.map((n) => n.toFixed(3)).join(', ')}`).toBe(
        true,
      );
    }
  });

  it('finds every piece that is in the room', () => {
    expect(REPORT.filter((r) => !r.found).map((r) => r.name)).toEqual([]);
  });

  it('puts every piece where it actually is', () => {
    for (const r of REPORT) {
      expect(r.posErrM, `${r.name}: ${allowanceFor(r.name).why ?? 'must be exact'}`).toBeLessThanOrEqual(
        allowanceFor(r.name).posM,
      );
    }
  });

  it('measures every piece at the size it actually is', () => {
    for (const r of REPORT) {
      const truth = TRUTH.find((t) => t.name === r.name)!;
      const frac = Math.abs(r.widthErrMM) / truth.dimMM[0];
      expect(frac, `${r.name}: ${allowanceFor(r.name).why ?? 'must be exact'}`).toBeLessThanOrEqual(
        allowanceFor(r.name).widthFrac,
      );
    }
  });

  it('measures the ceiling piece rather than falling back to the catalogue', () => {
    // The fan is the one piece whose numbers are approximate, so its allowance is
    // wide enough to be met by NOT MEASURING IT AT ALL — the catalogue default is
    // 1000 mm against a truth of 1000 mm. This is what stops that allowance from
    // quietly becoming a pass for a broken ceiling path.
    const fan = REFINED.find((d) => d.category === 'fan')!;
    expect(fan.dimMM).toBeDefined();
    expect(fan.dimMM![0]).not.toBe(1000);
    expect(fan.position!.y).toBe(ROOM.height); // the ceiling plane, not a guess
  });

  it('accuses none of the ten correct labels', () => {
    // The false-positive rate of the Phase 4 label check, on a room where every
    // word is right. A check that cries wolf is a check the user stops reading, and
    // the review screen locks nothing it has flagged.
    expect(REPORT.filter((r) => r.verdict === 'suspect').map((r) => r.name)).toEqual([]);
    // …and none of them is silently 'unmeasured' either, which would mean the
    // geometry never got a look and 'no accusation' proved nothing.
    expect(REPORT.filter((r) => r.verdict !== 'ok').map((r) => r.name)).toEqual([]);
  });

  it('does not move anything far when it snaps and settles it', () => {
    for (const r of REPORT) {
      expect(r.scenePosErrM, r.name).toBeLessThanOrEqual(SNAP_M);
    }
  });

  it('leaves every part’s whole footprint inside the room', () => {
    const poly = footprintForLayout('rect', ROOM.width, ROOM.depth);
    for (const p of PARTS) {
      expect(footInsidePoly(footFromPart(p.pos, p.rot, p.dimMM, p.circle), poly), `${p.id}`).toBe(true);
    }
  });
});

// ── What label equality is currently buying ───────────────────────────────────
//
// Phase 3b of the detection plan — dropping the label test from the cross-slot
// merge rule — was deferred until this harness existed, on the grounds that it
// trades precision for recall and the trade needs a number. Here is the number.
//
// Label equality is the ONLY thing separating two distinct same-category pieces
// that sit closer together than their merge tier. It is also the thing that lets
// one object photographed from two walls survive as two rows when the model happens
// to name it differently in each ("sofa" / "three seat sofa"). One of those is a
// real piece of furniture silently deleted; the other is a duplicate one tap away
// from gone. That asymmetry is the whole argument, and it points the same way as
// every other decision in lib/detect-refine.ts.
describe('the cross-slot label test, measured rather than argued', () => {
  const near = (label: string, x: number): Detection => ({
    label,
    conf: 0.9,
    box: bboxOfWallPanel('n', x, 1.5, -2.9, 0.6, 0.45, CAL),
    category: 'painting',
    slot: 'n',
    shape: 'painting',
  });

  it('keeps two differently-named paintings closer together than their tier', () => {
    // A gallery pair 0.30 m apart on one wall. Their merge tier is 0.35 m (painting
    // is 'tight'), so distance ALONE would collapse them — only the labels differ.
    const pair = [near('framed print', -0.15), near('concert poster', 0.15)];
    for (const d of pair) expect(inFrame(d.box)).toBe(true);
    const out = refineDetections(pair, CALS, ROOM);
    expect(out).toHaveLength(2);
    // The premise, so this cannot pass because the pair drifted apart: their
    // measured positions really are inside the tier.
    const gap = Math.hypot(
      out[0].position!.x - out[1].position!.x,
      out[0].position!.z - out[1].position!.z,
    );
    expect(gap).toBeLessThan(mergeDistanceFor('painting'));
  });

  it('and loses them the moment the labels agree', () => {
    // Same geometry, one word changed. This is exactly what Phase 3b would make
    // unconditional: the cost of dropping the label test is this pair, and every
    // pair like it, on every run — a real piece of furniture that never appears.
    const pair = [near('framed print', -0.15), near('framed print', 0.15)];
    expect(refineDetections(pair, CALS, ROOM)).toHaveLength(1);
  });

  it('while a single object named twice survives as two rows', () => {
    // The recall this buys back, and the reason 3b was ever proposed. One plant in
    // the corner, in both the N and E photos, named differently in each, comes
    // through as two — a duplicate the user deletes in one tap.
    //
    // A plant rather than the sofa this was first written with: only a narrow band
    // of the room is inside BOTH frames at once, and a 2 m sofa placed there hangs
    // out of the E photo. The `inFrame` guard said so, which is the second time
    // in this file it has caught a fixture rather than the code.
    const one: Detection[] = (['n', 'e'] as CaptureSlot[]).map((slot, i) => ({
      label: i === 0 ? 'potted plant' : 'fern',
      conf: 0.9,
      box: bboxOfFloorObject(slot, 2.0, -2.2, 0.4, 0.9, CAL),
      category: 'plant',
      slot,
      shape: 'plant',
    }));
    for (const d of one) expect(inFrame(d.box)).toBe(true);
    const out = refineDetections(one, CALS, ROOM);
    expect(out).toHaveLength(2);
    // Premise: the two measurements DO agree on where it is, so distance alone
    // would have merged them and only the differing labels kept them apart.
    const gap = Math.hypot(out[0].position!.x - out[1].position!.x, out[0].position!.z - out[1].position!.z);
    expect(gap).toBeLessThan(mergeDistanceFor('plant'));
  });
});
