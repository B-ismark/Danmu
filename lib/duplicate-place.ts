// Where a copy goes: beside the piece it was copied from, never inside it.
//
// Duplicate used to try seven FIXED offsets — 350 mm on each diagonal, 700 mm along
// each axis — and, when every one collided, fall back to the last, which was
// `[0, 0]`: the original's own spot. A fixed step is a step sized for a chair. A
// wardrobe, a bed or a sofa is wider than 700 mm, so every offset still overlapped
// the original and the copy landed exactly inside it — the user's report on
// 2026-10-01, "it shouldn't spawn inside the main instance". And each spot was
// checked with `clampIntoFootprint` + `collidesAt`, a two-step imitation of a drop,
// so a copy of a lamp beside its desk hung in the air at desk height.
//
// So the candidates are measured off the piece (its own width and depth plus a gap),
// in the piece's own frame — beside it first, along its width, which is where a
// second chair or a second print goes and which keeps a wall piece on its wall —
// and every candidate is a DROP: `resolvePlacement`, the one pipeline both drag
// surfaces use, decides what it stands on, which wall it rides and whether it is in
// the room and clear. A copy is a drop the user did not have to make.
//
// A selection of several pieces is copied as ONE set, by one shared offset sized off
// the set's combined footprint, so a bed and its nightstands arrive as a bed and its
// nightstands rather than three pieces scattered to wherever each found room.
//
// When nothing beside it is clear the copy is still made — Duplicate is never a
// gesture that does nothing — but it goes to the nearest spot that is at least in the
// room and off the original, and `clear: false` comes back so the caller says so.
// The last resort is the original's own spot only when not even that exists, and
// then it is reported the same way rather than dressed up as a placement.

import { resolvePlacement } from './drag-resolve';
import { aabbExtents, localToWorld, obbFromPart, obbOverlap } from './geometry';
import type { Footprint } from './footprint';
import type { ScenePart } from './scene-spec';

/** Air between the original and its copy, metres. Enough to read as two pieces from
 *  the default camera; under the 100 mm a person would call "apart". */
export const COPY_GAP_M = 0.05;

/** How far a resolve may move a copy off the spot it was asked for and still count as
 *  that spot — a wall snap re-measuring a print's standoff, not a clamp. */
const ASKED_TOL_M = 0.005;

export type CopyPlacement = {
  /** One answer per source, in the order given. */
  spots: Array<{ pos: [number, number, number]; rot: number }>;
  /** Every copy is in the room and clear of everything, the originals included. */
  clear: boolean;
};

/** The offsets to try, nearest first: the four sides, the four corners, then the four
 *  sides again one piece further out. `w`/`d` are the extents in metres of whatever is
 *  being copied along the frame's own x and z. */
function candidates(w: number, d: number): Array<[number, number]> {
  const sx = w + COPY_GAP_M;
  const sz = d + COPY_GAP_M;
  return [
    [sx, 0], [-sx, 0], [0, sz], [0, -sz],
    [sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz],
    [2 * sx, 0], [-2 * sx, 0], [0, 2 * sz], [0, -2 * sz],
  ];
}

/**
 * @param sources the pieces being copied, at their EFFECTIVE transforms.
 * @param world   every piece in the room at its effective transform, sources included
 *                — the originals are obstacles, which is the whole point.
 * @param supportOf what each source rides on now, so a lamp copied off a desk is
 *                looked for a place ON that desk before anywhere else.
 */
export function placeCopies(
  sources: ScenePart[],
  world: ScenePart[],
  footprint: Footprint,
  roomHeight: number,
  supportOf: Readonly<Record<string, string | undefined>> = {},
): CopyPlacement {
  if (sources.length === 0) return { spots: [], clear: true };

  // One piece is measured in its own frame, so "beside" means along its width
  // whichever way it faces. A set has no one facing, so it is measured in the room's.
  const single = sources.length === 1;
  const frame = single ? sources[0].rot : 0;
  let w: number;
  let d: number;
  if (single) {
    w = sources[0].dimMM[0] / 1000;
    d = sources[0].dimMM[1] / 1000;
  } else {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of sources) {
      const { ex, ez } = aabbExtents(s.rot, s.dimMM);
      minX = Math.min(minX, s.pos[0] - ex);
      maxX = Math.max(maxX, s.pos[0] + ex);
      minZ = Math.min(minZ, s.pos[2] - ez);
      maxZ = Math.max(maxZ, s.pos[2] + ez);
    }
    w = maxX - minX;
    d = maxZ - minZ;
  }

  // Supports before what rides them, so a lamp in the set is dropped onto the desk's
  // copy rather than looked for under it.
  const order = sources.map((_, i) => i).sort((a, b) => sources[a].pos[1] - sources[b].pos[1]);

  type Try = {
    spots: CopyPlacement['spots'];
    valid: boolean;
    inRoom: boolean;
    offOriginal: boolean;
    onSame: boolean;
    asked: boolean;
  };
  const attempt = (dx: number, dz: number): Try => {
    const spots: CopyPlacement['spots'] = new Array(sources.length);
    const probes: ScenePart[] = [];
    let valid = true;
    let inRoom = true;
    let offOriginal = true;
    let onSame = true;
    let asked = true;
    for (const i of order) {
      const src = sources[i];
      // The probe must be IN the list it is resolved against: `collidesAt` looks the
      // mover up there and answers "no collision" for one it cannot find.
      const probe: ScenePart = { ...src, id: `__copy-probe-${i}__`, groupId: undefined };
      const r = resolvePlacement({
        part: probe,
        rawX: src.pos[0] + dx,
        rawZ: src.pos[2] + dz,
        rot: src.rot,
        dim: src.dimMM,
        parts: [...world, ...probes, probe],
        footprint,
        roomHeight,
        snapMode: 'off',
        currentY: src.pos[1],
      });
      spots[i] = { pos: r.pos, rot: r.rot };
      probes.push({ ...probe, pos: r.pos, rot: r.rot });
      if (!r.valid) valid = false;
      if (r.refusal === 'room' || r.refusal === 'wall') inRoom = false;
      // The containment clamp can carry a step at the room's edge straight back onto
      // the piece it started beside, so "off the original" is asked, not assumed — and
      // asked of the footprints, not of `collidesAt`, which never reports a rug or a
      // curtain: a 2.4 m rug's step right was clamped back to 600 mm over its original
      // and came back `valid`.
      const mine = obbFromPart(r.pos, r.rot, src.dimMM);
      if (sources.some((o) => obbOverlap(mine, obbFromPart(o.pos, o.rot, o.dimMM), -0.001))) offOriginal = false;
      // A lamp copied WITH its desk rides the desk's copy, so it is never "on the same"
      // desk and the first tier below finds nothing — which is right: the second tier
      // is the same order without the question, and the set moves as one.
      const was = supportOf[src.id];
      if (was && r.supportId !== was) onSame = false;
      // Did it land where it was asked, rather than where a clamp or a wall's end
      // carried it? `valid` does not say: the containment clamp is a correction, not
      // a refusal, so a bed stepped half through the east wall comes back valid and
      // 500 mm short — and its nightstands, which were not clamped, do not.
      if (Math.hypot(r.pos[0] - (src.pos[0] + dx), r.pos[2] - (src.pos[2] + dz)) > ASKED_TOL_M) asked = false;
    }
    return { spots, valid, inRoom, offOriginal, onSame, asked };
  };

  const steps = candidates(w, d).map(([lx, lz]) => localToWorld(frame, lx, lz));
  const tries = steps.map(([dx, dz]) => attempt(dx, dz));
  const wantsSame = sources.some((s) => supportOf[s.id]);
  // Nearest first within each tier, and the tiers in the order a person would rank
  // them: exactly beside it (on the same surface, for a rider); beside it but shifted
  // by the room's edge; anywhere in the room off the original, overlapping something.
  const clean = (t: Try) => t.valid && t.offOriginal;
  const pick =
    (wantsSame ? tries.find((t) => clean(t) && t.asked && t.onSame) : undefined) ??
    tries.find((t) => clean(t) && t.asked) ??
    tries.find(clean) ??
    tries.find((t) => t.inRoom && t.offOriginal);
  if (pick) return { spots: pick.spots, clear: pick.valid };
  return { spots: sources.map((s) => ({ pos: [...s.pos] as [number, number, number], rot: s.rot })), clear: false };
}
