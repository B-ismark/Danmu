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

import type { ScenePart, Category } from './scene-spec';
import type { Footprint } from './footprint';
import {
  obbFromPart,
  obbGap,
  faceClearance,
  pointInObb,
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

  // ── 2. Pinched walkways between bulky furniture ──────────────────────────
  const bulky = solid.filter((p) => WALKWAY_CATEGORIES.has(p.category));
  for (let i = 0; i < bulky.length; i++) {
    for (let j = i + 1; j < bulky.length; j++) {
      const a = bulky[i];
      const b = bulky[j];
      const gap = obbGap(obbs.get(a.id)!, obbs.get(b.id)!);
      // Touching (deliberate composition) and far apart are both fine — the
      // problem zone is a gap someone would try to squeeze through.
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

  // ── 3. Storage door / drawer front clearance ─────────────────────────────
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

  // ── 4. Bedside access ────────────────────────────────────────────────────
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

  // ── 5. TV viewing distance ───────────────────────────────────────────────
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

  // ── 6. Free floor share ──────────────────────────────────────────────────
  const roomArea = polygonArea(poly);
  const used = solid.reduce((acc, p) => acc + (p.dimMM[0] / 1000) * (p.dimMM[1] / 1000), 0);
  const freeFloorShare = roomArea > 0 ? Math.max(0, 1 - used / roomArea) : 1;
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
