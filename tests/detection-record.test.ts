import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanLabelOf, detectionPartIds, fromRecord, fromRecords, toRecord, type SavedDetection } from '@/lib/detection-record';
import { buildSceneFromRoom, normalizeStoredParts, type ScenePart } from '@/lib/scene-spec';
import type { RoomData } from '@/lib/storage';
import type { Detection } from '@/lib/detection';
import { stripComments } from './helpers/source';

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
  it('reads a saved box back cut to its photo, as a fresh scan cuts it (§ 49.15)', () => {
    const past = toRecord({ ...full, box: [0.8, -0.05, 0.3, 0.5] }, 0, false, uid);
    const box = fromRecord(past).box;
    expect(box[0]).toBe(0.8);
    expect(box[1]).toBe(0);
    expect(box[2]).toBeCloseTo(0.2, 12);
    expect(box[3]).toBeCloseTo(0.45, 12);
    // Once cut, saving and reading again changes nothing, which is what keeps a
    // re-save from counting as an edit in lib/rescan.ts.
    expect(fromRecord(toRecord(fromRecord(past), 0, false, uid))).toEqual(fromRecord(past));
    // A box with nothing in the photo is kept as saved rather than dropped.
    const outside = toRecord({ ...full, box: [1.2, 0.2, 0.3, 0.4] }, 0, false, uid);
    expect(fromRecord(outside).box).toEqual([1.2, 0.2, 0.3, 0.4]);
  });

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

  // Until § 49.17 a cloud row was saved with whatever the model wrote for its wall,
  // and the suffix read back only `[nesw]`: every one of these came back on the
  // north wall, still carrying the suffix in its name.
  const saved = (label: string): SavedDetection => ({ id: 0, label, conf: 0.5, locked: true, box: [0.3, 0.4, 0.3, 0.3], category: 'sofa' });

  it('reads a wall saved in the scan reader’s other words back as that wall (§ 49.18)', () => {
    for (const said of ['s', 'S', 'south', 'SOUTH', 'south wall', 'S WALL', ' South ']) {
      const d = fromRecord(saved(`Sofa__slot:${said}`));
      expect([said, d.label, d.slot]).toEqual([said, 'Sofa', 's']);
    }
    for (const said of ['e', 'East', 'w', 'WEST', 'n', 'north wall']) {
      expect(fromRecord(saved(`Sofa__slot:${said}`)).slot).toBe(said.trim()[0].toLowerCase());
    }
  });

  it('reads the FIRST suffix of a label a re-save stacked, and heals it on the next save', () => {
    // Saving a `south` row again read it as `n` and wrote that over the top.
    const stacked = saved('Sofa__slot:south__slot:n');
    expect(fromRecord(stacked)).toMatchObject({ label: 'Sofa', slot: 's' });
    expect(toRecord(fromRecord(stacked), 0, true, uid).label).toBe('Sofa__slot:s');
  });

  it('strips a suffix that names no wall, and answers n for it as for none', () => {
    for (const said of ['up', 'x', '', 'constructor', 'nwall']) {
      expect(fromRecord(saved(`Sofa__slot:${said}`))).toMatchObject({ label: 'Sofa', slot: 'n' });
    }
  });
});

describe('cleanLabelOf', () => {
  it('strips a slot suffix and leaves everything else alone', () => {
    expect(cleanLabelOf({ ...full, label: 'sofa__slot:w' })).toBe('sofa');
    expect(cleanLabelOf({ ...full, label: 'sofa' })).toBe('sofa');
    expect(cleanLabelOf({ ...full, label: 'sofa_slot:w' })).toBe('sofa_slot:w');
  });

  it('strips a suffix that names no wall too, and everything after the first (§ 49.18)', () => {
    // This used to leave both alone, on the ground that a label is user-editable
    // text. Nobody types `__slot:`; the labels that carry one the old reader could
    // not read are cloud rows saved before § 49.17 with the model's own word for the
    // wall, and leaving the suffix on is what put `shelf__slot:x` on screen.
    expect(cleanLabelOf({ ...full, label: 'shelf__slot:x' })).toBe('shelf');
    expect(cleanLabelOf({ ...full, label: 'desk__slot:n wall__slot:n' })).toBe('desk');
    expect(cleanLabelOf({ ...full, label: '__slot:n desk' })).toBe('');
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

describe('one reader of the slot suffix (§ 49.18)', () => {
  const savedRoom = (label: string): RoomData => ({
    id: 'r',
    createdAt: 1,
    name: 'R',
    layoutId: 'rect',
    width: 4,
    depth: 4,
    height: 2.6,
    detectedObjects: [{ id: 0, uid: 'sofa-key', label, conf: 0.9, source: 'cloud', locked: true, box: [0.3, 0.4, 0.3, 0.3], category: 'sofa', dimMM: [2000, 900, 850] }],
  });
  const built = (label: string) => {
    const p = buildSceneFromRoom(savedRoom(label)).find((q) => q.id === 'sofa-key')!;
    return { name: p.name, slot: p.fromDetection?.slot, pos: p.pos };
  };

  it('builds a wall saved in words on that wall, under its own name', () => {
    const south = built('Sofa__slot:s');
    // The two walls build apart, or the comparisons below could not fail.
    expect(built('Sofa__slot:n').pos).not.toEqual(south.pos);
    expect(south).toMatchObject({ name: 'Sofa', slot: 's' });
    for (const label of ['Sofa__slot:south', 'Sofa__slot:SOUTH', 'Sofa__slot:S', 'Sofa__slot:south__slot:n']) {
      expect([label, built(label)]).toEqual([label, south]);
    }
    expect(built('Sofa__slot:up')).toEqual(built('Sofa__slot:n'));
  });

  it('cleans the name of a detected piece in a saved scene, and moves nothing', () => {
    // A room the user has edited opens from its snapshot rather than rebuilding, so
    // the builder's fix never reaches a piece the old builder already named.
    const part = buildSceneFromRoom(savedRoom('Sofa__slot:s')).find((q) => q.id === 'sofa-key')!;
    const old = (name: string): ScenePart => ({ ...part, name, fromDetection: { ...part.fromDetection!, slot: 'n' } });
    for (const [was, now] of [
      ['Sofa__slot:south', 'Sofa'],
      ['Sofa__slot:south__slot:n', 'Sofa'],
      ['__slot:up', 'sofa'],
    ]) {
      const stale = old(was);
      const [p] = normalizeStoredParts([stale]);
      expect([was, p.name]).toEqual([was, now]);
      expect(p).toEqual({ ...stale, name: now });
    }
    // A clean piece comes back as itself, which the memoised part list depends on…
    const clean = old('Sofa');
    expect(normalizeStoredParts([clean])[0]).toBe(clean);
    // …and so does one the scan did not build, whatever it is called.
    const added: ScenePart = { ...clean, name: 'Sofa__slot:south', fromDetection: undefined };
    expect(normalizeStoredParts([added])[0]).toBe(added);
    // A stored name that is not a string is read defensively, not split.
    const odd = { ...clean, name: 7 } as unknown as ScenePart;
    expect(normalizeStoredParts([odd])[0]).toBe(odd);
  });

  it('is written out nowhere but lib/detection-record.ts', () => {
    // Four readers each carried their own `[nesw]`, and that is how a saved word for
    // a wall came to mean north in all four. `stripComments` keeps strings and regex
    // literals, so a quoted or matched `__slot` is code and is caught.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) files.push(relative(process.cwd(), full).split('\\').join('/'));
      }
    };
    for (const root of ['app', 'components', 'lib']) walk(join(process.cwd(), root));
    expect(files).toEqual(
      expect.arrayContaining(['lib/scene-spec.ts', 'lib/detect-prompt.ts', 'components/studio/PhotoEditor.tsx', 'app/onboarding/detect/page.tsx']),
    );
    const writesIt = (f: string) => stripComments(readFileSync(f, 'utf8')).includes('__slot');
    // The one home must read as writing it, or a sweep that sees nothing passes.
    const home = 'lib/detection-record.ts';
    expect(writesIt(home)).toBe(true);
    expect(files.filter((f) => f !== home && writesIt(f))).toEqual([]);
  });
});
