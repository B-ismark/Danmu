// A mounted piece resized by a typed size stays on what it hangs from, and a window made
// deeper re-hangs the curtain over it (lib/mount-resize.ts). `tests/curtain-deep-window.test.ts`
// covers hanging a curtain over a window that is ALREADY deep; this is the other order —
// curtain first, window deepened after.
import { describe, expect, it } from 'vitest';
import { footprintForLayout } from '@/lib/footprint';
import { localToWorld } from '@/lib/geometry';
import { CURTAIN_CLEAR, CURTAIN_STANDOFF, groundY, hangOnWall, MOUNT_PAD, snapToWall, windowReach } from '@/lib/physics';
import { curtainCloth } from '@/lib/soft-goods';
import { partExtent, windowForm } from '@/lib/hard-goods';
import type { ScenePart } from '@/lib/scene-spec';
import { WALL_GAP } from '@/lib/layout-rules';
import { heightForResize, rehangForResize, type RehangMove } from '@/lib/mount-resize';

const FP = footprintForLayout('rect', 4, 4);
const H = 2.6;
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
      const moves = rehangForResize(scene, 'w', W_DIM(d), FP, H);
      const after = apply(scene, 'w', W_DIM(d), moves);
      expect(gap(byId(after, 'c'), byId(after, 'w')), `window ${d} mm`).toBeGreaterThanOrEqual(CURTAIN_CLEAR - 1e-9);
    }
  });

  it('lands exactly where hanging it over the deep window would have', () => {
    const win = windowAt('w', 60);
    const scene = [win, curtainAt('c', 0.1, [win])];
    const after = apply(scene, 'w', W_DIM(200), rehangForResize(scene, 'w', W_DIM(200), FP, H));
    expect(offWall(byId(after, 'c'))).toBeCloseTo(WALL_GAP + windowReach(0.2) + CURTAIN_CLEAR + C_DIM[1] / 2000, 9);
    // Along the wall and up it, nothing changes.
    expect(byId(after, 'c').pos[0]).toBeCloseTo(byId(scene, 'c').pos[0], 9);
    expect(byId(after, 'c').pos[1]).toBe(1.4);
    expect(byId(after, 'c').rot).toBe(byId(scene, 'c').rot);
  });

  it('sets the deepened window back against its wall, as a drag would', () => {
    const win = windowAt('w', 60);
    const moves = rehangForResize([win], 'w', W_DIM(200), FP, H);
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
    const after = apply(scene, 'w', W_DIM(60), rehangForResize(scene, 'w', W_DIM(60), FP, H));
    expect(offWall(byId(after, 'c'))).toBeCloseTo(STANDARD, 9);
  });

  it('leaves curtains this window is not behind', () => {
    const win = windowAt('w', 60, -1.2);
    // Further along the same wall, clear of the window and its sill…
    const along = curtainAt('along', 1.1, [win]);
    // …and on another wall altogether (east, x = +2).
    const east = curtainAt('east', 1.5, [win], 0);
    expect(east.rot).not.toBe(along.rot);
    const moves = rehangForResize([win, along, east], 'w', W_DIM(200), FP, H);
    expect(moves.map((m) => m.id)).toEqual(['w']);
  });

  it('does not tidy a curtain the window change did not move', () => {
    // A curtain standing off its hang (a room saved before curtains cleared deep sills,
    // or a file from elsewhere) is compared with where it would hang BEFORE the change,
    // not with where it stands: a window resized on another wall is no reason to move it.
    const win = windowAt('w', 60, -1.2);
    const east = curtainAt('east', 1.5, [win], 0);
    const off = { ...east, pos: [east.pos[0] - 0.05, east.pos[1], east.pos[2]] } as ScenePart;
    expect(rehangForResize([win, off], 'w', W_DIM(200), FP, H).map((m) => m.id)).toEqual(['w']);
  });

  it('leaves a curtain that a deeper window beside it already holds out', () => {
    // Two windows behind one wide curtain: the 200 mm one sets the hang, so deepening
    // the other to 150 changes nothing the curtain needs.
    const deep = windowAt('deep', 200, -0.7);
    const shallow = windowAt('shallow', 60, 0.7);
    const wide: [number, number, number] = [3000, 120, 2200];
    const s = hangOnWall([0, 0, -1.5], wide, FP, 'curtain', [deep, shallow]);
    const c = { ...curtainAt('c', 0, []), dimMM: wide, pos: [s.x, 1.4, s.z] } as ScenePart;
    const moves = rehangForResize([deep, shallow, c], 'shallow', W_DIM(150), FP, H);
    expect(moves.map((m) => m.id)).toEqual(['shallow']);
  });

  it('re-seats a curtain resized deeper, still clear of the window behind it', () => {
    const win = windowAt('w', 200);
    const scene = [win, curtainAt('c', 0.1, [win])];
    const deeper: [number, number, number] = [1600, 200, 2200];
    const after = apply(scene, 'c', deeper, rehangForResize(scene, 'c', deeper, FP, H));
    expect(gap(byId(after, 'c'), win)).toBeGreaterThanOrEqual(CURTAIN_CLEAR - 1e-9);
  });

  it('asks nothing of a piece that does not ride a wall', () => {
    const sofa = { ...windowAt('sofa', 900, 0), shape: 'sofa', category: 'sofa', name: 'Sofa', wallMounted: false } as ScenePart;
    expect(rehangForResize([sofa], 'sofa', [2000, 1000, 850], FP, H)).toEqual([]);
  });

  it('writes nothing when the size change moves nothing', () => {
    const win = windowAt('w', 60);
    const scene = [win, curtainAt('c', 0.1, [win])];
    // Taller, same depth: the window's back is already on the plaster and the sill
    // reaches no further.
    expect(rehangForResize(scene, 'w', [1200, 60, 1400], FP, H)).toEqual([]);
  });
});

/** A wall piece where the Library hangs one: back on the north wall's plaster. */
function hungAt(id: string, shape: string, category: string, dim: [number, number, number], x = 0, rot?: number): ScenePart {
  const s = snapToWall([x, 0, -2], dim, FP, 0);
  return {
    id, name: id, category, shape, locked: false,
    dimMM: dim, pos: [s.x, 1.4, s.z], rot: rot ?? s.rot ?? 0, wallMounted: true,
  } as ScenePart;
}

/** How far the piece's back stands off the north wall's plaster. */
const backOff = (p: ScenePart) => p.pos[2] - p.dimMM[1] / 2000 + 2;

describe('a wall piece resized in place keeps its back on the wall', () => {
  // TV, print, mirror, air conditioner and door: every wall rider that is not the
  // window/curtain pair above, each made deeper and shallower than it was hung.
  const CASES: Array<[string, string, [number, number, number], number[]]> = [
    ['tv', 'tv', [1200, 80, 700], [40, 150]],
    ['painting', 'painting', [700, 30, 500], [15, 80]],
    ['mirror', 'mirror', [600, 25, 900], [15, 50]],
    ['ac-unit', 'ac', [800, 220, 280], [150, 300]],
    ['door', 'door', [900, 40, 2000], [35, 60]],
  ];
  for (const [shape, category, dim, depths] of CASES) {
    it(shape, () => {
      const piece = hungAt('p', shape, category, dim, 0.3);
      expect(backOff(piece), 'hung on the plaster first').toBeCloseTo(WALL_GAP, 9);
      for (const d of depths) {
        const next: [number, number, number] = [dim[0], d, dim[2]];
        const after = apply([piece], 'p', next, rehangForResize([piece], 'p', next, FP, H));
        expect(backOff(byId(after, 'p')), `${shape} at ${d} mm`).toBeCloseTo(WALL_GAP, 9);
        // Along the wall and up it, nothing changes.
        expect(byId(after, 'p').pos[0]).toBeCloseTo(0.3, 9);
        expect(byId(after, 'p').pos[1]).toBe(1.4);
      }
    });
  }

  it('on a side wall too, where the move is along x', () => {
    const s = snapToWall([1.5, 0, 0.4], [1200, 80, 700], FP, 0);
    const tv = { ...hungAt('tv', 'tv', 'tv', [1200, 80, 700]), pos: [s.x, 1.4, s.z], rot: s.rot ?? 0 } as ScenePart;
    const moves = rehangForResize([tv], 'tv', [1200, 160, 700], FP, H);
    const seated = snapToWall([s.x, 0, s.z], [1200, 160, 700], FP, 0);
    expect(moves).toHaveLength(1);
    expect(moves[0].pos[0]).toBeCloseTo(seated.x, 9);
    expect(moves[0].pos[2]).toBeCloseTo(0.4, 9);
  });
});

describe('a mounted piece resized in place keeps the edge it hangs by', () => {
  /** A ceiling piece where the Library hangs one: top `MOUNT_PAD` under the slab. */
  function ceilingAt(id: string, shape: string, category: string, dim: [number, number, number]): ScenePart {
    return {
      id, name: id, category, shape, locked: false, dimMM: dim, rot: 0,
      pos: [0.4, groundY(category as never, shape as never, dim, H), -0.3],
    } as ScenePart;
  }
  const top = (p: ScenePart) => p.pos[1] + p.dimMM[2] / 2000;
  const bottom = (p: ScenePart) => p.pos[1] - p.dimMM[2] / 2000;

  it('a ceiling fan or ceiling light keeps its top at the ceiling, taller or shorter', () => {
    for (const [shape, category, dim] of [
      ['fan', 'fan', [1200, 1200, 400]],
      ['lamp-ceiling', 'lighting', [500, 500, 150]],
    ] as Array<[string, string, [number, number, number]]>) {
      const piece = ceilingAt('p', shape, category, dim);
      expect(top(piece), `${shape} hung under the slab first`).toBeCloseTo(H - MOUNT_PAD, 9);
      for (const h of [dim[2] / 2, dim[2] * 2]) {
        const next: [number, number, number] = [dim[0], dim[1], h];
        const after = apply([piece], 'p', next, rehangForResize([piece], 'p', next, FP, H));
        expect(top(byId(after, 'p')), `${shape} at ${h} mm`).toBeCloseTo(H - MOUNT_PAD, 9);
        // Ceiling pieces ride no wall: x and z stay exactly where they were.
        expect(byId(after, 'p').pos[0]).toBe(0.4);
        expect(byId(after, 'p').pos[2]).toBe(-0.3);
      }
    }
  });

  it('a curtain and an air conditioner keep their top; a door keeps its threshold', () => {
    const curtain = hungAt('c', 'curtain', 'curtain', [1600, 120, 2200]);
    const c2 = { ...curtain, pos: [curtain.pos[0], 1.4, curtain.pos[2]] } as ScenePart;
    const tall: [number, number, number] = [1600, 120, 2400];
    const cAfter = apply([c2], 'c', tall, rehangForResize([c2], 'c', tall, FP, H));
    expect(top(byId(cAfter, 'c'))).toBeCloseTo(top(c2), 9);

    const ac = hungAt('ac', 'ac-unit', 'ac', [800, 220, 280]);
    const acTall: [number, number, number] = [800, 220, 340];
    const acAfter = apply([ac], 'ac', acTall, rehangForResize([ac], 'ac', acTall, FP, H));
    expect(top(byId(acAfter, 'ac'))).toBeCloseTo(top(ac), 9);

    const door = { ...hungAt('d', 'door', 'door', [900, 40, 2000]), pos: [0.3, 1.0, -2 + 0.02 + 0.02] } as ScenePart;
    const dTall: [number, number, number] = [900, 40, 2200];
    const dAfter = apply([door], 'd', dTall, rehangForResize([door], 'd', dTall, FP, H));
    expect(bottom(byId(dAfter, 'd'))).toBeCloseTo(0, 9);
  });

  it('a TV keeps its centre — the height a person chose for it', () => {
    const tv = hungAt('tv', 'tv', 'tv', [1200, 80, 700]);
    const tall: [number, number, number] = [1200, 80, 900];
    expect(rehangForResize([tv], 'tv', tall, FP, H)).toEqual([]);
  });

  it('stays inside the band a drag clamps to', () => {
    // Pinned at the band a drag clamps to, from either side.
    expect(heightForResize('tv', 'tv', 2.5, 700, 900, H)).toBeCloseTo(H - 0.45 - MOUNT_PAD, 9);
    expect(heightForResize('tv', 'tv', 0.1, 700, 900, H)).toBeCloseTo(0.45 + MOUNT_PAD, 9);
    // A floor piece's y is its base and never moves.
    expect(heightForResize('sofa', 'sofa', 0, 850, 950, H)).toBe(0);
  });
});

