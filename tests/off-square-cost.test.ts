// What does it cost that the phone is never exactly square to the wall?
//
// `lib/photo-geometry.ts` opens by stating the rig: "camera at the ROOM CENTRE,
// CAM_HEIGHT off the floor, level, framing one wall straight-on". The first three
// are asked for and measured; the fourth is assumed and never checked. This file
// measures what the assumption costs, and changes NOTHING in `lib/` — whether to
// model it at all is a decision that needs the number first.
//
// Method: project the known room through a camera that is genuinely off-square,
// hand the resulting boxes to today's unmodified placers, and compare against where
// the furniture actually is. For the first time the forward and inverse models
// disagree ON PURPOSE — `tests/helpers/project.ts` warns that a round-trip cannot
// test the projection itself, and here it is not being asked to.
//
// Two things are being measured, not one, and the second is the one this file was
// nearly written without. `refineDetections` merges two sightings of one object
// when they land within the category's merge distance, so off-square framing can
// fail in OPPOSITE directions:
//
//   · the cross-slot lamp's two estimates drift APART → a duplicate appears. The
//     user sees it and deletes it in one tap.
//   · the two nightstands, 0.55 m apart in the 0.35 m `tight` tier with only
//     0.20 m of headroom, drift TOGETHER → one of them is deleted. Nobody sees it.
//
// `tests/detect-pipeline.test.ts` says which is worse in as many words: "a piece
// that never appears leaves no trace".

import { describe, expect, it } from 'vitest';
import {
  CAL,
  ROOM,
  TRUTH,
  boxFor,
  boxForYawed,
  nearest,
  offSquare,
  runPipeline,
  type Truth,
} from './helpers/known-room';
import { inFrame, project } from './helpers/project';
import { anchorFor } from '@/lib/physics';
import type { CaptureSlot } from '@/lib/storage';

const SLOTS: CaptureSlot[] = ['n', 'e', 's', 'w'];
const rad = (deg: number) => (deg * Math.PI) / 180;
const fmt = (n: number) => (Number.isNaN(n) ? '  --  ' : n.toFixed(4).padStart(7));

// ── First, is the new projector the same projector? ───────────────────────────

describe('the off-square projector is the proven one at zero', () => {
  it('agrees with boxFor exactly at yaw 0 with no depth', () => {
    // This is what validates a freshly written corner builder against the three
    // `bboxOf*` helpers that already have a suite, rather than trusting that the
    // two were written to match.
    for (const t of TRUTH) {
      for (const slot of t.slots) {
        const a = boxFor(t, slot, CAL);
        const b = boxForYawed(t, slot, CAL, { yawRad: 0 });
        for (let i = 0; i < 4; i += 1) {
          expect(b[i], `${t.name} ${slot} component ${i}`).toBeCloseTo(a[i], 12);
        }
      }
    }
  });

  it('and the whole pipeline reproduces the baseline through it', () => {
    const base = runPipeline();
    const same = runPipeline(offSquare(CAL, { yawRad: 0 }));
    expect(same.REFINED.length).toBe(base.REFINED.length);
    expect(same.PARTS.length).toBe(base.PARTS.length);
    for (let i = 0; i < base.REFINED.length; i += 1) {
      expect(same.REFINED[i].position!.x).toBeCloseTo(base.REFINED[i].position!.x, 12);
      expect(same.REFINED[i].position!.z).toBeCloseTo(base.REFINED[i].position!.z, 12);
      expect(same.REFINED[i].dimMM![0]).toBe(base.REFINED[i].dimMM![0]);
    }
  });
});

// ── The sign, derived by hand rather than from either model ───────────────────

describe('which way a turned camera moves the picture', () => {
  it('turning the lens right slides the scene left, in all four slots', () => {
    // Hand-derived from the physics, not read out of an implementation: turn your
    // head right and what was ahead of you moves left. This is the ONLY assertion
    // here that can catch a sign error shared by the forward and inverse models —
    // `tests/helpers/project.ts:14-18` says a round-trip cannot.
    for (const slot of SLOTS) {
      const wallCentre: Record<CaptureSlot, [number, number, number]> = {
        n: [0, 1.4, -ROOM.depth / 2],
        s: [0, 1.4, ROOM.depth / 2],
        e: [ROOM.width / 2, 1.4, 0],
        w: [-ROOM.width / 2, 1.4, 0],
      };
      const [x, y, z] = wallCentre[slot];
      const [u0] = project(slot, x, y, z, CAL);
      expect(u0, `${slot} square-on`).toBeCloseTo(0.5, 9);

      // Same point, camera turned +10° to its right.
      const t: Truth = {
        name: 'probe',
        label: 'probe',
        category: 'painting',
        shape: 'painting',
        x,
        y,
        z,
        dimMM: [10, 10, 10],
        slots: [slot],
      };
      const box = boxForYawed(t, slot, CAL, { yawRad: rad(10) });
      const uMid = box[0] + box[2] / 2;
      expect(uMid, `${slot} yawed +10°`).toBeLessThan(0.5);
    }
  });
});

// ── The control: what the harness cannot currently see ────────────────────────

describe('silhouette inflation, live at yaw 0 today', () => {
  const rows = TRUTH.filter((t) => anchorFor(t.category, t.shape) === 'floor').flatMap((t) =>
    t.slots.map((slot) => {
      const card = boxForYawed(t, slot, CAL, { yawRad: 0, realDepth: false });
      const box = boxForYawed(t, slot, CAL, { yawRad: 0, realDepth: true });
      return {
        name: t.name,
        slot,
        depthMM: t.dimMM[1],
        widthMM: t.dimMM[0],
        cardU: card[2],
        boxU: box[2],
        inflate: box[2] / card[2] - 1,
      };
    }),
  );

  // The measurement IS the output — see `tests/toolchain.test.ts` on why
  // `--disableConsoleIntercept` is load-bearing, and `CLAUDE.md` on gates whose
  // answer nobody reads. No `eslint-disable` here: `no-console` is not enabled in
  // this config, so a directive would suppress nothing and ESLint 9 reports an
  // unused one as a warning, which at `--max-warnings 0` is a red build.
  console.log(
    [
      `\noff-square · control at yaw 0: a real box vs the depthless card the fixtures use`,
      ...rows.map(
        (r) =>
          `  ${r.name.padEnd(14)} ${r.slot}  W ${String(r.widthMM).padStart(4)} D ${String(r.depthMM).padStart(4)} mm` +
          `  card u ${fmt(r.cardU)}  box u ${fmt(r.boxU)}  inflate ${(r.inflate * 100).toFixed(1).padStart(6)}%`,
      ),
    ].join('\n'),
  );

  it('a real box is never narrower on screen than its depthless card', () => {
    for (const r of rows) expect(r.inflate, `${r.name} ${r.slot}`).toBeGreaterThanOrEqual(-1e-12);
  });

  it('and the two differ, so the fixture really is hiding something', () => {
    // Pinned as a floor rather than an exact figure: what matters is that the gap
    // is not zero, i.e. `bboxOfFloorObject` reports a width no real box would.
    const worst = Math.max(...rows.map((r) => r.inflate));
    expect(worst).toBeGreaterThan(0.01);
  });
});

// ── The sweep ─────────────────────────────────────────────────────────────────

type Outcome = {
  label: string;
  deg: number;
  refined: number;
  offFrame: number;
  worstPosM: number;
  medPosM: number;
  worstWidthFrac: number;
  lampRows: number;
  nightstandGapM: number;
};

function measure(label: string, deg: number, yawOf: (slot: CaptureSlot) => number, realDepth: boolean): Outcome {
  const boxOf = (t: Truth, slot: CaptureSlot) =>
    boxForYawed(t, slot, CAL, { yawRad: yawOf(slot), realDepth });

  let offFrame = 0;
  for (const t of TRUTH) for (const slot of t.slots) if (!inFrame(boxOf(t, slot))) offFrame += 1;

  const { REFINED } = runPipeline(boxOf);

  const posErrs: number[] = [];
  let worstWidthFrac = 0;
  for (const t of TRUTH) {
    const pool = REFINED.filter((d) => d.position).map((d) => ({
      label: d.label,
      x: d.position!.x,
      z: d.position!.z,
      w: d.dimMM?.[0] ?? 0,
    }));
    const hit = nearest(t, pool);
    if (!hit) continue;
    posErrs.push(Math.hypot(hit.x - t.x, hit.z - t.z));
    worstWidthFrac = Math.max(worstWidthFrac, Math.abs(hit.w - t.dimMM[0]) / t.dimMM[0]);
  }
  const sorted = [...posErrs].sort((a, b) => a - b);

  const lampRows = REFINED.filter((d) => d.label === 'floor lamp').length;
  const stands = REFINED.filter((d) => d.label === 'bedside table' && d.position);
  const nightstandGapM =
    stands.length >= 2
      ? Math.hypot(
          stands[0].position!.x - stands[1].position!.x,
          stands[0].position!.z - stands[1].position!.z,
        )
      : 0;

  return {
    label,
    deg,
    refined: REFINED.length,
    offFrame,
    worstPosM: sorted.length ? sorted[sorted.length - 1] : NaN,
    medPosM: sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN,
    worstWidthFrac,
    lampRows,
    nightstandGapM,
  };
}

const ANGLES = [0, 2, 5, 10, 20];
const RUNS: Outcome[] = [];
for (const deg of ANGLES) {
  // Uniform: one shooting habit, every wall off-square the same way.
  RUNS.push(measure(`uniform +${deg}°`, deg, () => rad(deg), true));
  // Differential: per-shot hand variation, which is the case a sensor residual
  // could in principle see and a systematic bias could not.
  RUNS.push(
    measure(`per-slot ±${deg}°`, deg, (s) => rad(s === 'n' || s === 's' ? deg : -deg), true),
  );
}

// The measurement is the output; see the note on the first of these.
console.log(
  [
    `\noff-square · cost of a camera that is not square to the wall (real-depth boxes)`,
    `  ${'case'.padEnd(16)} refined  offFrame  worst pos  med pos  worst dW  lampRows  standGap`,
    ...RUNS.map(
      (r) =>
        `  ${r.label.padEnd(16)} ${String(r.refined).padStart(7)}  ${String(r.offFrame).padStart(8)}` +
        `  ${fmt(r.worstPosM)}  ${fmt(r.medPosM)}  ${(r.worstWidthFrac * 100).toFixed(1).padStart(7)}%` +
        `  ${String(r.lampRows).padStart(8)}  ${fmt(r.nightstandGapM)}`,
    ),
  ].join('\n'),
);

// ── Which piece, and at what angle ────────────────────────────────────────────

/** Per-piece error for one camera, so a headline number can name its own worst case. */
function perPiece(yawRad: number, realDepth: boolean) {
  const boxOf = (t: Truth, slot: CaptureSlot) => boxForYawed(t, slot, CAL, { yawRad, realDepth });
  const { REFINED } = runPipeline(boxOf);
  return TRUTH.map((t) => {
    const pool = REFINED.filter((d) => d.position).map((d) => ({
      label: d.label,
      x: d.position!.x,
      z: d.position!.z,
      w: d.dimMM?.[0] ?? 0,
    }));
    const hit = nearest(t, pool);
    const anyOff = t.slots.some((slot) => !inFrame(boxOf(t, slot)));
    return {
      name: t.name,
      anchor: anchorFor(t.category, t.shape),
      dims: t.dimMM,
      offFrame: anyOff,
      posErrM: hit ? Math.hypot(hit.x - t.x, hit.z - t.z) : NaN,
      widthFrac: hit ? (hit.w - t.dimMM[0]) / t.dimMM[0] : NaN,
    };
  });
}

const ZERO_DETAIL = perPiece(0, true);

// The measurement is the output; see the note on the first of these.
console.log(
  [
    `\noff-square · per piece at yaw 0 with REAL DEPTH — the error already present today`,
    ...ZERO_DETAIL.map(
      (r) =>
        `  ${r.name.padEnd(14)} ${r.anchor.padEnd(8)} ${r.dims.join('×').padEnd(16)}` +
        `  pos ${fmt(r.posErrM)} m  dW ${(r.widthFrac * 100).toFixed(1).padStart(7)}%` +
        (r.offFrame ? '  (off-frame)' : ''),
    ),
  ].join('\n'),
);

/** The smallest DIFFERENTIAL angle at which the cross-slot lamp stops merging, to
 *  0.25°. Differential rather than uniform because the sweep shows uniform never
 *  splits it — see the assertion that pins exactly that. */
const splitDeg = (() => {
  for (let deg = 0; deg <= 20; deg += 0.25) {
    const r = measure(`probe ${deg}`, deg, (sl) => rad(sl === 'n' || sl === 's' ? deg : -deg), true);
    if (r.lampRows > 1) return deg;
  }
  return NaN;
})();

// The measurement is the output; see the note on the first of these.
console.log(`\noff-square · the cross-slot lamp splits into a duplicate at ±${splitDeg}° of DIFFERENTIAL yaw`);

describe('the cost, measured', () => {
  it('reports a row per angle, so the baseline cannot drift unseen', () => {
    expect(RUNS.length).toBe(ANGLES.length * 2);
    for (const r of RUNS) expect(Number.isNaN(r.worstPosM)).toBe(false);
  });

  it('costs nothing at all at zero, in both sweep shapes', () => {
    // Filtered on the NUMBER, not the label. The first version matched
    // `label.includes('0°')`, which is also true of "+10°" and "±20°" — so it
    // asserted the zero-cost properties of every angle and failed. A string test
    // standing in for a numeric one.
    for (const r of RUNS.filter((x) => x.deg === 0)) {
      expect(r.refined, r.label).toBe(TRUTH.length);
      expect(r.lampRows, r.label).toBe(1);
      expect(r.offFrame, r.label).toBe(0);
    }
  });

  it('a duplicate appears, and only from DIFFERENTIAL off-square error', () => {
    // The structural result, and the one worth keeping: a camera off-square by the
    // SAME angle on every wall moves both sightings of the lamp the same way, so
    // they still agree and still merge. Only per-shot variation pulls them apart.
    // That is the common-mode / differential distinction, measured rather than
    // argued — and it is why a sensor residual (which can only see the
    // differential part) would be aimed at the right half.
    for (const r of RUNS.filter((x) => x.label.startsWith('uniform'))) {
      expect(r.lampRows, `${r.label} must not split`).toBe(1);
    }
    for (const r of RUNS.filter((x) => x.label.startsWith('per-slot') && x.deg >= 5)) {
      expect(r.lampRows, `${r.label} must split`).toBe(2);
    }
    for (const r of RUNS.filter((x) => x.label.startsWith('per-slot') && x.deg <= 2)) {
      expect(r.lampRows, `${r.label} must still merge`).toBe(1);
    }
    // Pinned so a regression that makes duplicates appear sooner fails.
    expect(splitDeg).toBeGreaterThan(2);
    expect(splitDeg).toBeLessThanOrEqual(5);
  });

  it('but the two nightstands never collapse, which is the failure that would be invisible', () => {
    // 0.55 m apart in the 0.35 m `tight` tier, so only 0.20 m of headroom — the
    // case worth fearing. Measured: the gap barely moves (0.5133 → 0.5077 across
    // 0–20°), because both nightstands sit in the SAME photo and an off-square
    // camera moves them together. Recorded as measured rather than feared.
    for (const r of RUNS) {
      expect(r.nightstandGapM, `${r.label} gap`).toBeGreaterThan(0.35);
    }
  });

  it('and the DOMINANT error is already there at yaw 0, once boxes have depth', () => {
    // The control experiment, and the finding that reorders this whole question:
    // hand today's placers the silhouette of a real 3D box rather than a depthless
    // card and the worst piece is already ~0.42 m out of place and ~79% too wide,
    // with the camera perfectly square. Every yaw below 10° is smaller than that.
    //
    // Pinned as floors, not as figures — the printed table carries the figures, and
    // pinning those would be pinning today's defect as a requirement.
    const worstPos = Math.max(...ZERO_DETAIL.map((r) => r.posErrM));
    const worstW = Math.max(...ZERO_DETAIL.map((r) => Math.abs(r.widthFrac)));
    expect(worstPos).toBeGreaterThan(0.2);
    expect(worstW).toBeGreaterThan(0.3);
  });

  it('and the cause is legible: a floor piece decodes at its NEAR FACE', () => {
    // Not just "there is an error" — the mechanism. `placeFloorObject` backprojects
    // the bbox BOTTOM EDGE onto the floor, which for a real box is the corner
    // nearest the camera, not the centre. So the decoded position sits about
    // `depth/2` short. The sofa makes it exact: 850 mm deep, 0.4250 m of error.
    //
    // Wall pieces are untouched (0.0000 m, 0.0%), which is the other half of the
    // diagnosis: a wall panel IS fronto-parallel and thin, so giving it depth
    // changes nothing. The defect is specific to floor-standing furniture.
    for (const r of ZERO_DETAIL) {
      if (r.anchor.startsWith('wall')) {
        expect(r.posErrM, `${r.name} (wall) must be exact`).toBeCloseTo(0, 9);
        expect(r.widthFrac, `${r.name} (wall) must be exact`).toBeCloseTo(0, 9);
        continue;
      }
      if (r.anchor !== 'floor') continue;
      const halfDepthM = r.dims[1] / 2000;
      // A BAND on the ratio, not a floor. The first version asserted
      // `posErrM > halfDepth * 0.9`, which every nonzero error passes, so it pinned
      // "there is an error" rather than the mechanism. Measured ratios run 1.00
      // (the sofa, near its view axis) to 1.27 (the lamp, furthest off it, which
      // adds a lateral term on top of the near face).
      //
      // Shown to have teeth by perturbing the MECHANISM, not the assertion:
      // halving the box's depth, doubling it, or offsetting its corners along the
      // wall axis instead of the view axis each fails this. (Loosening the bound
      // in this file of course cannot fail it — mutating an assertion tests
      // nothing, which is worth saying because two of the first mutations here
      // did exactly that.) Breadth lives in this band; precision lives in the
      // sofa case below.
      const ratio = r.posErrM / halfDepthM;
      expect(ratio, `${r.name}: error ÷ half its ${r.dims[1]} mm depth`).toBeGreaterThan(0.95);
      expect(ratio, `${r.name}: error ÷ half its ${r.dims[1]} mm depth`).toBeLessThan(1.5);
    }
  });

  it('and the sofa nails it exactly, being square to its own camera', () => {
    // The cleanest instance: 850 mm deep, sitting essentially on its slot's view
    // axis, so the lateral term vanishes and the whole error IS half the depth.
    // 0.4250 m against 0.425 m is the mechanism with nothing else mixed in.
    const sofa = ZERO_DETAIL.find((r) => r.name === 'sofa')!;
    expect(sofa.posErrM).toBeCloseTo(850 / 2000, 4);
  });

  it('and a square-footprint piece is the worst case for width', () => {
    // A 300 × 300 lamp and a 400 × 400 plant present their DIAGONAL, so the
    // silhouette is up to √2 wider than the width; a 2000 × 850 sofa on the view
    // axis presents almost exactly its width. That ordering is the mechanism
    // showing itself, and it is what a fixture of depthless cards cannot express.
    const by = new Map(ZERO_DETAIL.map((r) => [r.name, r]));
    expect(by.get('lamp')!.widthFrac).toBeGreaterThan(by.get('wardrobe')!.widthFrac);
    expect(by.get('plant')!.widthFrac).toBeGreaterThan(by.get('sofa')!.widthFrac);
  });

  it('costs position, monotonically in the angle', () => {
    // The claim the review made and this file exists to check: ψ is a POSITION
    // error. Monotonic rather than a fixed figure, because the figure is what the
    // printed table is for.
    const uniform = RUNS.filter((r) => r.label.startsWith('uniform'));
    for (let i = 1; i < uniform.length; i += 1) {
      expect(uniform[i].worstPosM, uniform[i].label).toBeGreaterThan(uniform[i - 1].worstPosM);
    }
  });
});
