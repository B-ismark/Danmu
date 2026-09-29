// What the high side of a cut axis (§ 49.5) costs and buys, as rates.
//
// `tests/label-repair.test.ts` holds the rule to fixtures that each isolate one case —
// a sofa cut at the side called a chair, a door cut at the foot called a TV. A price is
// a rate, and a rate needs a population: how many correctly named pieces does it
// accuse, across the rooms `tests/helpers/furnished-rooms.ts` builds, on each lens and
// tilt the app meets, and how many wrong words does it catch that the judge let
// through? Printed on every green run and pinned as literals, so a drift is a red test
// and not a number nobody reads.
//
// **What the table needs beside it.** The furnished rooms never cut a wall piece at its
// top or bottom — every wall piece in them sits in the frame's height — so the HEIGHT
// half of the rule, which is most of what it catches, has no correct piece exposed to
// it there. The second test is that exposure: every wall kind at the bottom, typical
// and top of its own band, photographed tipped so the frame cuts it.

import { describe, expect, it } from 'vitest';
import type { CalMap } from '@/lib/detect-refine';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { judgeLabel, type LabelVerdict } from '@/lib/label-repair';
import { cutAxes, type CameraCal } from '@/lib/photo-geometry';
import { CATEGORIES, defaultAxisFor, type Category, type Shape } from '@/lib/scene-spec';
import type { Detection } from '@/lib/detection';
import { ROOM, framedBoxFor, type Truth } from './helpers/known-room';
import { boxIn, furnishedRoom, SWEEP_SLOTS } from './helpers/furnished-rooms';

/** A lens of `deg` across, tipped `up` degrees above level. */
const lens = (deg: number, up = 0): CameraCal => ({
  k: 2 * Math.tan(((deg / 2) * Math.PI) / 180),
  aspect: 4 / 3,
  ...(up ? { tiltRad: (-up * Math.PI) / 180 } : {}),
});
const every = (c: CameraCal): CalMap => ({ n: c, e: c, s: c, w: c });

type Suspect = Extract<LabelVerdict, { status: 'suspect' }>;
/** Suspect before § 49.5: an axis the judge could already see is out of band. A cut
 *  axis never was, so the axes that are ONLY in `atLeast` are the rule's own. Checked
 *  once against a copy of the judge from before the rule, on every row of the first
 *  test: the same answer on each correct piece, under all seven cameras. */
const heldBefore = (v: LabelVerdict): v is Suspect => v.status === 'suspect' && v.failed.some((a) => !(v.atLeast ?? []).includes(a));
const newlyHeld = (v: LabelVerdict): v is Suspect => v.status === 'suspect' && !heldBefore(v);

describe('the high side of a cut axis, across furnished rooms (§ 49.5)', () => {
  it('catches hundreds more wrong words for a handful of correct ones', { timeout: 120_000 }, () => {
    // [true lens, lens it was read as, true tilt up, tilt it was read as]. The last two
    // rows are a tipped phone the app took for level — an upload, which carries no tilt.
    const CONFIGS: Array<[number, number, number, number]> = [
      [106, 106, 0, 0],
      [106, 66, 0, 0],
      [120, 66, 0, 0],
      [120, 120, 0, 0],
      [106, 106, -5, -5],
      [106, 106, 10, 0],
      [106, 106, -5, 0],
    ];
    const out: number[][] = [];
    for (const [trueDeg, readDeg, up, readUp] of CONFIGS) {
      const given = every(lens(readDeg, readUp));
      let before = 0, price = 0, judged = 0, caught = 0, gain = 0;
      // Of the wrong words caught, how often the right word is the first chip, and one
      // of the two the scan screen shows. A verdict is half of what the screen offers.
      let first = 0, shown = 0;
      // A verdict that says both "at least" and "about" of one row: `measuredPhrase` can
      // print only one, and `readAxes` is what makes that a choice it never faces.
      let both = 0;
      const mixed = (v: LabelVerdict) => v.status === 'suspect' && !!v.atLeast?.length && !!v.bounded?.length;
      const prices: string[] = [];
      for (let seed = 1; seed <= 150; seed++) {
        for (const p of furnishedRoom(seed * 7919 + 13)) {
          for (const slot of SWEEP_SLOTS) {
            const box = boxIn(p, slot, lens(trueDeg, up));
            if (!box) continue;
            const right = judgeLabel({ label: p.label, conf: 0.9, box, category: p.category, shape: p.shape, slot } as Detection, given, ROOM);
            if (mixed(right)) both++;
            if (heldBefore(right)) before++;
            if (newlyHeld(right)) {
              price++;
              prices.push(`${p.label} ${slot} ${right.failed} ${JSON.stringify(right.measured)}`);
            }
            for (const c of CATEGORIES) {
              if (c === 'other' || c === p.category) continue;
              const v = judgeLabel({ label: c, conf: 0.9, box, category: c, slot } as Detection, given, ROOM);
              if (v.status === 'unmeasured') continue;
              if (mixed(v)) both++;
              judged++;
              if (heldBefore(v)) caught++;
              else if (newlyHeld(v)) gain++;
              else continue;
              const i = v.candidates.findIndex((x) => x.category === p.category);
              if (i === 0) first++;
              if (i === 0 || i === 1) shown++;
            }
          }
        }
      }
      console.log(
        `§ 49.5 · ${trueDeg}° read ${readDeg}°, up ${up}° read ${readUp}°: correct flagged ${before} → +${price}; ` +
          `wrong words ${caught} of ${judged} → +${gain}, the right word first on ${first} and shown on ${shown}` +
          (prices.length ? `\n    ${prices.join('\n    ')}` : ''),
      );
      out.push([before, price, judged, caught, gain, first, shown]);
      expect(both).toBe(0);
    }
    // [correct pieces the judge already flagged, flagged newly, wrong words judged,
    // caught already, caught newly, the right word first, the right word shown]. The
    // first column is the price the judge was already paying, and the second is what
    // this rule adds to it — every one a fridge or a dining chair, read past its width's
    // top on a lens or a tilt the app took wrongly, printed above on every run.
    // The fifth row, tipped 5° down and read so, moved when a round piece's sides came to
    // be read at their own ends (§ 49.9), and only on the two words that read a box as
    // round, a lamp and a plant. Read on its top row, a round piece came out about 5% wide
    // at that tilt — a plant 421 × 896 for its own 400 × 900 — and 61 of the wrong words
    // caught were caught by that error alone: 29 standing mirrors and 10 paintings called
    // a lamp read past a lamp's 600 on it, and fit one read as a round piece reads. Ten
    // slivers under a dining chair's foot, read 30–45 mm tall, are unmeasured now, and
    // four rows are caught that were not. The right word lost first place on 82 rows and
    // took it on 2, on the ranking and not the reading: a fridge's box read as a plant now
    // sorts ahead of the fridge, and a plant read at its own size behind a mirror. The
    // correct pieces flagged are the same 107.
    expect(out).toEqual([
      [97, 0, 19743, 15019, 1037, 7691, 9263],
      [339, 1, 21354, 15389, 925, 3820, 4991],
      [485, 5, 25002, 18250, 830, 3791, 5053],
      [132, 0, 21433, 17086, 359, 7381, 9393],
      [107, 0, 20603, 15790, 853, 7758, 9436],
      [264, 0, 17828, 13170, 1260, 2476, 6601],
      [327, 10, 20359, 15741, 851, 5979, 7318],
    ]);
  });

  it('accuses no correct wall piece the frame cuts top or bottom, on the camera it was', () => {
    // Every wall kind at the bottom, the typical and the top of its own band on both
    // axes, at three places along the north wall, from phones tipped so the frame cuts
    // them. Mounted where each goes: a door and a curtain from the floor and to near the
    // ceiling, an air conditioner high, the rest at eye height or standing.
    const KINDS: Array<[Category, Shape, (hM: number) => number]> = [
      ['tv', 'tv', () => 1.2],
      ['curtain', 'curtain', (h) => 2.65 - h / 2],
      ['mirror', 'mirror', (h) => Math.max(1.5, h / 2 + 0.05)],
      ['mirror', 'mirror-oval', (h) => Math.max(1.5, h / 2 + 0.05)],
      ['painting', 'painting', (h) => Math.max(1.5, h / 2 + 0.3)],
      ['ac', 'ac-unit', (h) => 2.6 - h / 2],
      ['door', 'door', (h) => h / 2],
    ];
    const run = (trueDeg: number, up: number, readUp: number) => {
      let rows = 0, heightCut = 0, before = 0, price = 0;
      for (const [category, shape, yOf] of KINDS) {
        const r = dimRangeFor(category, shape);
        for (const w of [r.min[0], defaultAxisFor(category, shape, 0), r.max[0]]) {
          for (const h of [r.min[2], defaultAxisFor(category, shape, 2), Math.min(r.max[2], 2600)]) {
            for (const x of [-2, 0, 2]) {
              const t: Truth = { name: category, label: category, category, shape, x, z: -3.0, y: yOf(h / 1000), dimMM: [w, defaultAxisFor(category, shape, 1), h], slots: ['n'] };
              const box = framedBoxFor(t, 'n', lens(trueDeg, up));
              if (!box || box[2] < 0.02 || box[3] < 0.02) continue;
              rows++;
              if (cutAxes(box, 'wall').height) heightCut++;
              const v = judgeLabel({ label: category, conf: 0.9, box, category, shape, slot: 'n' } as Detection, { n: lens(trueDeg, readUp) }, ROOM);
              if (heldBefore(v)) before++;
              if (newlyHeld(v)) price++;
            }
          }
        }
      }
      return [rows, heightCut, before, price];
    };
    // On the camera it was, nothing: what the photo saw of a piece is never more than
    // the piece. The cut rows are the point — each count is how many it had to pass.
    const known = [[66, 10], [66, 20], [66, -10], [66, -20], [80, 20], [80, -20], [106, 20]].map(([deg, up]) => run(deg, up, up));
    expect(known).toEqual([
      [185, 75, 0, 0],
      [181, 110, 0, 0],
      [167, 66, 0, 0],
      [145, 83, 0, 0],
      [189, 108, 0, 0],
      [162, 81, 0, 0],
      [189, 36, 0, 0],
    ]);
    // Tipped and read as level, it pays — at the band's edges, where any over-read is
    // past the top, and on a reading the judge was already wrong about more often.
    const level = [[66, 10], [66, -10], [80, 20], [106, 20]].map(([deg, up]) => run(deg, up, 0));
    console.log(`§ 49.5 · wall pieces at their band's edges, tipped and read as level: [rows, height cut, flagged before, newly] ${JSON.stringify(level)}`);
    expect(level).toEqual([
      [185, 75, 35, 20],
      [167, 66, 24, 12],
      [189, 108, 35, 4],
      [189, 36, 108, 2],
    ]);
  });
});
