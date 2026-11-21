// @vitest-environment jsdom
//
// A monitor and a laptop on a table, and the table swapped for another model. What
// stood on it must end up somewhere a person would put it: on the new top if there is
// room — kept where it was in the table's own frame, slid in where it now hangs off —
// and on the floor beside the table if there is not, said by name. Before
// `lib/swap-riders.ts` a smaller top left the monitor in mid-air at the old height, and
// a table the swap moved left its company behind.
//
// Driven through the real stores and read back through `currentRoomScene`, which is
// what the 3D tab, the plan and a saved file all draw — the rider height pass included.
import { beforeEach, describe, expect, it } from 'vitest';
import { swapPartModel } from '@/lib/swap-model';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { currentRoomScene } from '@/lib/room-scene';
import { footprintForLayout } from '@/lib/footprint';
import { footArea, footFromPart, footIntersectionArea, footOverlap, TOUCH_M } from '@/lib/geometry';
import { verticalExtent } from '@/lib/physics';
import { PART_LIBRARY, type LibraryItem, type ScenePart } from '@/lib/scene-spec';
import { reseatRiders } from '@/lib/swap-riders';
import { bestMs, ceilingMs } from './helpers/perf';

const lib = (label: string): LibraryItem => PART_LIBRARY.find((r) => r.label === label)!;

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return { category: 'other', name: over.id, shape: 'box', pos: [0, 0, 0], rot: 0, dimMM: [1000, 600, 800], locked: false, ...over };
}

const DESK_TOP = 0.75;
const desk = part({ id: 'desk', name: 'Desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750] });
const monitor = part({ id: 'monitor', name: 'Monitor', category: 'monitor', shape: 'monitor', pos: [-0.35, DESK_TOP, -0.15], dimMM: [600, 200, 400] });
const laptop = part({ id: 'laptop', name: 'Laptop', category: 'monitor', shape: 'laptop', pos: [0.45, DESK_TOP, 0.1], dimMM: [340, 240, 220] });

function setRoom(parts: ScenePart[], parentIds: Record<string, string>, W = 5) {
  useScene.setState({
    room: { width: W, depth: W, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', W, W), wallColors: {} },
    parts,
    ready: true,
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds });
}

const live = (id: string) => currentRoomScene().find((p) => p.id === id)!;
const foot = (p: ScenePart) => footFromPart(p.pos, p.rot, p.dimMM, p.circle, p.shape);
const whollyOn = (p: ScenePart, top: ScenePart) => {
  const f = foot(p);
  return footIntersectionArea(f, foot(top)) >= footArea(f) * (1 - 1e-6);
};
const topOf = (p: ScenePart) => verticalExtent(p.category, p.shape, p.dimMM, p.pos[1])[1];

beforeEach(() => setRoom([desk, monitor, laptop], { monitor: 'desk', laptop: 'desk' }));

describe('swapping the table under a monitor and a laptop', () => {
  it('a bigger top keeps both, at the new height, where they were', () => {
    setRoom(
      [part({ ...desk, name: 'Coffee table', category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 420] }),
        { ...monitor, pos: [-0.2, 0.42, -0.1] }, { ...laptop, pos: [0.3, 0.42, 0.1] }],
      { monitor: 'desk', laptop: 'desk' },
    );
    const r = swapPartModel('desk', lib('Desk'));
    expect(r).toEqual({ ok: true, turned: false, grounded: [], crowded: [], holds: true });
    const t = live('desk');
    for (const id of ['monitor', 'laptop']) {
      const p = live(id);
      expect(p.pos[1]).toBeCloseTo(topOf(t), 9);
      expect(whollyOn(p, t)).toBe(true);
      expect(useStudio.getState().parentIds[id]).toBe('desk');
    }
    // Room on the top, so nothing was re-flowed.
    expect(live('monitor').pos[0]).toBeCloseTo(-0.2, 9);
    expect(live('laptop').pos[0]).toBeCloseTo(0.3, 9);
  });

  it('a smaller top that holds one keeps the bigger piece on it and puts the other on the floor', () => {
    const r = swapPartModel('desk', { ...lib('Coffee table'), dimMM: [650, 350, 420] });
    expect(r.ok && r.grounded).toEqual(['Laptop']);
    const t = live('desk');
    const m = live('monitor');
    // Slid in from where it hung off, and standing on the new top — not in mid-air.
    expect(whollyOn(m, t)).toBe(true);
    expect(m.pos[1]).toBeCloseTo(topOf(t), 9);
    expect(useStudio.getState().parentIds.monitor).toBe('desk');
    // The laptop is on the floor, beside the table rather than under it.
    const l = live('laptop');
    expect(l.pos[1]).toBe(0);
    expect(useStudio.getState().parentIds.laptop).toBeUndefined();
    expect(footOverlap(foot(l), foot(t), -TOUCH_M)).toBe(false);
  });

  it('a side table keeps the laptop and puts the monitor, wider than it, on the floor', () => {
    const r = swapPartModel('desk', lib('Side table'));
    expect(r.ok && r.grounded).toEqual(['Monitor']);
    const t = live('desk');
    const m = live('monitor');
    const l = live('laptop');
    expect(m.pos[1]).toBe(0);
    expect(footOverlap(foot(m), foot(t), -TOUCH_M)).toBe(false);
    expect(whollyOn(l, t)).toBe(true);
    expect(l.pos[1]).toBeCloseTo(topOf(t), 9);
    // Nothing floats: whatever is off the floor is on the table.
    expect(currentRoomScene().filter((p) => p.pos[1] > 0 && p.id !== 'desk').map((p) => p.id)).toEqual(['laptop']);
  });

  it('two pieces that each fit but not side by side where they were are re-flowed apart', () => {
    // Both carried to the same spot of the new top: the monitor stays, the laptop slides.
    setRoom([desk, { ...monitor, pos: [0, DESK_TOP, 0] }, { ...laptop, pos: [0, DESK_TOP, 0.15] }], { monitor: 'desk', laptop: 'desk' });
    const r = swapPartModel('desk', { ...lib('Coffee table'), dimMM: [1000, 700, 420] });
    expect(r.ok && r.grounded).toEqual([]);
    const t = live('desk');
    const m = live('monitor');
    const l = live('laptop');
    expect(whollyOn(m, t) && whollyOn(l, t)).toBe(true);
    expect(footOverlap(foot(m), foot(l), -TOUCH_M)).toBe(false);
  });

  it('swapped for something nothing stands on, its company goes to the floor', () => {
    const r = swapPartModel('desk', lib('Painting'));
    expect(r.ok && [...r.grounded].sort()).toEqual(['Laptop', 'Monitor']);
    // Said as "nothing stands on it", not "there wasn't room".
    expect(r.ok && r.holds).toBe(false);
    expect(live('monitor').pos[1]).toBe(0);
    expect(live('laptop').pos[1]).toBe(0);
  });

  it('what rides a rider goes with it', () => {
    const tray = part({ id: 'tray', name: 'Tray', category: 'other', shape: 'box', pos: [0, DESK_TOP, 0], dimMM: [400, 300, 40] });
    const cup = part({ id: 'cup', name: 'Cup', category: 'other', shape: 'box', pos: [0.1, DESK_TOP + 0.04, 0.05], dimMM: [80, 80, 100] });
    setRoom([desk, tray, cup], { tray: 'desk', cup: 'tray' });
    swapPartModel('desk', { ...lib('Coffee table'), dimMM: [900, 500, 420] });
    const t = live('desk');
    const tr = live('tray');
    const c = live('cup');
    expect(tr.pos[1]).toBeCloseTo(topOf(t), 9);
    expect(c.pos[1]).toBeCloseTo(topOf(tr), 9);
    expect(c.pos[0] - tr.pos[0]).toBeCloseTo(0.1, 9);
    expect(c.pos[2] - tr.pos[2]).toBeCloseTo(0.05, 9);
  });
});

describe('reseatRiders, the plan on its own', () => {
  it('a table that turns a quarter carries its riders round with it', () => {
    const after = { ...desk, rot: Math.PI / 2 };
    const plan = reseatRiders(desk, after, [monitor], { monitor: 'desk' }, [], footprintForLayout('rect', 5, 5), 2.5);
    const move = plan.moves.find((m) => m.id === 'monitor')!;
    // Local (−0.35, −0.15) at a quarter turn: x' = lz·sin + lx·cos… the three.js frame.
    expect(move.pos[0]).toBeCloseTo(-0.15, 9);
    expect(move.pos[2]).toBeCloseTo(0.35, 9);
    expect(move.rot).toBeCloseTo(Math.PI / 2, 9);
    expect(plan.seated).toEqual(['monitor']);
  });

  it('a table turned a third of the way round carries its rider in ITS frame, not the world’s', () => {
    // Every fixture above stands at rot 0, where the table's frame and the room's are the
    // same frame and swapping `worldToLocal` for `localToWorld` changes nothing.
    const a = Math.PI / 3;
    const b = a + Math.PI / 2;
    const before = { ...desk, pos: [0.4, 0, -0.3] as [number, number, number], rot: a };
    const after = { ...desk, pos: [0.4, 0, -0.3] as [number, number, number], rot: b, dimMM: [1600, 900, 750] as [number, number, number] };
    // Local (0.3, −0.1) in the three.js frame: x along (cos, −sin), z along (sin, cos).
    const at = (rot: number, lx: number, lz: number) => [lx * Math.cos(rot) + lz * Math.sin(rot), -lx * Math.sin(rot) + lz * Math.cos(rot)];
    const [wx, wz] = at(a, 0.3, -0.1);
    const rider = { ...laptop, pos: [0.4 + wx, DESK_TOP, -0.3 + wz] as [number, number, number], rot: a + 0.2 };
    const plan = reseatRiders(before, after, [rider], { laptop: 'desk' }, [], footprintForLayout('rect', 5, 5), 2.5);
    const [ex, ez] = at(b, 0.3, -0.1);
    const move = plan.moves.find((m) => m.id === 'laptop')!;
    expect(move.pos[0]).toBeCloseTo(0.4 + ex, 9);
    expect(move.pos[2]).toBeCloseTo(-0.3 + ez, 9);
    expect(move.rot).toBeCloseTo(b + 0.2, 9);
  });

  it('a rider that ends exactly where it stood gets no write', () => {
    // A write is never free: it pins an override against a re-detect.
    const plan = reseatRiders(desk, { ...desk, name: 'Desk 2' }, [monitor, laptop], { monitor: 'desk', laptop: 'desk' }, [], footprintForLayout('rect', 5, 5), 2.5);
    expect(plan.moves).toEqual([]);
    expect([...plan.seated].sort()).toEqual(['laptop', 'monitor']);
  });

  it('with no room outline to search, a rider that fits nowhere goes BESIDE the table, not under it', () => {
    const after = { ...desk, category: 'table' as const, shape: 'side-table' as const, dimMM: [450, 450, 550] as [number, number, number] };
    const plan = reseatRiders(desk, after, [monitor], { monitor: 'desk' }, [], undefined, 2.5);
    expect(plan.grounded).toEqual(['monitor']);
    const m = plan.moves.find((x) => x.id === 'monitor')!;
    expect(m.pos[1]).toBe(0);
    expect(footOverlap(foot({ ...monitor, pos: m.pos }), foot(after), -TOUCH_M)).toBe(false);
  });

  it('a banquet table of small things swapped for a stool decides in good time', () => {
    // 40 coasters on a 3 × 2 m top swapped for a 420 mm stool; the rest search it and fail.
    const big = { ...desk, dimMM: [3000, 2000, 750] as [number, number, number] };
    const riders: ScenePart[] = [];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 5; j++) {
        riders.push(part({ id: `c${i}-${j}`, pos: [-1.3 + i * 0.37, DESK_TOP, -0.8 + j * 0.4], dimMM: [200, 200, 100] }));
      }
    }
    const relation = Object.fromEntries(riders.map((r) => [r.id, 'desk']));
    const after = { ...big, dimMM: [420, 420, 450] as [number, number, number] };
    let plan = reseatRiders(big, after, riders, relation, [], footprintForLayout('rect', 8, 8), 2.5);
    expect(plan.seated.length + plan.grounded.length).toBe(40);
    // Four 200 mm coasters need 400 mm plus a gap each side of the seam; the 20 mm grid
    // finds room for three, which is the measured answer and pinned as one.
    expect(plan.seated.length).toBe(3);
    const ms = bestMs(() => { plan = reseatRiders(big, after, riders, relation, [], footprintForLayout('rect', 8, 8), 2.5); }, 1);
    console.log(`swap-riders · 40 riders onto a stool: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(ceilingMs(400));
  });
});

describe('a crowded top decides in good time', () => {
  it('forty 300 mm boxes onto a top with area for them but not the packing', () => {
    // The case the quick refusals cannot shortcut: every box passes the area check until
    // the top is nearly full, so the grid search runs for each that fails. At a fixed
    // 20 mm grid with no near-test it took 2.3 s.
    const big = { ...desk, dimMM: [3000, 2000, 750] as [number, number, number] };
    const riders = Array.from({ length: 40 }, (_, i) => part({ id: `b${i}`, pos: [0, DESK_TOP, 0], dimMM: [300, 300, 100] }));
    const relation = Object.fromEntries(riders.map((r) => [r.id, 'desk']));
    const after = { ...big, dimMM: [2400, 1600, 750] as [number, number, number] };
    let plan = reseatRiders(big, after, riders, relation, [], footprintForLayout('rect', 8, 8), 2.5);
    // Measured: 35 seat and five go to the floor.
    expect(plan.seated.length).toBe(35);
    expect(plan.grounded.length).toBe(5);
    const ms = bestMs(() => { plan = reseatRiders(big, after, riders, relation, [], footprintForLayout('rect', 8, 8), 2.5); }, 1);
    console.log(`swap-riders · 40 boxes onto a crowded top: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(ceilingMs(700));
  });
});

describe('a top too close to the ceiling holds nothing', () => {
  it('a lamp on a nightstand swapped for a wardrobe goes to the floor, not into the wardrobe', () => {
    const stand = part({ id: 'desk', name: 'Nightstand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] });
    const lamp = part({ id: 'lamp', name: 'Table lamp', category: 'lamp', shape: 'lamp-table', pos: [0, 0.55, 0], dimMM: [250, 250, 500], circle: true });
    setRoom([stand, lamp], { lamp: 'desk' });
    const r = swapPartModel('desk', lib('Wardrobe'));
    expect(r.ok && r.grounded).toEqual(['Table lamp']);
    expect(r.ok && r.holds).toBe(true);
    const l = live('lamp');
    expect(l.pos[1]).toBe(0);
    expect(footOverlap(foot(l), foot(live('desk')), -TOUCH_M)).toBe(false);
  });

  it('…while the same lamp swapped onto a desk stays on it — a round piece is held whole', () => {
    // The pair that makes the wardrobe case about the ceiling: same lamp, a top it fits
    // under. A round foot once read 0.6% short of "wholly on" against any top at all.
    const stand = part({ id: 'desk', name: 'Nightstand', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] });
    const lamp = part({ id: 'lamp', name: 'Table lamp', category: 'lamp', shape: 'lamp-table', pos: [0, 0.55, 0], dimMM: [250, 250, 500], circle: true });
    setRoom([stand, lamp], { lamp: 'desk' });
    const r = swapPartModel('desk', lib('Desk'));
    expect(r.ok && r.grounded).toEqual([]);
    expect(live('lamp').pos[1]).toBeCloseTo(topOf(live('desk')), 9);
    expect(useStudio.getState().parentIds.lamp).toBe('desk');
  });
});
