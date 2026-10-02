// The Inspector's **Wall** button, as a gesture.
//
// Wall used to write the piece's new spot and cascade what stood on it, and nothing
// else. Merged-set siblings and the rest of the selection stayed behind, and the
// riders were written unchecked. A drag already answers every one of those
// questions in `lib/drag-convoy.ts`, so Wall asks the same one: the piece is the lead,
// the wall spot is where the pointer let go, and the company is planned, resolved and
// settled exactly as a drag's. One rule, three consumers.
//
// What Wall adds is only the target, and two sentences a drag does not need: a set
// that runs out of room on the way stops short of the wall, which is the drag's slide
// and has to be SAID because a button has no hand watching it; and a piece already
// there is told so rather than written in place, since a write is an override.
//
// Pure, like the convoy: a snapshot of the world in, transforms out.
import { leadInherited, planConvoy, resolveConvoy, settleLead, travellingWorld, type ConvoyMove } from './drag-convoy';
import { refusalCause, resolvePlacement, type Refusal } from './drag-resolve';
import { snapToWall, wallStandoff } from './physics';
import type { Landing } from './rigid-parent';
import type { RiderRelation } from './rider-height';
import type { Poly } from './geometry';
import type { ScenePart } from './scene-spec';

/** Within float noise of where it stood is where it stood — the plan's `SAME_M`. */
const SAME = 1e-9;

export type WallMove =
  /** Write `moves` in one update and record `landings` in one more. `short` is true
   *  when the set stopped before the piece reached its wall. */
  | { kind: 'moved'; moves: ConvoyMove[]; landings: Landing[]; short: boolean }
  /** Already flush against its nearest wall, facing the room. Nothing to write. */
  | { kind: 'there' }
  /** Nothing moves. `blocked` names the member that could not follow; `refusal`, why
   *  the piece itself could not stand at the wall. Neither: the set had to stop short
   *  and the piece could not stand THERE — no one piece is the reason. */
  | { kind: 'refused'; blocked?: ScenePart; refusal?: Refusal; blockedIds: string[] };

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
  if (!part) return { kind: 'refused', blockedIds: [] };
  const start = part.pos;
  const snapped = snapToWall(start, part.dimMM, footprint, wallStandoff(part.shape));
  const rot = snapped.rot ?? part.rot;

  const convoy = planConvoy({ draggedId: id, parts, selection, restsOn, footprint, roomHeight });
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
  if (!first.valid) return { kind: 'refused', refusal: first.refusal, blockedIds: [] };
  const turned = Math.abs(Math.atan2(Math.sin(first.rot - part.rot), Math.cos(first.rot - part.rot))) > SAME;
  const moved = first.pos.some((v, i) => Math.abs(v - start[i]) > SAME);
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
  if (!co.valid || !settled) return { kind: 'refused', blocked: co.blocked, blockedIds: co.blockedIds };

  // The turn only when there is one: writing back an unchanged rotation still
  // creates an override (see `ConvoyMove`).
  const leadMove: ConvoyMove = turned ? { id, pos: lead.pos, rot: lead.rot } : { id, pos: lead.pos };
  return {
    kind: 'moved',
    moves: [leadMove, ...co.moves],
    landings: [{ id, on: lead.supportId }, ...co.landings],
    short: lead.pos[0] !== first.pos[0] || lead.pos[2] !== first.pos[2],
  };
}

/** What the panel says after a press, or null when the press did what the button
 *  says and there is nothing to add. One derivation, beside the rule it reports on,
 *  so the sentence cannot drift from the case it names. */
export function wallSentence(name: string, move: WallMove): string | null {
  if (move.kind === 'there') return `${name} is already against the nearest wall.`;
  if (move.kind === 'refused') {
    if (move.blocked) return `Nothing moved: ${move.blocked.name} has no room to follow.`;
    if (move.refusal) return `${name} will not fit against the nearest wall: ${refusalCause(move)}`;
    return 'Nothing moved: the selection has no room to reach the wall together.';
  }
  return move.short ? `${name} stopped short of the wall, so the rest of the selection still fits.` : null;
}
