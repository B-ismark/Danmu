import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { anchorFor, ridesWall } from '../lib/physics';
import { stripCommentsAndStrings } from './helpers/source';
import { CATEGORIES, isWallMountedPart, type Category, type Shape } from '../lib/scene-spec';
import { CATALOG_SHAPES_ORDERED } from '../lib/scene-spec';

/** Three surfaces draw a plan of one room — the 2D Plan tab (`PlanView`), the exported
 *  PNG (`plan-export`) and the Room panel's layout thumbnails (`MiniPlan` inside
 *  `RoomTools`). They were answering "which pieces are drawn as footprints" three
 *  different ways: `PlanView` drew every piece, `MiniPlan` filtered on the stored
 *  `wallMounted` flag, and `plan-export` filtered on the anchor. So a 1000 mm ceiling fan
 *  was a numbered rectangle in the export and absent from the thumbnail of the same room.
 *
 *  This is a regex over source, and that is a deliberate second-best. The filters are
 *  inline in two components and one module, so there is no shared value to import — and
 *  the failure being guarded is precisely a FOURTH surface growing its own answer, which
 *  no import can see. Same shape, and the same caveat, as the `MOUNT_PAD` sweep in
 *  `scene-build.test.ts`. Comments are stripped first, because prose quoting the
 *  expression satisfies the match exactly as well as the expression does — that has
 *  already happened once in this repo, to the MOUNT_PAD sweep, and it made a deleted
 *  clamp look present. */
// The shared one-pass scanner, not a local pair of regexes. The pair this replaced had
// the hole it was meant to close, one syntax over: a `/*` inside a STRING opens the
// block-comment match and swallows the code between it and the next closer. Measured
// against the real `lib/plan-export.ts` by danmu-bc: a targeted plant removes four lines
// out of 7324 and the offender goes invisible while both positive checks below still
// pass - so those checks are a floor, and the scanner is the mitigation.

const read = (rel: string) => stripCommentsAndStrings(readFileSync(join(process.cwd(), rel), 'utf8'));

const PLAN_SURFACES = [
  'lib/plan-export.ts',
  'components/studio/RoomTools.tsx',
  'components/studio/PlanView.tsx',
];

describe('every plan surface answers "is this drawn as a footprint" the same way', () => {
  it('no plan surface filters on the stored wallMounted flag', () => {
    const offenders: string[] = [];
    for (const rel of PLAN_SURFACES) {
      const src = read(rel);
      // A `.filter(...)` or a guard testing the stored flag. `wallMounted` may still be
      // WRITTEN here (`PlanView` hands it to `placeNewPart`) — what must not happen is a
      // read of it to decide how to draw.
      const bad = src.match(/[!(]\s*\w+\.wallMounted/g);
      if (bad) offenders.push(`${rel}: ${bad.join(', ')}`);
    }
    expect(offenders, 'ask ridesWall — the flag is true for the ceiling family too').toEqual([]);
  });

  it('and the sweep is reading the files it thinks it is', () => {
    // Without this, a renamed or moved file makes the assertion above pass over nothing —
    // the failure mode it is guarding against in the first place.
    for (const rel of PLAN_SURFACES) {
      const src = read(rel);
      expect(src.length, `${rel} must exist and have content`).toBeGreaterThan(2000);
      expect(src, `${rel} must actually draw a plan`).toMatch(/pos\[0\]|pos\[2\]/);
    }
  });
});

describe('ridesWall and isWallMountedPart differ by exactly the ceiling family', () => {
  it('and every catalog shape agrees with its anchor', () => {
    // The two predicates are one character apart in meaning and the whole bug class comes
    // from asking the wrong one. Pinning the difference means a shape moving between
    // anchors shows up here rather than as a piece drawn in the wrong place.
    const ceiling: string[] = [];
    let swept = 0;
    for (const cat of CATEGORIES as readonly Category[]) {
      for (const shape of CATALOG_SHAPES_ORDERED as readonly Shape[]) {
        swept++;
        const anchor = anchorFor(cat, shape);
        const wide = isWallMountedPart(cat, shape);
        const narrow = ridesWall(cat, shape);
        expect(wide, `${cat}/${shape}`).toBe(anchor !== 'floor');
        expect(narrow, `${cat}/${shape}`).toBe(anchor.startsWith('wall-'));
        if (wide && !narrow) {
          expect(anchor, `${cat}/${shape} differs but is not ceiling`).toBe('ceiling');
          ceiling.push(`${cat}/${shape}`);
        }
      }
    }
    // A count with a floor under it: if no pair ever differed, the two predicates would be
    // interchangeable and every finding above would be imaginary.
    expect(swept, 'the sweep must have pairs to sweep').toBeGreaterThan(200);
    expect(ceiling.length, 'some pair must differ, or there is no bug class here').toBeGreaterThan(0);
  });
});
