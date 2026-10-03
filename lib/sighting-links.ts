// Sighting links — the person saying "this is the bed I already have", and what the
// room does with it.
//
// `lib/repeat-sightings.ts` is the app's GUESS that two rows are one piece seen
// twice. It is a good guess and it is still a guess: a detector that says "bed" on
// one wall and "double bed" on the next, or a bed measured from its foot and from
// its side far enough apart, gets past it, and a room comes back with two beds. The
// person reviewing the list knows their own room, so this is the half where they
// decide: a row can be LINKED to an earlier row, which says the two are one piece.
//
// A link is stored on the later row as `sameAs`, the uid of the row it repeats —
// never an index, because `confirmed` and every other per-row answer on the review
// screen are indices and a delete re-numbers them all. A linked row is not kept, so
// the room builder never builds it (`buildSceneFromRoom` builds kept rows only), and
// that is the whole of how one bed seen from three walls becomes one bed. Nothing is
// deleted: unlinking puts the row back, kept, as its own piece.
//
// What a link adds beyond the untick is PLACEMENT, and only placement. Rule 2 of
// CLAUDE.md says a scanned piece's size comes from the catalogue, so two sightings
// are never combined into a size. Where a floor piece stands, though, is what the
// geometry measures, and two measurements of one place from two walls beat one —
// `combinedFloorSpot` below says when, and says it from a measurement rather than
// from the obvious argument, because the obvious argument is wrong on half the
// phones.
//
// Pure — no React — so the rules can be tested without a screen.

import { cutByFrame } from './photo-geometry';
import { measuredPlane, type CalMap } from './detect-refine';
import { sceneShapeFor, type Category } from './scene-spec';
import { cleanLabelOf, type SavedDetection } from './detection-record';
import type { Detection } from './detection';
import { SLOT_ORDER } from './capture-slots';

/** The row a linked row repeats, as an index into `dets` — or null when the row is
 *  its own piece, or its link points at a row no longer on the list. */
export function linkedTo(dets: readonly Detection[], i: number): number | null {
  const uid = dets[i]?.sameAs;
  if (!uid) return null;
  const j = dets.findIndex((d) => d.uid === uid);
  return j >= 0 && j !== i ? j : null;
}

/** The row whose tick decides whether row `i`'s piece is in the room: the row it is
 *  linked to, or `i` itself. A linked row is never built, so its own tick says nothing
 *  about the piece; the review list shows this row's tick on it instead, so a person
 *  looking at Wall 2 can see the bed is kept without going back to Wall 1. */
export function pieceRow(dets: readonly Detection[], i: number): number {
  return linkedTo(dets, i) ?? i;
}

/** Every row linked to row `i`, in list order. */
export function sightingsOf(dets: readonly Detection[], i: number): number[] {
  const uid = dets[i]?.uid;
  if (!uid) return [];
  const out: number[] = [];
  dets.forEach((d, j) => {
    if (j !== i && d.sameAs === uid) out.push(j);
  });
  return out;
}

/** The row a link to `j` really lands on: `j` itself, or the row `j` is already
 *  linked to. Links are one level deep by construction, so this never walks further
 *  than one step — and a link to a row that is itself linked would otherwise make a
 *  chain whose middle row nobody builds. */
function rootOf(dets: readonly Detection[], j: number): number {
  return linkedTo(dets, j) ?? j;
}

/** Link row `i` to row `target`: "this is the same piece". Returns the new list, or
 *  the same list when the link cannot be made (no uids, or a row linked to itself).
 *
 *  Rows already linked to `i` move with it to the new root, so links stay one level
 *  deep and a piece seen on three walls is one row with two linked to it, whichever
 *  order the person linked them in. The caller unticks `i` — `confirmed` is the
 *  page's, not this module's. */
export function linkSighting(dets: readonly Detection[], i: number, target: number): readonly Detection[] {
  const root = rootOf(dets, target);
  const rootUid = dets[root]?.uid;
  const ownUid = dets[i]?.uid;
  if (root === i || !rootUid || !ownUid) return dets;
  return dets.map((d, j) => {
    if (j === i) return { ...d, sameAs: rootUid };
    if (d.sameAs === ownUid) return { ...d, sameAs: rootUid };
    return d;
  });
}

/** Undo one link: row `i` is its own piece again. The caller ticks it. */
export function unlinkSighting(dets: readonly Detection[], i: number): readonly Detection[] {
  if (!dets[i]?.sameAs) return dets;
  return dets.map((d, j) => {
    if (j !== i) return d;
    const { sameAs: _drop, ...rest } = d;
    void _drop;
    return rest;
  });
}

/** Row `i` stops being the piece — unticked or deleted — and its first sighting takes
 *  over: that row loses its link (the caller ticks it) and every other sighting is
 *  re-pointed at it. `heir` is the row that took over, or null when `i` had none.
 *
 *  Why the piece survives its first row: a link says "these rows are one bed", and
 *  removing one row of a bed seen from three walls is most often removing the worst
 *  photo of it, not the bed. A person who wants no bed removes the heir too, and the
 *  hand-over runs out with the sightings. Row `i` itself is NOT linked to the heir:
 *  a removed row that pointed at the heir would be handed the piece back the moment
 *  the heir was removed, and the bed could never be taken out. */
export function handOver(dets: readonly Detection[], i: number): { dets: readonly Detection[]; heir: number | null } {
  const uid = dets[i]?.uid;
  const [heir] = sightingsOf(dets, i);
  const heirUid = heir === undefined ? undefined : dets[heir].uid;
  if (!uid || heir === undefined || !heirUid) return { dets, heir: null };
  const out = dets.map((d, j) => {
    if (j === heir) {
      const { sameAs: _drop, ...rest } = d;
      void _drop;
      return rest;
    }
    return d.sameAs === uid ? { ...d, sameAs: heirUid } : d;
  });
  return { dets: out, heir };
}

/** The list after row `i` is deleted, with its sightings handed to the first of them
 *  (`handOver`) rather than left pointing at nothing. `heir` is that row's index in the
 *  NEW list, for the caller to tick, or null. */
export function withoutRow(dets: readonly Detection[], i: number): { dets: Detection[]; heir: number | null } {
  const handed = handOver(dets, i);
  const heir = handed.heir === null ? null : handed.heir > i ? handed.heir - 1 : handed.heir;
  return { dets: handed.dets.filter((_, j) => j !== i), heir };
}

/** Which rows row `i` could be linked to, best first: kept rows that are pieces in
 *  their own right, on other walls before this one's, of the same kind when there are
 *  any and of any kind when there are none.
 *
 *  Same kind first because that is almost always the answer, and a picker of twenty
 *  rows hides it. Any kind when there is none because the detector's word is the
 *  thing most likely to be wrong — a wardrobe read as a "cabinet" on one wall is the
 *  case the automatic guess cannot catch, and the case the person can. */
export function linkCandidates(dets: readonly Detection[], kept: ReadonlySet<number>, i: number): number[] {
  const me = dets[i];
  if (!me) return [];
  const pool = dets
    .map((d, j) => ({ d, j }))
    .filter(({ d, j }) => j !== i && kept.has(j) && !d.sameAs && d.uid);
  const same = pool.filter(({ d }) => d.category === me.category);
  const pick = same.length > 0 ? same : pool;
  const wallRank = (d: Detection) => (d.slot === me.slot ? SLOT_ORDER.length : SLOT_ORDER.indexOf(d.slot));
  return pick.sort((a, b) => wallRank(a.d) - wallRank(b.d) || a.j - b.j).map(({ j }) => j);
}

/** Where a floor piece seen in more than one photo stands, from all its sightings —
 *  or null when there is nothing to combine (one sighting, a wall or ceiling piece,
 *  or no usable position).
 *
 *  `rows` is the kept row first, then the rows linked to it.
 *
 *  **Measured, not argued** (`tests/sighting-links.test.ts`, 150 furnished rooms,
 *  printed on every green run). Averaging two measurements is the obvious move and
 *  it is right on most phones and wrong on the rest:
 *
 *  · On an ASSUMED lens — most phones write no focal length, so the geometry reads
 *    every photo as a 66° lens — an ultrawide's floor piece lands about 1.2 m from
 *    where it stands, and each wall's photo pushes it a different way. The mean of
 *    every sighting brings it to about 0.8 m. So when any sighting rode an assumed
 *    lens, every sighting counts.
 *  · On a MEASURED lens the sightings are already good, and a sighting the frame cut
 *    off is the bad one: its near edge is out of the picture, so its distance is a
 *    bound and not a reading. Averaging it in made the mean WORSE than the first
 *    sighting alone (0.382 m against 0.318 at 106°). So only the uncut sightings
 *    count, and with fewer than two of them the kept row stands where it was
 *    measured — which, on that population, is every time: on a measured lens a link
 *    unticks the repeat and moves nothing.
 *
 *  Floor pieces only. A wall piece's place along its wall is read on a plane the
 *  geometry assumes, and near a corner one of its sightings is on the return wall;
 *  nothing here measured that averaging two such readings helps, so it does not. */
export function combinedFloorSpot(rows: readonly Detection[], cals: CalMap): { x: number; z: number } | null {
  if (rows.length < 2) return null;
  const first = rows[0];
  const plane = measuredPlane(first.category as Category, sceneShapeFor(first.category as Category, cleanLabelOf(first), first.shape));
  if (plane !== 'floor') return null;
  const placed = rows.filter((d) => d.position && Number.isFinite(d.position.x) && Number.isFinite(d.position.z));
  if (placed.length < 2) return null;
  const assumed = placed.some((d) => cals[d.slot]?.lens !== 'measured');
  const use = assumed ? placed : placed.filter((d) => !cutByFrame(d.box));
  if (use.length < 2) return null;
  const x = use.reduce((s, d) => s + d.position!.x, 0) / use.length;
  const z = use.reduce((s, d) => s + d.position!.z, 0) / use.length;
  return { x, z };
}

/** The records Continue saves, with each kept floor piece's combined spot written as
 *  `seenAt` (and any stale one cleared). Derived here, at the one moment the lenses
 *  are known, because the record does not keep them; and written BESIDE `position`
 *  rather than over it, so each row keeps its own measurement and the next Continue
 *  combines the same readings again instead of folding the last answer into the
 *  next. */
export function withSeenAt(records: readonly SavedDetection[], dets: readonly Detection[], cals: CalMap): SavedDetection[] {
  return records.map((r, i) => {
    const { seenAt: _old, ...rest } = r;
    void _old;
    if (!r.locked || dets[i]?.sameAs) return rest;
    const spot = combinedFloorSpot([dets[i], ...sightingsOf(dets, i).map((j) => dets[j])], cals);
    return spot ? { ...rest, seenAt: spot } : rest;
  });
}
