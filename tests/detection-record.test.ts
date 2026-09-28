import { describe, expect, it } from 'vitest';
import { cleanLabelOf, detectionPartIds, fromRecord, fromRecords, toRecord, type SavedDetection } from '@/lib/detection-record';
import { buildSceneFromRoom } from '@/lib/scene-spec';
import type { RoomData } from '@/lib/storage';
import type { Detection } from '@/lib/detection';

// The codec's whole documented failure mode is having TWO implementations that
// drift. So the tests are round-trips over a FULLY populated detection rather than
// a list of fields — a field added to one direction and not the other fails here
// without anyone remembering to extend an assertion.

const uid = () => 'minted-1';

/** Every optional field set, all to distinguishable values. The point of filling
 *  them all is that `full` is the thing that goes stale, not the assertions. */
const full: Detection = {
  uid: 'stable-key',
  label: 'double bed',
  conf: 0.83,
  source: 'cloud',
  box: [0.1, 0.2, 0.3, 0.4],
  category: 'bed',
  slot: 'e',
  dimMM: [1600, 2000, 550],
  position: { x: 1.1, y: 0.2, z: -0.4 },
  yaw: 1.5708,
  shape: 'bed-double',
  color: '#a1b2c3',
};

describe('toRecord / fromRecord', () => {
  it('round-trips every field of a fully populated detection', () => {
    expect(fromRecord(toRecord(full, 0, false, uid))).toEqual(full);
  });

  it('round-trips a bare detection, the on-device detector’s normal output', () => {
    // lib/local-detect.ts emits a label, a box and a category — no dims, no
    // position, no shape, no colour. That path must survive the codec too.
    const bare: Detection = { uid: 'k', label: 'chair', conf: 0.4, box: [0, 0, 0.2, 0.2], category: 'chair', slot: 'n' };
    expect(fromRecord(toRecord(bare, 3, true, uid))).toEqual(bare);
  });

  it('round-trips each source, and refuses a value it does not recognise', () => {
    // `source` is a union in Detection and a bare string in the record, so this is
    // the boundary where a room written by a later build meets an earlier one. An
    // unrecognised value must come back UNDEFINED rather than be trusted through —
    // `sourceOf` then supplies the historical default, which is a decision made in
    // one place instead of a bad string propagating into a threshold lookup.
    for (const source of ['local', 'cloud', 'manual'] as const) {
      expect(fromRecord(toRecord({ ...full, source }, 0, false, uid)).source, source).toBe(source);
    }
    const forged: SavedDetection = {
      id: 0,
      label: 'thing__slot:n',
      conf: 0.5,
      locked: false,
      box: [0, 0, 1, 1],
      source: 'satellite',
    };
    expect(fromRecord(forged).source).toBeUndefined();
    // And a record from before the field existed is not an error either.
    expect(fromRecord({ ...forged, source: undefined }).source).toBeUndefined();
  });

  it('keeps a uid it was given and mints one only when there is none', () => {
    expect(toRecord(full, 0, false, uid).uid).toBe('stable-key');
    expect(toRecord({ ...full, uid: undefined }, 0, false, uid).uid).toBe('minted-1');
  });

  it('carries the slot through the label and strips it back off', () => {
    // The slot has no field of its own; it rides in the label as a suffix. Both
    // halves of that trick have to agree, and the user must never see it.
    const rec = toRecord(full, 0, false, uid);
    expect(rec.label).toBe('double bed__slot:e');
    expect(fromRecord(rec).slot).toBe('e');
    expect(fromRecord(rec).label).toBe('double bed');
  });

  it('does not double the suffix on a detection that already carries one', () => {
    // A re-save reads a record, edits it and writes it again. Without the strip in
    // `cleanLabelOf` the label grows a suffix per save.
    const once = toRecord(full, 0, false, uid);
    const twice = toRecord(fromRecord(once), 0, false, uid);
    expect(twice.label).toBe(once.label);
    // …and belt and braces: a Detection whose label somehow still has the suffix.
    expect(toRecord({ ...full, label: 'double bed__slot:e' }, 0, false, uid).label).toBe('double bed__slot:e');
  });

  it('writes the id and the lock from its arguments, not from the detection', () => {
    // `locked` is the review screen's "confirmed" state, and `id` is the array
    // index. Neither lives on Detection, which is why they are parameters.
    expect(toRecord(full, 7, true, uid).id).toBe(7);
    expect(toRecord(full, 7, true, uid).locked).toBe(true);
    expect(toRecord(full, 7, false, uid).locked).toBe(false);
  });

  it('reads an unknown or missing category as `other`, never as undefined', () => {
    // `category` is a string in the persisted shape and a union in Detection, so
    // this is the one place a room saved by an older build crosses a type boundary.
    const rec: SavedDetection = { id: 0, label: 'thing__slot:n', conf: 0.5, locked: false, box: [0, 0, 1, 1] };
    expect(fromRecord(rec).category).toBe('other');
    expect(fromRecord({ ...rec, category: 'chaise-longue' }).category).toBe('chaise-longue');
  });

  it('falls back to slot n when the label carries no suffix at all', () => {
    const rec: SavedDetection = { id: 0, label: 'thing', conf: 0.5, locked: false, box: [0, 0, 1, 1] };
    expect(fromRecord(rec).slot).toBe('n');
  });
});

describe('cleanLabelOf', () => {
  it('strips a slot suffix and leaves everything else alone', () => {
    expect(cleanLabelOf({ ...full, label: 'sofa__slot:w' })).toBe('sofa');
    expect(cleanLabelOf({ ...full, label: 'sofa' })).toBe('sofa');
    // Only at the END, and only a real slot letter — a label is user-editable text.
    expect(cleanLabelOf({ ...full, label: '__slot:n desk' })).toBe('__slot:n desk');
    expect(cleanLabelOf({ ...full, label: 'shelf__slot:x' })).toBe('shelf__slot:x');
  });
});

describe('fromRecords — a row keeps the id it builds as', () => {
  // A list saved before rows carried a uid: two sofas (the first unkept), a table, and
  // one row with no category at all.
  const legacy = (over: Partial<SavedDetection>): SavedDetection => ({
    id: 0,
    label: 'thing__slot:n',
    conf: 0.8,
    locked: true,
    box: [0.1, 0.5, 0.2, 0.3],
    ...over,
  });
  const rows: SavedDetection[] = [
    legacy({ category: 'sofa', locked: false }),
    legacy({ category: 'sofa' }),
    legacy({ category: 'table' }),
    legacy({}),
    legacy({ category: 'table', uid: 'kept-key' }),
  ];
  const room = (detectedObjects: SavedDetection[]): RoomData => ({
    id: 'r',
    createdAt: 1,
    name: 'R',
    layoutId: 'rect',
    width: 5,
    depth: 4,
    height: 2.6,
    detectedObjects,
  });

  it('counts every row of a kind, kept or not, the way the room always has', () => {
    expect(detectionPartIds(rows)).toEqual(['sofa-1', 'sofa-2', 'table-1', 'other-1', 'kept-key']);
    // …and the room builds the kept ones under exactly those ids.
    expect(buildSceneFromRoom(room(rows)).map((p) => p.id)).toEqual(['sofa-2', 'table-1', 'other-1', 'kept-key']);
  });

  // The property: through the review screen and back, a legacy room's pieces are the
  // same pieces, so the moves stored against them still land on them.
  it('survives the review screen without re-keying a single piece', () => {
    const through = fromRecords(rows).map((d, i) => toRecord(d, i, !!rows[i].locked, () => 'minted-fresh'));
    expect(through.map((r) => r.uid)).toEqual(['sofa-1', 'sofa-2', 'table-1', 'other-1', 'kept-key']);
    expect(buildSceneFromRoom(room(through)).map((p) => p.id)).toEqual(buildSceneFromRoom(room(rows)).map((p) => p.id));
  });

  it('reads every other field exactly as fromRecord does', () => {
    const one = fromRecords([rows[2]])[0];
    expect({ ...one, uid: undefined }).toEqual(fromRecord(rows[2]));
  });
});
