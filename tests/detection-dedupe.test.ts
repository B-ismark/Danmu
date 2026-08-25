import { describe, expect, it } from 'vitest';
import { dedupeDetections } from '../lib/detect-refine';
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
