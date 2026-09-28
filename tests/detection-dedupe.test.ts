import { describe, expect, it } from 'vitest';
import { dedupeDetections, mergeDistanceFor, sameThingKey } from '../lib/detect-refine';
import { CATEGORIES } from '../lib/scene-spec';
import type { Detection } from '../lib/detection';

function det(p: Partial<Detection> & Pick<Detection, 'label' | 'category' | 'slot'>): Detection {
  return { conf: 0.9, box: [0.1, 0.1, 0.2, 0.3], ...p };
}

describe('dedupeDetections', () => {
  it('collapses one object boxed twice in the same photo', () => {
    const a = det({ label: 'sofa', category: 'sofa', slot: 'n', box: [0.2, 0.4, 0.4, 0.3] });
    const b = det({ label: 'three seat sofa', category: 'sofa', slot: 'n', box: [0.22, 0.42, 0.38, 0.28] });
    expect(dedupeDetections([a, b])).toHaveLength(1);
  });

  it('keeps two of the same thing in the same photo when they are apart', () => {
    const left = det({ label: 'dining chair', category: 'chair', slot: 'n', box: [0.05, 0.5, 0.15, 0.3] });
    const right = det({ label: 'dining chair', category: 'chair', slot: 'n', box: [0.7, 0.5, 0.15, 0.3] });
    expect(dedupeDetections([left, right])).toHaveLength(2);
  });

  it('keeps two SMALL neighbours whose boxes do not even touch', () => {
    // The scale-blindness the same-photo rule used to have, found by
    // tests/detect-pipeline.test.ts on its first run: two bedside tables 0.55 m
    // apart against a far wall image as 7%-wide boxes 9% apart. There is visible
    // daylight between them, and the old "centres within 12% of the image" test
    // merged them — deleting a real piece of furniture on the one path that spends
    // the user's quota. A fixed fraction of the IMAGE cannot answer a question
    // about two objects' PROPORTIONS.
    const a = det({
      label: 'bedside table',
      category: 'nightstand',
      slot: 'n',
      box: [0.578, 0.79, 0.074, 0.06],
      position: { x: 0.8, y: 0.27, z: -2.8 },
    });
    const b = det({
      label: 'bedside table',
      category: 'nightstand',
      slot: 'n',
      box: [0.668, 0.79, 0.074, 0.06],
      position: { x: 1.35, y: 0.27, z: -2.8 },
    });
    // Both premises stated, so this cannot come to pass by the fixtures drifting.
    expect(Math.abs(b.box[0] + b.box[2] / 2 - (a.box[0] + a.box[2] / 2))).toBeLessThan(0.12);
    expect(b.box[0]).toBeGreaterThan(a.box[0] + a.box[2]);
    expect(dedupeDetections([a, b])).toHaveLength(2);
  });

  it('still collapses a double-box that is offset rather than smaller', () => {
    // The other direction, so the fix cannot be "stop merging". One object boxed
    // twice in one pass sits nearly on top of itself, and IoU here is ~0.66.
    const a = det({ label: 'wardrobe', category: 'wardrobe', slot: 'n', box: [0.3, 0.2, 0.2, 0.5] });
    const b = det({ label: 'wardrobe unit', category: 'wardrobe', slot: 'n', box: [0.33, 0.24, 0.2, 0.5] });
    expect(dedupeDetections([a, b])).toHaveLength(1);
  });

  it('keeps a small box nested inside a big one of the same category', () => {
    // Intersection-over-union, not intersection-over-minimum, and this is the case
    // that separates them: one shelf of a bookcase, boxed inside the bookcase, both
    // called 'shelf'. IoM would be ~1.0 and would eat the bookcase. Keeping both is
    // the safe way to be wrong — a duplicate is one tap to delete, a missing piece
    // of furniture is invisible.
    const unit = det({ label: 'shelf', category: 'shelf', slot: 'e', box: [0.2, 0.1, 0.4, 0.7] });
    const oneShelf = det({ label: 'shelf', category: 'shelf', slot: 'e', box: [0.25, 0.3, 0.3, 0.08] });
    expect(dedupeDetections([unit, oneShelf])).toHaveLength(2);
  });

  // The regression this file exists for. The cross-slot rule used to match on
  // label + category with NO positional test, so any two identically-named
  // objects anywhere in the room collapsed into one — four matching chairs became
  // one chair, on the one code path that spends the user's daily quota.
  it('keeps four identical dining chairs found across two walls', () => {
    // Distinct bboxes as well as distinct positions — two chairs in the SAME photo
    // are separated by rule 1, two across photos by rule 2.
    const chairs: Detection[] = [
      det({ label: 'dining chair', category: 'chair', slot: 'n', box: [0.10, 0.5, 0.1, 0.2], position: { x: -0.6, y: 0.4, z: 0 } }),
      det({ label: 'dining chair', category: 'chair', slot: 'n', box: [0.70, 0.5, 0.1, 0.2], position: { x: 0.6, y: 0.4, z: 0 } }),
      det({ label: 'dining chair', category: 'chair', slot: 's', box: [0.30, 0.5, 0.1, 0.2], position: { x: 0, y: 0.4, z: -0.6 } }),
      det({ label: 'dining chair', category: 'chair', slot: 's', box: [0.80, 0.5, 0.1, 0.2], position: { x: 0, y: 0.4, z: 0.6 } }),
    ];
    expect(dedupeDetections(chairs)).toHaveLength(4);
  });

  it('keeps a pair of nightstands either side of a bed', () => {
    const pair: Detection[] = [
      det({ label: 'bedside table', category: 'nightstand', slot: 'n', position: { x: -1.25, y: 0.28, z: -1.8 } }),
      det({ label: 'bedside table', category: 'nightstand', slot: 'e', position: { x: 1.25, y: 0.28, z: -1.8 } }),
    ];
    expect(dedupeDetections(pair)).toHaveLength(2);
  });

  it('still collapses one object seen from two walls at the same place', () => {
    const same: Detection[] = [
      det({ label: 'double bed', category: 'bed', slot: 'n', position: { x: 0.1, y: 0.3, z: -1.2 } }),
      det({ label: 'double bed', category: 'bed', slot: 's', position: { x: 0.2, y: 0.3, z: -1.3 } }),
    ];
    expect(dedupeDetections(same)).toHaveLength(1);
  });

  it('keeps both when position is missing, rather than guessing', () => {
    // No positions to compare — a duplicate the user can delete in one tap beats
    // a real piece of furniture that never appears at all.
    const same: Detection[] = [
      det({ label: 'curtain', category: 'curtain', slot: 'n' }),
      det({ label: 'curtain', category: 'curtain', slot: 'w' }),
    ];
    expect(dedupeDetections(same)).toHaveLength(2);
  });

  it('never merges across categories', () => {
    const two: Detection[] = [
      det({ label: 'unit', category: 'wardrobe', slot: 'n', position: { x: 0, y: 1, z: 0 } }),
      det({ label: 'unit', category: 'shelf', slot: 'n', position: { x: 0, y: 1, z: 0 } }),
    ];
    expect(dedupeDetections(two)).toHaveLength(2);
  });
});

describe('dedupeDetections — which sighting survives', () => {
  // `measured` chooses WHICH row of a group is handed back, and nothing else. It used to
  // do more by accident: the measured row took the survivor's slot in the list, and every
  // later row was compared against it rather than against the row that founded the group,
  // so a measurement arriving in the middle moved the group to another photo and another
  // spot. Two ways that showed, one in each direction.

  // A print on the north wall, seen straight on from the north photo (measured) and past
  // the corner from the east one, where the on-device pass boxed it twice under two names.
  const east = det({ label: 'painting', category: 'painting', slot: 'e', box: [0.1, 0.3, 0.2, 0.2], position: { x: 2.2, y: 1.5, z: -1.98 } });
  const eastTwin = det({ label: 'wall art', category: 'painting', slot: 'e', box: [0.11, 0.31, 0.2, 0.19], position: { x: 2.2, y: 1.5, z: -1.98 } });
  const north = det({ label: 'painting', category: 'painting', slot: 'n', box: [0.6, 0.3, 0.12, 0.1], position: { x: 2.2, y: 1.5, z: -1.96 } });

  it('keeps the founder’s own double box merged after a measurement takes its place', () => {
    // The twin is the east row boxed again (same photo, IoU ~0.9) under a word rule 2 does
    // not fold, so the same-photo rule is the only thing that can catch it — and swapping
    // the east row out for the north one took the east photo's box with it.
    const out = dedupeDetections([east, north, eastTwin], new Set([north]));
    expect(out).toEqual([north]);
  });

  it('catches a double box of a sighting that joined from another photo', () => {
    // North founds the group and the east row joins it by name and place. The twin is
    // the EAST row boxed again, so it is the east row it has to be asked against: the
    // founder is another photo, under a word rule 2 does not fold.
    expect(dedupeDetections([north, east, eastTwin])).toEqual([north]);
    expect(dedupeDetections([north, east, eastTwin], new Set([north]))).toEqual([north]);
  });

  it('and does not reach a second bed the founder was never near', () => {
    // Twin beds 1.6 m apart, the first seen twice. The located sighting founds the group,
    // the measured one 0.8 m off it joins (bed's tier is 0.9 m) and survives — and the
    // second bed, 0.8 m from the SURVIVOR and 1.6 m from the founder, used to be swallowed.
    // Boxes a fifth of the frame apart per metre. They were a tenth, which drew the two
    // beds in the north photo overlapping by 58% — what the same-photo rule calls one
    // bed boxed twice, and asks of every row in a group, so that fixture was two beds
    // only while the rule could not see the second photo's member.
    const bed = (x: number, slot: Detection['slot']) =>
      det({ label: 'bed', category: 'bed', slot, box: [0.1 + x / 5, 0.5, 0.3, 0.3], position: { x, y: 0.3, z: -1 } });
    const [located, seen, other] = [bed(0, 'e'), bed(0.8, 'n'), bed(1.6, 'n')];
    const out = dedupeDetections([located, seen, other], new Set([seen, other]));
    expect(out).toEqual([seen, other]);
  });

  it('never changes how many pieces come out, in any order', () => {
    const rows = [east, eastTwin, north];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const counts = orders.map((o) => {
      const list = o.map((i) => rows[i]);
      return [dedupeDetections(list).length, dedupeDetections(list, new Set([north])).length];
    });
    // Each pair is [without the set, with it], and the two halves agree in every order.
    // The ORDER still matters, and that is first-come's own answer rather than this
    // defect: across photos a group is compared through its founder, and in three of
    // the six orders the twin meets the north row before it meets the east one — `wall
    // art` is not `painting`, and they are different photos, so no rule joins those two
    // and the room gets the print twice, for the soft merge to start unticked. (The
    // fifth order used to be a fourth: north, east, twin, where the twin does meet the
    // east row, as a member of north's group, and the same-photo rule now asks it.) What
    // the set may not do is move a count, and in the second order it did: 1 without it,
    // 2 with it.
    expect(counts).toEqual([[1, 1], [1, 1], [2, 2], [2, 2], [1, 1], [2, 2]]);
  });
});

describe('mergeDistanceFor', () => {
  // The regression this whole tier exists for. Four chairs tucked around a table
  // at 0.55 m centres collapsed to TWO under the old flat 0.6 m: the first ate
  // the second, the third survived by being 1.1 m from the first, and the fourth
  // was eaten by the third. Nothing told the user.
  it('keeps four dining chairs tucked 0.55 m apart around a table', () => {
    const chairs: Detection[] = [0, 1, 2, 3].map((i) => ({
      label: 'dining chair',
      conf: 0.9,
      category: 'chair' as const,
      slot: (i < 2 ? 'n' : 's') as Detection['slot'],
      // Distinct bboxes too, so rule 1 is not what separates them.
      box: [0.1 + i * 0.2, 0.5, 0.1, 0.2] as Detection['box'],
      position: { x: -0.825 + i * 0.55, y: 0.4, z: 0 },
    }));
    expect(dedupeDetections(chairs)).toHaveLength(4);
  });

  it('still merges one chair genuinely seen twice', () => {
    // A tight tier is not "never merge". Two views of the same chair land within
    // the calibration error of each other, which is well inside 0.35 m.
    const same: Detection[] = [
      det({ label: 'dining chair', category: 'chair', slot: 'n', position: { x: 0.4, y: 0.4, z: -1.0 } }),
      det({ label: 'dining chair', category: 'chair', slot: 'e', box: [0.6, 0.5, 0.1, 0.2], position: { x: 0.5, y: 0.4, z: -0.9 } }),
    ];
    expect(dedupeDetections(same)).toHaveLength(1);
  });

  it('merges a bed whose two views disagree by more than a chair may', () => {
    // 0.7 m apart: beyond the old flat threshold as well as the tight tier, but
    // a plausible disagreement between two photos of one 2 m bed, and there is
    // no arrangement in which two beds sit 0.7 m apart.
    const same: Detection[] = [
      det({ label: 'double bed', category: 'bed', slot: 'n', position: { x: 0, y: 0.3, z: -1.2 } }),
      det({ label: 'double bed', category: 'bed', slot: 'w', box: [0.3, 0.5, 0.3, 0.3], position: { x: 0.7, y: 0.3, z: -1.2 } }),
    ];
    expect(dedupeDetections(same)).toHaveLength(1);
    // Proof the tier is what carries it: the old flat 0.6 m would not have.
    expect(mergeDistanceFor('bed')).toBeGreaterThan(0.7);
  });

  it('gives every category a distance, and orders the tiers', () => {
    for (const category of CATEGORIES) {
      expect(mergeDistanceFor(category), category).toBeGreaterThan(0);
    }
    expect(mergeDistanceFor('chair')).toBeLessThan(mergeDistanceFor('desk'));
    expect(mergeDistanceFor('desk')).toBeLessThan(mergeDistanceFor('wardrobe'));
    // An unlisted category falls back to the flat value this replaced, so nothing
    // silently loosens when a category is added.
    expect(mergeDistanceFor('other')).toBe(0.6);
  });
});

describe('the two detectors\' words for one thing', () => {
  const at = (label: string, slot: 'n' | 'e', x: number) =>
    det({ label, category: 'sofa', slot, box: slot === 'n' ? [0.3, 0.5, 0.3, 0.2] : [0.6, 0.5, 0.3, 0.2], position: { x, y: 0.4, z: 0 } });

  it('merges a couch in one photo with a sofa in another at the same spot', () => {
    // The on-device path names a sofa "Couch" from its Open Images model and "Sofa"
    // from its world prompts; the label test kept both.
    expect(dedupeDetections([at('Couch', 'n', 0), at('Sofa', 'e', 0.1)])).toHaveLength(1);
  });

  it('still keeps two differently named seats — a loveseat is not a sofa', () => {
    expect(dedupeDetections([at('Loveseat', 'n', 0), at('Sofa', 'e', 0.1)])).toHaveLength(2);
  });

  it('still keeps a synonym pair that is far apart', () => {
    expect(dedupeDetections([at('Couch', 'n', 0), at('Sofa', 'e', 3)])).toHaveLength(2);
  });

  it('folds each detector\'s word onto one key, and nothing else', () => {
    expect(sameThingKey(' Houseplant ')).toBe(sameThingKey('Potted plant'));
    expect(sameThingKey('Television')).toBe(sameThingKey('tv'));
    expect(sameThingKey('Ceiling fan')).not.toBe(sameThingKey('Electric fan'));
    expect(sameThingKey('Armchair')).toBe('armchair');
  });
});
