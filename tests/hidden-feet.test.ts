// A floor piece whose foot a NEARER floor piece hides — `markHiddenFeet` in
// lib/detect-refine.ts, and the `footHidden` it hands `placeFloorObject`.
//
// From the foot of a bed the nightstands either side of its head are seen from the
// mattress up. Their boxes end where the bed starts, and the floor placer read that row
// as where they stand: nearer and smaller than they are, so the label check called two
// real nightstands the wrong size. The mark tells the placer the photo did not show the
// foot, which is the answer it already has for a foot the FRAME cuts off.
//
// The two sets of boxes the rule is held to are a fixture and a photograph. The fixture
// is the known room's (`tests/helpers/known-room.ts`), with the nightstand's box cut
// where the mattress crosses it — that is what a detector boxes, and the fixture's own
// helper does not model one piece hiding another. The photograph is the seaview suite's
// ultrawide east wall from the field test: a bed boxed headboard to frame bottom, a
// nightstand behind it whose foot the mattress hides, and one beside it standing clear
// on the tiles with its foot in plain view. Those three boxes are what the detector drew.

import { describe, expect, it } from 'vitest';
import { markHiddenFeet, OCCLUDER_MIN_HEIGHT_MM, refineDetections } from '@/lib/detect-refine';
import { judgeLabels } from '@/lib/label-repair';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot } from '@/lib/storage';
import { CAL, CALS, framedBoxFor, ROOM, type Truth } from './helpers/known-room';
import type { Box } from './helpers/project';

const row = (label: string, category: string, box: Box, slot: CaptureSlot = 'n'): Detection =>
  ({ label, category, box, slot, conf: 0.9 }) as Detection;
const marks = (dets: Detection[]) => markHiddenFeet(dets).map((d) => d.footHidden === true);

// ── The known room: a nightstand at the wall, a double bed in front of it ──────

const NIGHTSTAND: Truth = {
  name: 'nightstand', label: 'bedside table', category: 'nightstand', shape: 'nightstand',
  x: 0.8, z: -2.8, dimMM: [450, 400, 550], slots: ['n'],
};
const BED: Truth = {
  name: 'bed', label: 'bed', category: 'bed', shape: 'bed-double',
  x: 0.8, z: -1.55, dimMM: [1600, 2000, 500], slots: ['n'],
};
const whole = framedBoxFor(NIGHTSTAND, 'n', CAL)!;
/** Top of the mattress in the photo — where it starts hiding what stands behind it. */
const mattressTop = framedBoxFor(BED, 'n', CAL)![1];
/** What a detector boxes of the nightstand: from its top down to the mattress. */
const behind: Box = [whole[0], whole[1], whole[2], mattressTop - whole[1]];
/** The bed as a detector boxes it, headboard and all. */
const bedBox = framedBoxFor({ ...BED, dimMM: [1600, 2000, 1000] }, 'n', CAL)!;

describe('a nightstand behind a bed', () => {
  it('is the case: the box ends on the mattress, well above the nightstand’s own foot', () => {
    expect(whole[1] + whole[3] - (behind[1] + behind[3])).toBeGreaterThan(0.08);
    // Not cut by the frame on any side, so nothing but the bed explains the short box.
    expect(behind[0]).toBeGreaterThan(0.02);
    expect(behind[0] + behind[2]).toBeLessThan(0.98);
  });

  it('is marked when the bed is in the same photo, and read at its true size and place', () => {
    const refined = refineDetections([row('bed', 'bed', bedBox), row('bedside table', 'nightstand', behind)], CALS, ROOM);
    const ns = refined.find((d) => d.category === 'nightstand')!;
    expect(ns.footHidden).toBe(true);
    expect(ns.position!.x).toBeCloseTo(0.8, 3);
    expect(ns.position!.z).toBeCloseTo(-2.8, 3);
    expect(ns.dimMM![0]).toBe(450);
    expect(ns.dimMM![2]).toBe(550);
  });

  it('is read wide and short, at the wrong place, with its top edge taken for a foot', () => {
    // The control: the same box with nothing in front of it. This is what the label
    // check was judging, and why it called a real nightstand the wrong size.
    const [alone] = refineDetections([row('bedside table', 'nightstand', behind)], CALS, ROOM);
    expect(alone.footHidden).toBeUndefined();
    expect(alone.position!.x - 0.8).toBeGreaterThan(0.1);
    expect(alone.dimMM![0]).toBe(531);
    expect(alone.dimMM![2]).toBe(423);
  });

  it('is judged on the reading it was given, not on the wrong one', () => {
    // A reopened row carries no mark, so `judgeLabels` marks the set itself: the
    // verdict says both sizes are bounds, because the photo gave no foot to read them at.
    const verdicts = judgeLabels([row('bed', 'bed', bedBox), row('bedside table', 'nightstand', behind)], CALS, ROOM);
    expect(verdicts[1]).toEqual({ status: 'ok', bounded: ['width', 'height'] });
    expect(judgeLabels([row('bedside table', 'nightstand', behind)], CALS, ROOM)[0]).toEqual({ status: 'ok' });
  });

  it('is not marked by a rug, which lies on the floor rather than standing in front', () => {
    expect(marks([row('rug', 'rug', bedBox), row('bedside table', 'nightstand', behind)])).toEqual([false, false]);
    expect(OCCLUDER_MIN_HEIGHT_MM).toBe(300);
  });

  it('is not marked by a bed in another photo', () => {
    expect(marks([row('bed', 'bed', bedBox, 'e'), row('bedside table', 'nightstand', behind)])).toEqual([false, false]);
  });

  it('is not marked by a wall piece, and a wall piece is never marked', () => {
    expect(marks([row('tv', 'tv', bedBox), row('bedside table', 'nightstand', behind)])).toEqual([false, false]);
    expect(marks([row('bed', 'bed', bedBox), row('framed print', 'painting', behind)])).toEqual([false, false]);
  });
});

// ── The photograph ────────────────────────────────────────────────────────────

describe('the seaview suite, ultrawide, east wall', () => {
  const bed: Box = [0, 0.528, 0.553, 0.472];
  const tucked: Box = [0.095, 0.658, 0.151, 0.138];
  const clear: Box = [0.529, 0.646, 0.104, 0.173];
  const dets = [row('bed', 'bed', bed, 'e'), row('nightstand', 'nightstand', tucked, 'e'), row('nightstand', 'nightstand', clear, 'e')];

  it('marks the nightstand the mattress hides, and not the one standing clear on the tiles', () => {
    expect(marks(dets)).toEqual([false, true, false]);
  });

  it('would mark the clear one too if most of its width were enough', () => {
    // Its box reaches 24 thousandths inside the bed's — not half, but the rule this
    // replaced asked for half, and the twin beds below were inside it by far more.
    const reach = bed[0] + bed[2] - clear[0];
    expect(reach).toBeGreaterThan(0.02);
    expect(reach).toBeLessThan(clear[2] / 2);
  });
});

// ── Pieces whose foot shows ───────────────────────────────────────────────────

describe('what is not hidden', () => {
  const single = (x: number): Truth => ({
    name: `single ${x}`, label: 'bed', category: 'bed', shape: 'bed-single',
    x, z: -2.05, dimMM: [900, 1900, 450], slots: ['n', 'e'],
  });

  it('the far one of twin beds seen end-on, which reaches past the near one’s side', () => {
    const near = framedBoxFor(single(1.7), 'e', CAL)!;
    const far = framedBoxFor(single(2.8), 'e', CAL)!;
    // Lower foot, foot inside: everything but the width says hidden. (Both run off the
    // left of this photo, so the side cut below spares it as well; the next case is
    // the same shape in from the edges, where only the width does.)
    expect(near[1] + near[3]).toBeGreaterThan(far[1] + far[3] + 0.02);
    expect(far[0] + far[2]).toBeGreaterThan(near[0] + near[2] + 0.01);
    expect(marks([row('bed', 'bed', near, 'e'), row('bed', 'bed', far, 'e')])).toEqual([false, false]);
  });

  it('a piece reaching past the nearer one’s side, by half its width', () => {
    const front: Box = [0.2, 0.5, 0.4, 0.4];
    const past: Box = [0.5, 0.4, 0.2, 0.3];
    expect(marks([row('sofa', 'sofa', front), row('nightstand', 'nightstand', past)])).toEqual([false, false]);
    const within: Box = [0.4, 0.4, 0.2, 0.3];
    expect(marks([row('sofa', 'sofa', front), row('nightstand', 'nightstand', within)])).toEqual([false, true]);
  });

  it('a row the frame cuts at a side, even inside a nearer box', () => {
    const near = framedBoxFor(single(1.7), 'n', CAL)!;
    const far = framedBoxFor(single(2.8), 'n', CAL)!;
    expect(far[0] + far[2]).toBeCloseTo(1, 6);
    expect(far[0]).toBeGreaterThan(near[0]);
    expect(near[1] + near[3]).toBeGreaterThan(far[1] + far[3] + 0.02);
    expect(marks([row('bed', 'bed', near), row('bed', 'bed', far)])).toEqual([false, false]);
    // The same box a hair in from the edge is marked, so the side cut is what spares it.
    const inside: Box = [far[0], far[1], far[2] - 0.02, far[3]];
    expect(marks([row('bed', 'bed', near), row('bed', 'bed', inside)])).toEqual([false, true]);
  });

  it('two pieces side by side on one line', () => {
    // Feet 10 thousandths apart: the nightstand's at 0.80, the sofa's at 0.81.
    const a: Box = [0.2, 0.5, 0.3, 0.31];
    const b: Box = [0.25, 0.45, 0.1, 0.35];
    expect(marks([row('sofa', 'sofa', a), row('nightstand', 'nightstand', b)])).toEqual([false, false]);
    const nearer: Box = [0.2, 0.5, 0.3, 0.33];
    expect(marks([row('sofa', 'sofa', nearer), row('nightstand', 'nightstand', b)])).toEqual([false, true]);
  });

  it('a foot resting on the nearer piece’s top edge', () => {
    const front: Box = [0.2, 0.6, 0.4, 0.4];
    const onTop: Box = [0.3, 0.4, 0.1, 0.2 + 0.005];
    expect(marks([row('sofa', 'sofa', front), row('nightstand', 'nightstand', onTop)])).toEqual([false, false]);
    const below: Box = [0.3, 0.4, 0.1, 0.22];
    expect(marks([row('sofa', 'sofa', front), row('nightstand', 'nightstand', below)])).toEqual([false, true]);
  });
});

describe('the mark itself', () => {
  it('comes off a row whose occluder has gone, and leaves an unchanged row the same object', () => {
    const stale = { ...row('bedside table', 'nightstand', behind), footHidden: true as const };
    const [cleared] = markHiddenFeet([stale]);
    expect(cleared.footHidden).toBeUndefined();
    expect('footHidden' in cleared).toBe(false);
    const bed = row('bed', 'bed', bedBox);
    const [same] = markHiddenFeet([bed, stale]).slice(0, 1);
    expect(same).toBe(bed);
    expect(markHiddenFeet([bed, stale])[1]).toBe(stale);
  });
});
