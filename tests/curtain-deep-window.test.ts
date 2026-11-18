// A curtain hung over a window deeper than the catalogue's 60 mm, by every path that
// hangs one. `CURTAIN_STANDOFF` clears a 60 mm window's sill; a deeper window's sill
// reaches `depth + 60 mm` into the room, and until `hangOnWall` only the seeded pair
// knew that (docs/what-is-still-open.md § 58). Each path is asked through its own entry
// point rather than through `hangOnWall`, because the defect was paths disagreeing.
// (The swap path is in `tests/swap-model.test.ts`, which drives the stores. The Wall
// button is not among them: the panel offers it only to floor pieces, and its target
// is handed to `resolvePlacement` anyway, which is the drag case below.)
import { describe, expect, it } from 'vitest';
import { footprintForLayout } from '@/lib/footprint';
import { localToWorld } from '@/lib/geometry';
import { CURTAIN_CLEAR, CURTAIN_STANDOFF, hangOnWall, snapToWall, windowReach } from '@/lib/physics';
import { curtainCloth } from '@/lib/soft-goods';
import { partExtent, windowForm } from '@/lib/hard-goods';
import { placeNewPart, type ScenePart } from '@/lib/scene-spec';
import { resolvePlacement } from '@/lib/drag-resolve';
import { WALL_GAP } from '@/lib/layout-rules';

const FP = footprintForLayout('rect', 4, 4);
const H = 2.6;
const C_DIM: [number, number, number] = [1600, 120, 2200];

/** A window on the north wall, snapped there the way the Library puts one. */
function windowAt(depthMM: number, x = 0, z = -2): ScenePart {
  const dim: [number, number, number] = [1200, depthMM, 1200];
  const s = snapToWall([x, 0, z], dim, FP, 0);
  return {
    id: `win-${depthMM}-${x}-${z}`, name: 'Window', category: 'other', shape: 'window', locked: false,
    dimMM: dim, pos: [s.x, 1.4, s.z], rot: s.rot ?? 0, wallMounted: true,
  } as ScenePart;
}

function curtainAt(x: number, z: number, rot = 0): ScenePart {
  return {
    id: 'curtain', name: 'Curtain', category: 'curtain', shape: 'curtain', locked: false,
    dimMM: C_DIM, pos: [x, 1.4, z], rot, wallMounted: true,
  } as ScenePart;
}

/** Cloth's deepest trough minus the window's furthest part (the sill), along the
 *  window's facing: must be at least `CURTAIN_CLEAR`. */
function gap(pos: readonly number[], w: ScenePart): number {
  const [fx, fz] = localToWorld(w.rot, 0, 1);
  const ahead = (p: readonly number[]) => p[0] * fx + p[2] * fz;
  const verts = curtainCloth(C_DIM, 12).positions;
  let back = Infinity;
  for (let i = 2; i < verts.length; i += 3) back = Math.min(back, verts[i]);
  let front = -Infinity;
  for (const part of windowForm(w.dimMM).parts) front = Math.max(front, partExtent(part).hi[2]);
  return ahead(pos) + back - (ahead(w.pos) + front);
}

/** How far the curtain's centre stands off the north wall's plaster. */
const offWall = (pos: readonly number[]) => pos[2] + 2;

const DEPTHS = [60, 100, 150, 200];

describe('a curtain over a deep window clears its sill, however it is hung', () => {
  it('dragged', () => {
    for (const d of DEPTHS) {
      const win = windowAt(d);
      const r = resolvePlacement({
        part: curtainAt(0.1, -1.5), rawX: 0.1, rawZ: -1.5, rot: 0, dim: C_DIM,
        parts: [win, curtainAt(0.1, -1.5)], footprint: FP, roomHeight: H, snapMode: 'off',
      });
      expect(gap(r.pos, win), `drag, window ${d} mm`).toBeGreaterThanOrEqual(CURTAIN_CLEAR - 1e-9);
    }
  });

  it('added from the Library', () => {
    for (const d of DEPTHS) {
      const win = windowAt(d);
      const p = placeNewPart('curtain', 'curtain', C_DIM, { width: 4, depth: 4, height: H, footprint: FP }, [win], [0, -1.5]);
      expect(gap(p.pos, win), `add, window ${d} mm`).toBeGreaterThanOrEqual(CURTAIN_CLEAR - 1e-9);
    }
  });

  it('stands off by the sill it must clear, exactly — no further', () => {
    // The 200 mm window's sill reaches 260 mm; the curtain's back goes `CURTAIN_CLEAR`
    // beyond it, and its centre half its own depth more.
    const win = windowAt(200);
    const s = hangOnWall([0, 0, -1.5], C_DIM, FP, 'curtain', [win]);
    expect(offWall([s.x, 0, s.z])).toBeCloseTo(WALL_GAP + windowReach(0.2) + CURTAIN_CLEAR + C_DIM[1] / 2000, 9);
  });

  it('keeps the standard gap where no deep window is behind it', () => {
    const standard = WALL_GAP + CURTAIN_STANDOFF + C_DIM[1] / 2000;
    // Nothing at all.
    let s = hangOnWall([0, 0, -1.5], C_DIM, FP, 'curtain', []);
    expect(offWall([s.x, 0, s.z]), 'no window').toBeCloseTo(standard, 9);
    // A deep window on ANOTHER wall (east), facing another way.
    const east = windowAt(200, 2, 0);
    s = hangOnWall([0, 0, -1.5], C_DIM, FP, 'curtain', [east]);
    expect(offWall([s.x, 0, s.z]), 'a window on another wall').toBeCloseTo(standard, 9);
    // A deep window on the SAME wall, but well along it — not behind the curtain.
    const along = windowAt(200, -1.4);
    s = hangOnWall([1.1, 0, -1.5], C_DIM, FP, 'curtain', [along]);
    expect(offWall([s.x, 0, s.z]), 'a window further along the wall').toBeCloseTo(standard, 9);
    // A deep window just overlapping the curtain's end (sill overhang included) DOES count.
    const edge = windowAt(200, 1.1 - (C_DIM[0] / 2000 + 0.6 + 0.06) + 0.01);
    s = hangOnWall([1.1, 0, -1.5], C_DIM, FP, 'curtain', [edge]);
    expect(offWall([s.x, 0, s.z]), 'a window just under the curtain’s end').toBeGreaterThan(standard + 0.1);
  });

  it('leaves everything that is not a curtain to `snapToWall`', () => {
    const win = windowAt(200);
    const tv: [number, number, number] = [1200, 80, 700];
    expect(hangOnWall([0, 0, -1.5], tv, FP, 'tv', [win])).toEqual(snapToWall([0, 0, -1.5], tv, FP, 0));
  });
});
