import { describe, expect, it } from 'vitest';
import { buildSceneFromRoom, CATALOG_SHAPES_ORDERED } from '../lib/scene-spec';
import type { RoomData } from '../lib/storage';

type Saved = NonNullable<RoomData['detectedObjects']>[number];

function room(detected: Saved[], over: Partial<RoomData> = {}): RoomData {
  return {
    id: 'r1',
    createdAt: 0,
    name: 'Test room',
    layoutId: 'rect',
    width: 5,
    depth: 4,
    height: 2.8,
    detectedObjects: detected,
    ...over,
  };
}

function saved(i: number, over: Partial<Saved> = {}): Saved {
  return {
    id: i,
    label: `sofa__slot:n`,
    conf: 0.9,
    locked: false,
    box: [0.2, 0.4, 0.3, 0.3],
    category: 'sofa',
    ...over,
  };
}

// The detect → scene translation had no coverage at all, and it is where the
// higher-severity findings of the audit lived.
describe('buildSceneFromRoom', () => {
  it('falls back to the starter scene when there are no detections', () => {
    const parts = buildSceneFromRoom(room([]));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.locked === false)).toBe(true);
  });

  // The id is what every per-part user edit is keyed by — positions, rotations,
  // dims, hidden. It used to be a positional `${category}-${n}`, i.e. an ordinal
  // rather than an identity, so re-detecting a room re-pointed the old `sofa-1`'s
  // saved transform at whatever the new `sofa-1` happened to be.
  it('uses the detection uid as the part id when one is present', () => {
    const parts = buildSceneFromRoom(room([saved(0, { uid: 'stable-key-1' })]));
    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe('stable-key-1');
  });

  it('keeps ids stable when the set of detections changes around them', () => {
    const a = saved(0, { uid: 'aaa', label: 'sofa__slot:n' });
    const b = saved(1, { uid: 'bbb', label: 'armchair__slot:n', category: 'chair' });
    const before = buildSceneFromRoom(room([a, b]));
    // Delete the first detection and re-detect: 'bbb' must not inherit 'aaa'.
    const after = buildSceneFromRoom(room([b]));
    expect(before.map((p) => p.id)).toEqual(['aaa', 'bbb']);
    expect(after.map((p) => p.id)).toEqual(['bbb']);
  });

  it('falls back to the positional id for rooms saved before uid existed', () => {
    // Minting one here instead would orphan every transform those rooms already
    // have, which is worse than the bug being fixed.
    const parts = buildSceneFromRoom(room([saved(0)]));
    expect(parts[0].id).toBe('sofa-1');
  });

  it('honours an AI shape that is in the catalog', () => {
    const parts = buildSceneFromRoom(
      room([saved(0, { label: 'seat__slot:n', category: 'other', shape: 'window' })]),
    );
    // 'window' was missing from the catalog gate, so a locally-detected window
    // was rejected and fell back to a plain box — even though WindowGeo exists.
    expect(CATALOG_SHAPES_ORDERED).toContain('window');
    expect(parts[0].shape).toBe('window');
  });

  it('refuses a shape that is not in the catalog', () => {
    const parts = buildSceneFromRoom(
      room([saved(0, { label: 'thing__slot:n', category: 'other', shape: 'not-a-shape' })]),
    );
    expect(parts[0].shape).toBe('box');
  });

  it('clamps an absurd AI dimension into the shape range', () => {
    const parts = buildSceneFromRoom(room([saved(0, { dimMM: [40000, 1, 90000] })]));
    const [w, , h] = parts[0].dimMM;
    expect(w).toBeLessThanOrEqual(4000); // sofa max width
    expect(h).toBeGreaterThanOrEqual(600); // sofa min height
  });

  it('grounds a floor-standing part on the floor', () => {
    const parts = buildSceneFromRoom(room([saved(0, { position: { x: 0, y: 1.9, z: 0 } })]));
    expect(parts[0].pos[1]).toBe(0);
  });

  it('keeps every part inside the room footprint', () => {
    const parts = buildSceneFromRoom(
      room([saved(0, { position: { x: 40, y: 0, z: 40 } }), saved(1, { uid: 'b' })]),
    );
    for (const p of parts) {
      expect(Math.abs(p.pos[0])).toBeLessThanOrEqual(2.5 + 0.01);
      expect(Math.abs(p.pos[2])).toBeLessThanOrEqual(2 + 0.01);
    }
  });

  it('drops a part that would poke through the ceiling back under it', () => {
    // A 2.0 m wardrobe in a 2.4 m room, handed a Y that would push its top through
    // the ceiling: the settle pass brings it back down.
    const parts = buildSceneFromRoom(
      room(
        [
          saved(0, {
            category: 'wardrobe',
            label: 'wardrobe__slot:n',
            dimMM: [2000, 600, 2000],
            position: { x: 0, y: 1.2, z: -1.5 },
          }),
        ],
        { height: 2.4 },
      ),
    );
    const top = parts[0].pos[1] + parts[0].dimMM[2] / 1000;
    expect(top).toBeLessThanOrEqual(2.4);
  });

  it('does NOT shrink a part that is genuinely taller than the room', () => {
    // A 2.6 m wardrobe does not fit under a 2.4 m ceiling, and quietly resizing it
    // to fit would be exactly the dimension lie this codebase exists to avoid. It
    // keeps its real height, sits on the floor, and lib/clearance reports it.
    const parts = buildSceneFromRoom(
      room([saved(0, { category: 'wardrobe', label: 'wardrobe__slot:n', dimMM: [2000, 600, 2600] })], {
        height: 2.4,
      }),
    );
    expect(parts[0].dimMM[2]).toBe(2600);
    expect(parts[0].pos[1]).toBe(0);
  });

  it('carries the saved locked flag and colour through', () => {
    const parts = buildSceneFromRoom(room([saved(0, { locked: true, color: '#123456' })]));
    expect(parts[0].locked).toBe(true);
    expect(parts[0].color).toBe('#123456');
  });
});
