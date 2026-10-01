import { describe, expect, it } from 'vitest';
import { hasEditsSinceStart, sameWalls, startingParts, type PieceEdits } from '../lib/room-start';
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
/** The piece half of the question, asked of a room whose walls are as it opened. */
const edited = (parts: ScenePart[], start: ScenePart[], edits: PieceEdits) =>
  hasEditsSinceStart(parts, start, edits, shape(), shape());

describe('startingParts', () => {
  it('rebuilds a starter room the same way twice, so an untouched room has nothing to undo', () => {
    const start = startingParts(null, shape());
    expect(start.length).toBeGreaterThan(0);
    expect(edited(reloaded(startingParts(null, shape())), start, none)).toBe(false);
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

  it("lays the start out in the walls it is given, not the ones in the record", () => {
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
    expect(edited(added, start, none)).toBe(true);
    expect(edited(reloaded(start).slice(1), start, none)).toBe(true);
    const recoloured = reloaded(start);
    recoloured[0] = { ...recoloured[0], color: '#123456' };
    expect(edited(recoloured, start, none)).toBe(true);
  });

  it('sees every edit kept beside the scene: moved, turned, resized, hidden', () => {
    const id = start[0].id;
    expect(edited(start, start, { ...none, positions: { [id]: [0, 0, 0] } })).toBe(true);
    expect(edited(start, start, { ...none, rotations: { [id]: 1 } })).toBe(true);
    expect(edited(start, start, { ...none, dims: { [id]: [1, 1, 1] } })).toBe(true);
    expect(edited(start, start, { ...none, hidden: { [id]: true } })).toBe(true);
    // A piece shown again is not an edit.
    expect(edited(start, start, { ...none, hidden: { [id]: false } })).toBe(false);
  });

  it('treats a key holding undefined as absent, as a saved record does', () => {
    const withUndefined = reloaded(start).map((p) => ({ ...p, note: undefined }) as ScenePart);
    expect(edited(withUndefined, start, none)).toBe(false);
  });
});

describe('the walls are part of the start', () => {
  const start = startingParts(null, shape());

  it('sees a wall moved and a ceiling changed, with every piece where it was', () => {
    const opened = shape();
    expect(hasEditsSinceStart(start, start, none, opened, opened)).toBe(false);
    expect(hasEditsSinceStart(start, start, none, shape(5, 3.8), opened)).toBe(true);
    expect(hasEditsSinceStart(start, start, none, { ...opened, height: 3 }, opened)).toBe(true);
  });

  it('compares the outline, not just the box around it', () => {
    const opened = shape();
    const moved = opened.footprint.map(([x, z], i) => (i === 0 ? ([x + 0.2, z] as [number, number]) : ([x, z] as [number, number])));
    expect(sameWalls({ ...opened, footprint: moved }, opened)).toBe(false);
    expect(sameWalls({ ...opened, layoutId: 'custom' }, opened)).toBe(false);
    // …and the box as well, each side on its own: the box is what the size fields
    // show, so a room that reads a different size has different walls.
    expect(sameWalls({ ...opened, width: opened.width + 0.1 }, opened)).toBe(false);
    expect(sameWalls({ ...opened, depth: opened.depth + 0.1 }, opened)).toBe(false);
  });

  it('leaves the paint, the site and the typical-size mark out of it', () => {
    const opened = shape();
    expect(sameWalls({ ...opened, wallColors: { 0: '#123456' }, roughSize: true }, opened)).toBe(true);
    expect(sameWalls(JSON.parse(JSON.stringify(opened)) as RoomShape, opened)).toBe(true);
  });
});
