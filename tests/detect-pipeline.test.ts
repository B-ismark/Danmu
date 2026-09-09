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
import { mergeDistanceFor, refineDetections } from '@/lib/detect-refine';
import { footFromPart, footInsidePoly } from '@/lib/geometry';
import { footprintForLayout } from '@/lib/footprint';
import { defaultDepthFor } from '@/lib/scene-spec';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot } from '@/lib/storage';
import { bboxOfFloorObject, bboxOfWallPanel, inFrame } from './helpers/project';
import { CAL, CALS, ROOM, TRUTH, nearest, runPipeline, squareOn } from './helpers/known-room';

// The room, its ten pieces, the projector and the pipeline all live in
// `tests/helpers/known-room.ts` now — `tests/off-square-cost.test.ts` runs the same
// room past a camera that is not square to the wall, and `boxFor`/`shots` used to
// read the camera off this file's module scope. Moving them changed nothing here:
// the printed table below is byte-identical to before and every assertion in this
// file passed untouched, which is the whole reason the extraction was safe to make.

// ── The run, done once and asserted many times ────────────────────────────────

const { IN, REFINED, VERDICTS, PARTS } = runPipeline(squareOn(CAL), CALS);

type Row = {
  name: string;
  label: string;
  found: boolean;
  posErrM: number;
  widthErrMM: number;
  /** Signed height error in mm. Added with the near-face fix, because height was
   *  one of the three things riding the wrong distance and a column nobody printed
   *  is a measurement nobody has. A piece whose top is BELOW the lens images its FAR
   *  top edge, so its height was read at the near face and came back tall — the
   *  nightstands by ~130 mm, with every gate green. */
  heightErrMM: number;
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
    return {
      name: t.name,
      label: t.label,
      found: false,
      posErrM: NaN,
      widthErrMM: NaN,
      heightErrMM: NaN,
      verdict: 'LOST',
      scenePosErrM: NaN,
    };
  }
  const d = REFINED[hit.i];
  return {
    name: t.name,
    label: t.label,
    found: true,
    posErrM: Math.hypot(hit.x - t.x, hit.z - t.z),
    widthErrMM: (d.dimMM?.[0] ?? 0) - t.dimMM[0],
    heightErrMM: (d.dimMM?.[2] ?? 0) - t.dimMM[2],
    verdict: VERDICTS[hit.i].status,
    scenePosErrM: part ? Math.hypot(part.x - t.x, part.z - t.z) : NaN,
  };
});

/** Half the difference between the sofa's real depth and the depth
 *  `placeFloorObject` has to assume for it — the one residual left in this room
 *  once a floor piece is decoded at its centre instead of its near face.
 *
 *  Read from the catalogue rather than typed, so a change to either number moves
 *  the expectation with it instead of turning this file red for the wrong reason. */
const SOFA_DEPTH_GAP_M =
  Math.abs(defaultDepthFor('sofa', 'sofa') - TRUTH.find((t) => t.name === 'sofa')!.dimMM[1]) / 2000;

/** How far the ROUND fixture's own discretisation can move an answer.
 *
 *  `floorCylinderPoints` samples a circle at 720 rim points, so the extreme sample
 *  sits a little short of the true tangent and the bbox it builds is a polygon's,
 *  not a circle's. Measured: the plant lands 8.8e-7 m out at 720 samples and 1.4e-7
 *  at 1440, so it shrinks with the sample count — and `tests/photo-geometry.test.ts`
 *  round-trips the same inverse against an ANALYTIC tangent bbox, where it is exact
 *  to 1e-15 on position, width and height alike. So this is the fixture's number
 *  and not the placer's, which is the distinction worth having an assertion for
 *  rather than a sentence.
 *
 *  Not driven to zero by raising the count: 31,000 samples would be needed, and the
 *  off-square sweep builds these boxes eighty-one times. 1e-5 m is four orders below
 *  anything the app can display and two above what is measured here. */
const ROUND_RIM_M = 1e-5;

// ── What each piece is allowed to be off by ───────────────────────────────────
//
// **Not listed means EXACT.** The detector here is perfect and every step after it
// is deterministic arithmetic, so a floor or wall piece coming back even a
// millimetre out is a defect rather than noise. Keeping the bar at zero is the whole
// value of this file: the day one of these numbers moves, something changed.
//
// **What that bar means changed once, and this is the note that says so.** It used
// to hold against a fixture that projected floor pieces as depthless CARDS, for
// which a piece's near face and its centre plane are the same plane — the one
// quantity `placeFloorObject` was getting wrong. So every floor row read 0.0000 and
// that was a property of the fixture rather than of the placer, which is the same
// defect as an assertion that cannot fail. `boxFor` projects solids now: eight
// corners for a box footprint, tangent rim samples for a round one. Nine of the ten
// pieces are still exact, and now that is a statement about the code.
const ALLOW: Record<string, { posM: number; widthFrac: number; why: string }> = {
  fan: {
    posM: 0.12,
    widthFrac: 0.03,
    why: 'placeCeilingObject reads one bbox row for a plate that spans a range of distances — see its note on why the centre row and not the top',
  },
  sofa: {
    // DERIVED, not fitted, and it is the whole story of the near-face fix. Every
    // floor piece is now decoded at its centre, which takes a depth, and the depth
    // comes from the catalogue because a photograph cannot see it. This sofa is
    // 850 mm deep and the catalogue says 950, so its centre lands exactly half that
    // 100 mm gap too far back. Nothing else about it moves: its width is exact,
    // because it straddles its own view axis and both silhouette edges therefore
    // sit on the near face, where the assumed depth cannot reach them.
    //
    // Half of a difference is a figure, so it is asserted as one rather than
    // allowed as a slack — see the `it` below that pins it to nine decimals. This
    // row exists only so the sweep's message names the reason.
    posM: SOFA_DEPTH_GAP_M + 1e-9,
    widthFrac: 1e-9,
    why: 'exactly half the gap between its real 850 mm depth and the catalogue default the placer must assume — see the assertion below',
  },
  // The two round pieces, allowed the FIXTURE's rim polygon and nothing else. See
  // ROUND_RIM_M: the inverse itself is exact to 1e-15 against an analytic tangent
  // bbox, so what is being allowed here is 720 sample points, not a model error.
  plant: { posM: ROUND_RIM_M, widthFrac: ROUND_RIM_M, why: "the round fixture's 720-point rim polygon, not the placer — see ROUND_RIM_M" },
  lamp: { posM: ROUND_RIM_M, widthFrac: ROUND_RIM_M, why: "the round fixture's 720-point rim polygon, not the placer — see ROUND_RIM_M" },
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
  //
  // That takes a flag. vitest 4's default reporter DISCARDS console output from a
  // passing run, so for a while this printed to nobody and the gate stayed green
  // over an invisible baseline. `pnpm test` passes `--disableConsoleIntercept`, and
  // `tests/toolchain.test.ts` pins it — running vitest directly without it is why
  // you would see no table here.
  const fmt = (n: number) => (Number.isNaN(n) ? '  --  ' : n.toFixed(4).padStart(7));
  console.log(
    [
      `\ndetect pipeline · in=${IN.length} refined=${REFINED.length} parts=${PARTS.length} truth=${TRUTH.length}`,
      ...REPORT.map(
        (r) =>
          `  ${r.name.padEnd(14)} ${r.found ? 'ok  ' : 'LOST'}  pos ${fmt(r.posErrM)} m  dW ${String(Math.round(r.widthErrMM)).padStart(5)} mm  dH ${String(Math.round(r.heightErrMM)).padStart(5)} mm  ${r.verdict.padEnd(10)} scene ${fmt(r.scenePosErrM)} m`,
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

  it('measures every piece at the HEIGHT it actually is', () => {
    // The column that did not exist until the near-face fix, and the reason it now
    // does: height rode the same wrong distance as position and width. A piece whose
    // top is BELOW the lens images its FAR top edge, so reading it at the near face
    // made both nightstands ~130 mm too tall and the sofa ~150 mm, with every gate
    // in this file green — a printed table with no height column in it, which is the
    // failure this repo keeps finding rather than a new one.
    for (const r of REPORT) {
      if (r.name === 'sofa') continue;
      expect(Math.abs(r.heightErrMM), `${r.name}: must be exact`).toBeLessThanOrEqual(1);
    }

    // The sofa again, and for the same single reason: recovering the height of a low
    // piece needs its FAR face, so the depth it cannot see reaches the height too.
    // 950 mm assumed against 850 real puts the far face 100 mm too far back, and the
    // same angular drop over a longer distance reads as less height. Signed, because
    // "too short" is the direction the mechanism predicts and a bound on the
    // magnitude alone would pass if it went the other way.
    const sofa = REPORT.find((r) => r.name === 'sofa')!;
    expect(sofa.heightErrMM).toBeLessThan(0);
    expect(sofa.heightErrMM).toBeGreaterThan(-30);
  });

  it('and the one residual left is exactly half a depth it cannot see', () => {
    // The near-face fix in one assertion. A floor piece is decoded at its centre
    // now, which takes a depth, and a photograph cannot see depth — so the placer
    // reads the catalogue's, which for this sofa is 950 mm against its real 850.
    // Half that gap, 0.0500 m, is the whole error. Not a tolerance: a figure, to
    // nine decimals, so it fails if the mechanism changes and not merely if the
    // number grows.
    //
    // What this replaces is worth remembering: the same sofa was 0.4250 m out —
    // exactly half its OWN 850 mm depth — because the bbox's bottom edge is its
    // near face and the placer called that the centre.
    const sofa = REPORT.find((r) => r.name === 'sofa')!;
    expect(sofa.posErrM).toBeCloseTo(SOFA_DEPTH_GAP_M, 9);
    expect(SOFA_DEPTH_GAP_M).toBeCloseTo(0.05, 9);

    // And it is the only piece that owes anything to a catalogue number. Three of
    // the six floor pieces are exact outright, because for those the catalogue depth
    // IS their real depth.
    for (const name of ['wardrobe', 'nightstand-L', 'nightstand-R']) {
      expect(REPORT.find((r) => r.name === name)!.posErrM, `${name} is exact`).toBeLessThanOrEqual(1e-9);
    }

    // The other two are round, and that is the half worth asserting rather than
    // stating: a circle's depth IS its width, so the placer measures it and owes the
    // catalogue nothing at all. It is why the two pieces that used to be worst on
    // width — a floor lamp at +81%, a plant at +54% — are now the two that need no
    // assumed number. What is left is the fixture's rim polygon, four orders below
    // a millimetre.
    for (const name of ['plant', 'lamp']) {
      const r = REPORT.find((x) => x.name === name)!;
      expect(r.posErrM, `${name} owes the catalogue nothing`).toBeLessThan(ROUND_RIM_M);
      expect(Math.abs(r.widthErrMM), `${name} width`).toBeLessThan(1);
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
// Two of the three fixtures below are SAME-slot, which is not a slip: the label
// test guards rule 2, and rule 2 carries no slot test (see its note in
// lib/detect-refine.ts). Dropping label equality would cost the gallery pair
// whichever photo they came from.
describe('the merge label test, measured rather than argued', () => {
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
