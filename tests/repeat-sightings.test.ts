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

import { describe, expect, it } from 'vitest';
import { refineDetections } from '@/lib/detect-refine';
import { findRepeats, keptAtFirst, REPEAT_SHARE } from '@/lib/repeat-sightings';
import { footArea, footFromPart, footIntersectionArea } from '@/lib/geometry';
import { startingSpot } from '@/lib/scene-spec';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot } from '@/lib/storage';
import { boxFor, CAL, CALS, refinedOnly, ROOM, shots, squareOn, TRUTH, type Truth } from './helpers/known-room';
import type { Box } from './helpers/project';

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
 *  build it — which, for a row that carries a position, is that position. */
function repeats(dets: Detection[], keep: boolean[] = []): (number | null)[] {
  return findRepeats(dets, keep, ROOM);
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

  it('keeps two wall pieces apart when one hangs above the other', () => {
    const at = (y: number, slot: CaptureSlot): Detection =>
      row({ category: 'painting', slot, position: { x: 0, y, z: -2.98 }, dimMM: [700, 40, 500] });
    // 1.25–1.75 against 1.85–2.35: the same stretch of wall, no height in common.
    expect(repeats([at(1.5, 'n'), at(2.1, 'e')])).toEqual([null, null]);
    // 1.25–1.75 against 1.35–1.85: most of the same frame.
    expect(repeats([at(1.5, 'n'), at(1.6, 'e')])).toEqual([null, 0]);
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
    expect(findRepeats(dets, [], null)).toEqual([null, 0]);
    delete dets[1].position;
    expect(findRepeats(dets, [], null)).toEqual([null, null]);
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
    expect(findRepeats(dets, [], null)).toEqual([null, null]);
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
    expect(keptAtFirst(dets, [false, true], ROOM)).toEqual(new Set([1]));
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
    expect(keptAtFirst(dets, [true, true, true], ROOM)).toEqual(new Set([0, 2]));
    expect(keptAtFirst(dets, [true, true, false], ROOM)).toEqual(new Set([0]));
  });
});

// ── The known room ────────────────────────────────────────────────────────────

/** What a real detector hands back for a piece that runs out of the picture: the
 *  part it can see. `boxFor` projects the whole solid, frame or not. */
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
 *  second model that calls it `second` and draws the taller box. */
function readTwice(t: Truth, second: string): Detection[] {
  return t.slots.flatMap((slot) => {
    const seen = inPicture(boxFor(t, slot, CAL));
    const unplaced = { slot, shape: undefined, position: undefined, dimMM: undefined, yaw: undefined };
    return [
      row({ category: t.category, label: t.label, box: seen, ...unplaced }),
      row({ category: t.category, label: second, box: taller(seen, 2.2), ...unplaced }),
    ];
  });
}

describe('the known room', () => {
  it('flags nothing in a room where every piece was already found once', () => {
    // Eleven pieces, including two identical bedside tables a hand's width apart and
    // a lamp in two photos that the hard merge already took. Every one is a piece.
    const refined = refinedOnly(squareOn(CAL), CALS);
    expect(refined).toHaveLength(TRUTH.length);
    expect(findRepeats(refined, refined.map(() => true), ROOM)).toEqual(refined.map(() => null));
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
    const flagged = findRepeats(renamed, renamed.map(() => true), ROOM);
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
    expect(keptAtFirst(refined, refined.map(() => true), ROOM).size).toBe(1);
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
    const refined = refineDetections(readTwice(light, 'pendant light'), CALS, ROOM);
    // Every sighting measured, and measured up at the ceiling.
    expect(refined.length).toBeGreaterThan(1);
    for (const d of refined) expect(d.position?.y, d.label).toBeGreaterThan(ROOM.height - 0.5);
    expect(keptAtFirst(refined, refined.map(() => true), ROOM).size).toBe(1);
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
    expect(keptAtFirst(refined, refined.map(() => true), ROOM).size).toBe(2);
  });
});
