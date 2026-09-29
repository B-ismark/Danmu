// The soft half of "is this the same piece?" — rows that could be one piece seen
// from two walls, or read twice from one photo, start unticked and say why.
//
// Two kinds of fixture, for two kinds of claim. The rule tests below hand
// `findRepeats` rows that already carry a position, so each one isolates a single
// decision (plane, box contact, height, rank) without a camera in the way. The
// known-room tests at the bottom run the real pipeline over projected boxes, because
// the defect this module answers — five beds — came from what the placers do to a
// box cut off by the edge of the frame, and a hand-written position cannot express
// that.
//
// Floor pieces are compared as the circle they could turn within (a photo never
// measures a floor piece's heading), so the distances below are disc distances:
// two 1 m discs share a quarter of their floor about 0.64 m apart, not 0.75.
//
// The lens tests after the known room are the half the others cannot reach. Most
// phones write no focal length, so a photo's lens is assumed, and an ultrawide
// measured as a 66° lens puts one piece seen from two walls in two places. Those
// tests run one kind of furniture at a time, each with a control that compares the
// same rows where they were measured, to show the fixture really does double it.
// Then the one case where the lens is not the doubt: a piece the side of its photo
// cut off, which is reached round on a measured lens too. The last block is
// the population: 150 rooms from `tests/helpers/furnished-rooms.ts`, printed on
// every green run and held as literals, because the sweep's price is a rate and a
// hand-built fixture cannot measure a rate.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { geoRefine, refineDetections, type CalMap } from '@/lib/detect-refine';
import { findRepeats, keptAtFirst, REPEAT_SHARE, sameButColor, sweptSolids, SWEPT_HFOV_DEG } from '@/lib/repeat-sightings';
import { footArea, footFromPart, footIntersectionArea } from '@/lib/geometry';
import {
  atLens,
  calFromHfov,
  calibrateFromFloorLine,
  fitHeightToFloorLine,
  PLAUSIBLE_HFOV_DEG,
  wallFrame,
  type CameraCal,
  type LensSource,
} from '@/lib/photo-geometry';
import { startingSpot } from '@/lib/scene-spec';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot } from '@/lib/storage';
import { framedBoxFor, CAL, CALS, refinedOnly, ROOM, shots, squareOn, TRUTH, type Truth } from './helpers/known-room';
import { boxIn, furnishedRoom, SWEEP_SLOTS } from './helpers/furnished-rooms';
import { project, type Box } from './helpers/project';

type Row = Partial<Detection> & Pick<Detection, 'category'>;

/** A row the geometry has already placed. Defaults are a local-detector bed-sized
 *  box in the middle of the north photo; each test overrides what it is about. */
function row(r: Row): Detection {
  return {
    label: r.category,
    conf: 0.9,
    source: 'local',
    box: [0.3, 0.4, 0.4, 0.3],
    slot: 'n',
    shape: r.category,
    position: { x: 0, y: 0, z: 0 },
    dimMM: [1000, 1000, 500],
    yaw: 0,
    ...r,
  };
}

/** The rule tests' room: the known room, so a row is compared where the room will
 *  build it — which, for a row that carries a position, is that position. No lens:
 *  with one, a row from another photo would be re-measured from its box at every
 *  lens a phone could have, and the hand-written position would stop being the
 *  thing under test. */
function repeats(dets: Detection[], keep: boolean[] = []): (number | null)[] {
  return findRepeats(dets, keep, ROOM, {});
}

/** How far apart two 1 m floor discs stand when they share `share` of their floor —
 *  solved against the geometry's own intersection, so the threshold test below
 *  asks about the threshold and not about how a circle is polygonised. */
function gapFor(share: number): number {
  const disc = (x: number) => footFromPart([x, 0, 0], 0, [1000, 1000, 500], true);
  const at = (x: number) => footIntersectionArea(disc(0), disc(x)) / footArea(disc(0));
  let near = 0;
  let far = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (near + far) / 2;
    if (at(mid) > share) near = mid;
    else far = mid;
  }
  return (near + far) / 2;
}

/** Two 1 × 1 m floor pieces whose footprints share `share` of either one, by
 *  sliding the second along x. Each photo's box is kept apart so the pair is only
 *  a candidate because the photos differ. */
function slid(share: number, a: Row = { category: 'table' }, b: Row = { category: 'table' }): Detection[] {
  return [
    row({ ...a, slot: 'n' }),
    row({ ...b, slot: 'e', position: { x: gapFor(share), y: 0, z: 0 } }),
  ];
}

describe('findRepeats — what counts as the same piece', () => {
  it('flags a second sighting that shares a quarter of the floor, and not one that shares less', () => {
    expect(repeats(slid(REPEAT_SHARE + 0.01))).toEqual([null, 0]);
    expect(repeats(slid(REPEAT_SHARE - 0.01))).toEqual([null, null]);
  });

  it('measures the share over the SMALLER piece, so a small estimate inside a big one is a repeat', () => {
    // A 0.5 m table wholly inside the 2 m circle a long table could turn within:
    // all of the small one, a sixteenth of the union.
    const dets = [
      row({ category: 'table', dimMM: [2000, 1000, 750] }),
      row({ category: 'table', slot: 'e', dimMM: [500, 500, 750], box: [0.1, 0.4, 0.1, 0.1] }),
    ];
    expect(repeats(dets)).toEqual([null, 0]);
  });

  it('never calls two different kinds of thing one piece', () => {
    expect(repeats(slid(0.9, { category: 'table' }, { category: 'desk' }))).toEqual([null, null]);
  });

  it('never calls a pendant one piece with the floor lamp under it', () => {
    // Same category, same spot in plan; one is measured on the ceiling.
    const dets = [
      row({ category: 'lamp', shape: 'lamp-floor', dimMM: [400, 400, 1600] }),
      row({ category: 'lamp', shape: 'lamp-pendant', slot: 'e', position: { x: 0, y: 2.7, z: 0 }, dimMM: [400, 400, 300] }),
    ];
    expect(repeats(dets)).toEqual([null, null]);
  });

  it('reads a height only off a position the room took', () => {
    // A cloud row that put the print outside the room: the room builds it on its
    // photo's wall instead, at that wall's default height, and it is compared THERE.
    // Its own 1.2 m went with the place it described, or it would hang one print
    // below the other at the one spot the room gives them both.
    const box: Box = [0.6, 0.3, 0.1, 0.1];
    const dimMM: [number, number, number] = [700, 40, 500];
    const spot = startingSpot('n', box, dimMM, true, 'painting', undefined, undefined, ROOM);
    const [x, y, z] = spot.pos;
    const refused = row({ category: 'painting', box, dimMM, position: { x: 0, y: 1.2, z: -9 } });
    const seen = row({ category: 'painting', slot: 'e', dimMM, position: { x, y, z }, yaw: spot.rot });
    expect(y).toBeGreaterThan(1.2 + 0.5);
    expect(repeats([refused, seen])).toEqual([1, null]);
    // Inside the room it is the row's own place, and its own height with it.
    expect(repeats([{ ...refused, position: { x, y: 1.2, z } }, seen])).toEqual([null, null]);
  });

  it('keeps two wall pieces apart when one hangs above the other', () => {
    const at = (y: number, slot: CaptureSlot): Detection =>
      row({ category: 'painting', slot, position: { x: 0, y, z: -2.98 }, dimMM: [700, 40, 500] });
    // 1.25–1.75 against 1.85–2.35: the same stretch of wall, no height in common.
    expect(repeats([at(1.5, 'n'), at(2.1, 'e')])).toEqual([null, null]);
    // 1.25–1.75 against 1.35–1.85: most of the same frame.
    expect(repeats([at(1.5, 'n'), at(1.6, 'e')])).toEqual([null, 0]);
  });

  it('compares a wall row the cloud gave no height at the height the room starts it', () => {
    // Nothing validates the cloud's JSON, so a place can arrive with no `y`. Read as
    // it stood that was NaN, which overlaps nothing, and the same print read twice
    // was two prints.
    const noHeight = (slot: CaptureSlot, y?: unknown): Detection =>
      row({ category: 'painting', slot, position: { x: 0, z: -2.98, ...(y === undefined ? {} : { y }) } as Detection['position'], dimMM: [700, 40, 500] });
    expect(repeats([noHeight('n'), noHeight('e')])).toEqual([null, 0]);
    expect(repeats([noHeight('n', '1.5'), noHeight('e', null)])).toEqual([null, 0]);
  });

  it('keeps a curtain on the wall whatever shape the detector gave it', () => {
    // The same curtain read twice, once with a ceiling shape. It is cloth on a wall
    // either way — the split `geoRefine` measures it by — so the two are one piece.
    const curtain = (shape: string, slot: CaptureSlot): Detection =>
      row({ category: 'curtain', shape, slot, position: { x: 0, y: 1.4, z: -2.9 }, dimMM: [1400, 100, 2400] });
    expect(repeats([curtain('curtain', 'n'), curtain('lamp-pendant', 'e')])).toEqual([null, 0]);
  });

  it('reads "something else" by its word, because the category is a bucket', () => {
    const other = (label: string) => ({ category: 'other' as const, shape: 'box', label });
    expect(repeats(slid(0.9, other('stool'), other('basket')))).toEqual([null, null]);
    expect(repeats(slid(0.9, other('stool'), other('Stool')))).toEqual([null, 0]);
  });

  it('while the room is still loading, leaves a row with no position as a piece in its own right', () => {
    const dets = slid(0.9);
    // Placed rows need no room: they are compared where they were measured.
    expect(findRepeats(dets, [], null, {})).toEqual([null, 0]);
    delete dets[1].position;
    expect(findRepeats(dets, [], null, {})).toEqual([null, null]);
  });
});

describe('findRepeats — a row the camera could not place', () => {
  // A bed cut off by the bottom of the frame is often refused a position, and it
  // still becomes a piece: at the spot on its photo's wall under the middle of its
  // box. Two of those in one place are two beds in one place.
  const unplaced = (box: Box): Detection => row({ category: 'bed', box, position: undefined, yaw: undefined });

  it('compares it where the room will build it', () => {
    const dets = [unplaced([0.3, 0.5, 0.4, 0.3]), unplaced([0.33, 0.5, 0.34, 0.3])];
    expect(repeats(dets)).toEqual([null, 0]);
    // No room, no starting spot, nothing to compare.
    expect(findRepeats(dets, [], null, {})).toEqual([null, null]);
  });

  it('flags it against a placed sighting standing on that spot, and not one across the room', () => {
    const box: Box = [0.3, 0.5, 0.4, 0.3];
    const dims: [number, number, number] = [1000, 1000, 500];
    const spot = startingSpot('n', box, dims, false, 'bed-double', undefined, undefined, ROOM).pos;
    const placed = (x: number, z: number) =>
      row({ category: 'bed', slot: 'e', box: [0.1, 0.4, 0.2, 0.2], position: { x, y: 0, z } });
    expect(repeats([unplaced(box), placed(spot[0], spot[2])])).toEqual([null, 0]);
    expect(repeats([unplaced(box), placed(-spot[0] - 2, -spot[2])])).toEqual([null, null]);
  });
});

describe('findRepeats — one photo, read more than once', () => {
  // Twin beds side by side, measured so badly their footprints overlap. The photo
  // drew a gap between them, and a gap in the picture is a fact.
  // Box edges are sums a float can hold exactly (0.25 + 0.25 = 0.5), so "touching"
  // below means touching and not 1e-17 apart.
  const twin = (boxB: Box): Detection[] => [
    row({ category: 'bed', box: [0.25, 0.4, 0.25, 0.3] }),
    row({ category: 'bed', position: { x: 0.3, y: 0, z: 0 }, box: boxB }),
  ];

  it('never merges two boxes the photo drew apart', () => {
    expect(repeats(twin([0.625, 0.4, 0.25, 0.3]))).toEqual([null, null]);
  });

  it('does not count boxes that only touch at an edge', () => {
    expect(repeats(twin([0.5, 0.4, 0.25, 0.3]))).toEqual([null, null]);
  });

  it('flags a second box drawn round the same piece in the same photo', () => {
    // A second model boxing the mattress where the first boxed the whole bed:
    // overlapping, but under the hard merge's 0.5 IoU. The whole-bed box is the
    // bigger one, so it is the piece.
    expect(repeats(twin([0.3, 0.5, 0.15, 0.2]))).toEqual([null, 0]);
  });
});

describe('findRepeats — which sighting is THE piece', () => {
  it('never flags a row the user drew', () => {
    const drawn = { category: 'table' as const, source: 'manual' as const, conf: 1 };
    expect(repeats(slid(0.9, drawn, drawn))).toEqual([null, null]);
  });

  it("makes the user's row the piece, over a sighting that would be kept", () => {
    const dets = slid(0.9, { category: 'table' }, { category: 'table', source: 'manual', conf: 1 });
    expect(repeats(dets, [true, true])).toEqual([1, null]);
  });

  it('makes a kept sighting the piece, so a repeat never leaves the room with none', () => {
    // The unkept row is unclipped and bigger — it wins every later tie-break.
    const dets = slid(0.9, { category: 'table', box: [0.2, 0.2, 0.5, 0.5] }, { category: 'table', box: [0, 0.4, 0.2, 0.2] });
    expect(repeats(dets, [false, true])).toEqual([1, null]);
    expect(keptAtFirst(dets, [false, true], ROOM, {})).toEqual(new Set([1]));
  });

  it('prefers the sighting the frame did not cut off', () => {
    const dets = slid(0.9, { category: 'table', box: [0, 0.2, 0.6, 0.6] }, { category: 'table', box: [0.4, 0.4, 0.2, 0.2] });
    expect(repeats(dets)).toEqual([1, null]);
  });

  it('prefers the bigger box when neither is cut off', () => {
    const dets = slid(0.9, { category: 'table', box: [0.4, 0.4, 0.2, 0.2] }, { category: 'table', box: [0.2, 0.2, 0.5, 0.5] });
    expect(repeats(dets)).toEqual([1, null]);
  });

  it('falls back to list order', () => {
    expect(repeats(slid(0.9))).toEqual([null, 0]);
  });

  it('files a sighting under the piece it shares the most with', () => {
    // Two tables a metre apart, drawn apart in one photo; the third row, from
    // another photo, overlaps both — the second more (0.45 m off it against 0.55).
    const dets = [
      row({ category: 'table', slot: 'n', position: { x: 0, y: 0, z: 0 } }),
      row({ category: 'table', slot: 'n', position: { x: 1.0, y: 0, z: 0 }, box: [0.75, 0.4, 0.2, 0.3] }),
      row({ category: 'table', slot: 'e', position: { x: 0.55, y: 0, z: 0 }, box: [0.1, 0.1, 0.2, 0.2] }),
    ];
    expect(repeats(dets)).toEqual([null, null, 1]);
  });

  it('does not chain: a sighting like a repeat but not like its piece is a piece', () => {
    // Three chairs in a row, each overlapping the next by measurement error, must
    // not collapse into one chair.
    const chair = (x: number, slot: CaptureSlot, box: Box) =>
      row({ category: 'chair', slot, position: { x, y: 0, z: 0 }, dimMM: [500, 500, 900], box });
    const dets = [
      chair(0, 'n', [0.4, 0.4, 0.3, 0.3]),
      chair(0.3, 'e', [0.4, 0.4, 0.2, 0.2]),
      chair(0.6, 's', [0.4, 0.4, 0.1, 0.1]),
    ];
    expect(repeats(dets)).toEqual([null, 0, null]);
  });
});

describe('keptAtFirst', () => {
  it('ticks what would be kept, minus its repeats', () => {
    const dets = [...slid(0.9), row({ category: 'sofa', slot: 's', position: { x: 3, y: 0, z: 0 } })];
    expect(keptAtFirst(dets, [true, true, true], ROOM, {})).toEqual(new Set([0, 2]));
    expect(keptAtFirst(dets, [true, true, false], ROOM, {})).toEqual(new Set([0]));
  });
});

// ── The known room ────────────────────────────────────────────────────────────

/** What a real detector hands back for a piece that runs out of the picture: the
 *  part it can see, from its outline (§ 49.16). A piece every photo it is filed
 *  under does not show at all is a fixture error, not a sighting. */
function framed(t: Truth, slot: CaptureSlot, shot: CameraCal): Box {
  const b = framedBoxFor(t, slot, shot);
  if (!b) throw new Error(`${t.name} is not in the photo of ${slot}`);
  return b;
}

/** Clip a box to the frame — for a box grown past the edge, like `taller`'s. */
function inPicture(b: Box): Box {
  const x0 = Math.max(0, b[0]);
  const y0 = Math.max(0, b[1]);
  const x1 = Math.min(1, b[0] + b[2]);
  const y1 = Math.min(1, b[1] + b[3]);
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Grow a box upward until it is `f` times as tall — a second model's box round the
 *  same bed that takes in the headboard and the wall behind it. */
function taller(b: Box, f: number): Box {
  const [x, y, w, h] = b;
  return inPicture([x, y - h * (f - 1), w, h * f]);
}

/** Every sighting of `t`, each photo read twice: once as `label`, and once by a
 *  second model that calls it `second` and draws the taller box — photographed on
 *  `shot`, the lens the phone really had. `grow: false` keeps the second box the
 *  same, for a piece with no height for a second model to take in. */
function readTwice(t: Truth, second: string, { shot = CAL, grow = true }: { shot?: CameraCal; grow?: boolean } = {}): Detection[] {
  return t.slots.flatMap((slot) => {
    const seen = framed(t, slot, shot);
    const unplaced = { slot, shape: undefined, position: undefined, dimMM: undefined, yaw: undefined };
    return [
      row({ category: t.category, label: t.label, box: seen, ...unplaced }),
      row({ category: t.category, label: second, box: grow ? taller(seen, 2.2) : seen, ...unplaced }),
    ];
  });
}

describe('the known room', () => {
  it('flags nothing in a room where every piece was already found once', () => {
    // Eleven pieces, including two identical bedside tables a hand's width apart and
    // a lamp in two photos that the hard merge already took. Every one is a piece.
    const refined = refinedOnly(squareOn(CAL), CALS);
    expect(refined).toHaveLength(TRUTH.length);
    expect(findRepeats(refined, refined.map(() => true), ROOM, CALS)).toEqual(refined.map(() => null));
  });

  it('flags the lamp when its second photo calls it something else', () => {
    const renamed = refineDetections(
      shots(squareOn(CAL)).map(({ det }) =>
        det.label === 'floor lamp' && det.slot === 'e' ? { ...det, label: 'standing lamp' } : det,
      ),
      CALS,
      ROOM,
    );
    const lamps = renamed.map((d, i) => ({ d, i })).filter(({ d }) => d.category === 'lamp');
    // The word test keeps both rows through the hard merge…
    expect(lamps).toHaveLength(2);
    // …and the floor says they are one lamp.
    const flagged = findRepeats(renamed, renamed.map(() => true), ROOM, CALS);
    expect(lamps.filter(({ i }) => flagged[i] !== null)).toHaveLength(1);
  });

  it('keeps ONE bed out of a bed read twice in each of two photos', () => {
    // The report this module exists for. A double bed in the north-east quadrant,
    // too big for either photo: the north one cuts off its foot, the east one its
    // side. Each photo is read by two models, and the second calls it a double bed
    // and draws a taller box — under the hard merge's overlap bar, and a different
    // word from the first. Every row clears the confidence bar.
    const bed: Truth = {
      name: 'bed', label: 'bed', category: 'bed', shape: 'bed-double',
      x: 1.5, z: -1.5, dimMM: [1600, 2000, 500], slots: ['n', 'e'],
    };
    const refined = refineDetections(readTwice(bed, 'double bed'), CALS, ROOM);
    // The hard merge alone leaves several beds, every one of them kept.
    expect(refined.length).toBeGreaterThan(2);
    expect(keptAtFirst(refined, refined.map(() => true), ROOM, CALS).size).toBe(1);
  });

  it('keeps ONE ceiling light out of one read in two photos, though no photo named its shape', () => {
    // The on-device detector hands over a category and a word and almost never a
    // shape, and a ceiling light is a LAMP by category: it is the word that makes it
    // a pendant, and the room builds the pendant. Measured as the shape-less lamp
    // instead, each sighting was a floor piece above the horizon, refused, and then
    // hung by the wall of whichever photo saw it — one light per photo.
    const light: Truth = {
      name: 'light', label: 'ceiling light', category: 'lamp', shape: 'lamp-pendant',
      x: 1.5, z: -1.5, dimMM: [500, 500, 300], slots: ['n', 'e'],
    };
    // The east photo read only by the second model, under the second word, so no rule
    // of the hard merge joins the two photos and it is this check's to take. Read
    // twice in both, the east photo's own double box now joins the group its first
    // box did, and the hard merge takes the lot — asserted below, since that is the
    // fixture this test used to be.
    const [nLabel, nSecond] = readTwice({ ...light, slots: ['n'] }, 'pendant light');
    const [, eSecond] = readTwice({ ...light, slots: ['e'] }, 'pendant light');
    const refined = refineDetections([nLabel, nSecond, eSecond], CALS, ROOM);
    // Every sighting measured, and measured up at the ceiling.
    expect(refined.length).toBeGreaterThan(1);
    for (const d of refined) expect(d.position?.y, d.label).toBeGreaterThan(ROOM.height - 0.5);
    expect(keptAtFirst(refined, refined.map(() => true), ROOM, CALS).size).toBe(1);
    expect(refineDetections(readTwice(light, 'pendant light'), CALS, ROOM)).toHaveLength(1);
  });

  it('keeps TWO beds out of twin singles read twice in one photo', () => {
    // The pair the soft merge must not take: two single beds a hand's width apart
    // against the north wall. Their boxes never meet in the picture, and that gap is
    // what keeps them two, however their floor estimates overlap.
    const single = (x: number): Truth => ({
      name: `single ${x}`, label: 'bed', category: 'bed', shape: 'bed-single',
      x, z: -2.05, dimMM: [900, 1900, 450], slots: ['n'],
    });
    const refined = refineDetections([single(-0.6), single(0.6)].flatMap((t) => readTwice(t, 'single bed')), CALS, ROOM);
    expect(refined.length).toBeGreaterThan(2);
    expect(keptAtFirst(refined, refined.map(() => true), ROOM, CALS).size).toBe(2);
  });

  it('still loses the second of twin beds in a corner, before this runs — § 46.1, filed', () => {
    // The same pair in the north-east corner, seen from the north and the east. Held
    // as the defect, in literals, because both earlier readings of it came from probes
    // nobody kept and both were wrong about which bed was left.
    const single = (x: number): Truth => ({
      name: `single ${x}`, label: 'bed', category: 'bed', shape: 'bed-single',
      x, z: -2.05, dimMM: [900, 1900, 450], slots: ['n', 'e'],
    });
    // The lens the phone wrote down changes nothing: the hard merge takes both doors either way.
    // WHICH bed is left is the survivor the merge keeps, and a sighting the frame did not
    // cut outranks one it did (`survivorRank`): at 1.9 and 3.0 the first bed's east view
    // is cut by the photo's side and the second bed's is whole, so the second is kept and
    // the FIRST is the one gone. Before that rank the first bed's cut view was kept.
    for (const cals of [CALS, every(lens(106, 'measured'))]) {
      const first = readTwice(single(1.9), 'single bed');
      const second = readTwice(single(3.0), 'single bed');
      const refined = refineDetections([...first, ...second], cals, ROOM);
      expect(refined).toHaveLength(4);
      // Every row left is a sighting of one bed: the other is not unticked, it is gone.
      for (const d of refined) expect(second.map((f) => f.box)).toContainEqual(d.box);
      expect(keptAtFirst(refined, refined.map(() => true), ROOM, cals).size).toBe(1);
    }
  });

  it('keeps both of twin beds at 1.7 and 2.8, once the fixture boxes only what the photo shows — § 49.16', () => {
    // The same pair a little further west. This lost the first bed too, and was held
    // beside the pair above as the same defect, while the fixture boxed each bed's
    // whole box clipped to the frame — extent the photo never showed. Boxed from the
    // outline inside the frame, as a detector draws it, the two beds stay two on
    // either lens, so this half of § 46.1 was the fixture's.
    const single = (x: number): Truth => ({
      name: `single ${x}`, label: 'bed', category: 'bed', shape: 'bed-single',
      x, z: -2.05, dimMM: [900, 1900, 450], slots: ['n', 'e'],
    });
    for (const cals of [CALS, every(lens(106, 'measured'))]) {
      const first = readTwice(single(1.7), 'single bed');
      const second = readTwice(single(2.8), 'single bed');
      const refined = refineDetections([...first, ...second], cals, ROOM);
      const of = (bed: Detection[], d: Detection) => bed.some((f) => f.box === d.box);
      const whose = refined.map((d) => (of(first, d) ? 'first' : of(second, d) ? 'second' : 'neither'));
      expect(whose).toEqual(['first', 'first', 'first', 'first', 'second', 'second']);
      expect(keptAtFirst(refined, refined.map(() => true), ROOM, cals).size).toBe(2);
    }
  });
});

// ── A lens nobody measured ────────────────────────────────────────────────────

/** A camera `deg` wide, on a phone that did or did not write its focal length. */
const lens = (deg: number, src?: LensSource): CameraCal => ({
  k: 2 * Math.tan(((deg / 2) * Math.PI) / 180),
  aspect: 4 / 3,
  ...(src ? { lens: src } : {}),
});
const every = (c: CameraCal): CalMap => ({ n: c, e: c, s: c, w: c });
/** How many places the bookshelf below could stand, reaching round its cut side: its
 *  own place at a typical bookshelf's width, and 32 longer boxes. It was 34 while the
 *  fixture boxed extent the photo never showed (§ 49.16): the cut box was a little
 *  taller than the photo's, so one more width stood as a bookshelf. */
const REACHED = 33;

/** `t` as a detector sees it in the photo of `slot` taken on `shot`: a box and a
 *  word, nothing the geometry has not measured yet. */
function seen(t: Truth, slot: CaptureSlot, shot: CameraCal, label = t.label): Detection {
  return row({
    label,
    category: t.category,
    box: framed(t, slot, shot),
    slot,
    shape: undefined,
    position: undefined,
    dimMM: undefined,
    yaw: undefined,
  });
}

/** How many pieces start ticked when the photos are read on `cals` and compared on
 *  `compare` — `{}` to compare every row where it was measured, the rule unswept. */
function keptWith(dets: Detection[], cals: CalMap, compare: CalMap = cals): number {
  const refined = refineDetections(dets, cals, ROOM);
  return keptAtFirst(refined, refined.map(() => true), ROOM, compare).size;
}

const piece = (
  name: string,
  category: Truth['category'],
  shape: Truth['shape'],
  x: number,
  z: number,
  dimMM: [number, number, number],
  y?: number,
): Truth => ({ name, label: name, category, shape, x, z, y, dimMM, slots: ['n', 'e'] });

describe('findRepeats — a lens nobody measured', () => {
  // Every photo here is taken on the known room's 106° ultrawide and read by a phone
  // that wrote no focal length, so the geometry assumes 66°. Measured at the wrong
  // lens, one piece seen from two walls lands in two places — far enough apart that
  // the floor says two pieces — and the room gets one of each. What the photos DO
  // agree on is the lens: at the one they were really taken on, the two sightings
  // stand on the same floor. So a pair from different photos is compared at every
  // lens a phone could have, and the best agreement is the answer.
  //
  // Each kind is read twice per photo, the second time under another word and a
  // taller box, so the hard merge leaves the pair across photos to this rule. (A wall
  // piece's two readings from one photo can hang at one spot on its wall, and the
  // hard merge takes those — the TV and the curtain here — which still leaves one
  // row per photo for the sweep, as the control below shows.) The bookshelf is the one
  // kind the side of a photo cuts off at every spot in this corner, and a box that
  // stops at the frame is reached round rather than read as the piece — see the test
  // after the controls.
  //
  // The wall pieces sit near the north-east corner, which is the case they are here
  // for: on the 106° the east photo sees them on the RETURN wall, so at the true lens
  // that sighting is refused as a measurement and located where its line of sight
  // meets the north wall. At the assumed 66° the same sighting fits the east wall and
  // is measured there. The sweep re-asks the camera at every lens from the box alone,
  // and at the true one the two sightings hang on one stretch of the north wall.
  const KINDS: [Truth, string][] = [
    [piece('sofa', 'sofa', 'sofa', 1.8, -1.6, [2000, 850, 800]), 'couch'],
    [piece('wardrobe', 'wardrobe', 'wardrobe', 2.4, -2.65, [1200, 600, 2000]), 'closet'],
    [piece('armchair', 'chair', 'chair-armchair', 1.5, -1.5, [800, 800, 900]), 'arm chair'],
    [piece('rug', 'rug', 'rug', 1.5, -1.3, [2000, 1400, 5]), 'area rug'],
    [piece('coffee table', 'table', 'coffee-table', 1.2, -1.2, [1100, 600, 450]), 'table'],
    [piece('desk', 'desk', 'desk-standard', 2.2, -2.6, [1400, 700, 750]), 'table'],
    [piece('fridge', 'fridge', 'fridge', 3.1, -2.6, [700, 700, 1800]), 'refrigerator'],
    [piece('bookshelf', 'shelf', 'bookshelf', 2.5, -1.5, [900, 350, 1800]), 'bookcase'],
    [piece('plant', 'plant', 'plant', 2.5, -2.2, [400, 400, 900]), 'houseplant'],
    [piece('ottoman', 'ottoman', 'ottoman', 1.3, -1.4, [600, 600, 450]), 'pouf'],
    [piece('bed', 'bed', 'bed-double', 1.5, -1.5, [1600, 2000, 500]), 'double bed'],
    [piece('tv', 'tv', 'tv', 2.3, -3.0, [1200, 80, 700], 1.2), 'television'],
    [piece('painting', 'painting', 'painting', 2.5, -3.0, [700, 40, 500], 1.5), 'picture'],
    [piece('mirror', 'mirror', 'mirror', 2.8, -3.0, [600, 30, 1400], 1.2), 'wall mirror'],
    [piece('curtain', 'curtain', 'curtain', 2.2, -3.0, [1400, 80, 2300], 1.45), 'drapes'],
    [piece('pendant', 'lamp', 'lamp-pendant', 1.5, -1.5, [500, 500, 300]), 'ceiling light'],
    [piece('fan', 'fan', 'fan', 1.5, -1.5, [1000, 1000, 200]), 'ceiling fan'],
  ];

  it.each(KINDS)('keeps ONE %s seen from two walls on a lens the phone did not report', (t, second) => {
    // A rug has no height for a second model to take in, so its second box is the same.
    const dets = readTwice(t, second, { grow: t.category !== 'rug' });
    expect(dets).toHaveLength(4);
    expect(keptWith(dets, every(lens(66, 'assumed')))).toBe(1);
    // The same rows at the true lens: nothing for the sweep to find.
    expect(keptWith(dets, CALS)).toBe(1);
  });

  it.each(KINDS)('…where the fixture shows a %s the unswept rule would double', (t, second) => {
    // The same rows compared where the 66° put them, with no lens to sweep: every kind
    // comes back twice. That is the evidence the test above can fail. (Marking the 66°
    // measured used to be this control, and no longer is one: a sighting cut off by the
    // side of its photo is reached round on a measured lens too, so it would merge.)
    // The rug is the exception, and it is a regression check only: neither photo
    // places it, and two unplaced rugs are compared at their starting spots.
    const dets = readTwice(t, second, { grow: t.category !== 'rug' });
    expect(keptWith(dets, every(lens(66, 'assumed')), {})).toBe(t.category === 'rug' ? 1 : 2);
  });

  it('sweeps as wide as a phone lens goes', () => {
    // An armchair on a 120° shot needs the sweep's widest lens to come back together.
    const chair = piece('armchair', 'chair', 'chair-armchair', 2, -2, [800, 800, 900]);
    const dets = (['n', 'e'] as const).map((s) => seen(chair, s, lens(120)));
    expect(keptWith(dets, every(lens(66, 'assumed')))).toBe(1);
    expect(keptWith(dets, every(lens(66, 'measured')))).toBe(2);
    // The narrow end cannot be reached by behaviour: at 30–56° almost nothing in this
    // room is in two photos at all. So the sweep's own ends are pinned as literals —
    // and they are the bound the floor-line solve refuses a lens outside, so moving
    // one moves both.
    expect(PLAUSIBLE_HFOV_DEG).toEqual({ min: 30, max: 120 });
    expect([SWEPT_HFOV_DEG[0], SWEPT_HFOV_DEG[SWEPT_HFOV_DEG.length - 1], SWEPT_HFOV_DEG.length]).toEqual([30, 120, 46]);
  });

  it('asks a lens the camera could not place at for nothing, not for the assumed lens’s answer', () => {
    // A pendant halfway to the north wall, on the 106°. At the assumed 66° it is
    // placed, near the plaster. Every narrower lens puts it beyond the wall, and the
    // ceiling placer refuses — so at those lenses the sweep must have no place for it.
    // A sweep that re-asked from the refined row rather than from its box would be
    // handed the 66° answer back by every refusal and compare that instead.
    const pendant = piece('pendant', 'lamp', 'lamp-pendant', 1.5, -1.5, [500, 500, 300]);
    const cals = every(lens(66, 'assumed'));
    const [placed] = refineDetections([seen(pendant, 'n', CAL)], cals, ROOM);
    expect(placed.position).toBeDefined();
    const swept = sweptSolids(placed, ROOM, cals)!;
    const refused = SWEPT_HFOV_DEG.filter((_, i) => swept[i].length === 0);
    expect([refused[0], refused[refused.length - 1], refused.length]).toEqual([30, 64, 18]);
    expect(swept[SWEPT_HFOV_DEG.indexOf(66)]).toHaveLength(1);
    expect(swept[SWEPT_HFOV_DEG.indexOf(106)]).toHaveLength(1);
  });

  it('holds a photo whose lens was measured where it was measured', () => {
    // An armchair both photos see whole — a box the frame cut off is doubted on any
    // lens, which is the next test, and would hide what this one is about.
    const chair = piece('armchair', 'chair', 'chair-armchair', 1.5, -1.5, [800, 800, 900]);
    const dets = (['n', 'e'] as const).map((s) => seen(chair, s, CAL));
    const at = (cals: CalMap) => findRepeats(refineDetections(dets, cals, ROOM), [true, true], ROOM, cals);
    // Both lenses read off the photos: whatever they say is what the room is built on,
    // and two places is two armchairs.
    expect(at({ n: lens(66, 'measured'), e: lens(66, 'measured') })).toEqual([null, null]);
    expect(at({ n: lens(66, 'assumed'), e: lens(66, 'assumed') })).toEqual([null, 0]);
    // One of each: the assumed photo is swept against the measured one, held still —
    // whichever of the two photos it is.
    expect(at({ n: lens(66, 'assumed'), e: lens(106, 'measured') })).toEqual([null, 0]);
    expect(at({ n: lens(106, 'measured'), e: lens(66, 'assumed') })).toEqual([null, 0]);
  });

  it('reaches round a piece the side of its photo cut off, on a lens that was measured too', () => {
    // A bookshelf near the north-east corner, shot on the 106° by a phone that wrote
    // its focal length. The north photo cuts it off at the right, and that box is not
    // the piece: the camera reads the frame edge as the far corner, and the width comes
    // out below nothing. The placer keeps the edge the photo did see and gives the cut
    // width a bookshelf's typical size (`PieceFootprint.whole`), which stands it close
    // enough to the east photo's whole view for the hard merge to take the pair, the
    // whole sighting kept. Before that growth the north row was refused, built on the
    // north wall, and only the walk below could find it a second bookshelf.
    const shelf = piece('bookshelf', 'shelf', 'bookshelf', 2.5, -1.5, [900, 350, 1800]);
    const dets = (['n', 'e'] as const).map((s) => seen(shelf, s, CAL));
    const cals = every(lens(106, 'measured'));
    const refined = refineDetections(dets, cals, ROOM);
    expect(refined.map((d) => `${d.slot} ${d.position ? 'placed' : 'refused'}`)).toEqual(['e placed']);
    expect(keptWith(dets, cals, {})).toBe(1);
    // The cut sighting on its own, as it stands when the two photos use different words
    // and the hard merge never asks: placed, at the typical width, not the −79 mm one.
    const north = geoRefine(dets[0], cals, ROOM);
    expect(north.position).toBeDefined();
    expect(north.dimMM?.[0]).toBe(900);
    // The whole box is left alone, and the cut one is asked once: it is the box that is
    // short, not the lens that is wrong, so every lens gets the same answer.
    const [east] = refined;
    expect(sweptSolids(east, ROOM, cals)).toBeNull();
    const reach = sweptSolids(north, ROOM, cals)!;
    expect(reach).toHaveLength(SWEPT_HFOV_DEG.length);
    expect(reach.every((s) => s === reach[0])).toBe(true);
    expect(reach[0]).toHaveLength(REACHED);
    // …and only a piece a bookshelf's size. The same box with its top pulled down to a
    // quarter of its height, or pushed up to twice it, is no bookshelf at any width, so
    // nothing is reached: all that is left is the row's own place.
    const [x, y, w, h] = north.box;
    const squat = sweptSolids({ ...north, box: [x, y + 0.75 * h, w, 0.25 * h] }, ROOM, cals)!;
    const towering = sweptSolids({ ...north, box: [x, y - h, w, 2 * h] }, ROOM, cals)!;
    expect([squat[0].length, towering[0].length]).toEqual([1, 1]);
    // A row from the cloud detector arrives with its own guess at where the piece is and
    // how big. The box is measured, so the guess is replaced — and the walk re-asks the
    // camera from the box alone, so the guess reaches none of it either.
    const [guessed] = refineDetections(
      [{ ...dets[0], position: { x: 0, y: 0, z: 0 }, yaw: 0, dimMM: [900, 350, 1800] }],
      cals,
      ROOM,
    );
    expect(guessed.position).toEqual(north.position);
    expect(sweptSolids(guessed, ROOM, cals)![0]).toEqual(reach[0]);
  });

  it('never re-measures two rows from the same photo', () => {
    // Two dining chairs half a metre apart in one photo. One lens made both boxes, so
    // a lens that brought them together would be one the photo cannot have had.
    const chair = (label: string, x: number, z: number): Truth => ({
      name: label, label, category: 'chair', shape: 'chair-dining', x, z, dimMM: [450, 500, 900], slots: ['n'],
    });
    const dets = [seen(chair('dining chair', 0.3, -1.8), 'n', CAL), seen(chair('chair', 0.4, -2.3), 'n', CAL)];
    const refined = refineDetections(dets, CALS, ROOM);
    expect(refined).toHaveLength(2);
    expect(findRepeats(refined, [true, true], ROOM, CALS)).toEqual([null, null]);
  });

  it('pays for the sweep in chairs that happen to line up', () => {
    // The known cost, recorded so it is a number and not a surprise. Two dining chairs
    // 1.7 m apart, each seen once, from different walls, on a phone whose lens really
    // was 66°. Some lens a phone could have puts them on the same floor, and the sweep
    // cannot tell that from one chair read twice — so the second starts unticked and
    // one tap puts it back. If this ever comes back [null, null], the rule got better:
    // update the rate in `lib/repeat-sightings.ts`, which this is one instance of.
    const chair = (x: number, z: number, slot: CaptureSlot): Truth => ({
      name: 'dining chair', label: 'dining chair', category: 'chair', shape: 'chair-dining',
      x, z, dimMM: [450, 500, 900], slots: [slot],
    });
    const dets = [seen(chair(-2.35, 0.9, 'w'), 'w', lens(66)), seen(chair(-0.85, 1.7, 's'), 's', lens(66))];
    const refined = refineDetections(dets, every(lens(66)), ROOM);
    expect(findRepeats(refined, [true, true], ROOM, {})).toEqual([null, null]);
    expect(findRepeats(refined, [true, true], ROOM, every(lens(66)))).toEqual([null, 0]);
  });
});

// ── Furnished rooms by the hundred ────────────────────────────────────────────

type Tallied = Detection & { _t: number };
type Tally = { vis: number; multi: number; dup: number; lost: number };

describe('findRepeats — a hundred and fifty furnished rooms', () => {
  // The rate the doc block in `lib/repeat-sightings.ts` quotes, measured on the
  // generator in `tests/helpers/furnished-rooms.ts`. A piece is LOST when no row of
  // it starts ticked, and each extra ticked row of one piece is a DUPLICATE. The
  // three readings of the same rows are: unswept (no lens handed over), swept (the
  // lens the phone reported, assumed), and measured (the same lens marked measured).
  // Measured is unswept plus the one doubt a measured lens still leaves, a box the
  // side of its photo cut off; it takes duplicates the unswept reading leaves and
  // loses exactly the pieces that one loses — that is the gate, at scale.
  // GONE counts the pieces with no row at all once `refineDetections` has run: the
  // hard merge took every sighting of them into a neighbour's. No reading of the
  // ticks can bring one back, and under a wrong lens they are nearly all the losses.
  it('prints and holds the rate', { timeout: 300_000 }, () => {
    const ROOMS = 150;
    const count = (trueDeg: number, givenDeg: number) => {
      const given = every(lens(givenDeg));
      const measured = every(lens(givenDeg, 'measured'));
      const out = { gone: 0, unswept: blank(), swept: blank(), measured: blank() };
      for (let sd = 1; sd <= ROOMS; sd++) {
        const pieces = furnishedRoom(sd * 7919 + 13);
        const dets: Tallied[] = [];
        const shots = pieces.map(() => 0);
        pieces.forEach((p, i) => {
          for (const s of SWEEP_SLOTS) {
            const box = boxIn(p, s, lens(trueDeg));
            if (!box) continue;
            shots[i]++;
            dets.push({ label: p.label, conf: 0.9, box, category: p.category, slot: s, shape: p.shape, _t: i } as Tallied);
          }
        });
        const refined = refineDetections(dets, given, ROOM) as Tallied[];
        const rowed = new Set(refined.map((d) => d._t));
        shots.forEach((n, i) => {
          if (n > 0 && !rowed.has(i)) out.gone++;
        });
        const tally = (t: Tally, cals: CalMap) => {
          const ticks = pieces.map(() => 0);
          keptAtFirst(refined, refined.map(() => true), ROOM, cals).forEach((i) => ticks[refined[i]._t]++);
          shots.forEach((n, i) => {
            if (n === 0) return;
            t.vis++;
            if (n >= 2) t.multi++;
            if (ticks[i] === 0) t.lost++;
            if (ticks[i] > 1) t.dup += ticks[i] - 1;
          });
        };
        tally(out.unswept, {});
        tally(out.swept, given);
        tally(out.measured, measured);
      }
      return out;
    };
    const blank = (): Tally => ({ vis: 0, multi: 0, dup: 0, lost: 0 });

    const lines: string[] = [];
    const rows = [
      [66, 66],
      [106, 66],
      [106, 106],
      [120, 66],
      [120, 120],
    ] as const;
    const got = rows.map(([t, g]) => {
      const r = count(t, g);
      lines.push(
        `true ${t}° read at ${g}°  seen ${r.swept.vis}, in two photos ${r.swept.multi}, gone ${r.gone}  ` +
          `unswept dup ${r.unswept.dup} lost ${r.unswept.lost}  swept dup ${r.swept.dup} lost ${r.swept.lost}  ` +
          `measured dup ${r.measured.dup} lost ${r.measured.lost}`,
      );
      return [
        r.swept.vis, r.swept.multi, r.gone,
        r.unswept.dup, r.unswept.lost, r.swept.dup, r.swept.lost, r.measured.dup, r.measured.lost,
      ];
    });
    console.log(`findRepeats over ${ROOMS} furnished rooms:\n  ${lines.join('\n  ')}`);
    expect(got).toEqual([
      [575, 0, 1, 0, 2, 0, 10, 0, 2],
      [993, 252, 37, 247, 37, 5, 41, 216, 37],
      [993, 252, 9, 7, 11, 3, 20, 5, 11],
      [989, 464, 42, 452, 43, 19, 42, 423, 43],
      [989, 464, 2, 36, 4, 24, 4, 34, 4],
    ]);
  });
});

// ── A floor line ──────────────────────────────────────────────────────────────

describe('findRepeats — a lens a floor line tied to the height', () => {
  // The rooms above are shot 1.5 m up and read at 1.5 m, so a height is never
  // wrong there. A person holds a phone anywhere from 1.3 to 1.7 m, and where the
  // detect screen finds the wall-floor line it spends it on whichever of the lens
  // and the height it does not have: the lens against an assumed 1.5 m, or the
  // height against a lens the vanishing points inferred. Either way the height is
  // one lens's answer, and the sweep asks every lens — so it re-asks the line at
  // each (`atLens`) rather than carrying one lens's height to all of them, which is
  // a camera the photo contradicts. HELD is the sweep as it was, the line dropped
  // from the same calibration; TIED is the sweep now. Both on 150 rooms.
  const K = (deg: number) => 2 * Math.tan(((deg / 2) * Math.PI) / 180);
  /** What the detect screen builds from each wall's floor line, for a photo taken on
   *  `shot`: the lens solved at 1.5 m (`solve`), or the height at an inferred lens. */
  const lined = (shot: CameraCal, inferredDeg?: number): CalMap => {
    const out: CalMap = {};
    for (const s of SWEEP_SLOTS as readonly CaptureSlot[]) {
      const d = wallFrame(s, ROOM.footprint)!.distance;
      const foot = { n: [0, -d], s: [0, d], e: [d, 0], w: [-d, 0] }[s];
      const [, vFloor] = project(s, foot[0], 0, foot[1], shot);
      out[s] =
        (inferredDeg === undefined
          ? calibrateFromFloorLine(vFloor, s, ROOM.footprint, shot.aspect)
          : fitHeightToFloorLine(vFloor, s, ROOM.footprint, calFromHfov(inferredDeg, shot.aspect))) ?? undefined;
      expect(out[s]?.floorLine, `${s}: the line is in frame and solved`).toBe(vFloor);
    }
    return out;
  };
  const held = (m: CalMap): CalMap =>
    Object.fromEntries(Object.entries(m).map(([s, c]) => [s, { ...c!, floorLine: undefined }]));

  it('re-asks the line at every lens, and a lens it puts out of reach answers nothing', () => {
    const cals = lined({ k: K(106), aspect: 4 / 3, height: 1.3 });
    const sofa = seen(piece('sofa', 'sofa', 'sofa', 1.8, -1.6, [2000, 850, 800]), 'n', { k: K(106), aspect: 4 / 3, height: 1.3 });
    const [placed] = refineDetections([sofa], cals, ROOM);
    const swept = sweptSolids(placed, ROOM, cals)!;
    const reachable = SWEPT_HFOV_DEG.map((deg) => atLens(cals.n!, K(deg), 'n', ROOM.footprint) !== null);
    // A narrow lens would need the camera near the floor, a wide one near the ceiling.
    expect(reachable[0]).toBe(false);
    expect(reachable.some(Boolean)).toBe(true);
    swept.forEach((at, i) => expect(at.length > 0, `${SWEPT_HFOV_DEG[i]}°`).toBe(reachable[i]));
    // Held, every lens answers, at a height only one of them was solved for.
    expect(sweptSolids(placed, ROOM, held(cals))!.every((at) => at.length > 0)).toBe(true);
  });

  it('prints and holds the rate', { timeout: 300_000 }, () => {
    const ROOMS = 150;
    const count = (shot: CameraCal, cals: CalMap) => {
      const out = { vis: 0, held: { dup: 0, lost: 0 }, tied: { dup: 0, lost: 0 } };
      for (let sd = 1; sd <= ROOMS; sd++) {
        const pieces = furnishedRoom(sd * 7919 + 13);
        const dets: Tallied[] = [];
        const shots = pieces.map(() => 0);
        pieces.forEach((p, i) => {
          for (const s of SWEEP_SLOTS) {
            const box = boxIn(p, s, shot);
            if (!box) continue;
            shots[i]++;
            dets.push({ label: p.label, conf: 0.9, box, category: p.category, slot: s, shape: p.shape, _t: i } as Tallied);
          }
        });
        const refined = refineDetections(dets, cals, ROOM) as Tallied[];
        const tally = (t: { dup: number; lost: number }, compare: CalMap) => {
          const ticks = pieces.map(() => 0);
          keptAtFirst(refined, refined.map(() => true), ROOM, compare).forEach((i) => ticks[refined[i]._t]++);
          shots.forEach((n, i) => {
            if (n === 0) return;
            if (ticks[i] === 0) t.lost++;
            if (ticks[i] > 1) t.dup += ticks[i] - 1;
          });
        };
        out.vis += shots.filter((n) => n > 0).length;
        tally(out.held, held(cals));
        tally(out.tied, cals);
      }
      return out;
    };
    const rows = [
      [106, 1.3, undefined],
      [106, 1.5, 80],
      [106, 1.7, 66],
      [120, 1.7, 80],
    ] as const;
    const lines: string[] = [];
    const got = rows.map(([deg, height, inferred]) => {
      const shot: CameraCal = { k: K(deg), aspect: 4 / 3, height };
      const r = count(shot, lined(shot, inferred));
      lines.push(
        `true ${deg}° at ${height} m, line solved the ${inferred === undefined ? 'lens at 1.5 m' : `height at ${inferred}°`}  ` +
          `seen ${r.vis}  held dup ${r.held.dup} lost ${r.held.lost}  tied dup ${r.tied.dup} lost ${r.tied.lost}`,
      );
      return [r.vis, r.held.dup, r.held.lost, r.tied.dup, r.tied.lost];
    });
    console.log(`findRepeats with a floor line, over ${ROOMS} furnished rooms:\n  ${lines.join('\n  ')}`);
    expect(got).toEqual([
      [1000, 16, 13, 4, 13],
      [993, 4, 25, 5, 16],
      [968, 14, 20, 15, 18],
      [979, 25, 17, 25, 17],
    ]);
  });
});

describe('sameButColor — the one write the review makes that nothing measures', () => {
  const rows: Detection[] = [
    { label: 'bed', conf: 0.9, box: [0.1, 0.4, 0.5, 0.4], category: 'bed', slot: 'n', position: { x: 0, y: 0.3, z: -1 } },
    { label: 'lamp', conf: 0.8, box: [0.7, 0.2, 0.1, 0.3], category: 'lamp', slot: 'e' },
  ];
  // Exactly the colour fill's write in app/onboarding/detect/page.tsx.
  const filled = rows.map((x, i) => (i === 0 ? { ...x, color: '#a0522d' } : x));

  it('treats the colour fill as no change', () => {
    expect(sameButColor(rows, filled)).toBe(true);
    // Both ways: a colour the other list has not got yet is still only a colour.
    expect(sameButColor(filled, rows)).toBe(true);
  });

  it('and every edit that is measured as one', () => {
    const edits: Detection[][] = [
      rows.map((x, i) => (i === 1 ? { ...x, label: 'floor lamp' } : x)), // a rename
      rows.map((x, i) => (i === 0 ? { ...x, position: { x: 0, y: 0.3, z: -1 } } : x)), // re-placed where it was
      rows.map((x, i) => (i === 1 ? { ...x, shape: 'lamp-floor' } : x)), // a field the other has not got
      rows.map((x, i) => (i === 1 ? { ...x, uid: 'u1', color: '#fff000' } : x)), // colour AND something else
      [rows[1], rows[0]], // the same rows in another order
      rows.slice(0, 1), // one deleted
    ];
    expect(edits.map((e) => sameButColor(rows, e))).toEqual([false, false, false, false, false, false]);
  });

  it('is what the scan screen measures from', () => {
    // A wiring the helper cannot see: both memos have to read the colour-blind rows, and
    // the verdicts are one of the repeat check's own inputs, so either reading the raw
    // list re-runs it.
    const src = readFileSync(join(process.cwd(), 'app/onboarding/detect/page.tsx'), 'utf8');
    expect(src.match(/useMemo\(\(\) => judgeLabels\((\w+),/)?.[1]).toBe('measuredRows');
    expect(src.match(/findRepeats\(\s*(\w+),\s*(\w+)\.map/)?.slice(1)).toEqual(['measuredRows', 'measuredRows']);
    expect(src).toContain('if (!sameButColor(measuredRows, detections)) setMeasuredRows(detections);');
  });
});
