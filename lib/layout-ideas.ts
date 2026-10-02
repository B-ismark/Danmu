/**
 * The ideas gallery: several arrangements of one room, a page at a time.
 *
 * Shuffle used to apply one arrangement straight to the room and throw the rest of
 * the pool away. `shuffleRoom` gathers up to `MIN_CLEAN` clean candidates per press
 * so that `orderOffers` has something to choose between, and `ShuffleOutcome.ideas`
 * now hands all of the showable ones back. This file is everything the gallery
 * decides about them that is not a React question: how many to a page, how many to
 * look for, what each one is called, and what it does to the transform maps.
 *
 * Pure and store-free, like the rest of `lib/layout-*`, so the panel is wiring and
 * the decisions are here where the tests reach them.
 *
 * ── An idea is a whole room, measured from where the gallery opened ────────────
 *
 * Every idea is applied onto the SAME base: the transform maps as they stood when
 * the gallery opened. Applying idea 3 after idea 2 therefore puts back every piece
 * idea 2 moved and idea 3 did not. Stacking them instead (idea 3 on top of idea 2)
 * would make each thumbnail a lie about the room it produces, because the solver
 * arranged each one against the base and nothing else.
 */
import { distToBoundary, frontVector } from './geometry';
import { isSeating, roleOf, roomProfile, WALL_ATTACH_TOL, isSoftFurnishing, type Role } from './layout-rules';
import { ridingParents } from './rigid-parent';
import type { Placement } from './layout-score';
import type { Footprint } from './footprint';
import type { ScenePart } from './scene-spec';

/** Ideas to a page. Decision D6 of the 2026-09 overhaul: **three on a phone, four
 *  anywhere wider.** Three is what Merrell et al. showed at a time in the study the
 *  gallery comes from; four is what a laptop's panel holds as a 2 × 2 grid without
 *  the thumbnails dropping below a readable plan. A phone is the studio's own
 *  answer to "is this a phone" (`usePhoneStudio`, under 600px), not a width here. */
export const IDEAS_PER_PAGE = { phone: 3, wide: 4 } as const;

/** Stop looking after this many. The 36 layouts of Merrell et al., which is also
 *  about where a person stops paging: nine pages of four is already more browsing
 *  than choosing. A ceiling on the search, never a promise that 36 exist. */
export const MAX_IDEAS = 36;

/** How many searches in a row may come back with nothing new before the gallery
 *  says that is every idea it has. One search is up to twelve solves, about two
 *  seconds in the arranging worker, so three dry ones is six seconds of looking at
 *  a room that has plainly run out — and a small room genuinely does: two pieces in
 *  a box have only so many arrangements. */
export const DRY_SEARCHES = 3;

/** How far off a piece's front another piece may stand and still be what it
 *  FACES, in radians either side. 30°: inside it a person sitting there is looking
 *  at the thing without turning their head, which is the only sense of "facing" a
 *  caption can honestly claim. Descriptive, not a rule — nothing is scored on it. */
export const FACING_HALF_ANGLE = Math.PI / 6;

export type Idea = {
  /** Stable for the life of one gallery. */
  id: string;
  /** Index-aligned to the parts the gallery opened with — every piece, moved or not. */
  placements: Placement[];
  /** Indices whose placement differs from the base. */
  moved: number[];
};

export type Transform2 = {
  positions: Record<string, [number, number, number]>;
  rotations: Record<string, number>;
};

/** The transform maps this idea produces, built on the base the gallery opened with.
 *
 *  Only the moved pieces are written, and heights are carried from the part: the
 *  solver moves and turns, and never lifts or resizes (the same contract Fix and
 *  Shuffle keep). New objects every call, so a caller can hand them to the store
 *  without aliasing the base. */
export function ideaTransforms(base: Transform2, parts: readonly ScenePart[], idea: Pick<Idea, 'placements' | 'moved'>): Transform2 {
  if (idea.placements.length !== parts.length) {
    // The same refusal `layoutSimilarity` makes: an idea recorded against a
    // different set of furniture is index-aligned to a different room.
    throw new Error(`ideaTransforms: ${idea.placements.length} placements for ${parts.length} parts`);
  }
  const positions = { ...base.positions };
  const rotations = { ...base.rotations };
  for (const i of idea.moved) {
    const p = parts[i];
    const at = idea.placements[i];
    positions[p.id] = [at.x, p.pos[1], at.z];
    rotations[p.id] = at.yaw;
  }
  return { positions, rotations };
}

/** The tops a seat is never shown standing on: every table, and the bed. A
 *  platform is `other` (see `roleOf`) and is a floor, so a seat on one stays. */
const SEAT_NEVER_ON: ReadonlySet<Role> = new Set<Role>(['bed', 'dining-table', 'coffee-table', 'side-table', 'nightstand', 'desk']);

/** The room Ideas arranges: the room as it stands, with every seat that is standing
 *  on a table or a bed set down on the floor where it is, and whatever stands on that
 *  seat brought down by the same distance. `down` is every index it lowered, and every
 *  idea writes them, moved or not: an idea that left the ottoman's spot alone would
 *  otherwise leave it at the table's height with the table gone from under it.
 *
 *  The user's call (2026-09-30, `docs/what-is-still-open.md` § H.6.4): a drag may
 *  stand a seat on a coffee table, and Ideas may never show one there. It used to in
 *  all of them, measured — a seat riding a table or a bed is carried with it
 *  (`carryRiders`), so it was on its top in 48 of 48 ideas across five presets.
 *
 *  Read again after each seat until none is left, because the solver reads the room
 *  it is handed the same way (`ridingParents`, which `carryRiders` carries by) and
 *  that room must have no seat on a top in it. The re-read is not tidiness: an
 *  ottoman set down inside its coffee table puts the stool on it exactly level with
 *  the table's top, and read once, that stool still stood on the table. Each pass
 *  puts one more seat on the floor and none back up, so it ends. */
export function seatsDown(parts: ScenePart[]): { parts: ScenePart[]; down: number[] } {
  let out = parts;
  const down = new Set<number>();
  const at = new Map(parts.map((p, i) => [p.id, i]));
  for (;;) {
    const rides = ridingParents(out);
    const seat = out.findIndex((p) => {
      const under = rides[p.id];
      return under !== undefined && isSeating(roleOf(p)) && SEAT_NEVER_ON.has(roleOf(out[at.get(under)!]));
    });
    if (seat < 0) return { parts: out, down: [...down].sort((a, b) => a - b) };
    const drop = out[seat].pos[1];
    const carried = new Set([seat]);
    for (let grew = true; grew; ) {
      grew = false;
      out.forEach((p, i) => {
        const under = rides[p.id];
        if (under === undefined || carried.has(i) || !carried.has(at.get(under)!)) return;
        carried.add(i);
        grew = true;
      });
    }
    out = out.map((p, i) =>
      carried.has(i) ? { ...p, pos: [p.pos[0], p.pos[1] - drop, p.pos[2]] as [number, number, number] } : p,
    );
    for (const i of carried) down.add(i);
  }
}

/** One string for "are these the same transform maps", by content.
 *
 *  By content and not by reference because undo restores a snapshot, and a
 *  snapshot is equal to what the gallery wrote without being the same object. The
 *  Layouts tab asks the same question the same way (`transformKey` in RoomTools). */
export function transformsKey(t: Transform2 & { dims: Record<string, [number, number, number]> }): string {
  return JSON.stringify([t.positions, t.rotations, t.dims]);
}

/** Which roles a caption may say a piece is facing, best first, and how it says
 *  them. A screen or a window is what a person arranges a seat around; a table in
 *  front of a sofa is nearly every living room and would make every caption the
 *  same.
 *
 *  The target is named by its ROLE, not by the piece's own name: a name is typed by
 *  a person ("TV · 65″", "Window"), and "facing Window" is not a sentence, while
 *  lowercasing it would turn "TV" into "tv". A closed vocabulary is the one kind of
 *  word that splices safely (see `shuffleRefusal`'s note). The subject keeps its
 *  own name, because it starts the sentence. */
const FACE: readonly [Role, string][] = [
  ['tv', 'the TV'],
  ['window', 'the window'],
  ['door', 'the door'],
  ['dining-table', 'the dining table'],
  ['coffee-table', 'the coffee table'],
];
const FACE_PRIORITY: Role[] = FACE.map(([role]) => role);

/** What can be said to FACE anything: the pieces a person sits or lies on, and a
 *  desk. A coffee table, a lamp or a plant has no front a person uses, so "coffee
 *  table facing the door" would be a sentence about which way its mesh points. */
const HAS_A_FRONT: ReadonlySet<Role> = new Set<Role>(['bed', 'sofa', 'armchair', 'dining-chair', 'office-chair', 'desk']);

/** What an idea is, in words: where the piece the room is arranged around ends up,
 *  and how much of the room moves to get there. "Sofa against a wall, facing the
 *  TV" · "5 pieces move". Short on purpose: a phone shows three to a row, about
 *  seventeen characters a line.
 *
 *  `lead` is null when nothing in the room can carry a sentence — only soft pieces
 *  moved, and there is no bed, sofa, table or desk. The count is always there,
 *  because "2 pieces move" and "9 pieces move" are the fact a person wants before
 *  pressing, and it is the one a thumbnail at 110px shows worst.
 *
 *  Every word is derived from the placements. A caption that praised an idea
 *  ("cosy", "better flow") would be the solver's score wearing an adjective, which
 *  is what "words, not scores" rules out in the other direction. */
export function ideaCaption(
  parts: readonly ScenePart[],
  footprint: Footprint,
  idea: Pick<Idea, 'placements' | 'moved'>,
): { lead: string | null; count: string } {
  const n = idea.moved.length;
  const count = `${n} ${n === 1 ? 'piece moves' : 'pieces move'}`;
  const subject = captionSubject(parts, idea);
  if (subject === null) return { lead: null, count };

  const part = parts[subject];
  const at = idea.placements[subject];
  const [fx, fz] = frontVector(at.yaw);
  const halfDepth = part.dimMM[1] / 2000;
  // Its BACK against a wall, measured from the middle of the back face — the
  // same near-face gap `WALL_ATTACH_TOL` is defined on, so "by a wall" here and
  // "the wall takes it along" in a wall drag are one answer.
  const gap = distToBoundary(footprint, at.x - fx * halfDepth, at.z - fz * halfDepth);
  const where = gap <= WALL_ATTACH_TOL ? 'against a wall' : 'in the open';

  const target = HAS_A_FRONT.has(roleOf(part)) ? facing(parts, idea.placements, subject) : null;
  const lead =
    target === null ? `${part.name} ${where}` : `${part.name} ${where}, facing ${FACE[target.rank][1]}`;
  return { lead, count };
}

/** The piece a caption is about: the room's anchor (bed, sofa, dining table, desk —
 *  `roomProfile`'s own ranking) when this idea moves it, else the largest solid
 *  piece it does move. A kept sofa sits where it sits in every idea, so a caption
 *  about it would read the same on every card: a caption says what the idea
 *  changes. */
function captionSubject(parts: readonly ScenePart[], idea: Pick<Idea, 'placements' | 'moved'>): number | null {
  const anchor = roomProfile(parts as ScenePart[]).anchor;
  if (anchor !== null && idea.moved.includes(anchor)) return anchor;
  let best: number | null = null;
  let bestArea = 0;
  for (const i of idea.moved) {
    if (isSoftFurnishing(parts[i])) continue;
    const area = parts[i].dimMM[0] * parts[i].dimMM[1];
    if (area > bestArea) {
      best = i;
      bestArea = area;
    }
  }
  return best;
}

/** What `subject` faces, if anything worth naming stands inside its forward cone.
 *  Priority first, then the nearest along the front: a sofa with both a window and
 *  a television ahead of it is facing the television. */
function facing(
  parts: readonly ScenePart[],
  placements: readonly Placement[],
  subject: number,
): { index: number; rank: number } | null {
  const s = placements[subject];
  const [fx, fz] = frontVector(s.yaw);
  let best: number | null = null;
  let bestRank = FACE_PRIORITY.length;
  let bestAlong = Infinity;
  for (let j = 0; j < parts.length; j++) {
    if (j === subject) continue;
    const rank = FACE_PRIORITY.indexOf(roleOf(parts[j]));
    if (rank < 0) continue;
    const dx = placements[j].x - s.x;
    const dz = placements[j].z - s.z;
    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * fz - dz * fx);
    // One test covers behind as well: anything at or behind the side line is at
    // 90° or more, far outside the cone, so no separate `along <= 0` is needed.
    if (Math.atan2(across, along) > FACING_HALF_ANGLE) continue;
    if (rank < bestRank || (rank === bestRank && along < bestAlong)) {
      best = j;
      bestRank = rank;
      bestAlong = along;
    }
  }
  return best === null ? null : { index: best, rank: bestRank };
}

/** The ideas on one page. `page` is zero-based. */
export function pageOf<T>(ideas: readonly T[], page: number, size: number): T[] {
  return ideas.slice(page * size, page * size + size);
}

/** "5–8" for the second page of four, clipped to what has been found. Null while
 *  the page is still empty, so nothing claims a range it cannot show. */
export function pageRange(page: number, size: number, found: number): string | null {
  const from = page * size + 1;
  const to = Math.min(found, page * size + size);
  if (to < from) return null;
  return from === to ? `${from}` : `${from}–${to}`;
}

/** Whether the gallery should be searching: until the page being looked at AND the
 *  one after it are full, so pressing Next shows ideas rather than a wait — unless
 *  the ceiling is reached or the room has run dry. */
export function wantsMore(found: number, page: number, size: number, drySearches: number): boolean {
  if (drySearches >= DRY_SEARCHES) return false;
  return found < Math.min(MAX_IDEAS, (page + 2) * size);
}

/** `wanted`, or `wanted (2)`, `(3)`… if a saved layout already has that name. An
 *  idea's number restarts with each gallery, and two layouts both called "Idea 1"
 *  would be two rows nobody can tell apart in the Layouts tab. */
export function freeName(wanted: string, taken: readonly string[]): string {
  if (!taken.includes(wanted)) return wanted;
  let k = 2;
  while (taken.includes(`${wanted} (${k})`)) k += 1;
  return `${wanted} (${k})`;
}
