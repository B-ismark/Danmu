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
    expect(r).toEqual({ ok: true, turned: false, grounded: [] });
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
});
