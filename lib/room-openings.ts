// Where a room is entered, and where its light comes from.
//
// Until this existed, no preset room had a door or a window. `footprintForLayout`
// returned a bare polygon and `defaultScene` furnished it — which sounds like a
// small omission and is the reason the starter rooms had no rationale anybody could
// read. Four things followed from it, all of them measured on the shipped presets:
//
//   · `roomProfile.apertures` was empty, so `navigabilityCost` returned 0 by its own
//     no-door guard and the solver's "can you actually get there" pass was INERT on
//     every new room.
//   · `entranceComponents` returned null, so the room report's `reach` and `cut-off`
//     rules said nothing and the `door` and `entry` rules never fired at all.
//   · The `desk ← window` relation was unreachable.
//   · And, above all: **with no door, no wall has a reason to be the back wall.**
//     The seeder chose by `min(depth, 3.3) × 2 + width` — a defensible tiebreak, but
//     the thing that actually decides it in a real room is what you see when you walk
//     in and where the daylight falls, and neither was in the room.
//
// So the openings come first and everything else is arranged against them. Nothing
// here is a guess about a real building: it is the ordinary arrangement of a
// domestic room, stated as geometry.
//
// ── The two rules ───────────────────────────────────────────────────────────
//
//   · **The door goes on a short wall, near a corner.** You come into a room through
//     its end, not across its best wall, and a door in the middle of a wall cuts that
//     wall in two — a 4 m wall with a central door has two 1.5 m runs and holds
//     nothing. Set against a corner it leaves one long run for furniture, which is
//     what the seeder then uses.
//   · **The window faces the door.** The wall you face walking in is the one worth
//     glazing, and it is what puts daylight across the room rather than into the eyes
//     of anyone sitting in it. A large room gets a second window on a long side wall.
//
// Deterministic, and derived entirely from the polygon: an L, a T, a U or a shape the
// user dragged into being all get answered by the same two rules rather than by a
// table of preset-specific constants, which is what `lib/room-bays.ts` already
// established for the furniture.

import type { Footprint } from './footprint';
import { polygonCentroid } from './footprint';

/** A hole in a wall, ready to become a `ScenePart`. */
export type Opening = {
  kind: 'door' | 'window';
  name: string;
  /** Centre of the opening, on the wall face. */
  x: number;
  z: number;
  /** Yaw whose front (local +Z) points INTO the room — the same convention
   *  `BaySide.yaw` and `nearestEdge` use. */
  rot: number;
  dimMM: [number, number, number];
  /** Centre height. Wall-mounted parts are positioned at their mesh centre. */
  y: number;
};

/** A standard internal door, and a domestic window. Sizes match the catalog's own
 *  entries rather than being invented here — a door the user adds by hand and a door
 *  the room came with have to be the same object. */
const DOOR_MM: [number, number, number] = [900, 50, 2100];
const WINDOW_MM: [number, number, number] = [1200, 60, 1200];

/** Height of a window's sill. The `window` access rule reads the sill back off the
 *  part (`pos.y − h/2`) to decide what may stand in front of it, so this is the one
 *  number that decides whether the thing under the window is a windowsill or a
 *  mistake — and it has to be the number that lets a sofa back onto a window, because
 *  a sofa under a window is the most ordinary arrangement in the language.
 *
 *  900 mm is the ordinary domestic sill and it lands on the right side of every piece
 *  that matters: an 880 mm sofa back passes under it, a 2100 mm wardrobe does not.
 *  At 800 mm every seeded living room reported its own sofa as blocking the light. */
const SILL = 0.9;

/** Clear wall left between a door's jamb and the corner it sits near. Enough for
 *  the architrave and a hand on the handle. */
const JAMB = 0.35;

/** A wall shorter than this cannot hold a door with its jambs. */
const doorNeeds = DOOR_MM[0] / 1000 + JAMB * 2;
/** …and a window wants a little wall either side of it too. */
const windowNeeds = WINDOW_MM[0] / 1000 + 0.6;

/** Past this floor area a room is worth a second window. Two windows in a 12 m²
 *  bedroom is a conservatory, not a bedroom. */
const SECOND_WINDOW_AREA = 18;

type Edge = {
  /** Midpoint, inward normal, and the yaw that faces into the room. */
  mx: number;
  mz: number;
  nx: number;
  nz: number;
  yaw: number;
  length: number;
  /** Unit vector along the edge, from `a` to `b`. */
  ux: number;
  uz: number;
  ax: number;
  az: number;
};

/**
 * Where this room's door and windows go.
 *
 * Returns them in placement order — the door first, because everything else is
 * chosen relative to it. An empty result means the polygon has no wall long enough
 * to hold a door, which is a room too small to be one; the caller furnishes it
 * anyway and `lib/clearance.ts` has the honest thing to say about it.
 */
export function openingsForRoom(poly: Footprint): Opening[] {
  const edges = edgesOf(poly);
  if (edges.length === 0) return [];

  // ── The door: the shortest wall that can hold one ────────────────────────
  //
  // Shortest rather than nearest-anything: a room's long walls are its useful ones,
  // and spending one on the door is what leaves a living room with nowhere to put
  // the sofa. Ties break on position so the answer is the same every time the room
  // is opened.
  const doorable = edges.filter((e) => e.length >= doorNeeds);
  if (doorable.length === 0) return [];
  // …and an OUTER wall, before length is even consulted. The short walls of an L or
  // a T are the ones its own notch cuts, and a door there opens into the wing rather
  // than into the room: measured on the 6 × 4.7 L, the door took the 1.97 m notch
  // wall and its swing plus route filled the wing, so the reading nook the preset
  // promises could not be seeded at all. An outer wall is one the whole polygon lies
  // behind — a hull edge — which is the same question asked in geometry instead of in
  // special cases per preset shape.
  const outer = doorable.filter((e) => isOuter(e, poly));
  const doorEdge = [...(outer.length > 0 ? outer : doorable)].sort(
    (a, b) => a.length - b.length || a.mx - b.mx || a.mz - b.mz,
  )[0];

  // Against the corner, not across the middle — see the header. Which corner is
  // decided by which one leaves the longer stretch of the room behind it, measured
  // from the room's own middle, so an L's door does not open onto its own notch.
  const centre = polygonCentroid(poly);
  const half = DOOR_MM[0] / 2000;
  const near = JAMB + half;
  const far = doorEdge.length - JAMB - half;
  const at = pickEnd(doorEdge, near, far, centre);

  const out: Opening[] = [
    {
      kind: 'door',
      name: 'Door',
      ...pointOn(doorEdge, at, DOOR_MM[1]),
      rot: doorEdge.yaw,
      dimMM: DOOR_MM,
      // Base on the floor: a wall-mounted part is positioned at its mesh centre.
      y: DOOR_MM[2] / 2000,
    },
  ];

  // ── The windows: facing the door first ───────────────────────────────────
  //
  // Outer walls only, and for the same reason the door wants one: a window in the
  // side of an L's or a T's notch does not look outside, it looks across the room.
  const glazeable = edges.filter((e) => e !== doorEdge && e.length >= windowNeeds && isOuter(e, poly));
  const facing = glazeable
    .filter((e) => e.nx * doorEdge.nx + e.nz * doorEdge.nz < -0.5)
    .sort((a, b) => b.length - a.length);
  const sides = glazeable
    .filter((e) => Math.abs(e.nx * doorEdge.nx + e.nz * doorEdge.nz) < 0.5)
    .sort((a, b) => b.length - a.length);

  // The wall you face coming in, else the longest other wall — a room whose door is
  // on the only wall opposite anything still deserves daylight.
  const first = facing[0] ?? sides[0];
  if (first) out.push(windowOn(first, 0.5));
  // …and a second on a side wall, once there is room enough to want one — but the
  // SHORTER side, because a room's longest wall is its best furniture wall and
  // glazing it costs the room its focal wall. Measured on the 6 × 4.7 L: the second
  // window took the 6 m north wall, which is the only wall in that room long enough
  // and deep enough to seat a sofa in front of a screen, so the seeder had to hang
  // the television in front of the window or hang it nowhere.
  if (polyArea(poly) >= SECOND_WINDOW_AREA) {
    const second = [...sides]
      .reverse()
      .find((e) => e !== first && !out.some((o) => o.x === e.mx && o.z === e.mz));
    if (second) out.push(windowOn(second, 0.5));
  }
  return out;
}

function windowOn(edge: Edge, t: number): Opening {
  return {
    kind: 'window',
    name: 'Window',
    ...pointOn(edge, edge.length * t, WINDOW_MM[1]),
    rot: edge.yaw,
    dimMM: WINDOW_MM,
    y: SILL + WINDOW_MM[2] / 2000,
  };
}

/** A point `d` along the edge from its start, stood just inside the wall.
 *
 *  Just inside, not exactly on it: a wall-mounted part is positioned at its mesh
 *  centre, so half its depth is the geometry, and the extra millimetres are because
 *  a point ON a polygon's boundary is not reliably inside it — `pointInFootprint`
 *  answered `false` for every opening placed on the line, which is how a door came to
 *  be reported as not being in the room it is the way into. */
function pointOn(e: Edge, d: number, depthMM = 0): { x: number; z: number } {
  const inset = depthMM / 2000 + 0.01;
  return { x: e.ax + e.ux * d + e.nx * inset, z: e.az + e.uz * d + e.nz * inset };
}

/** Which end of the wall to sit the door against: the one whose far side has more
 *  room behind it, so the door opens into the body of the room rather than into a
 *  corner it shares with a notch. */
function pickEnd(e: Edge, near: number, far: number, centre: [number, number]): number {
  if (far <= near) return e.length / 2;
  const a = pointOn(e, near);
  const b = pointOn(e, far);
  const da = Math.hypot(a.x - centre[0], a.z - centre[1]);
  const db = Math.hypot(b.x - centre[0], b.z - centre[1]);
  // Nearer the room's middle wins: that end has the room on both sides of it.
  return da <= db ? near : far;
}

/** The polygon's edges, each with the frame a wall-mounted part needs.
 *
 *  The inward normal is taken from the polygon's winding and then CHECKED against
 *  the centroid, because a footprint the user has dragged can end up wound either
 *  way and a door facing the garden is not a door. */
function edgesOf(poly: Footprint): Edge[] {
  if (poly.length < 3) return [];
  const centre = polygonCentroid(poly);
  const out: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const ux = dx / length;
    const uz = dz / length;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    let nx = -uz;
    let nz = ux;
    if ((centre[0] - mx) * nx + (centre[1] - mz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    out.push({ mx, mz, nx, nz, yaw: Math.atan2(nx, nz), length, ux, uz, ax: a[0], az: a[1] });
  }
  return out;
}

/** Is this edge on the room's outer boundary — i.e. does the whole polygon lie on its
 *  inward side?
 *
 *  A convex-hull edge, asked directly rather than by building the hull. True for every
 *  wall of a rectangle, and false for exactly the walls an L, a T or a U cuts INTO
 *  itself, which is what separates "a wall of the room" from "the side of a notch". */
function isOuter(e: Edge, poly: Footprint): boolean {
  for (const [vx, vz] of poly) {
    if ((vx - e.ax) * e.nx + (vz - e.az) * e.nz < -0.01) return false;
  }
  return true;
}

function polyArea(poly: Footprint): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
