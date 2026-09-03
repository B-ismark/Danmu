import { describe, expect, it } from 'vitest';
import {
  buildSceneFile,
  MAX_FILE_BYTES,
  parseSceneFile,
  SCENE_FILE_FORMAT,
  SCENE_FILE_VERSION,
  sceneFileJson,
  sceneFileName,
  sceneFileToRoom,
  type SceneFile,
} from '../lib/scene-file';
import { dimRangeFor, ROOM_HEIGHT_M } from '../lib/dimension-ranges';
import { MOUNT_PAD } from '../lib/physics';
import type { RoomData, Transforms } from '../lib/storage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSceneFromRoom,
  CATALOG_SHAPES_ORDERED,
  CATEGORIES,
  isWallMountedPart,
  normalizeStoredParts,
} from '../lib/scene-spec';
import { stripCommentsAndStrings } from './helpers/source';
import type { ScenePart } from '../lib/scene-spec';

const ROOM: RoomData = {
  id: 'room-1',
  createdAt: 1_700_000_000_000,
  name: 'Front Room',
  layoutId: 'rect',
  width: 5,
  depth: 4,
  height: 2.6,
};

const SOFA: ScenePart = {
  id: 'sofa-1',
  category: 'sofa',
  name: 'Sofa',
  shape: 'sofa',
  pos: [0, 0.44, -1.5],
  rot: 0,
  dimMM: [2200, 950, 880],
  locked: false,
};

const NO_TRANSFORMS: Transforms = { positions: {}, rotations: {}, dims: {} };

/** Export → JSON → parse, the trip a file actually makes. */
function roundTrip(
  room: RoomData = ROOM,
  parts: ScenePart[] = [SOFA],
  transforms: Transforms = NO_TRANSFORMS,
) {
  const out = parseSceneFile(sceneFileJson(buildSceneFile(room, parts, transforms, 1_700_000_000_001)));
  if (!out.ok) throw new Error(`expected a readable file, got: ${out.error}`);
  return out;
}

/** A minimal valid file as loose JSON, so a test can corrupt one field at a time
 *  without the type checker defending it. */
function rawFile(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: SCENE_FILE_FORMAT,
    version: SCENE_FILE_VERSION,
    exportedAt: 1,
    room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: 2.6 },
    parts: [],
    ...over,
  });
}

function rawPart(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    category: 'sofa',
    name: 'Sofa',
    shape: 'sofa',
    pos: [0, 0.44, -1.5],
    rot: 0,
    dimMM: [2200, 950, 880],
    locked: false,
    ...over,
  };
}

/** Parse a file carrying exactly these parts. */
function withParts(parts: unknown[]) {
  const out = parseSceneFile(rawFile({ parts }));
  if (!out.ok) throw new Error(`expected a readable file, got: ${out.error}`);
  return out;
}

describe('scene file · round trip', () => {
  it('carries the room and its furniture', () => {
    const { file, dropped } = roundTrip();
    expect(dropped).toEqual([]);
    expect(file.room).toEqual({ name: 'Front Room', layoutId: 'rect', width: 5, depth: 4, height: 2.6 });
    expect(file.parts).toHaveLength(1);
    expect(file.parts[0]).toMatchObject({ id: 'sofa-1', shape: 'sofa', dimMM: [2200, 950, 880] });
  });

  it('carries wall paint, a custom outline and the site', () => {
    const { file } = roundTrip({
      ...ROOM,
      layoutId: 'custom',
      wallColors: { 0: '#aabbcc', 2: '#112233' },
      footprint: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
      site: { bearingDeg: 90 },
    });
    expect(file.room.wallColors).toEqual({ 0: '#aabbcc', 2: '#112233' });
    expect(file.room.footprint).toHaveLength(4);
    expect(file.room.site).toEqual({ bearingDeg: 90 });
  });

  it('exports the bearing and nothing else, even from a record that carries more', () => {
    // The leak this closes. The old sun mood stored a latitude and a longitude on
    // `site`; removing them from the TYPE stopped anything reading them but left
    // the bytes, and because they are no longer declared TypeScript cannot see
    // them ride along a spread. `buildSceneFile` wrote `room.site` wholesale, so
    // coordinates for the inside of someone's home went into the file whose entire
    // purpose is to be handed to someone else — while `readSite` correctly refused
    // them coming back. Asymmetric, in the leaking direction.
    //
    // The cast is the point of the test: this is what a real legacy record looks
    // like, and the type system is exactly what could not catch it.
    const legacy = { bearingDeg: 90, lat: 5.6039, lon: -0.187 } as unknown as typeof ROOM.site;
    const { file } = roundTrip({ ...ROOM, site: legacy });
    expect(file.room.site).toEqual({ bearingDeg: 90 });
    // Asserted on the serialised bytes too, not only on the object: the object is
    // what a projection produces, the bytes are what actually leaves the machine.
    expect(JSON.stringify(file)).not.toMatch(/lat|lon/);
  });

  it('bakes the studio overrides, so the file shows what the user is looking at', () => {
    // The live app keeps a part's transform in two places and lets the override win.
    // A file resolves that instead of reproducing it.
    const { file } = roundTrip(ROOM, [SOFA], {
      positions: { 'sofa-1': [1, 0.44, 2] },
      rotations: { 'sofa-1': Math.PI / 2 },
      dims: { 'sofa-1': [1800, 900, 800] },
    });
    expect(file.parts[0].pos).toEqual([1, 0.44, 2]);
    expect(file.parts[0].rot).toBeCloseTo(Math.PI / 2);
    expect(file.parts[0].dimMM).toEqual([1800, 900, 800]);
  });

  it('keeps a hidden piece hidden, and puts it back in the transforms on the way in', () => {
    const { file } = roundTrip(ROOM, [SOFA], { ...NO_TRANSFORMS, hidden: { 'sofa-1': true } });
    expect(file.parts[0].hidden).toBe(true);

    const { parts, transforms } = sceneFileToRoom(file);
    expect(transforms.hidden).toEqual({ 'sofa-1': true });
    // `hidden` is per-room state, not a property of the piece — it must not ride
    // along on the ScenePart the scene store holds.
    expect('hidden' in parts[0]).toBe(false);
  });

  it('returns empty override maps, because the parts already carry the final values', () => {
    const { file } = roundTrip(ROOM, [SOFA], { positions: { 'sofa-1': [1, 0.44, 2] }, rotations: {}, dims: {} });
    const { parts, transforms } = sceneFileToRoom(file);
    expect(transforms.positions).toEqual({});
    expect(parts[0].pos).toEqual([1, 0.44, 2]);
  });

  it('carries a resting-on-top relationship, split back into transforms on the way in', () => {
    const LAMP: ScenePart = { ...SOFA, id: 'lamp-1', name: 'Lamp' };
    const { file } = roundTrip(ROOM, [SOFA, LAMP], { ...NO_TRANSFORMS, parentIds: { 'lamp-1': 'sofa-1' } });
    expect(file.parts.find((p) => p.id === 'lamp-1')!.parentId).toBe('sofa-1');
    expect(file.parts.find((p) => p.id === 'sofa-1')!.parentId).toBeUndefined();

    const { parts, transforms } = sceneFileToRoom(file);
    expect(transforms.parentIds).toEqual({ 'lamp-1': 'sofa-1' });
    // Like `hidden`, this is per-room state, not a property of the piece.
    expect(parts.every((p) => !('parentId' in p))).toBe(true);
  });

  it('writes a rider at the height its support is NOW, not the height it was built at', () => {
    // § 12, at the one boundary where getting it wrong is unrecoverable. The two
    // transform layers are baked here, and neither of them holds a rider's Y after its
    // support was resized — nothing wrote one. Baking through `resolveParts` therefore
    // wrote the lamp at 0.45, the desk's ORIGINAL top, into a file that then opens on a
    // machine which never saw the resize and has nothing left to derive the right
    // answer from.
    const DESK: ScenePart = {
      id: 'desk-1', category: 'desk', name: 'Desk', shape: 'desk-standard',
      pos: [0, 0, 0], rot: 0, dimMM: [1400, 700, 450], locked: false,
    };
    const LAMP: ScenePart = {
      id: 'lamp-1', category: 'lamp', name: 'Lamp', shape: 'lamp-table',
      pos: [0, 0.45, 0], rot: 0, dimMM: [300, 300, 400], locked: false,
    };
    const grown: Transforms = { ...NO_TRANSFORMS, dims: { 'desk-1': [1400, 700, 900] } };
    const { file } = roundTrip(ROOM, [DESK, LAMP], grown);
    expect(file.parts.find((p) => p.id === 'desk-1')!.dimMM).toEqual([1400, 700, 900]);
    expect(file.parts.find((p) => p.id === 'lamp-1')!.pos).toEqual([0, 0.9, 0]);
  });
});

describe('scene file · what never leaves', () => {
  it('does not carry a detection box into a file that has no photos', () => {
    const detected: ScenePart = {
      ...SOFA,
      fromDetection: { slot: 'n', bbox: [0, 0, 1, 1], conf: 0.9 },
    };
    const file = buildSceneFile(ROOM, [detected], NO_TRANSFORMS, 1);
    expect('fromDetection' in file.parts[0]).toBe(false);
    expect(sceneFileJson(file)).not.toContain('fromDetection');
  });

  it('has no room for a photo anywhere in the serialised form', () => {
    // The privacy line this format is built around: a file is for sending to
    // someone, and the captures are pictures of the inside of a home.
    const json = sceneFileJson(buildSceneFile(ROOM, [SOFA], NO_TRANSFORMS, 1));
    for (const forbidden of ['blob', 'capture', 'cap:', 'image/', 'base64', 'detectedObjects']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('does not touch the parts it was handed', () => {
    // `buildSceneFile` resolves overrides and then sets `hidden` on the result. Those
    // parts come straight out of the scene store, so writing through to them would be
    // an export quietly editing the room — and `resolveParts` returns the SAME object
    // when a part has no overrides, which is exactly when it would happen.
    const parts = [SOFA];
    const before = JSON.stringify(SOFA);
    buildSceneFile(ROOM, parts, { ...NO_TRANSFORMS, hidden: { 'sofa-1': true } }, 1);
    expect(JSON.stringify(SOFA)).toBe(before);
    expect('hidden' in SOFA).toBe(false);
  });

  it('leaves the exporting room’s identity behind', () => {
    // id / createdAt describe a record in one browser's IndexedDB, not the room.
    const json = sceneFileJson(buildSceneFile(ROOM, [SOFA], NO_TRANSFORMS, 1));
    expect(json).not.toContain('room-1');
    expect(JSON.parse(json).room.createdAt).toBeUndefined();
  });

  it('ignores a key it does not know, rather than refusing the piece', () => {
    // The general case of a test that used to name one field (`meshHash`, from the
    // deleted mesh cache): a part is read key by key against a whitelist, so a file
    // written by a newer build — or an older one carrying a field since removed —
    // imports as far as this build understands it instead of failing whole.
    const { file, dropped } = withParts([rawPart({ meshHash: 'abc123', somethingNewer: 7 })]);
    expect(dropped).toEqual([]);
    expect(file.parts).toHaveLength(1);
    expect(file.parts[0]).not.toHaveProperty('meshHash');
    expect(file.parts[0]).not.toHaveProperty('somethingNewer');
    expect(file.parts[0].name).toBe('Sofa');
  });
});

describe('scene file · a file is untrusted input', () => {
  it('refuses text that is not JSON', () => {
    const out = parseSceneFile('not json at all {');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/readable|damaged/i);
  });

  it('refuses JSON that is not ours', () => {
    const out = parseSceneFile(JSON.stringify({ some: 'other tool', version: 1 }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/isn't a Danmu room/i);
  });

  it('refuses a primitive and an array at the top level', () => {
    expect(parseSceneFile('42').ok).toBe(false);
    expect(parseSceneFile('[]').ok).toBe(false);
    expect(parseSceneFile('null').ok).toBe(false);
  });

  it('names the version skew rather than calling a newer file invalid', () => {
    const out = parseSceneFile(rawFile({ version: SCENE_FILE_VERSION + 1 }));
    expect(out.ok).toBe(false);
    // The fix is on this side, and the user cannot infer that from "invalid file".
    if (!out.ok) expect(out.error).toMatch(/newer version.*[Uu]pdate/s);
  });

  it('reads an older file, since every change so far is additive', () => {
    expect(parseSceneFile(rawFile({ version: 0 })).ok).toBe(true);
  });

  it('refuses a file longer than the cap without trying to parse it', () => {
    const out = parseSceneFile('x'.repeat(MAX_FILE_BYTES + 1));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/too large/i);
  });

  it('refuses a file with no usable room', () => {
    expect(parseSceneFile(rawFile({ room: undefined })).ok).toBe(false);
    expect(parseSceneFile(rawFile({ room: { name: 'R' } })).ok).toBe(false);
    // Out-of-range SIDES are fatal for the room itself: there is no floor to stand
    // furniture on, and unlike a colour there is no sensible default.
    expect(parseSceneFile(rawFile({ room: { width: 0, depth: 4, height: 2.6 } })).ok).toBe(false);
    // A height that is not a number is fatal for the same reason a width is.
    expect(parseSceneFile(rawFile({ room: { width: 5, depth: 4, height: 'tall' } })).ok).toBe(false);
    // …but a side a rounding error under the bound is a room THIS APP JUST WROTE.
    // A wall reaches the 1 m floor by repeated addition, and five of six plausible
    // (start width, step) pairs land on 0.99999999999999844. An exact `>= lo` here
    // makes that file fatal — "that room file has no usable room" — and it fails
    // only when the user tries to hand the room to someone else, which is the
    // entire sharing story. `ROOM_SIDE_EPS` is the same tolerance the two wall
    // movers carry; a bound with a tolerance has to carry it everywhere it is read.
    expect(parseSceneFile(rawFile({ room: { name: 'R', layoutId: 'rect', width: 0.99999999999999844, depth: 4, height: 2.6 } })).ok).toBe(true);
    // And it forgives arithmetic only — a 0.99 m side is still a refusal.
    expect(parseSceneFile(rawFile({ room: { name: 'R', layoutId: 'rect', width: 0.99, depth: 4, height: 2.6 } })).ok).toBe(false);
    expect(parseSceneFile(rawFile({ room: { width: 5, depth: 4 } })).ok).toBe(false);
    // 1 m is a legal SIDE, which is what made the old copy of the bound invisible:
    // the number was in range, for the wrong axis.
    expect(parseSceneFile(rawFile({ room: { width: 1.2, depth: 4, height: 2.6 } })).ok).toBe(true);
  });

  it('clamps an out-of-range ceiling and says so, rather than losing the room', () => {
    // A ceiling is the one room dimension that is lossy rather than fatal, and the
    // reason is that this app WROTE rooms a 1.8 m floor now rejects — the editor
    // gated every axis with the side range until `ROOM_HEIGHT_M` existed, and the
    // fan bug that prompted it came from a 1.65 m room. Refusing the file meant
    // saving that room and getting "missing its room" back, about a file this app
    // produced. It is the same contract `clampDims` gives every imported PART size,
    // and it is not silent: `dropped` is shown.
    const low = parseSceneFile(rawFile({ room: { width: 5, depth: 4, height: 1.65 } }));
    expect(low.ok).toBe(true);
    if (low.ok) {
      expect(low.file.room.height).toBe(ROOM_HEIGHT_M.min);
      expect(low.dropped.join(' ')).toMatch(/ceiling/i);
      expect(low.dropped.join(' ')).toContain('1.65');
    }
    // Both ends, because a clamp with a sign error is invisible at one of them.
    const high = parseSceneFile(rawFile({ room: { width: 5, depth: 4, height: 1e6 } }));
    expect(high.ok).toBe(true);
    if (high.ok) {
      expect(high.file.room.height).toBe(ROOM_HEIGHT_M.max);
      expect(high.dropped.join(' ')).toMatch(/ceiling/i);
    }
    // A ceiling already in range is passed through and reported as nothing.
    const fine = parseSceneFile(rawFile({ room: { width: 5, depth: 4, height: 2.6 } }));
    expect(fine.ok).toBe(true);
    if (fine.ok) {
      expect(fine.file.room.height).toBe(2.6);
      expect(fine.dropped.join(' ')).not.toMatch(/ceiling/i);
    }
    // Infinity is still refused outright — clamping it would turn `1e400` into a
    // legal 12 m ceiling, which is the one case where lossy would be dishonest.
    // Spliced into the JSON TEXT: `1e400` is already `Infinity` by the time a JS
    // object literal reaches `JSON.stringify`, which writes it out as `null` — so
    // building this through `rawFile`'s object would have tested the null path and
    // called it the infinity one.
    const inf = rawFile({ room: { width: 5, depth: 4, height: 2.6 } }).replace('"height":2.6', '"height":1e400');
    expect(JSON.parse(inf).room.height).toBe(Infinity);
    expect(parseSceneFile(inf).ok).toBe(false);
  });

  it('rejects Infinity, which JSON smuggles in as 1e400', () => {
    // JSON has no Infinity literal, but an over-large exponent parses to one — and
    // an infinite coordinate turns every comparison false and every matrix NaN
    // without throwing anywhere the app would notice.
    expect(JSON.parse('1e400')).toBe(Infinity);
    const { file, dropped } = withParts([rawPart({ pos: [0, 0, 1e400] })]);
    expect(file.parts).toHaveLength(0);
    expect(dropped.join(' ')).toMatch(/could not be read/i);
  });

  it('drops a piece whose shape it cannot render, rather than guessing', () => {
    const { file, dropped } = withParts([rawPart({ shape: 'teleporter' }), rawPart({ id: 'p2' })]);
    expect(file.parts.map((p) => p.id)).toEqual(['p2']);
    expect(dropped.join(' ')).toMatch(/1 piece could not be read/);
  });

  it('drops a piece with an unknown category, since sizing keys off it', () => {
    expect(withParts([rawPart({ category: 'spaceship' })]).file.parts).toHaveLength(0);
  });

  it('clamps an imported size instead of believing it', () => {
    // The trust boundary: a number from a file is a hint, exactly like a number
    // from a model. Nothing downstream should have to know where it came from.
    const { file } = withParts([rawPart({ dimMM: [99000, 99000, 99000] })]);
    const max = dimRangeFor('sofa', 'sofa').max;
    expect(file.parts[0].dimMM).toEqual(max);
  });

  it('clamps a size that is too small as well as too large', () => {
    const { file } = withParts([rawPart({ dimMM: [1, 1, 1] })]);
    expect(file.parts[0].dimMM).toEqual(dimRangeFor('sofa', 'sofa').min);
  });

  it('drops a piece with a malformed transform', () => {
    expect(withParts([rawPart({ pos: [0, 0] })]).file.parts).toHaveLength(0);
    expect(withParts([rawPart({ pos: 'middle' })]).file.parts).toHaveLength(0);
    expect(withParts([rawPart({ rot: null })]).file.parts).toHaveLength(0);
    expect(withParts([rawPart({ dimMM: ['2200', 950, 880] })]).file.parts).toHaveLength(0);
  });

  it('forgets a colour that is not a plain hex, and keeps the piece', () => {
    // A colour reaches a Three.js material and a style attribute, so nothing that is
    // not #rrggbb may survive the parse.
    for (const bad of ['red', 'url(evil)', '#ab', 'rgb(1,2,3)', '#12345g', 'javascript:x']) {
      const { file } = withParts([rawPart({ color: bad })]);
      expect(file.parts).toHaveLength(1);
      expect(file.parts[0].color).toBeUndefined();
    }
  });

  it('accepts a hex colour and normalises its case', () => {
    expect(withParts([rawPart({ color: '#AABBCC' })]).file.parts[0].color).toBe('#aabbcc');
  });

  it('forgets an unknown finish', () => {
    expect(withParts([rawPart({ finish: 'holographic' })]).file.parts[0].finish).toBeUndefined();
    expect(withParts([rawPart({ finish: 'matte' })]).file.parts[0].finish).toBe('matte');
  });

  it('gives a piece a fresh id when its own is missing or already taken', () => {
    // Two pieces sharing an id would move as one, because the transform maps and the
    // React list are both keyed on it.
    const { file } = withParts([rawPart({ id: 'dup' }), rawPart({ id: 'dup' }), rawPart({ id: '' })]);
    const ids = file.parts.map((p) => p.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('dup');
  });

  it('caps how many pieces it will read, and says that it did', () => {
    const { file, dropped } = withParts(
      Array.from({ length: 600 }, (_, i) => rawPart({ id: `p${i}` })),
    );
    expect(file.parts.length).toBeLessThanOrEqual(500);
    expect(dropped.join(' ')).toMatch(/only the first 500/);
  });

  it('truncates a name rather than storing an essay', () => {
    const { file } = withParts([rawPart({ name: 'n'.repeat(5000) })]);
    expect(file.parts[0].name.length).toBeLessThanOrEqual(200);
  });

  it('coerces a non-boolean lock to false', () => {
    expect(withParts([rawPart({ locked: 'yes' })]).file.parts[0].locked).toBe(false);
    expect(withParts([rawPart({ locked: true })]).file.parts[0].locked).toBe(true);
  });

  it('drops a parentId that points at nothing in the file, and says so', () => {
    const { file, dropped } = withParts([rawPart({ id: 'p1', parentId: 'ghost' })]);
    expect(file.parts[0].parentId).toBeUndefined();
    expect(dropped.join(' ')).toMatch(/relationship.*(missing|looping)/i);
  });

  it('refuses a piece parenting itself', () => {
    const { file, dropped } = withParts([rawPart({ id: 'p1', parentId: 'p1' })]);
    expect(file.parts[0].parentId).toBeUndefined();
    expect(dropped.join(' ')).toMatch(/relationship/i);
  });

  it('resolves a parentId reference even when the REFERENCING piece itself needed a fresh id', () => {
    // p1 is a valid, unique target; the second piece has no id of its own and
    // gets reminted — its own remint must not stop its parentId from resolving.
    const { file } = withParts([rawPart({ id: 'p1' }), rawPart({ id: '', parentId: 'p1' })]);
    expect(file.parts).toHaveLength(2);
    const child = file.parts.find((p) => p.id !== 'p1')!;
    expect(child.parentId).toBe('p1');
  });

  it('resolves a parentId to the piece that KEPT the duplicated id, not the reminted one', () => {
    // Two pieces both claim `desk`. The first keeps it; the second is reminted.
    // A reference to `desk` means the one still answering to that name — last
    // writer wins in the id map pointed it at the piece that lost the name.
    const { file } = withParts([
      rawPart({ id: 'desk', name: 'Keeper' }),
      rawPart({ id: 'desk', name: 'Reminted' }),
      rawPart({ id: 'lamp', parentId: 'desk' }),
    ]);
    expect(file.parts).toHaveLength(3);
    const keeper = file.parts.find((p) => p.name === 'Keeper')!;
    const reminted = file.parts.find((p) => p.name === 'Reminted')!;
    expect(keeper.id).toBe('desk');
    expect(reminted.id).not.toBe('desk');
    expect(file.parts.find((p) => p.id === 'lamp')!.parentId).toBe(keeper.id);
  });

  it('breaks an in-file cycle at exactly one edge rather than refusing the whole chain', () => {
    const { file, dropped } = withParts([
      rawPart({ id: 'a', parentId: 'c' }),
      rawPart({ id: 'b', parentId: 'a' }),
      rawPart({ id: 'c', parentId: 'b' }),
    ]);
    expect(file.parts).toHaveLength(3);
    const byId = new Map(file.parts.map((p) => [p.id, p.parentId]));
    const links = [byId.get('a'), byId.get('b'), byId.get('c')].filter(Boolean);
    expect(links).toHaveLength(2); // one edge refused; the other two survive
    expect(dropped.join(' ')).toMatch(/relationship.*looping/i);
  });
});

describe('scene file · degrading a room rather than refusing it', () => {
  it('falls back to the preset shape when the outline is unreadable, and says so', () => {
    const out = parseSceneFile(
      rawFile({ room: { name: 'R', layoutId: 'l', width: 5, depth: 4, height: 2.6, footprint: [[0, 0], [1, 1]] } }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.file.room.footprint).toBeUndefined();
      expect(out.file.room.layoutId).toBe('l');
      expect(out.dropped.join(' ')).toMatch(/outline was unreadable/i);
    }
  });

  it('refuses an outline whole rather than truncating it', () => {
    // Half an outline is a different room, not a partial one.
    const many = Array.from({ length: 300 }, (_, i) => [i * 0.01, 0]);
    const out = parseSceneFile(rawFile({ room: { name: 'R', layoutId: 'custom', width: 5, depth: 4, height: 2.6, footprint: many } }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.file.room.footprint).toBeUndefined();
  });

  it('keeps only the wall colours that are real hexes', () => {
    const out = parseSceneFile(
      rawFile({
        room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: 2.6, wallColors: { 0: '#aabbcc', 1: 'red', notAnIndex: '#ffffff' } },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.file.room.wallColors).toEqual({ 0: '#aabbcc' });
  });

  it('drops a bearing that is not a direction, and says so', () => {
    const out = parseSceneFile(
      rawFile({ room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: 2.6, site: { bearingDeg: 900 } } }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.file.room.site).toBeUndefined();
      expect(out.dropped.join(' ')).toMatch(/which way the room faces/i);
    }
  });

  it('reads past the latitude and longitude an older file carries', () => {
    // `Site` held a `lat` and a `lon` while the sun mood computed a real solar
    // position from them. Both are gone from the type (see `lib/storage.ts`), and
    // a file written by that build must still import — with its bearing kept and
    // the coordinates simply not brought across. They are NOT reported in
    // `dropped`: that list is for content the user would notice missing from
    // their room, and a latitude nothing renders is not.
    const out = parseSceneFile(
      rawFile({
        room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: 2.6, site: { lat: 5.6, lon: -0.2, bearingDeg: 90 } },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.file.room.site).toEqual({ bearingDeg: 90 });
      expect(out.dropped.join(' ')).not.toMatch(/faces|latitude|location/i);
    }
  });

  it('keeps a bearing whose file also carries an impossible latitude', () => {
    // The order these are checked in matters, and getting it wrong is silent: if
    // `readSite` still validated the coordinates it no longer keeps, one bad
    // legacy number would throw away a perfectly good bearing and the room would
    // import facing the wrong way.
    const out = parseSceneFile(
      rawFile({
        room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: 2.6, site: { lat: 200, lon: 999, bearingDeg: 45 } },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.file.room.site).toEqual({ bearingDeg: 45 });
  });

  it('falls back to a custom layout for an unknown preset, keeping the sizes', () => {
    const out = parseSceneFile(rawFile({ room: { name: 'R', layoutId: 'hexagon', width: 5, depth: 4, height: 2.6 } }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.file.room.layoutId).toBe('custom');
      expect(out.file.room.width).toBe(5);
    }
  });

  it('names an unnamed room instead of opening a blank card', () => {
    const out = parseSceneFile(rawFile({ room: { layoutId: 'rect', width: 5, depth: 4, height: 2.6 } }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.file.room.name).toBe('Imported room');
  });
});

describe('scene file · decor and light', () => {
  it('keeps well-formed decor and skips the rest', () => {
    const { file } = withParts([
      rawPart({
        decor: [
          { id: 'd1', kind: 'books', x: 0.1, z: 0.2 },
          { id: 'd2', kind: 'trophy', x: 0, z: 0 },
          { kind: 'vase', x: 0, z: 0 },
        ],
      }),
    ]);
    const decor = file.parts[0].decor ?? [];
    expect(decor.map((d) => d.kind)).toEqual(['books', 'vase']);
    expect(decor[1].id).toBeTruthy();
  });

  it('keeps an empty decor array, which means the user cleared the surface', () => {
    // Distinct from absent, which means "never touched, show a suggestion".
    expect(withParts([rawPart({ decor: [] })]).file.parts[0].decor).toEqual([]);
  });

  it('keeps a lamp’s real units and drops a physically impossible one', () => {
    expect(withParts([rawPart({ light: { lumens: 400, kelvin: 2700 } })]).file.parts[0].light).toEqual({
      lumens: 400,
      kelvin: 2700,
    });
    expect(withParts([rawPart({ light: { lumens: 1e9, kelvin: 2700 } })]).file.parts[0].light).toBeUndefined();
    expect(withParts([rawPart({ light: { lumens: 400, kelvin: 0 } })]).file.parts[0].light).toBeUndefined();
  });

  it('keeps a cone angle only when it is one', () => {
    expect(withParts([rawPart({ light: { lumens: 400, kelvin: 2700, coneDeg: 60 } })]).file.parts[0].light?.coneDeg).toBe(60);
    expect(withParts([rawPart({ light: { lumens: 400, kelvin: 2700, coneDeg: 400 } })]).file.parts[0].light?.coneDeg).toBeUndefined();
  });
});

describe('scene file · filenames', () => {
  it('slugs a room name', () => {
    expect(sceneFileName('Front Room')).toBe('front-room.danmu.json');
    expect(sceneFileName('  Ama’s Flat!! ')).toBe('ama-s-flat.danmu.json');
  });

  it('falls back rather than producing a dotfile', () => {
    expect(sceneFileName('')).toBe('room.danmu.json');
    expect(sceneFileName('!!!')).toBe('room.danmu.json');
  });

  it('bounds the length', () => {
    expect(sceneFileName('a'.repeat(500)).length).toBeLessThanOrEqual(60 + '.danmu.json'.length);
  });
});

describe('scene file · the shape of the format itself', () => {
  it('stamps the format and version it was written with', () => {
    const file: SceneFile = buildSceneFile(ROOM, [], NO_TRANSFORMS, 42);
    expect(file.format).toBe(SCENE_FILE_FORMAT);
    expect(file.version).toBe(SCENE_FILE_VERSION);
    expect(file.exportedAt).toBe(42);
  });

  it('is readable by a human, which is most of what makes a local format trustworthy', () => {
    expect(sceneFileJson(buildSceneFile(ROOM, [SOFA], NO_TRANSFORMS, 1))).toContain('\n  ');
  });

  it('survives an empty room', () => {
    const out = roundTrip(ROOM, []);
    expect(out.file.parts).toEqual([]);
    expect(sceneFileToRoom(out.file).parts).toEqual([]);
  });
});

describe('a clamped ceiling takes its pieces with it', () => {
  // Clamping the ceiling and leaving the pieces where they were is half a repair.
  // The clamp exists because this app WROTE rooms below the current 1.8 m floor —
  // the fan bug was reported from a 1.65 m room — so the file that most needs
  // clamping is exactly the file with a fan hung from the ceiling it is clamping.
  // Saving that room and opening it again raised the ceiling and left the fan at
  // its old height: the original complaint, reproduced by the fix for it, with the
  // toast naming the ceiling and never the pieces it had just invalidated.
  const LOW = 1.65;
  const FLOOR = ROOM_HEIGHT_M.min;

  function importedFan() {
    const fan = rawPart({
      id: 'fan',
      category: 'fan',
      name: 'Fan',
      shape: 'fan',
      dimMM: [1000, 1000, 300],
      // Hung just under the 1.65 m ceiling the file was written with.
      pos: [0, LOW - 0.15, 0],
    });
    const parsed = parseSceneFile(
      rawFile({ room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: LOW }, parts: [fan] }),
    );
    if (!parsed.ok) throw new Error('fixture did not parse');
    return parsed;
  }

  it('the fixture really is the clamped case', () => {
    // Without this the assertions below would pass on a file that was never clamped.
    expect(LOW).toBeLessThan(FLOOR);
    const parsed = importedFan();
    expect(parsed.file.room.height).toBeCloseTo(FLOOR, 9);
  });

  it('re-hangs the fan under the ceiling it was actually given', () => {
    const parsed = importedFan();
    const fan = parsed.file.parts[0];
    expect(fan).toBeDefined();
    // Two properties rather than one number, because the number is not the naive
    // one: following the ceiling would put the hub at 1.65, and the mount clamp
    // then caps it at `ceiling - h/2 - MOUNT_PAD`. Asserting 1.65 would be
    // asserting the bug's absence against a rule the code does not follow.
    //
    // It went UP…
    expect(fan!.pos[1]).toBeGreaterThan(LOW - 0.15);
    // …and it hangs under the ceiling it was actually given, pad included. Left
    // where the file put it, the hub sits at 1.50 in a 1.80 m room — a fan that
    // came off its own ceiling, which is the complaint the clamp exists to answer.
    expect(fan!.pos[1] + 0.15).toBeLessThanOrEqual(FLOOR - MOUNT_PAD + 1e-9);
    expect(fan!.pos[1] + 0.15).toBeGreaterThan(FLOOR - MOUNT_PAD - 0.05);
  });

  it('and says so, because nothing here is allowed to be lossy in silence', () => {
    const parsed = importedFan();
    expect(parsed.dropped.some((d) => /re-hung/.test(d))).toBe(true);
  });

  it('leaves a floor-standing piece exactly where it was', () => {
    // `heightForNewCeiling` decides who follows a ceiling, so a sofa must not.
    const sofa = rawPart({ id: 'sofa', pos: [0, 0.44, -1.5] });
    const parsed = parseSceneFile(
      rawFile({ room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: LOW }, parts: [sofa] }),
    );
    if (!parsed.ok) throw new Error('fixture did not parse');
    expect(parsed.file.parts[0].pos[1]).toBeCloseTo(0.44, 9);
  });

  it('does nothing at all when the ceiling was in range', () => {
    const fan = rawPart({ id: 'fan', category: 'fan', name: 'Fan', shape: 'fan', dimMM: [1000, 1000, 300], pos: [0, 2.4, 0] });
    const parsed = parseSceneFile(rawFile({ parts: [fan] })); // the default 2.6 m room
    if (!parsed.ok) throw new Error('fixture did not parse');
    expect(parsed.file.parts[0].pos[1]).toBeCloseTo(2.4, 9);
    expect(parsed.dropped.some((d) => /re-hung/.test(d))).toBe(false);
  });
});

describe('scene file · wallMounted is derived, and the note about it is true', () => {
  /** The eight things a file can put in a boolean field, against BOTH derived answers.
   *
   *  What this table catches is worth stating precisely, because it is not what it looks
   *  like. It does NOT catch the defect it was written for: the old code produced a note
   *  for the same six values this one does, and only the TEXT was wrong, so the counts
   *  are identical across that fix and the table is green on it. What it does catch is
   *  both plausible partial fixes — coercing with `=== true` and keeping one message
   *  (`0` on a sofa then agrees and the note vanishes), and dropping the malformed branch
   *  (every non-boolean goes silent). Measured, not assumed: those two mutations redden
   *  it and a full revert does not. The text assertion below is what holds the original
   *  defect down. */
  const VALUES: Array<[string, unknown]> = [
    ['true', true],
    ['false', false],
    ['zero', 0],
    ['one', 1],
    ['empty string', ''],
    ['the string true', 'true'],
    ['the string false', 'false'],
    ['null', null],
  ];

  /** A shape `anchorFor` puts on a wall, and one it puts on the floor. Both directions
   *  are needed: the flag is absent-means-false, so a mounted piece and a floor piece
   *  fail in opposite directions and a single fixture is green on half of it. */
  const MOUNTED = { category: 'tv', name: 'Telly', shape: 'tv', dimMM: [1450, 60, 820], expectMounted: true };
  const FLOOR = { category: 'sofa', name: 'Sofa', shape: 'sofa', dimMM: [2200, 950, 880], expectMounted: false };
  /** The ceiling family, which `wallMounted` lumps in with the wall pieces and which is
   *  the reason the note is phrased by anchor. `lamp-pendant` is also the one shape id
   *  whose leak into user copy would be unmistakable. */
  const CEILING = { category: 'lamp', name: 'Pendant', shape: 'lamp-pendant', dimMM: [350, 350, 400], expectMounted: true };

  function notesFor(base: Record<string, unknown>, over: Record<string, unknown>) {
    const { file, dropped } = withParts([rawPart({ ...base, ...over })]);
    return { notes: dropped.filter((d) => /wallMounted/i.test(d)), part: file.parts[0] };
  }

  it('says nothing when the file agrees, or leaves the field out', () => {
    expect(notesFor(MOUNTED, { wallMounted: true }).notes).toEqual([]);
    expect(notesFor(FLOOR, { wallMounted: false }).notes).toEqual([]);
    expect(notesFor(MOUNTED, {}).notes).toEqual([]);
    expect(notesFor(FLOOR, {}).notes).toEqual([]);
  });

  it('derives the flag whatever the file said, in both directions', () => {
    for (const [, value] of VALUES) {
      expect(notesFor(MOUNTED, { wallMounted: value }).part.wallMounted).toBe(true);
      expect(notesFor(CEILING, { wallMounted: value }).part.wallMounted).toBe(true);
      expect(notesFor(FLOOR, { wallMounted: value }).part.wallMounted).toBeUndefined();
    }
  });

  it('reports each of the eight values exactly once, or not at all', () => {
    // `toHaveLength` and not `toContain`: the old text was produced for values that
    // agreed, so "there is a note" was already satisfied by the defect.
    const expected: Record<string, [number, number]> = {
      // value            → [notes on a tv, notes on a sofa]
      true: [0, 1],
      false: [1, 0],
      zero: [1, 1],
      one: [1, 1],
      'empty string': [1, 1],
      'the string true': [1, 1],
      'the string false': [1, 1],
      null: [1, 1],
    };
    for (const [label, value] of VALUES) {
      const [onMounted, onFloor] = expected[label];
      expect(notesFor(MOUNTED, { wallMounted: value }).notes, `${label} on a tv`).toHaveLength(onMounted);
      expect(notesFor(FLOOR, { wallMounted: value }).notes, `${label} on a sofa`).toHaveLength(onFloor);
    }
  });

  it('never renders a claim the file did not make', () => {
    // A boolean that disagrees is quoted back verbatim…
    expect(notesFor(MOUNTED, { wallMounted: false }).notes[0]).toContain('said wallMounted: false');
    expect(notesFor(FLOOR, { wallMounted: true }).notes[0]).toContain('said wallMounted: true');

    // …and a non-boolean is named as malformed rather than coerced. This is the half
    // that a harder coercion cannot fix: `1` on a tv agrees in intent, and `=== true`
    // renders it as “said false”, which is the opposite of what the file says.
    for (const value of [0, 1, '', 'true', 'false', null]) {
      for (const base of [MOUNTED, FLOOR]) {
        const note = notesFor(base, { wallMounted: value }).notes[0];
        expect(note, `${JSON.stringify(value)} on a ${base.shape}`).toContain('neither true nor false');
        expect(note).not.toMatch(/said wallMounted/);
      }
    }
  });

  it('names where the piece belongs, by ANCHOR, and never by the flag', () => {
    // The first version of this read `a ${shape} is ${derived ? '' : 'not '}wall-mounted`,
    // which is two defects in one clause. `derivedMount` is `anchorFor(...) !== 'floor'`,
    // so it called a pendant and a ceiling fan "wall-mounted" — false, about a piece the
    // file two lines above knows hangs from the ceiling. And `shape` is the internal
    // kebab-case id, so a user was shown "a lamp-pendant" and "an ac-unit". The three
    // anchors are asserted TOGETHER because a single one is satisfied by a constant.
    expect(notesFor(MOUNTED, { wallMounted: false }).notes[0]).toContain('it is fixed to a wall');
    expect(notesFor(CEILING, { wallMounted: false }).notes[0]).toContain('it hangs from the ceiling');
    expect(notesFor(FLOOR, { wallMounted: true }).notes[0]).toContain('it stands on the floor');

    // And no internal id reaches the user. `lamp-pendant` is the one that would.
    for (const base of [MOUNTED, CEILING, FLOOR]) {
      const note = notesFor(base, { wallMounted: !base.expectMounted }).notes[0] ?? '';
      expect(note, `${base.shape} leaked its shape id`).not.toContain(base.shape);
    }
  });

  it('is silent on a file this app wrote — and not because it cannot fire', () => {
    const TV: ScenePart = {
      id: 'tv-1',
      category: 'tv',
      name: 'Telly',
      shape: 'tv',
      pos: [0, 1.2, -1.9],
      rot: 0,
      dimMM: [1450, 60, 820],
      locked: false,
      wallMounted: true,
    };
    expect(roundTrip(ROOM, [TV, SOFA]).dropped).toEqual([]);

    // The discriminator. `buildSceneFile` SPREADS the part it is handed rather than
    // deriving the flag, so the silence above is a property of the builders in
    // `scene-spec.ts` agreeing with `isWallMountedPart` — which can regress in that
    // file without this one changing. Hand the writer a part that disagrees and the
    // note comes back, which is what makes the empty array above evidence.
    const bad = roundTrip(ROOM, [{ ...TV, wallMounted: false }, SOFA]);
    expect(bad.dropped.filter((d) => /wallMounted/i.test(d))).toHaveLength(1);
  });
});

describe('scene file · a detected room reloads as the room that was saved', () => {
  /** The round trip that was NOT an identity. `buildSceneFromRoom` used to answer
   *  "is this mounted" from the category while `groundY` answered from the shape, so a
   *  detected pendant was built with the flag unset; `buildSceneFile` SPREADS, so the
   *  key was absent from the JSON; and `readPart` derives, so it came back `true`.
   *  `isAperture` and every `!p.wallMounted` reader flipped on reload, and `dropped`
   *  was empty — a file that OMITS a field disagrees with nothing, and omitting is
   *  exactly what our own writer did. Silent plus non-identity is the pair that makes
   *  it a defect rather than a difference.
   *
   *  This sits at the file boundary on purpose. The builder-side sweep in
   *  `scene-build.test.ts` pins the cause; this pins the consequence, and either side
   *  can regress without the other changing. */
  const DETECTED: RoomData = {
    id: 'r1',
    createdAt: 0,
    name: 'Detected',
    layoutId: 'rect',
    width: 5,
    depth: 4,
    height: 2.8,
    detectedObjects: [
      { id: 1, label: 'pendant__slot:n', conf: 0.9, locked: false, box: [0.2, 0.4, 0.3, 0.3], category: 'lamp' },
      { id: 2, label: 'sofa__slot:n', conf: 0.9, locked: false, box: [0.5, 0.6, 0.3, 0.3], category: 'sofa' },
    ],
  };

  it('keeps every mount flag across save and reload, and says nothing', () => {
    const built = buildSceneFromRoom(DETECTED);
    const pendant = built.find((p) => p.shape === 'lamp-pendant');
    expect(pendant, 'the fixture must produce a pendant').toBeDefined();

    const out = parseSceneFile(sceneFileJson(buildSceneFile(DETECTED, built, NO_TRANSFORMS, 1)));
    if (!out.ok) throw new Error(`expected a readable file, got: ${out.error}`);

    expect(out.dropped).toEqual([]);
    for (const before of built) {
      const after = out.file.parts.find((q) => q.id === before.id);
      expect(after, `${before.name} survived the trip`).toBeDefined();
      expect(!!after!.wallMounted, `${before.name} (${before.shape})`).toBe(!!before.wallMounted);
    }
  });
});

describe('a persisted snapshot is re-derived, not trusted', () => {
  // The boundary a fresh install can never reach. `RoomSync` prefers the IndexedDB
  // `scene` snapshot over rebuilding, and `dress` used to write `wallMounted: false` on
  // the dining pendant — so a room saved before the derivation landed holds a part whose
  // stored flag contradicts `isWallMountedPart`, and the same part is then read two ways
  // at once: derived by `settleHeights` / `plan-export` / `wall-move`, stored-flag by the
  // solver / `clearance` / `apertures` / `item-snap` / the Inspector.
  //
  // Every other fixture in this suite BUILDS a scene rather than loading one, which is
  // exactly why nothing noticed: it looks perfect on a fresh install and on CI, and bites
  // only users with history.
  const stored = (over: Partial<ScenePart>): ScenePart => ({
    id: 'x',
    category: 'other',
    name: 'X',
    shape: 'box',
    pos: [0, 0, 0],
    rot: 0,
    dimMM: [600, 600, 800],
    locked: false,
    ...over,
  });

  it('corrects a stale flag in both directions', () => {
    // The real case, verbatim: a pendant written as floor-standing.
    const pendant = stored({ id: 'p', category: 'lamp', shape: 'lamp-pendant', dimMM: [350, 350, 400], wallMounted: false });
    // And the mirror, which is the half a one-directional fix would miss: a sofa that a
    // hand-edited or older snapshot claims is mounted.
    const sofa = stored({ id: 's', category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], wallMounted: true });

    const [p, s] = normalizeStoredParts([pendant, sofa]);
    expect(p.wallMounted, 'a pendant hangs from the ceiling').toBe(true);
    expect(s.wallMounted, 'a sofa stands on the floor').toBeUndefined();
    // ABSENT, not `false` — the flag is optional and every reader tests `!p.wallMounted`,
    // so matching what the builders emit keeps one answer rather than two spellings.
    expect('wallMounted' in s ? s.wallMounted : undefined).toBeUndefined();
  });

  it('leaves an agreeing part completely alone, object identity included', () => {
    // Not cosmetic. `useScene.setParts` feeds React, and rebuilding every part on every
    // load would change every reference and re-render the whole scene for nothing.
    const tv = stored({ id: 't', category: 'tv', shape: 'tv', dimMM: [1450, 60, 820], wallMounted: true });
    const table = stored({ id: 'c', category: 'table', shape: 'coffee-table', dimMM: [1000, 600, 400] });
    const out = normalizeStoredParts([tv, table]);
    expect(out[0]).toBe(tv);
    expect(out[1]).toBe(table);
  });

  it('and it agrees with the builders on every catalog pair', () => {
    // The two must not answer differently, or a load would silently rewrite a scene the
    // builder had just got right. A count with a floor under it, for the usual reason.
    let swept = 0;
    const wrong: string[] = [];
    for (const cat of CATEGORIES) {
      for (const shape of CATALOG_SHAPES_ORDERED) {
        swept++;
        const [out] = normalizeStoredParts([stored({ category: cat, shape })]);
        if (!!out.wallMounted !== isWallMountedPart(cat, shape)) wrong.push(`${cat}/${shape}`);
      }
    }
    expect(swept, 'the sweep must have pairs to sweep').toBeGreaterThan(200);
    expect(wrong, `${wrong.length} of ${swept} pairs disagree`).toEqual([]);
  });
});

describe('every path that loads a persisted scene re-derives it', () => {
  // A regex over source, and the same deliberate second-best as the sweeps in
  // `scene-build.test.ts` and `plan-surfaces.test.ts`: there are THREE call sites and the
  // failure being guarded is a fourth one arriving without the normaliser. Comments and
  // string literals are stripped by the shared scanner first, because prose quoting the
  // call satisfies a match exactly as well as the call does.
  const LOADERS = [
    'components/studio/RoomSync.tsx',
    'components/studio/PlanThumb.tsx',
    'components/studio/RoomTools.tsx',
  ];

  it('and no loader hands a raw snapshot to setParts', () => {
    for (const rel of LOADERS) {
      const src = stripCommentsAndStrings(readFileSync(join(process.cwd(), rel), 'utf8'));
      // The positive half first: this is a floor, not the mitigation — it catches a
      // stripper that ate everything, not one that ate the offending line.
      expect(src.length, `${rel} must exist and have content`).toBeGreaterThan(500);
      expect(src, `${rel} must actually call setParts`).toMatch(/setParts\(/);
      const calls = src.match(/setParts\([^)]*\)/g) ?? [];
      expect(calls.length, `${rel} must have a setParts call to check`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, `${rel}: ${call} does not re-derive`).toMatch(/normalizeStoredParts|null/);
      }
    }
  });
});
