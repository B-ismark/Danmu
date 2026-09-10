// Where the lens stood — the four candidate standpoints, measured before one is chosen.
//
// Every distance this app reads off a room photo scales with where the camera was, and
// that position is not measured: it is assumed. Today's assumption is the WORLD ORIGIN
// (`lib/photo-geometry.ts`'s rig line), which for a `u` room is a point ON one of its own
// walls — so its north view has no wall ahead of it at all. This file is the measurement
// that picks the replacement, and it prints on every green run because the numbers below
// are what the choice rests on.
//
// It calls `framedWallFrom` rather than re-deriving its arithmetic. That is not a
// preference: `docs/traps.md` carries "call the function" twice over from this exact
// thread, once when a scratch probe's hand-transcribed placer produced a 130% error that
// the shipped code does not have, and once when a table's four hand-typed truth numbers
// let it contradict itself while green. A candidate standpoint compared against a
// re-implementation is careful measurement of the wrong subject.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { footprintForLayout, footprintBounds, distanceToFootprintEdge, pointInFootprint, type Footprint, type LayoutId } from '@/lib/footprint';
import { polyAreaCentroid, type Poly } from '@/lib/geometry';
import { roomBays } from '@/lib/room-bays';
import { framedWallFrom, calFromHfov, defaultCal, type CameraCal } from '@/lib/photo-geometry';
import { SLOT_ORDER } from '@/lib/capture-slots';

/** The presets as the PICKER ships them, read out of the picker.
 *
 *  Not five hand-typed width/depth pairs, and the reason is this thread's own scar: the
 *  § 44 table carried four hand-typed truth numbers, and mutation showed the fixture could
 *  be moved while the table went on printing the old truth beside the new measurement —
 *  green, and self-contradicting. A dimension typed here would be a claim about the app;
 *  read here it is a fact about it. The parse is asserted below, so a regex that silently
 *  matches nothing cannot pass. */
function shippedPresets(): { id: LayoutId; name: string; width: number; depth: number }[] {
  const src = readFileSync('app/onboarding/layout-pick/page.tsx', 'utf8');
  const rows = [...src.matchAll(/\{\s*id:\s*'(\w+)'(?:\s+as\s+const)?\s*,\s*name:\s*'([^']+)'\s*,\s*width:\s*([\d.]+)\s*,\s*depth:\s*([\d.]+)/g)];
  return rows.map((m) => ({ id: m[1] as LayoutId, name: m[2], width: Number(m[3]), depth: Number(m[4]) }));
}

type Stand = readonly [number, number];

/** The most open spot in the room: the interior point farthest from any wall, which is the
 *  "pole of inaccessibility" § 44b's filed note names as one of the two candidates. Grid
 *  then refine, in the idiom `findInteriorPoint` already uses — measurement-side, because
 *  it is a candidate rather than production code until the table below justifies it. */
function poleOfInaccessibility(poly: Footprint, step = 0.05): Stand | null {
  const b = footprintBounds(poly);
  let best: Stand | null = null;
  let bestD = -Infinity;
  for (let pass = 0, s = step, x0 = b.minX, x1 = b.maxX, z0 = b.minZ, z1 = b.maxZ; pass < 3; pass++) {
    for (let x = x0; x <= x1; x += s) {
      for (let z = z0; z <= z1; z += s) {
        if (!pointInFootprint(x, z, poly)) continue;
        const d = distanceToFootprintEdge(x, z, poly);
        if (d > bestD) { bestD = d; best = [x, z]; }
      }
    }
    if (!best) return null;
    // Refine around the winner rather than gridding the whole room finer.
    x0 = best[0] - s; x1 = best[0] + s; z0 = best[1] - s; z1 = best[1] + s;
    s /= 10;
  }
  return best;
}

function candidates(poly: Footprint): { rule: string; stand: Stand | null }[] {
  const b = footprintBounds(poly);
  const bay = roomBays(poly)[0];
  const [ax, az] = polyAreaCentroid(poly as unknown as Poly);
  return [
    { rule: 'origin (today)', stand: [0, 0] },
    { rule: 'bbox centre', stand: [b.cx, b.cz] },
    { rule: 'area centroid', stand: [ax, az] },
    { rule: 'largest bay', stand: bay ? [bay.cx, bay.cz] : null },
    { rule: 'pole', stand: poleOfInaccessibility(poly) },
  ];
}

const NARROW: CameraCal = defaultCal(4 / 3);         // the 66° assumed default
const WIDE: CameraCal = calFromHfov(106, 4 / 3);     // a real ultrawide

/** Framed world width at distance d is exactly `k · d` — `tanX(u) = (u − 0.5) · k`, so the
 *  full image spans k of tangent — which is `2·tan(hFOV/2)·d`, the inequality `CLAUDE.md`
 *  rule 2 already states. No new constant. */
const frames = (span: number, d: number, cal: CameraCal) => span <= cal.k * d;

/** The horizontal field of view a lens would need to frame this wall corner to corner
 *  from this distance. A number where `frames` is a boolean, because "NO" hides whether
 *  a wall missed by a hand's width or by half the room. */
const needsDeg = (span: number, d: number) => 2 * (Math.atan(span / (2 * d)) * 180) / Math.PI;

const f2 = (n: number) => (Object.is(n, -0) ? 0 : n).toFixed(2);

describe('where the lens stands', () => {
  const presets = shippedPresets();

  it('reads the shipped presets out of the picker', () => {
    // The premise. A regex that matched nothing would make every row below vacuous, and
    // an empty sweep is the failure this repo keeps finding: not a broken check, one that
    // ran and reported on nothing.
    expect(presets.map((p) => p.id)).toEqual(['rect', 'l', 't', 'u', 'open']);
    for (const p of presets) {
      expect(p.width).toBeGreaterThan(3);
      expect(p.depth).toBeGreaterThan(3);
    }
  });

  it('prints what each candidate standpoint can photograph', () => {
    const out: string[] = [
      '\nwhere the lens stands · five candidate standpoints × the five shipped presets',
      '  preset             rule            stand           slot  ahead    span  needs   clear  66°  106°',
    ];
    for (const p of presets) {
      const poly = footprintForLayout(p.id, p.width, p.depth);
      for (const { rule, stand } of candidates(poly)) {
        for (const slot of SLOT_ORDER) {
          const frame = stand ? framedWallFrom(stand, slot, poly) : null;
          const span = frame ? frame.right - frame.left : NaN;
          const clear = stand ? distanceToFootprintEdge(stand[0], stand[1], poly) : NaN;
          out.push(
            '  ' +
              `${p.name} ${p.width}×${p.depth}`.padEnd(19) +
              rule.padEnd(16) +
              (stand ? `(${f2(stand[0])}, ${f2(stand[1])})` : '—').padEnd(16) +
              slot.padEnd(6) +
              (frame ? `${f2(frame.distance)}m`.padStart(7) : 'NONE'.padStart(7)) +
              (frame ? `${f2(span)}`.padStart(6) : ''.padStart(6)) +
              (frame ? `${needsDeg(span, frame.distance).toFixed(0)}°`.padStart(7) : ''.padStart(7)) +
              `${f2(clear)}`.padStart(7) +
              (frame ? (frames(span, frame.distance, NARROW) ? '  yes' : '   NO') : '    —') +
              (frame ? (frames(span, frame.distance, WIDE) ? '  yes' : '   NO') : '    —'),
          );
        }
      }
    }
    console.log(out.join('\n'));
    // Two header lines plus one row per (preset, candidate, slot). Asserted as the
    // PRODUCT rather than as `> 1`, which the first version said and which passes on a
    // table of nothing but its own headings — the same toothless shape as a coverage
    // counter written `> 0`, and it did pass that way for one run while the preset regex
    // was matching nothing at all.
    expect(out.length).toBe(2 + presets.length * candidates(footprintForLayout('rect', 4, 3)).length * SLOT_ORDER.length);
  });

  /** How many of a preset's four views have a wall in front of the lens at all. This is
   *  the HARD requirement and the only one: a slot with no wall ahead cannot be measured
   *  by anything downstream — both floor-line solvers return null, `placeWallObject`
   *  refuses, and the floor and ceiling bounds go inert. Whether the wall also FITS in
   *  frame is a different question and deliberately not a gate; see the framing test. */
  const aheadCount = (poly: Footprint, stand: Stand | null) =>
    stand ? SLOT_ORDER.filter((slot) => framedWallFrom(stand, slot, poly) !== null).length : 0;

  it('today the lens has no wall ahead of it in a U-Shape, and every other preset is fine', () => {
    // The defect, pinned as a count rather than described. 19 of the presets' 20 walls
    // are photographable from the origin; the twentieth is the `u`'s north view, where
    // the notch's inner face sits at exactly z = 0 and the rig stands the lens ON it.
    const perPreset = presets.map((p) => aheadCount(footprintForLayout(p.id, p.width, p.depth), [0, 0]));
    expect(perPreset).toEqual([4, 4, 4, 3, 4]);
    expect(perPreset.reduce((a, b) => a + b)).toBe(19);
    // And the standpoint's own clearance from the nearest wall is exactly zero there,
    // which is the whole defect in one number: the lens is not near a wall, it is on one.
    const u = footprintForLayout('u', 6, 5);
    expect(distanceToFootprintEdge(0, 0, u)).toBe(0);
  });

  it('the largest bay is the standpoint, and the table above is why', () => {
    // THE DECISION, recorded executably. Three requirements, in order of how much they
    // matter, and only one rule meets all three.
    for (const p of presets) {
      const poly = footprintForLayout(p.id, p.width, p.depth);
      const bay = roomBays(poly)[0];
      expect(bay).toBeDefined();
      const stand: Stand = [bay.cx, bay.cz];

      // 1. Every view has a wall ahead of it — 20 of 20, where the origin manages 19.
      expect(aheadCount(poly, stand)).toBe(4);

      // 2. On the room's own symmetry axis. All five presets are symmetric about x = 0
      //    (`footprintForLayout` authors them that way), and the capture flow asks a
      //    person to stand in one place and turn — so a standpoint off that axis would
      //    make two opposite walls unequal distances for no reason the room gives.
      expect(Math.abs(stand[0])).toBe(0);
    }

    // 3. EXACTLY the origin on a centred rectangle — an equality, not a tolerance,
    //    because it is what keeps `detect-pipeline`'s and `off-square-cost`'s baseline
    //    tables byte-identical when the standpoint replaces the hard-coded origin. A
    //    rule that were merely near-zero here would move every number in the repo and
    //    leave nothing able to prove which change had moved it.
    for (const [w, d] of [[6, 4], [7.5, 5.6], [3, 3], [12, 2]] as const) {
      const bay = roomBays(footprintForLayout('rect', w, d))[0];
      expect(Math.abs(bay.cx)).toBe(0);
      expect(Math.abs(bay.cz)).toBe(0);
    }
  });

  it('and the two rules that lost, so neither is re-proposed', () => {
    // Both are named in § 44b's filed note as candidates, so the reason each lost is a
    // measurement rather than a preference — and each is a number this file prints.

    // THE POLE OF INACCESSIBILITY is degenerate on a rectangle. The farthest-from-any-wall
    // point in a 6 × 4 room is the whole centre LINE x ∈ [−1, 1] at z = 0, every point of
    // it exactly 2.0 m from the nearest wall, so the answer is whichever cell a grid scan
    // reaches first. Measured: it lands off-centre, which fails requirement 3 outright and
    // makes the rule's answer an artifact of its own step size.
    const rect = footprintForLayout('rect', 6, 4);
    const pole = poleOfInaccessibility(rect)!;
    expect(distanceToFootprintEdge(pole[0], pole[1], rect)).toBeCloseTo(2.0, 6);
    expect(Math.abs(pole[0])).toBeGreaterThan(0.5); // NOT the centre of the room
    expect(distanceToFootprintEdge(0, 0, rect)).toBeCloseTo(2.0, 6); // the plateau

    // THE AREA CENTROID is inside every preset — that is what `interiorPoint` uses it for
    // and it is right about that — but "inside" is not the question. On a `u` it stands
    // 0.35 m from the notch's inner face: a wall you cannot photograph, needing a 150°
    // lens to frame 2.64 m of it, where the largest bay stands 1.25 m back and needs 93°.
    const u = footprintForLayout('u', 6, 5);
    const [ax, az] = polyAreaCentroid(u as unknown as Poly);
    const centroidFrame = framedWallFrom([ax, az], 'n', u)!;
    const bayFrame = framedWallFrom([roomBays(u)[0].cx, roomBays(u)[0].cz], 'n', u)!;
    expect(centroidFrame.distance).toBeCloseTo(0.35, 2);
    expect(bayFrame.distance).toBeCloseTo(1.25, 2);
    expect(needsDeg(centroidFrame.right - centroidFrame.left, centroidFrame.distance)).toBeGreaterThan(140);
    expect(needsDeg(bayFrame.right - bayFrame.left, bayFrame.distance)).toBeLessThan(100);
  });

  it('no standpoint can frame a shipped room corner to corner, which is about the COPY', () => {
    // Found by this table rather than looked for, and it is not a fact about non-convex
    // rooms: `lib/capture.ts` tells a person to "frame it corner to corner" from the
    // middle of the room, and in the app's own default Rectangle that instruction is
    // arithmetically impossible. A 6 m wall seen from 2 m needs a 113° lens; the assumed
    // default is 66° and a phone's main camera is nearer 78°. So the promise the copy
    // makes is one the room cannot keep, on the flow's very first shot.
    const rect = footprintForLayout('rect', 6, 4);
    const north = framedWallFrom([0, 0], 'n', rect)!;
    expect(north.right - north.left).toBeCloseTo(6, 9);
    expect(north.distance).toBeCloseTo(2, 9);
    expect(needsDeg(6, 2)).toBeCloseTo(112.6, 1);
    expect(frames(6, 2, NARROW)).toBe(false);
    expect(frames(6, 2, WIDE)).toBe(false);
    // Filed rather than fixed here: it is a copy question, and the standpoint change is
    // what makes it answerable, because the instruction and the geometry finally name the
    // same spot. See `docs/what-is-still-open.md`.
  });
});
