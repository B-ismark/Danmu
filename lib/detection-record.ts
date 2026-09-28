// The persisted form of a detection, and the only pair of functions that converts
// to and from it.
//
// ONE pair, deliberately, and it used to be two written out by hand at opposite
// ends of app/onboarding/detect/page.tsx. They had drifted: the record written on
// finish carried `position`, `yaw` and `shape` — the placement the geometry pass
// derived from the calibrated camera — while the cache read that runs when the
// screen is re-entered rebuilt Detection objects WITHOUT them. Since finish() is
// the only way forward off that screen and its button is always enabled, the next
// press wrote `undefined` over all three. The studio's Rescan button links straight
// there, so it was one click from silently discarding the geometry pass.
//
// It lives in lib/ rather than in the page for two reasons. It is pure logic that a
// React component happened to own, so nothing could test it — and the pipeline
// harness has to cross this boundary to be a pipeline test at all. A harness with
// its own copy of the codec would be checking a third implementation of the thing
// whose whole documented failure mode is having two.
//
// The slot is smuggled through `label` as a `__slot:x` suffix rather than stored as
// its own field. That predates this file and is left alone: changing it is a
// persisted-schema change for cosmetics, and `RoomData.version` exists for the
// first change that actually needs it.

import type { DetectSource } from './detect-confidence';
import type { Detection } from './detection';
import type { CaptureSlot, RoomData } from './storage';

export type SavedDetection = NonNullable<RoomData['detectedObjects']>[number];

const SLOT_SUFFIX = /__slot:[nesw]$/;

/** The label without the slot suffix. Exported because the review screen shows it
 *  and the record writes it, and those two disagreeing is how a room full of
 *  furniture came to be named "sofa__slot:n". */
export function cleanLabelOf(d: Detection): string {
  return d.label.replace(SLOT_SUFFIX, '');
}

/** Detection → record. `mintUid` supplies a key for a detection that has none;
 *  passed in rather than imported so this stays pure and a test can be
 *  deterministic. The key is minted ONCE and then carried, so a ScenePart id stays
 *  attached to the same piece of furniture across a re-detect. */
export function toRecord(d: Detection, index: number, locked: boolean, mintUid: () => string): SavedDetection {
  return {
    id: index,
    uid: d.uid ?? mintUid(),
    label: `${cleanLabelOf(d)}__slot:${d.slot}`,
    conf: d.conf,
    source: d.source,
    locked,
    box: d.box,
    category: d.category,
    dimMM: d.dimMM,
    position: d.position,
    yaw: d.yaw,
    shape: d.shape,
    color: d.color,
  };
}

/** Record → Detection. Every field `toRecord` writes is read back here; that is the
 *  property the two of them exist to hold, and `tests/detection-record.test.ts`
 *  checks it by round-trip rather than by field list, so a field added to one side
 *  and not the other fails. */
export function fromRecord(r: SavedDetection): Detection {
  return {
    uid: r.uid,
    label: r.label.replace(SLOT_SUFFIX, ''),
    conf: r.conf,
    // Widened to `string` in the record and narrowed back here, the same way
    // `category` is. An unrecognised value reads as undefined rather than being
    // trusted, and `sourceOf` then supplies the historical default.
    source: (['local', 'cloud', 'manual'] as const).find((s) => s === r.source) as DetectSource | undefined,
    box: r.box,
    category: (r.category ?? 'other') as Detection['category'],
    slot: ((r.label.match(/__slot:([nesw])$/) ?? [])[1] ?? 'n') as CaptureSlot,
    dimMM: r.dimMM,
    position: r.position,
    yaw: r.yaw,
    shape: r.shape,
    color: r.color,
  };
}

/** The id each row of a saved list builds as in the room — `buildSceneFromRoom`
 *  reads it from here, so there is one answer. A row's own `uid` when it has one; a
 *  row saved before uids shipped has none, and builds under its category's ordinal
 *  over the WHOLE list, unkept rows included, since that is what every move the user
 *  made to it is stored under. */
export function detectionPartIds(rows: readonly { uid?: string; category?: string }[]): string[] {
  const counters: Record<string, number> = {};
  return rows.map((r) => {
    const cat = r.category ?? 'other';
    counters[cat] = (counters[cat] ?? 0) + 1;
    return r.uid ?? `${cat}-${counters[cat]}`;
  });
}

/** A saved list → the review screen's rows, each carrying the id it already builds
 *  as. For a row saved before uids that is its ordinal, taken as its uid from here
 *  on: minting it a fresh key instead — which the screen did — re-keyed the piece the
 *  first time anyone pressed Continue, and every move, turn and resize the user had
 *  made to it was left pointing at an id nothing built any more. */
export function fromRecords(rows: readonly SavedDetection[]): Detection[] {
  const ids = detectionPartIds(rows);
  return rows.map((r, i) => ({ ...fromRecord(r), uid: ids[i] }));
}
