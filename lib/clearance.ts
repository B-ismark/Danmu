// Room ergonomics checker — deterministic interior-design rules evaluated
// against exact part geometry (lib/geometry). No AI involved: every finding is
// reproducible math over the scene, which is what makes it trustworthy enough
// to plan a real room around.
//
// Thresholds follow common interior-design guidance:
//   · 600 mm minimum comfortable walkway between furniture
//   · 600 mm in front of hinged storage (wardrobe doors, fridge)
//   · 500 mm bedside access strip
//   · TV viewing distance ≈ 1.2–2.5 × screen diagonal
//
// Two of the rules here exist because the geometry engine deliberately does not
// "fix" a problem silently: parts can overlap (nothing resolves part-vs-part at
// build time) and a part can be taller than the room (shrinking it to fit would be
// a dimension lie). Both used to produce no finding at all, so the panel said
// "Everything fits" over an arrangement that plainly did not.

import type { ScenePart, Category } from './scene-spec';
import type { Footprint } from './footprint';
import {
  obbFromPart,
  obbGap,
  obbIntersectionArea,
  faceClearance,
  pointInObb,
  pointInPoly,
  type OBB,
  type Poly,
} from './geometry';

export type ClearanceSeverity = 'error' | 'warn' | 'info';

export type ClearanceIssue = {
  id: string;
  severity: ClearanceSeverity;
  title: string;
  detail: string;
  /** parts involved — UI selects these on click */
  partIds: string[];
};

export type RoomReport = {
  issues: ClearanceIssue[];
  /** share of the floor polygon not covered by floor-standing furniture, 0..1 */
  freeFloorShare: number;
};

// Bulky pieces whose pairwise gaps form walkways people actually use.
const WALKWAY_CATEGORIES = new Set<Category>([
  'sofa', 'bed', 'wardrobe', 'shelf', 'fridge', 'desk',
]);

// Storage whose doors/drawers need room to open in front.
const FRONT_CLEARANCE_CATEGORIES = new Set<Category>(['wardrobe', 'fridge', 'shelf']);

const MIN_WALKWAY = 0.6;
const MIN_FRONT = 0.6;
const MIN_BEDSIDE = 0.5;

// ── Same-place rule thresholds ──────────────────────────────────────────────
// Seating pushed under a work surface shares that surface's footprint ON
// PURPOSE, and the chair back rises above the table top so no vertical test
// separates the two. Four chairs round a dining table is the most ordinary
// arrangement there is; reporting four errors on it would teach people to
// ignore this panel.
const TUCKS_UNDER = new Set<Category>(['chair', 'ottoman']);
const TUCKED_INTO = new Set<Category>(['table', 'desk']);

/** Share of the SMALLER piece's footprint that must lie inside the other before
 *  this is a collision rather than two pieces meeting untidily. Half of a piece
 *  buried in another is unambiguous; a few centimetres of clip is a nudge. */
const CLASH_SHARE = 0.5;

/** …and for a pair that legitimately shares floor, the bar instead of a blanket
 *  exemption. A chair pushed hard under a table reaches perhaps 60% of its own
 *  footprint; a chair standing where the table is reaches all of it, and that is
 *  still worth saying. */
const TUCKED_CLASH_SHARE = 0.85;

function clashShare(a: ScenePart, b: ScenePart): number {
  const tucks =
    (TUCKS_UNDER.has(a.category) && TUCKED_INTO.has(b.category)) ||
    (TUCKS_UNDER.has(b.category) && TUCKED_INTO.has(a.category));
  return tucks ? TUCKED_CLASH_SHARE : CLASH_SHARE;
}

export function analyzeRoom(
  parts: ScenePart[],
  room: { footprint: Footprint; height: number },
): RoomReport {
  const issues: ClearanceIssue[] = [];
  const poly = room.footprint as Poly;

  // Floor-standing solid furniture only (rugs and wall-mounted items don't
  // block walking).
  const solid = parts.filter(
    (p) => !p.wallMounted && p.category !== 'rug' && p.pos[1] < 0.05 && p.dimMM[2] > 250,
  );
  const obbs = new Map<string, OBB>();
  for (const p of solid) obbs.set(p.id, obbFromPart(p.pos, p.rot, p.dimMM));

  // ── 1. Door swing blocked ────────────────────────────────────────────────
  for (const door of parts.filter((p) => p.category === 'door')) {
    const radius = door.dimMM[0] / 1000; // the leaf sweeps its own width
    const blockers = solid.filter((p) => {
      if (p.id === door.id) return false;
      const b = obbs.get(p.id)!;
      return distPointToObb(door.pos[0], door.pos[2], b) < radius;
    });
    if (blockers.length > 0) {
      issues.push({
        id: `door-${door.id}`,
        severity: 'error',
        title: 'Door can’t open fully',
        detail: `${blockers.map((b) => b.name).join(', ')} sits inside the ${Math.round(radius * 100)} cm swing of “${door.name}”.`,
        partIds: [door.id, ...blockers.map((b) => b.id)],
      });
    }
  }

  // ── 2. Two pieces in the same place ──────────────────────────────────────
  // obbGap returns 0 both for furniture pushed flush together (deliberate) and
  // for furniture occupying the same floor (a mistake), and the walkway rule
  // below skips everything at or under 12 cm as "touching". So interpenetrating
  // parts used to produce no finding at all, and the panel said "Everything
  // fits". buildSceneFromRoom does no part-vs-part resolution, so a detected
  // scene can genuinely arrive like this.
  //
  // "Overlap at all" is the wrong test, though — see TUCKS_UNDER and
  // CLASH_SHARE above. This wants the pieces that are IN each other, not the
  // ones that merely meet.
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      // Only when they also share vertical space — a monitor over a desk is a
      // stack, not a clash. (`solid` is already floor-level, but a part can sit
      // just under 0.05 m and still be short enough to pass under another.)
      const aTop = a.pos[1] + a.dimMM[2] / 1000;
      const bTop = b.pos[1] + b.dimMM[2] / 1000;
      if (aTop <= b.pos[1] + 0.005 || bTop <= a.pos[1] + 0.005) continue;
      const oa = obbs.get(a.id)!;
      const ob = obbs.get(b.id)!;
      const shared = obbIntersectionArea(oa, ob);
      if (shared <= 0) continue;
      const smaller = Math.min(oa.hw * oa.hd, ob.hw * ob.hd) * 4;
      if (smaller <= 0 || shared / smaller < clashShare(a, b)) continue;
      issues.push({
        id: `clash-${a.id}-${b.id}`,
        severity: 'error',
        title: 'Two pieces in the same place',
        detail: `“${a.name}” and “${b.name}” overlap on the floor — one of them has to move before this arrangement is real.`,
        partIds: [a.id, b.id],
      });
    }
  }

  // ── 3. Pinched walkways between bulky furniture ──────────────────────────
  const bulky = solid.filter((p) => WALKWAY_CATEGORIES.has(p.category));
  for (let i = 0; i < bulky.length; i++) {
    for (let j = i + 1; j < bulky.length; j++) {
      const a = bulky[i];
      const b = bulky[j];
      const gap = obbGap(obbs.get(a.id)!, obbs.get(b.id)!);
      // Touching (deliberate composition) and far apart are both fine — the
      // problem zone is a gap someone would try to squeeze through. Genuine
      // overlap is caught above, so 0 here really does mean flush.
      if (gap > 0.12 && gap < MIN_WALKWAY) {
        issues.push({
          id: `walk-${a.id}-${b.id}`,
          severity: 'warn',
          title: 'Tight walkway',
          detail: `Only ${Math.round(gap * 100)} cm between “${a.name}” and “${b.name}” — comfortable passage needs ${MIN_WALKWAY * 100} cm.`,
          partIds: [a.id, b.id],
        });
      }
    }
  }

  // ── 4. Storage door / drawer front clearance ─────────────────────────────
  for (const p of solid.filter((s) => FRONT_CLEARANCE_CATEGORIES.has(s.category))) {
    const others = solid.filter((o) => o.id !== p.id).map((o) => obbs.get(o.id)!);
    const front = faceClearance(obbs.get(p.id)!, '+z', others, poly, 2);
    if (front < MIN_FRONT) {
      issues.push({
        id: `front-${p.id}`,
        severity: 'warn',
        title: 'Doors can’t open',
        detail: `“${p.name}” has ${Math.round(front * 100)} cm in front — needs ${MIN_FRONT * 100} cm to open doors and reach inside.`,
        partIds: [p.id],
      });
    }
  }

  // ── 5. Bedside access ────────────────────────────────────────────────────
  for (const bed of solid.filter((s) => s.category === 'bed')) {
    const others = solid
      .filter((o) => o.id !== bed.id && o.category !== 'nightstand')
      .map((o) => obbs.get(o.id)!);
    const me = obbs.get(bed.id)!;
    const left = faceClearance(me, '-x', others, poly, 2);
    const right = faceClearance(me, '+x', others, poly, 2);
    const isDouble = bed.shape === 'bed-double';
    const clearSides = [left, right].filter((d) => d >= MIN_BEDSIDE).length;
    if (isDouble && clearSides < 2) {
      issues.push({
        id: `bed-${bed.id}`,
        severity: 'warn',
        title: 'Bed hard to get into',
        detail: `A double bed wants ${MIN_BEDSIDE * 100} cm on both sides — “${bed.name}” has ${Math.round(left * 100)} cm / ${Math.round(right * 100)} cm.`,
        partIds: [bed.id],
      });
    } else if (!isDouble && clearSides < 1) {
      issues.push({
        id: `bed-${bed.id}`,
        severity: 'warn',
        title: 'Bed boxed in',
        detail: `“${bed.name}” has no free side — keep at least ${MIN_BEDSIDE * 100} cm on one side to get in and make the bed.`,
        partIds: [bed.id],
      });
    }
  }

  // ── 6. TV viewing distance ───────────────────────────────────────────────
  const seats = parts.filter((p) => p.category === 'sofa' || p.shape === 'chair-armchair');
  for (const tv of parts.filter((p) => p.category === 'tv' && p.shape === 'tv')) {
    if (seats.length === 0) continue;
    const diag = Math.hypot(tv.dimMM[0], tv.dimMM[2]) / 1000;
    let nearest: ScenePart | null = null;
    let nd = Infinity;
    for (const s of seats) {
      const d = Math.hypot(s.pos[0] - tv.pos[0], s.pos[2] - tv.pos[2]);
      if (d < nd) {
        nd = d;
        nearest = s;
      }
    }
    if (!nearest) continue;
    if (nd < diag * 1.0) {
      issues.push({
        id: `tv-${tv.id}`,
        severity: 'warn',
        title: 'Sitting too close to the TV',
        detail: `“${nearest.name}” is ${nd.toFixed(1)} m from the ${Math.round((diag / 0.0254) * 10) / 10}″-class screen — comfortable viewing starts around ${(diag * 1.2).toFixed(1)} m.`,
        partIds: [tv.id, nearest.id],
      });
    } else if (nd > diag * 3.2) {
      issues.push({
        id: `tv-${tv.id}`,
        severity: 'info',
        title: 'TV may feel small from the seat',
        detail: `“${nearest.name}” sits ${nd.toFixed(1)} m away — ideal range for this screen is ${(diag * 1.2).toFixed(1)}–${(diag * 2.5).toFixed(1)} m.`,
        partIds: [tv.id, nearest.id],
      });
    }
  }

  // ── 7. Taller than the room ──────────────────────────────────────────────
  // The scene builder deliberately does NOT shrink a piece to fit — clamping the
  // dimension would be the one thing this codebase refuses to do, and a 2.6 m
  // wardrobe genuinely does not go under a 2.4 m ceiling. So it keeps its real
  // height, sits on the floor, and passes through the ceiling in the 3D view with
  // nothing said about it. Say it here, where the room's problems are reported.
  for (const p of parts) {
    if (p.wallMounted) continue;
    const h = p.dimMM[2] / 1000;
    if (h <= room.height) continue;
    issues.push({
      id: `tall-${p.id}`,
      severity: 'error',
      title: 'Taller than the room',
      detail: `“${p.name}” is ${Math.round(h * 100)} cm tall and the ceiling is ${Math.round(room.height * 100)} cm — it will not stand up in here. Danmu keeps the real size rather than shrinking it for you.`,
      partIds: [p.id],
    });
  }

  // ── 8. Free floor share ──────────────────────────────────────────────────
  const freeFloorShare = freeFloorFraction(
    solid.map((p) => obbs.get(p.id)!),
    poly,
  );
  if (freeFloorShare < 0.4) {
    issues.push({
      id: 'crowding',
      severity: 'warn',
      title: 'Room is getting crowded',
      detail: `Furniture covers ${Math.round((1 - freeFloorShare) * 100)}% of the floor — most rooms breathe best under 50%.`,
      partIds: [],
    });
  }

  const order: Record<ClearanceSeverity, number> = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { issues, freeFloorShare };
}

/** Cell size for the coverage raster, in metres. 5 cm over a 40 m room is 800
 *  columns — ample for a percentage, and cheap because the whole thing runs once
 *  per committed edit (analyzeRoom is memoised by its caller). */
const COVER_CELL = 0.05;

/** Fraction of the footprint NOT covered by any part, 0..1.
 *
 *  A union, not a sum. Summing each part's W × D triple-counted a chair pushed
 *  under a desk, ignored rotation entirely, and counted the whole of a part that
 *  hung outside the room after a wall drag — then clamped the result at 0, so a
 *  busy room confidently reported "100% of the floor covered". */
export function freeFloorFraction(parts: OBB[], poly: Poly): number {
  let inside = 0;
  let covered = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxZ <= minZ) return 1;

  for (let z = minZ + COVER_CELL / 2; z < maxZ; z += COVER_CELL) {
    for (let x = minX + COVER_CELL / 2; x < maxX; x += COVER_CELL) {
      if (!pointInPoly(x, z, poly)) continue;
      inside++;
      for (const b of parts) {
        if (pointInObb(x, z, b)) {
          covered++;
          break;
        }
      }
    }
  }
  if (inside === 0) return 1;
  return Math.max(0, Math.min(1, 1 - covered / inside));
}

/** Distance from a point to an OBB's boundary (0 when inside). */
function distPointToObb(x: number, z: number, b: OBB): number {
  if (pointInObb(x, z, b)) return 0;
  const c = Math.cos(-b.rot);
  const s = Math.sin(-b.rot);
  const dx = x - b.cx;
  const dz = z - b.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ex = Math.max(0, Math.abs(lx) - b.hw);
  const ez = Math.max(0, Math.abs(lz) - b.hd);
  return Math.hypot(ex, ez);
}

export function polygonArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}
