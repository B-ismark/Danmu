import { describe, expect, it } from 'vitest';
import { dedupeDetections, mergeDistanceFor } from '../lib/detect-refine';
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
