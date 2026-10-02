// The Inspector's **Wall** button, as a gesture.
//
// Wall used to write the piece's new spot and cascade what stood on it, and nothing
// else. Merged-set siblings and the rest of the selection stayed behind, and a press
// into a taken wall spot stood the piece inside its neighbour. A drag already answers
// those questions in `lib/drag-convoy.ts`, so Wall asks the same one: the piece is the
// lead, the wall spot is where the pointer let go, and the company is planned, resolved
// and settled exactly as a drag's. One rule, three consumers. What it does NOT fix is
// the lead's own riders, which a drag carries unchecked too (`ownAt`; filed in
// docs/what-is-still-open.md § H.6.7).
//
// What Wall adds is the target, and the sentences a drag does not need, because a
// button has no hand watching it: a set that runs out of room stops short of the wall
// (the drag's slide); a piece with company goes to the wall BEHIND it rather than
// turning, because the set translates and never turns (`Convoy.leadEdge` is the same
// decision for a drag); and a piece already there is told so rather than written in
// place, since a write is an override.
//
// Pure, like the convoy: a snapshot of the world in, transforms out.
import { leadInherited, planConvoy, resolveConvoy, settleLead, travellingWorld, type ConvoyMove } from './drag-convoy';
import { refusalCause, resolvePlacement, type Refusal } from './drag-resolve';
import { SAME_M, SAME_TURN, turnBetween } from './item-snap';
import { WALL_GAP } from './layout-rules';
import { snapToWall, wallStandoff } from './physics';
import type { Landing } from './rigid-parent';
import type { RiderRelation } from './rider-height';
import type { Poly } from './geometry';
import type { ScenePart } from './scene-spec';

/** How far a wall spot lies in FRONT of where the piece stands, facing `rot`: negative
 *  is a step back towards the wall behind it. */
const intoRoomOf = (spot: { x: number; z: number }, from: readonly number[], rot: number) =>
  (spot.x - from[0]) * Math.sin(rot) + (spot.z - from[2]) * Math.cos(rot);

export type WallMove =
  /** Write `moves` in one update and record `landings` in one more. `short` is true
   *  when the set stopped before the piece reached its wall; `behind`, when company
   *  sent it to the wall behind it instead of the nearest one. */
  | { kind: 'moved'; moves: ConvoyMove[]; landings: Landing[]; short: boolean; behind: boolean }
  /** Already against its wall, facing the room. Nothing to write. */
  | { kind: 'there' }
  /** Nothing moves, and the first field present says why: `blocked`, the members that
   *  could not follow — every one, since a button has no outline to show the rest;
   *  `needsTurn`, company is following and no wall stands behind the piece; `refusal`,
   *  the piece itself cannot stand at the wall. None: the set had to stop short and the
   *  piece could not stand THERE — no one piece is the reason. */
  | { kind: 'refused'; blocked: ScenePart[]; needsTurn?: true; refusal?: Refusal };

export function moveToWall(input: {
  id: string;
  /** The world at its EFFECTIVE transforms. */
  parts: ScenePart[];
  selection: readonly string[];
  restsOn: RiderRelation;
  footprint: Poly;
  roomHeight: number;
  /** See `resolveConvoy`. */
  memberHasPosOverride: (id: string) => boolean;
}): WallMove {
  const { id, parts, selection, restsOn, footprint, roomHeight, memberHasPosOverride } = input;
  const part = parts.find((p) => p.id === id);
  // Unreachable from the Inspector, which found `part` in the same list; here so the
  // function is total.
  if (!part) return { kind: 'refused', blocked: [] };
  const start = part.pos;
  const standoff = wallStandoff(part.shape);
  const convoy = planConvoy({ draggedId: id, parts, selection, restsOn, footprint, roomHeight });

  // Alone, the nearest wall, turning to face the room. With company, only a wall the
  // piece already backs onto: the set translates and never turns, so a turned lead
  // arrives with its chair at its end instead of its front — valid, and wrong. "Backs
  // onto" is both halves: the wall faces the way the piece does, AND reaching it is a
  // step back. In an L the notch's wall faces the way the far wall does, and from the
  // stem it is reached by walking forward through the corner.
  const nearest = snapToWall(start, part.dimMM, footprint, standoff);
  let snapped = nearest;
  if (convoy.members.length > 0) {
    let best: typeof nearest | null = null;
    for (let i = 0; i < footprint.length; i++) {
      const s = snapToWall(start, part.dimMM, footprint, standoff, i);
      if (s.rot === undefined || turnBetween(s.rot, part.rot) > SAME_TURN) continue;
      if (intoRoomOf(s, start, s.rot) > WALL_GAP + SAME_M) continue;
      if (!best || Math.hypot(s.x - start[0], s.z - start[2]) < Math.hypot(best.x - start[0], best.z - start[2])) best = s;
    }
    if (!best) return { kind: 'refused', blocked: [], needsTurn: true };
    snapped = best;
  }
  const behind = snapped !== nearest && (snapped.x !== nearest.x || snapped.z !== nearest.z);
  const rot = snapped.rot ?? part.rot;

  // Already there is asked of the TARGET, before the target is judged: a piece against
  // its wall is there even if something overlaps it where it stands. And "against" is
  // anywhere between the snap spot and the plaster — a drag clamps flush with the
  // plaster, and pulling that piece `WALL_GAP` back into the room is a move away from
  // the wall the button is named for. Only the distance off the wall is asked: the snap
  // moves a piece along its wall only to pull an overhang back inside a short wall's
  // ends, and a piece standing flush there is against its wall all the same.
  const intoRoom = intoRoomOf(snapped, start, rot);
  if (turnBetween(rot, part.rot) <= SAME_TURN && intoRoom >= -SAME_M && intoRoom <= WALL_GAP + SAME_M) {
    return { kind: 'there' };
  }
  // The plan's `resolveAt`, at the wall's turn: the company shifted to where it is
  // going, the piece's own riders out of its way, and the same snap-off the members
  // get — the target is already a wall spot, so a magnet could only pull it off one.
  // No `company`: it only keeps an arrow key's stop off the set, and a press is not
  // an arrow key.
  const resolveAt = (x: number, z: number) =>
    resolvePlacement({
      part,
      rawX: x,
      rawZ: z,
      rot,
      dim: part.dimMM,
      parts: convoy.travelling.size > 1 ? travellingWorld(convoy, parts, x - start[0], z - start[2], convoy.own) : parts,
      footprint,
      roomHeight,
      snapMode: 'off',
      currentY: start[1],
      wallEdge: convoy.leadEdge,
      inherited: leadInherited(convoy, rot, part.dimMM),
    });

  const first = resolveAt(snapped.x, snapped.z);
  if (!first.valid) return { kind: 'refused', blocked: [], refusal: first.refusal };
  const turned = turnBetween(first.rot, part.rot) > SAME_TURN;
  const moved = first.pos.some((v, i) => Math.abs(v - start[i]) > SAME_M);
  if (!moved && !turned) return { kind: 'there' };

  const { lead, co, settled } = settleLead(
    resolveAt,
    (l) =>
      resolveConvoy({
        convoy,
        draggedId: id,
        pos: l.pos,
        rot: l.rot,
        startPos: start,
        parts,
        footprint,
        roomHeight,
        gesture: 'move',
        memberHasPosOverride,
      }),
    first,
  );
  if (!co.valid || !settled) {
    const byId = new Map(parts.map((p) => [p.id, p]));
    return { kind: 'refused', blocked: co.blockedIds.flatMap((b) => byId.get(b) ?? []) };
  }
  // The convoy's climb rule, for the lead: gravity is the drag's, so a piece arriving
  // over a sideboard at its wall would stand on it, and a button has no hand watching.
  // A piece does not get onto something taller than itself by being sent sideways. The
  // convoy exempts a wall rider, which nothing pressing this button can be: the panel
  // hides Wall for every piece not anchored to the floor.
  if (lead.pos[1] - start[1] > part.dimMM[2] / 1000) {
    return { kind: 'refused', blocked: [], refusal: 'blocked' };
  }

  // The turn only when there is one: writing back an unchanged rotation still
  // creates an override (see `ConvoyMove`). The position is written even when only
  // the turn changed it: the press is the user saying where the piece goes, and a
  // re-detect moving it off the wall would undo that.
  const leadMove: ConvoyMove = turned ? { id, pos: lead.pos, rot: lead.rot } : { id, pos: lead.pos };
  return {
    kind: 'moved',
    moves: [leadMove, ...co.moves],
    landings: [{ id, on: lead.supportId }, ...co.landings],
    short: lead.pos[0] !== first.pos[0] || lead.pos[2] !== first.pos[2],
    behind,
  };
}

/** "A", "A and B", "A, B and C". */
const listNames = (ps: ScenePart[]) =>
  ps.length < 2 ? (ps[0]?.name ?? '') : `${ps.slice(0, -1).map((p) => p.name).join(', ')} and ${ps[ps.length - 1].name}`;

/** What the panel says after a press, or null when the press did what the button
 *  says and there is nothing to add. One derivation, beside the rule it reports on,
 *  so the sentence cannot drift from the case it names. */
export function wallSentence(name: string, move: WallMove): string | null {
  if (move.kind === 'there') return `${name} is already against the nearest wall.`;
  if (move.kind === 'refused') {
    // The drag's own words for a member's veto, so one rule reads as one sentence.
    if (move.blocked.length > 0)
      return `Nothing moved: ${listNames(move.blocked)} will not fit there, so the rest of the selection cannot follow.`;
    if (move.needsTurn)
      return `Nothing moved: ${name} would have to turn to meet a wall, and the rest of the selection does not turn with it.`;
    if (move.refusal) return `${name} will not fit against the nearest wall: ${refusalCause(move)}`;
    return 'Nothing moved: the selection has no room to reach the wall together.';
  }
  if (move.behind && move.short)
    return `${name} went to the wall behind it and stopped short, so the rest of the selection still fits.`;
  if (move.behind) return `${name} went to the wall behind it, so the rest of the selection did not have to turn.`;
  return move.short ? `${name} stopped short of the wall, so the rest of the selection still fits.` : null;
}
