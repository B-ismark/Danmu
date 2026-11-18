// A window made deeper by a typed size re-hangs the curtain over it (lib/curtain-rehang.ts).
// `tests/curtain-deep-window.test.ts` covers hanging a curtain over a window that is
// ALREADY deep; this is the other order — curtain first, window deepened after.
import { describe, expect, it } from 'vitest';
import { footprintForLayout } from '@/lib/footprint';
import { localToWorld } from '@/lib/geometry';
import { CURTAIN_CLEAR, CURTAIN_STANDOFF, hangOnWall, snapToWall, windowReach } from '@/lib/physics';
import { curtainCloth } from '@/lib/soft-goods';
import { partExtent, windowForm } from '@/lib/hard-goods';
import type { ScenePart } from '@/lib/scene-spec';
import { WALL_GAP } from '@/lib/layout-rules';
import { rehangForResize, type RehangMove } from '@/lib/curtain-rehang';

const FP = footprintForLayout('rect', 4, 4);
const C_DIM: [number, number, number] = [1600, 120, 2200];
const W_DIM = (d: number): [number, number, number] => [1200, d, 1200];

/** A window on the north wall at `x`, where the Library puts one. */
function windowAt(id: string, depthMM: number, x = 0): ScenePart {
  const s = snapToWall([x, 0, -2], W_DIM(depthMM), FP, 0);
  return {
    id, name: 'Window', category: 'other', shape: 'window', locked: false,
    dimMM: W_DIM(depthMM), pos: [s.x, 1.4, s.z], rot: s.rot ?? 0, wallMounted: true,
  } as ScenePart;
}

/** A curtain hung by hand at `x` on the wall nearest (x, z), clear of `room`'s windows. */
function curtainAt(id: string, x: number, room: readonly ScenePart[], z = -1.5): ScenePart {
  const s = hangOnWall([x, 0, z], C_DIM, FP, 'curtain', room);
  return {
    id, name: 'Curtain', category: 'curtain', shape: 'curtain', locked: false,
    dimMM: C_DIM, pos: [s.x, 1.4, s.z], rot: s.rot ?? 0, wallMounted: true,
  } as ScenePart;
}

/** The room after the moves, and the resized piece at its new size. */
function apply(scene: readonly ScenePart[], id: string, dimMM: [number, number, number], moves: RehangMove[]): ScenePart[] {
  return scene.map((p) => {
    const m = moves.find((mv) => mv.id === p.id);
    return { ...p, ...(p.id === id ? { dimMM } : null), ...(m ? { pos: m.pos } : null) };
  });
}

/** Cloth's deepest trough minus the window's sill, along the window's facing. */
function gap(c: ScenePart, w: ScenePart): number {
  const [fx, fz] = localToWorld(w.rot, 0, 1);
  const ahead = (p: readonly number[]) => p[0] * fx + p[2] * fz;
  const verts = curtainCloth(c.dimMM, 12).positions;
  let back = Infinity;
  for (let i = 2; i < verts.length; i += 3) back = Math.min(back, verts[i]);
  let front = -Infinity;
  for (const part of windowForm(w.dimMM).parts) front = Math.max(front, partExtent(part).hi[2]);
  return ahead(c.pos) + back - (ahead(w.pos) + front);
}

const offWall = (p: ScenePart) => p.pos[2] + 2;
const STANDARD = WALL_GAP + CURTAIN_STANDOFF + C_DIM[1] / 2000;
const byId = (scene: readonly ScenePart[], id: string) => scene.find((p) => p.id === id)!;

describe('deepening a window re-hangs the curtain over it', () => {
  it('moves the curtain clear of the new sill, at every depth the window can take', () => {
    for (const d of [100, 150, 200]) {
      const win = windowAt('w', 60);
      const scene = [win, curtainAt('c', 0.1, [win])];
      expect(offWall(byId(scene, 'c')), 'hung at the standard gap first').toBeCloseTo(STANDARD, 9);
      const moves = rehangForResize(scene, 'w', W_DIM(d), FP);
      const after = apply(scene, 'w', W_DIM(d), moves);
      expect(gap(byId(after, 'c'), byId(after, 'w')), `window ${d} mm`).toBeGreaterThanOrEqual(CURTAIN_CLEAR - 1e-9);
    }
  });

  it('lands exactly where hanging it over the deep window would have', () => {
    const win = windowAt('w', 60);
    const scene = [win, curtainAt('c', 0.1, [win])];
    const after = apply(scene, 'w', W_DIM(200), rehangForResize(scene, 'w', W_DIM(200), FP));
    expect(offWall(byId(after, 'c'))).toBeCloseTo(WALL_GAP + windowReach(0.2) + CURTAIN_CLEAR + C_DIM[1] / 2000, 9);
    // Along the wall and up it, nothing changes.
    expect(byId(after, 'c').pos[0]).toBeCloseTo(byId(scene, 'c').pos[0], 9);
    expect(byId(after, 'c').pos[1]).toBe(1.4);
    expect(byId(after, 'c').rot).toBe(byId(scene, 'c').rot);
  });

  it('sets the deepened window back against its wall, as a drag would', () => {
    const win = windowAt('w', 60);
    const moves = rehangForResize([win], 'w', W_DIM(200), FP);
    const seated = snapToWall([win.pos[0], 0, win.pos[2]], W_DIM(200), FP, 0);
    expect(moves).toHaveLength(1);
    expect(moves[0].pos[0]).toBeCloseTo(seated.x, 9);
    expect(moves[0].pos[2]).toBeCloseTo(seated.z, 9);
    expect(moves[0].pos[1]).toBe(1.4);
  });

  it('brings the curtain back in when the window is made shallow again', () => {
    const win = windowAt('w', 200);
    const scene = [win, curtainAt('c', 0.1, [win])];
    expect(offWall(byId(scene, 'c'))).toBeGreaterThan(STANDARD + 0.1);
    const after = apply(scene, 'w', W_DIM(60), rehangForResize(scene, 'w', W_DIM(60), FP));
    expect(offWall(byId(after, 'c'))).toBeCloseTo(STANDARD, 9);
  });

  it('leaves curtains this window is not behind', () => {
    const win = windowAt('w', 60, -1.2);
    // Further along the same wall, clear of the window and its sill…
    const along = curtainAt('along', 1.1, [win]);
    // …and on another wall altogether (east, x = +2).
    const east = curtainAt('east', 1.5, [win], 0);
    expect(east.rot).not.toBe(along.rot);
    const moves = rehangForResize([win, along, east], 'w', W_DIM(200), FP);
    expect(moves.map((m) => m.id)).toEqual(['w']);
  });

  it('does not tidy a curtain the window change did not move', () => {
    // A curtain standing off its hang (a room saved before curtains cleared deep sills,
    // or a file from elsewhere) is compared with where it would hang BEFORE the change,
    // not with where it stands: a window resized on another wall is no reason to move it.
    const win = windowAt('w', 60, -1.2);
    const east = curtainAt('east', 1.5, [win], 0);
    const off = { ...east, pos: [east.pos[0] - 0.05, east.pos[1], east.pos[2]] } as ScenePart;
    expect(rehangForResize([win, off], 'w', W_DIM(200), FP).map((m) => m.id)).toEqual(['w']);
  });

  it('leaves a curtain that a deeper window beside it already holds out', () => {
    // Two windows behind one wide curtain: the 200 mm one sets the hang, so deepening
    // the other to 150 changes nothing the curtain needs.
    const deep = windowAt('deep', 200, -0.7);
    const shallow = windowAt('shallow', 60, 0.7);
    const wide: [number, number, number] = [3000, 120, 2200];
    const s = hangOnWall([0, 0, -1.5], wide, FP, 'curtain', [deep, shallow]);
    const c = { ...curtainAt('c', 0, []), dimMM: wide, pos: [s.x, 1.4, s.z] } as ScenePart;
    const moves = rehangForResize([deep, shallow, c], 'shallow', W_DIM(150), FP);
    expect(moves.map((m) => m.id)).toEqual(['shallow']);
  });

  it('re-seats a curtain resized deeper, still clear of the window behind it', () => {
    const win = windowAt('w', 200);
    const scene = [win, curtainAt('c', 0.1, [win])];
    const deeper: [number, number, number] = [1600, 200, 2200];
    const after = apply(scene, 'c', deeper, rehangForResize(scene, 'c', deeper, FP));
    expect(gap(byId(after, 'c'), win)).toBeGreaterThanOrEqual(CURTAIN_CLEAR - 1e-9);
  });

  it('asks nothing of a piece that is not a window or a curtain', () => {
    const win = windowAt('w', 60);
    const tv = { ...windowAt('tv', 80, 1.2), shape: 'tv', category: 'tv', name: 'TV' } as ScenePart;
    expect(rehangForResize([win, curtainAt('c', 0.1, [win]), tv], 'tv', [1200, 200, 700], FP)).toEqual([]);
  });

  it('writes nothing when the size change moves nothing', () => {
    const win = windowAt('w', 60);
    const scene = [win, curtainAt('c', 0.1, [win])];
    // Taller, same depth: the window's back is already on the plaster and the sill
    // reaches no further.
    expect(rehangForResize(scene, 'w', [1200, 60, 1400], FP)).toEqual([]);
  });
});
