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
// first change that actually needs it. What is NOT left alone is who reads it:
// `splitSlotSuffix` is the one reader, and the room builder and the photo editor
// call it rather than carry their own pattern — they used to, four of them, each
// with its own `[nesw]` (§ 49.18).

import type { DetectSource } from './detect-confidence';
import { clipToFrame } from './photo-geometry';
import { slotOf } from './slot-names';
import type { Detection } from './detection';
import type { CaptureSlot, RoomData } from './storage';

export type SavedDetection = NonNullable<RoomData['detectedObjects']>[number];

const SLOT_SUFFIX = '__slot:';

/** A saved label split into the piece's name and the wall its suffix names —
 *  `undefined` when the suffix names none, which each caller answers for itself.
 *  Everything from the FIRST suffix on is stripped, whatever it says: the suffix is
 *  this file's encoding, nobody types it, and what showed when it was left on was
 *  the encoding itself.
 *
 *  Read with `slotOf`, so a suffix in any form the scan reader accepts is that wall.
 *  Until § 49.17 a cloud row's slot was saved as the model wrote it, and this read
 *  back only `[nesw]`: `Sofa__slot:south` came back on the NORTH wall, still
 *  called `Sofa__slot:south`. Only the FIRST suffix is read, because saving that
 *  row again wrote a second over it — `Sofa__slot:south__slot:n` — and the second
 *  is the old reader's default, not anything anyone said about the sofa. */
export function splitSlotSuffix(label: string): { name: string; slot: CaptureSlot | undefined } {
  const at = label.indexOf(SLOT_SUFFIX);
  if (at < 0) return { name: label, slot: undefined };
  return { name: label.slice(0, at), slot: slotOf(label.slice(at + SLOT_SUFFIX.length).split(SLOT_SUFFIX)[0]) };
}

/** The wall the room builder places a saved row on: the one its suffix names when
 *  that suffix was written in the record's own form, a single code at the end, and
 *  `n` for anything else — which is where this row has always been built.
 *
 *  Not `splitSlotSuffix(label).slot`, and the difference is the rule that a load
 *  moves nothing. A room the user only DRAGGED in has no saved scene and is rebuilt
 *  from this list on every open, with the drag applied over the top; a turn exists
 *  only if they turned it. So building `Sofa__slot:south` on the south wall now would
 *  leave it where they dragged it, facing the other way. The scan screen reads the
 *  true wall (`fromRecord`), and Continue there writes it back as a code, which is
 *  the rebuild the user asked for. */
export function placedSlot(label: string): CaptureSlot {
  const { slot } = splitSlotSuffix(label);
  return slot && label.endsWith(SLOT_SUFFIX + slot) ? slot : 'n';
}

/** The label without the slot suffix. Exported because the review screen shows it
 *  and the record writes it, and those two disagreeing is how a room full of
 *  furniture came to be named "sofa__slot:n". */
export function cleanLabelOf(d: Detection): string {
  return splitSlotSuffix(d.label).name;
}

/** Detection → record. `mintUid` supplies a key for a detection that has none;
 *  passed in rather than imported so this stays pure and a test can be
 *  deterministic. The key is minted ONCE and then carried, so a ScenePart id stays
 *  attached to the same piece of furniture across a re-detect. */
export function toRecord(d: Detection, index: number, locked: boolean, mintUid: () => string): SavedDetection {
  return {
    id: index,
    uid: d.uid ?? mintUid(),
    label: `${cleanLabelOf(d)}${SLOT_SUFFIX}${d.slot}`,
    conf: d.conf,
    source: d.source,
    locked,
    box: d.box,
    category: d.category,
    dimMM: d.dimMM,
    position: d.position,
    yaw: d.yaw,
    shape: d.shape,
  };
}

/** Record → Detection. Every field `toRecord` writes is read back here; that is the
 *  property the two of them exist to hold, and `tests/detection-record.test.ts`
 *  checks it by round-trip rather than by field list, so a field added to one side
 *  and not the other fails. */
export function fromRecord(r: SavedDetection): Detection {
  const { name, slot } = splitSlotSuffix(r.label);
  return {
    uid: r.uid,
    label: name,
    conf: r.conf,
    // Widened to `string` in the record and narrowed back here, the same way
    // `category` is. An unrecognised value reads as undefined rather than being
    // trusted, and `sourceOf` then supplies the historical default.
    source: (['local', 'cloud', 'manual'] as const).find((s) => s === r.source) as DetectSource | undefined,
    // Cut to its photo, as a fresh scan's box is (§ 49.15): a row saved before that
    // cut may run past the frame, and the review screen re-measures every row from
    // its box each time it opens. Cutting cannot give back an edge the old
    // on-device clamp moved, only stop the box describing what nobody saw. Here
    // rather than on the screen so both ends of `lib/rescan.ts`'s comparison read
    // the same box, or every such row would count as changed on the next Continue.
    // A box with nothing in frame is kept as saved: this reads the rows the user
    // kept, and dropping one would renumber the rest.
    box: clipToFrame(r.box) ?? r.box,
    category: (r.category ?? 'other') as Detection['category'],
    slot: slot ?? 'n',
    dimMM: r.dimMM,
    position: r.position,
    yaw: r.yaw,
    shape: r.shape,
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
