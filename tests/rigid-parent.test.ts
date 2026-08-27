import { describe, it, expect } from 'vitest';
import { snapshotDescendants, cascadeTransform, livingParents, wouldCreateCycle } from '@/lib/rigid-parent';
import type { ScenePart } from '@/lib/scene-spec';

function part(overrides: Partial<ScenePart> & Pick<ScenePart, 'id' | 'pos' | 'dimMM'>): ScenePart {
  return {
    category: 'desk',
    name: 'part',
    shape: 'desk-standard',
    rot: 0,
    locked: false,
    ...overrides,
  };
}

const DESK = part({ id: 'desk', pos: [0, 0, 0], dimMM: [1400, 700, 750] }); // top at 0.75

describe('snapshotDescendants', () => {
  it('finds a single level, physically-validated child', () => {
    const laptop = part({ id: 'laptop', pos: [0.3, 0.75, 0], rot: 0.2, dimMM: [340, 240, 220] });
    const desc = snapshotDescendants('desk', [DESK, laptop], { laptop: 'desk' });
    expect(desc).toHaveLength(1);
    expect(desc[0].id).toBe('laptop');
    expect(desc[0].parentId).toBe('desk');
    expect(desc[0].localOffset[0]).toBeCloseTo(0.3, 6);
    expect(desc[0].localOffset[1]).toBeCloseTo(0, 6);
    expect(desc[0].offsetY).toBeCloseTo(0.75, 6);
    expect(desc[0].relRot).toBeCloseTo(0.2, 6);
  });

  it('walks a 3-level chain, each offset relative to its OWN immediate parent', () => {
    const tray = part({ id: 'tray', pos: [0.2, 0.75, 0.1], dimMM: [300, 300, 50] }); // top at 0.8
    const laptop = part({ id: 'laptop', pos: [0.2, 0.8, 0.1], rot: 0.1, dimMM: [340, 240, 220] });
    const parentIds = { tray: 'desk', laptop: 'tray' };
    const desc = snapshotDescendants('desk', [DESK, tray, laptop], parentIds);
    expect(desc.map((d) => d.id)).toEqual(['tray', 'laptop']); // level order

    const trayOff = desc[0];
    expect(trayOff.parentId).toBe('desk');
    expect(trayOff.localOffset).toEqual([0.2, 0.1]);
    expect(trayOff.offsetY).toBeCloseTo(0.75, 6);

    const laptopOff = desc[1];
    expect(laptopOff.parentId).toBe('tray'); // relative to the TRAY, not the desk
    expect(laptopOff.localOffset[0]).toBeCloseTo(0, 6);
    expect(laptopOff.localOffset[1]).toBeCloseTo(0, 6);
    expect(laptopOff.offsetY).toBeCloseTo(0.05, 6);
    expect(laptopOff.relRot).toBeCloseTo(0.1, 6);
  });

  it('drops a stale relationship instead of trusting parentIds structurally', () => {
    // Simulates a programmatic mover (Suggest layout, a saved Layout A/B, a
    // wall carrying furniture away) moving the laptop without ever touching
    // parentIds — it's no longer over the desk, nor at the desk's height.
    const laptopMovedAway = part({ id: 'laptop', pos: [5, 0, 5], dimMM: [340, 240, 220] });
    const desc = snapshotDescendants('desk', [DESK, laptopMovedAway], { laptop: 'desk' });
    expect(desc).toEqual([]);
  });

  it('skips a relationship whose child no longer exists', () => {
    const desc = snapshotDescendants('desk', [DESK], { laptop: 'desk' });
    expect(desc).toEqual([]);
  });

  it('returns nothing for a dead root id', () => {
    const laptop = part({ id: 'laptop', pos: [0.3, 0.75, 0], dimMM: [340, 240, 220] });
    const desc = snapshotDescendants('ghost', [DESK, laptop], { laptop: 'desk' });
    expect(desc).toEqual([]);
  });

  it('bounds a cyclic/corrupted map defensively rather than looping forever', () => {
    // A well-formed parentIds map can never produce this (each child has
    // exactly one parent), but a corrupted one shouldn't hang the cascade.
    const a = part({ id: 'a', pos: [0, 0.75, 0], dimMM: [300, 300, 300] });
    const b = part({ id: 'b', pos: [0, 1.05, 0], dimMM: [300, 300, 300] });
    const desc = snapshotDescendants('a', [a, b], { a: 'b', b: 'a' });
    expect(desc.length).toBeLessThanOrEqual(1); // terminates; does not enqueue 'a' twice
  });
});

describe('cascadeTransform', () => {
  it('rotates a single child around the parent pivot (worked example)', () => {
    // Desk at origin, laptop at local offset (0.3, 0). Desk turns a quarter turn.
    const desc = [{ id: 'laptop', parentId: 'desk', localOffset: [0.3, 0] as [number, number], offsetY: 0.75, relRot: 0.2, rot: 0.2 }];
    const moves = cascadeTransform('desk', [0, 0, 0], Math.PI / 2, desc);
    expect(moves).toHaveLength(1);
    expect(moves[0].pos[0]).toBeCloseTo(0, 6);
    expect(moves[0].pos[1]).toBeCloseTo(0.75, 6);
    expect(moves[0].pos[2]).toBeCloseTo(-0.3, 6);
    expect(moves[0].rot).toBeCloseTo(Math.PI / 2 + 0.2, 6);
  });

  it('re-derives each level\'s own Y from its own immediate parent — the height fix', () => {
    // Desk gravitates onto something taller (Y 0 -> 0.5); a laptop on a tray on
    // the desk must land on the tray's NEW height, not the desk's old one, and
    // not be left floating or buried.
    const desc = snapshotDescendants(
      'desk',
      [
        DESK,
        part({ id: 'tray', pos: [0.2, 0.75, 0.1], dimMM: [300, 300, 50] }),
        part({ id: 'laptop', pos: [0.2, 0.8, 0.1], rot: 0.1, dimMM: [340, 240, 220] }),
      ],
      { tray: 'desk', laptop: 'tray' },
    );
    const moves = cascadeTransform('desk', [1, 0.5, 2], 0, desc);
    const tray = moves.find((m) => m.id === 'tray')!;
    const laptop = moves.find((m) => m.id === 'laptop')!;
    expect(tray.pos).toEqual([1.2, 1.25, 2.1]); // desk's new Y (0.5) + tray's offsetY (0.75)
    expect(laptop.pos).toEqual([1.2, 1.3, 2.1]); // tray's new Y (1.25) + laptop's offsetY (0.05)
    // The desk did not TURN, so no child's angle changed and no child's angle may
    // be written. `rot` used to come back unconditionally, which meant every drag
    // of a desk with a laptop on it stamped a rotation override on the laptop —
    // `setTransformsFor` creates the key regardless of the value, and per
    // lib/transforms.ts that pins the angle against a re-detect and persists it.
    // Absent, not merely equal: an equal value written is still a pin.
    expect('rot' in laptop).toBe(false);
    expect('rot' in tray).toBe(false);
  });

  it('does write the angle for a child the cascade really turned', () => {
    // The other side of the same test. A quarter turn moves every child's angle by
    // a quarter turn, so the override is earned.
    const desc = snapshotDescendants(
      'desk',
      [DESK, part({ id: 'tray', pos: [0.2, 0.75, 0.1], rot: 0.1, dimMM: [300, 300, 50] })],
      { tray: 'desk' },
    );
    const moves = cascadeTransform('desk', [0, 0, 0], Math.PI / 2, desc);
    expect(moves[0].rot).toBeCloseTo(Math.PI / 2 + 0.1, 6);
  });

  it('skips a descendant whose immediate parent transform is missing (defensive, should not happen given BFS order)', () => {
    const desc = [{ id: 'orphan', parentId: 'nobody', localOffset: [0, 0] as [number, number], offsetY: 0, relRot: 0, rot: 0 }];
    expect(cascadeTransform('desk', [0, 0, 0], 0, desc)).toEqual([]);
  });
});

describe('wouldCreateCycle', () => {
  it('refuses a part parenting itself', () => {
    expect(wouldCreateCycle('a', 'a', {})).toBe(true);
  });

  it('refuses a transitive cycle', () => {
    // b's parent is already a; parenting a under b would close the loop.
    expect(wouldCreateCycle('a', 'b', { b: 'a' })).toBe(true);
  });

  it('allows a non-cyclic link', () => {
    expect(wouldCreateCycle('c', 'b', { b: 'a' })).toBe(false);
  });

  it('bounds a pre-existing corrupted/self-referential map rather than looping forever', () => {
    expect(wouldCreateCycle('y', 'x', { x: 'x' })).toBe(true);
  });
});

describe('livingParents', () => {
  it('keeps an edge whose two ends both still exist', () => {
    const laptop = part({ id: 'laptop', pos: [0, 0.75, 0], dimMM: [340, 240, 220] });
    expect(livingParents({ laptop: 'desk' }, [DESK, laptop])).toEqual({ laptop: 'desk' });
  });

  it('drops an edge whose child was deleted', () => {
    expect(livingParents({ laptop: 'desk' }, [DESK])).toEqual({});
  });

  it('drops an edge whose PARENT was deleted — the side resetTransforms never clears', () => {
    const laptop = part({ id: 'laptop', pos: [0, 0.75, 0], dimMM: [340, 240, 220] });
    expect(livingParents({ laptop: 'desk' }, [laptop])).toEqual({});
  });

  it('treats an absent map as empty rather than returning undefined', () => {
    // Rooms saved before rigid parenting shipped have no `parentIds` at all, and
    // the store's field is not optional.
    expect(livingParents(undefined, [DESK])).toEqual({});
  });

  it('does not mutate the map it was handed', () => {
    const original = { laptop: 'desk', tray: 'ghost' };
    livingParents(original, [DESK]);
    expect(original).toEqual({ laptop: 'desk', tray: 'ghost' });
  });
});

describe('cascadeTransform: forceRotFor', () => {
  const lamp = part({ id: 'lamp', pos: [0.3, 0.75, 0], rot: 0, dimMM: [200, 200, 400] });
  const own = snapshotDescendants('desk', [DESK, lamp], { lamp: 'desk' });

  it('omits an unchanged rotation on an ordinary frame', () => {
    const moves = cascadeTransform('desk', [0, 0, 0], DESK.rot, own);
    expect('rot' in moves[0]).toBe(false);
  });

  it('writes it anyway when the id is named — which is what a RESTORE needs', () => {
    // On a restore the recomputed angle equals the snapshot angle BY CONSTRUCTION:
    // `relRot` is the child's angle minus the parent's at snapshot time, and the
    // restore replays from that same parent angle. So the omission fired every
    // time and Escape could never put a child's rotation back — turn a desk with a
    // lamp on it in the plan, press Escape, and the desk returned while the lamp
    // kept the angle the drag gave it, persisted.
    const moves = cascadeTransform('desk', [0, 0, 0], DESK.rot, own, (id) => id === 'lamp');
    expect('rot' in moves[0]).toBe(true);
    expect(moves[0].rot).toBeCloseTo(lamp.rot, 9);
  });

  it('and only for the ids named, so nothing else is pinned', () => {
    const moves = cascadeTransform('desk', [0, 0, 0], DESK.rot, own, () => false);
    expect('rot' in moves[0]).toBe(false);
  });
});
