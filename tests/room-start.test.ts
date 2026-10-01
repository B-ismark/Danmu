import { describe, expect, it } from 'vitest';
import { hasEditsSinceStart, startingParts, type PieceEdits } from '../lib/room-start';
import { roomFootprint } from '../lib/footprint';
import { buildSceneFromRoom, defaultScene, normalizeStoredParts, type ScenePart } from '../lib/scene-spec';
import type { RoomShape } from '../lib/scene-store';
import { LAYOUT_IDS, type RoomData } from '../lib/storage';

const shape = (width = 4.6, depth = 3.8): RoomShape => ({
  width,
  depth,
  height: 2.6,
  layoutId: 'rect',
  footprint: roomFootprint({ width, depth, layoutId: 'rect', footprint: undefined }),
  wallColors: {},
});
const none: PieceEdits = { positions: {}, rotations: {}, dims: {}, hidden: {} };
// A saved scene comes back as a fresh array of fresh objects, never the same one.
const reloaded = (parts: ScenePart[]) => JSON.parse(JSON.stringify(parts)) as ScenePart[];

describe('startingParts', () => {
  it('rebuilds a starter room the same way twice, so an untouched room has nothing to undo', () => {
    const start = startingParts(null, shape());
    expect(start.length).toBeGreaterThan(0);
    expect(hasEditsSinceStart(reloaded(startingParts(null, shape())), start, none)).toBe(false);
  });

  it("rebuilds a scanned room from the scan's own record, not the starter", () => {
    const room = shape(4, 3.5);
    const source = {
      id: 'r1',
      createdAt: 0,
      name: 'Scan',
      layoutId: 'rect',
      width: room.width,
      depth: room.depth,
      height: room.height,
      detectedObjects: [{ label: 'sofa', category: 'sofa', dimMM: [2000, 900, 850], position: [0, 0, 1.1] }],
    } as unknown as RoomData;
    const start = startingParts(source, room);
    expect(start).toEqual(normalizeStoredParts(buildSceneFromRoom({ ...source, footprint: room.footprint })));
    expect(start).not.toEqual(startingParts(null, room));
  });

  it("lays the start out in today's walls, not the ones in the record", () => {
    const source = { id: 'r', createdAt: 0, name: 'x', layoutId: 'rect', width: 6, depth: 5, height: 2.6 } as unknown as RoomData;
    const small = shape(3.2, 3);
    const start = startingParts(source, small);
    // The same arrangement a record that already had these walls would get — not the
    // 6 × 5 one squeezed in by containment afterwards.
    expect(start).toEqual(startingParts({ ...source, width: small.width, depth: small.depth }, small));
    for (const p of start) {
      expect(Math.abs(p.pos[0])).toBeLessThan(small.width / 2 + 1e-6);
      expect(Math.abs(p.pos[2])).toBeLessThan(small.depth / 2 + 1e-6);
    }
  });
});

describe('the re-derivation the start goes through', () => {
  // `startingParts` runs its build through `normalizeStoredParts` because the saved
  // side of the compare goes through it on load. That is only harmless if it is the
  // identity on a fresh build — otherwise every untouched room would read as edited —
  // and `lib/room-start.ts` says it is, for every preset. This is where that is held.
  it('changes nothing on a fresh build of any preset, at any of four sizes', () => {
    const changed: string[] = [];
    for (const layoutId of LAYOUT_IDS) {
      for (const [w, d] of [[3, 3], [4.6, 3.8], [6, 4.5], [8, 7]] as const) {
        const footprint = roomFootprint({ width: w, depth: d, layoutId, footprint: undefined });
        const built = defaultScene(layoutId, w, d, { footprint, height: 2.6 });
        if (JSON.stringify(normalizeStoredParts(built)) !== JSON.stringify(built)) changed.push(`${layoutId} ${w}x${d}`);
      }
    }
    expect(changed).toEqual([]);
  });
});

describe('hasEditsSinceStart', () => {
  const start = startingParts(null, shape());

  it('sees a piece added, a piece removed, and a recolour', () => {
    const added = [...reloaded(start), { ...start[0], id: 'extra' }];
    expect(hasEditsSinceStart(added, start, none)).toBe(true);
    expect(hasEditsSinceStart(reloaded(start).slice(1), start, none)).toBe(true);
    const recoloured = reloaded(start);
    recoloured[0] = { ...recoloured[0], color: '#123456' };
    expect(hasEditsSinceStart(recoloured, start, none)).toBe(true);
  });

  it('sees every edit kept beside the scene: moved, turned, resized, hidden', () => {
    const id = start[0].id;
    expect(hasEditsSinceStart(start, start, { ...none, positions: { [id]: [0, 0, 0] } })).toBe(true);
    expect(hasEditsSinceStart(start, start, { ...none, rotations: { [id]: 1 } })).toBe(true);
    expect(hasEditsSinceStart(start, start, { ...none, dims: { [id]: [1, 1, 1] } })).toBe(true);
    expect(hasEditsSinceStart(start, start, { ...none, hidden: { [id]: true } })).toBe(true);
    // A piece shown again is not an edit.
    expect(hasEditsSinceStart(start, start, { ...none, hidden: { [id]: false } })).toBe(false);
  });

  it('treats a key holding undefined as absent, as a saved record does', () => {
    const withUndefined = reloaded(start).map((p) => ({ ...p, note: undefined }) as ScenePart);
    expect(hasEditsSinceStart(withUndefined, start, none)).toBe(false);
  });
});
