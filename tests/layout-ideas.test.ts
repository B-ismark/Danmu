import { describe, expect, it } from 'vitest';
import { lockedForSolve, movableFor, LAYOUT_SIMILAR_M, TURN_EPSILON } from '@/lib/layout-solve';
import { layoutSimilarity } from '@/lib/layout-offer';
import { shuffleRoom, showableIdeas, REPEAT_SIMILARITY } from '@/lib/layout-shuffle';
import {
  DRY_SEARCHES,
  FACING_HALF_ANGLE,
  freeName,
  IDEAS_PER_PAGE,
  MAX_IDEAS,
  ideaCaption,
  ideaTransforms,
  pageOf,
  pageRange,
  ideaMoved,
  seatsDown,
  transformsKey,
  wantsMore,
} from '@/lib/layout-ideas';
import { isSeating, roleOf, WALL_ATTACH_TOL } from '@/lib/layout-rules';
import { footFromPart, footInsidePoly, footIntersectionArea } from '@/lib/geometry';
import { ridingParents } from '@/lib/rigid-parent';
import { highestSurfaceUnder } from '@/lib/physics';
import type { LayoutId } from '@/lib/footprint';
import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import type { Placement } from '@/lib/layout-score';

// The ideas gallery (item 9 of the 2026-09 overhaul). What is tested here is the
// part that is not React: what a shuffle hands the gallery, how an idea turns into
// transform maps, what each one is called, and how many to a page. The panel's
// wiring is `tests/ideas-panel.test.tsx`.

const W = 6;
const D = 4;
const RECT = footprintForLayout('rect', W, D);

function part(id: string, over: Partial<ScenePart>): ScenePart {
  return {
    id,
    name: id,
    category: 'other',
    shape: 'box',
    dimMM: [500, 500, 500],
    pos: [0, 0.25, 0],
    rot: 0,
    locked: false,
    ...over,
  } as ScenePart;
}

const at = (x: number, z: number, yaw = 0): Placement => ({ x, z, yaw }) as Placement;

describe('a shuffle hands back every idea worth showing', () => {
  const parts = defaultScene('rect', W, D);
  const room = { footprint: RECT, height: 2.4 };
  const locked = lockedForSolve(parts, {}, null);
  const movable = movableFor(parts, locked);
  const alike = (a: Placement[], b: Placement[]) =>
    layoutSimilarity(a, b, { spotM: LAYOUT_SIMILAR_M, yawRad: TURN_EPSILON, movable });

  it('more than one, and no two alike', () => {
    const out = shuffleRoom(parts, room, locked, { attempt: 1 });
    expect(out).not.toBeNull();
    // A page of ideas is only a page if a press finds several. Asserted rather than
    // assumed: the gallery exists because the pool was already there.
    expect(out!.ideas.length).toBeGreaterThan(1);
    expect(out!.ideas.length).toBeLessThanOrEqual(out!.clean);
    for (let i = 0; i < out!.ideas.length; i++)
      for (let j = 0; j < i; j++)
        expect(alike(out!.ideas[i].placements, out!.ideas[j].placements)).toBeLessThanOrEqual(REPEAT_SIMILARITY);
  });

  it('none of them repeats what the gallery has already shown', () => {
    const first = shuffleRoom(parts, room, locked, { attempt: 1 })!;
    const ids = parts.map((p) => p.id);
    const shown = first.ideas.map((r) => ({ ids, placements: r.placements }));
    // Same attempt, so the same pool: everything in it has been shown, and the
    // honest answer is an empty list, never a repeat dressed as an idea.
    const again = shuffleRoom(parts, room, locked, { attempt: 1, history: shown })!;
    expect(again.ideas).toEqual([]);
    // A new attempt is a new question, and what it offers is new.
    const next = shuffleRoom(parts, room, locked, { attempt: 2, history: shown })!;
    for (const idea of next.ideas)
      for (const prev of shown) expect(alike(idea.placements, prev.placements)).toBeLessThanOrEqual(REPEAT_SIMILARITY);
  });
});

describe('what is worth showing, given near-twins the search does not produce', () => {
  // Similarity by the first placement's x alone: within 0.1 m is "the same idea".
  const repeats = (a: Placement[], b: Placement[]) => Math.abs(a[0].x - b[0].x) < 0.1;
  const c = (x: number) => ({ placements: [at(x, 0)] });

  it('keeps rank order and drops a twin of an idea kept earlier on the same page', () => {
    const ranked = [c(0), c(0.05), c(1), c(1.02), c(2)];
    expect(showableIdeas(ranked, [], repeats).map((r) => r.placements[0].x)).toEqual([0, 1, 2]);
  });

  it('and anything like what was shown before', () => {
    const ranked = [c(0), c(1), c(2)];
    expect(showableIdeas(ranked, [c(1.05)], repeats).map((r) => r.placements[0].x)).toEqual([0, 2]);
    expect(showableIdeas(ranked, ranked, repeats)).toEqual([]);
  });
});

describe('an idea is applied onto the room the gallery opened with', () => {
  const parts = [part('a', { pos: [0, 0.25, 0] }), part('b', { pos: [1, 0.4, 0] }), part('c', { pos: [2, 0.25, 0] })];
  const base = { positions: { c: [2.5, 0.25, 0.5] as [number, number, number] }, rotations: { c: 0.3 } };

  it('writes the moved pieces, keeps their heights, and leaves the base alone', () => {
    const idea = { placements: [at(0, 0), at(-1, 1, 1.2), at(2, 0)], moved: [1] };
    const t = ideaTransforms(base, parts, idea);
    expect(t.positions.b).toEqual([-1, 0.4, 1]);
    expect(t.rotations.b).toBe(1.2);
    expect(t.positions.c).toEqual([2.5, 0.25, 0.5]);
    expect(t.positions.a).toBeUndefined();
    expect(base.positions).not.toHaveProperty('b');
  });

  it('a second idea puts back what the first moved and it did not', () => {
    const first = ideaTransforms(base, parts, { placements: [at(-2, 1), at(1, 0), at(2, 0)], moved: [0] });
    const second = ideaTransforms(base, parts, { placements: [at(0, 0), at(1, -1), at(2, 0)], moved: [1] });
    expect(first.positions.a).toEqual([-2, 0.25, 1]);
    expect(second.positions.a).toBeUndefined();
    expect(second.positions.b).toEqual([1, 0.4, -1]);
  });

  it('refuses an idea recorded against different furniture', () => {
    expect(() => ideaTransforms(base, parts, { placements: [at(0, 0)], moved: [0] })).toThrow(/1 placements for 3 parts/);
  });

  it('compares transform maps by content, because undo restores a copy', () => {
    const t = { ...ideaTransforms(base, parts, { placements: [at(0, 0), at(3, 1), at(2, 0)], moved: [1] }), dims: {} };
    expect(transformsKey(structuredClone(t))).toBe(transformsKey(t));
    expect(transformsKey({ ...t, rotations: { ...t.rotations, b: 0.01 } })).not.toBe(transformsKey(t));
  });
});

describe('Ideas never shows a seat standing on a table or a bed (user call 2A)', () => {
  // A drag may stand a seat on a coffee table (§ H.6.4); Ideas sets it down beside the
  // table and arranges it from the floor. Measured before this existed: a seat riding a
  // top is carried with it, so it stood on that top in 48 of 48 ideas.
  const room = defaultScene('rect', W, D, { footprint: RECT, height: 2.5 });
  const free = (parts: ScenePart[]) => parts.map(() => false);
  const down = (parts: ScenePart[], locked = free(parts)) => seatsDown(parts, locked, RECT);

  /** `seat` standing on `host`'s top, as a drag leaves it, and checked to be riding it
   *  — a fixture that only looks stacked would make every assertion below vacuous. */
  function standOn(parts: ScenePart[], host: ScenePart, seat: ScenePart): ScenePart[] {
    const top = highestSurfaceUnder(parts, seat.id, host.pos[0], host.pos[2], seat.dimMM, seat.rot, seat.circle, seat.shape);
    const placed = { ...seat, pos: [host.pos[0], top?.y ?? 0, host.pos[2]] as [number, number, number] };
    const out = [...parts, placed];
    expect(ridingParents(out)[seat.id], `${seat.id} is riding ${host.id}`).toBe(host.id);
    return out;
  }
  const footOf = (p: ScenePart) => footFromPart(p.pos, p.rot, p.dimMM, p.circle, p.shape);
  const byId = (parts: ScenePart[], id: string) => parts.find((p) => p.id === id)!;
  /** Set down clear of `host`, inside the room, at `y`. */
  function besideIt(out: ScenePart[], seatId: string, host: ScenePart, y: number) {
    const seat = byId(out, seatId);
    expect(footIntersectionArea(footOf(seat), footOf(host)), `${seatId} is clear of ${host.id}`).toBe(0);
    expect(footInsidePoly(footOf(seat), RECT), `${seatId} is inside the room`).toBe(true);
    expect(seat.pos[1], `${seatId} is down`).toBeCloseTo(y, 12);
  }
  const ottoman = part('otto', { category: 'ottoman', shape: 'ottoman', dimMM: [550, 400, 420] });
  const stool = part('stool', { category: 'chair', shape: 'stool', dimMM: [350, 350, 450] });
  const tray = part('tray', { category: 'other', shape: 'box', dimMM: [300, 250, 60] });
  const coffee = room.find((p) => roleOf(p) === 'coffee-table')!;

  it('an ottoman on the coffee table comes down beside it, a hand clear, and nothing else moves', () => {
    const parts = standOn(room, coffee, ottoman);
    const { parts: out, down: moved } = down(parts);
    expect(moved).toEqual([parts.length - 1]);
    besideIt(out, 'otto', coffee, 0);
    // Out through the nearest side: half the table's depth, half the ottoman's, and the gap.
    const otto = out.at(-1)!;
    expect(Math.hypot(otto.pos[0] - coffee.pos[0], otto.pos[2] - coffee.pos[2])).toBeCloseTo(
      (coffee.dimMM[1] + ottoman.dimMM[1]) / 2000 + 0.05,
      12,
    );
    out.slice(0, -1).forEach((p, i) => expect(p).toBe(parts[i]));
  });

  it('a seat turned a quarter on the table clears it by its turned size, not its own', () => {
    const parts = standOn(room, coffee, { ...ottoman, rot: coffee.rot + Math.PI / 2 });
    const { parts: out } = down(parts);
    besideIt(out, 'otto', coffee, 0);
    // Turned, its 550 mm width is what faces the table's long side.
    const otto = out.at(-1)!;
    expect(Math.hypot(otto.pos[0] - coffee.pos[0], otto.pos[2] - coffee.pos[2])).toBeCloseTo(
      (coffee.dimMM[1] + ottoman.dimMM[0]) / 2000 + 0.05,
      12,
    );
  });

  it('every table and the bed, and never a platform, which is a floor', () => {
    const big = footprintForLayout('rect', 8, 8);
    const hosts: [ScenePart, string][] = [
      [part('dining', { category: 'table', shape: 'box', dimMM: [1600, 900, 750], pos: [0, 0, 0] }), 'dining-table'],
      [part('coffee', { category: 'table', shape: 'box', dimMM: [1100, 600, 420], pos: [0, 0, 0] }), 'coffee-table'],
      [part('side', { category: 'table', shape: 'side-table', dimMM: [500, 500, 550], pos: [0, 0, 0] }), 'side-table'],
      [part('stand', { category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0] }), 'nightstand'],
      [part('desk', { category: 'desk', shape: 'desk-l', dimMM: [1400, 700, 750], pos: [0, 0, 0] }), 'desk'],
      [part('bed', { category: 'bed', shape: 'bed-double', dimMM: [1600, 2000, 500], pos: [0, 0, 0] }), 'bed'],
    ];
    for (const [host, role] of hosts) {
      expect(roleOf(host)).toBe(role);
      const stood = standOn([host], host, stool);
      const { parts: out, down: moved } = seatsDown(stood, free(stood), big);
      expect(moved, role).toEqual([1]);
      expect(out[1].pos[1], role).toBe(0);
      expect(footIntersectionArea(footOf(out[1]), footOf(host)), role).toBe(0);
    }
    const platform = part('deck', { category: 'other', shape: 'box', dimMM: [3000, 2000, 300], pos: [0, 0, 0] });
    expect(roleOf(platform)).toBe('other');
    const onDeck = standOn([platform], platform, ottoman);
    expect(down(onDeck)).toEqual({ parts: onDeck, down: [] });
    // A table standing on the platform: the seat comes down onto the platform, the
    // level the table stands on, and not through it to the floor.
    const table = standOn([platform], platform, part('table', { category: 'table', shape: 'box', dimMM: [1100, 600, 420] }));
    const raised = standOn(table, table[1], ottoman);
    const { parts: out } = down(raised);
    expect(ridingParents(out).otto).toBe('deck');
    expect(byId(out, 'otto').pos[1]).toBeCloseTo(0.3, 12);
  });

  it('beside a table against a wall, it comes down on the room side', () => {
    const dining = part('dining', { category: 'table', shape: 'box', dimMM: [1600, 900, 750], pos: [0, 0, D / 2 - 0.45] });
    const parts = standOn([dining], dining, stool);
    const { parts: out } = down(parts);
    besideIt(out, 'stool', dining, 0);
    expect(out[1].pos[2], 'the nearer side is through the wall').toBeLessThan(dining.pos[2]);
  });

  /** The promise itself, read the way the solver reads the room it is handed. The
   *  tops are written out rather than imported: they are the decision under test. */
  const seatsOnTops = (parts: ScenePart[]) =>
    Object.entries(ridingParents(parts))
      .map(([child, parent]) => [byId(parts, child), byId(parts, parent)])
      .filter(([c, p]) => isSeating(roleOf(c)) &&
        ['bed', 'dining-table', 'coffee-table', 'side-table', 'nightstand', 'desk'].includes(roleOf(p)))
      .map(([c, p]) => `${c.id} on ${p.id}`);

  it('what stands on the seat comes with it and stays on it; what stands beside it stays', () => {
    // The ottoman as tall as the table, which is the case that broke: set down inside
    // the table, the stool on it sat level with the table's top and read as standing
    // on the table, so the search left it there when the ottoman moved.
    const level = { ...ottoman, dimMM: [550, 400, coffee.dimMM[2]] as [number, number, number] };
    const withOttoman = standOn(room, coffee, level);
    const otto = withOttoman.at(-1)!;
    const lamp = part('lamp', { category: 'lamp', shape: 'lamp-table', dimMM: [200, 200, 400] });
    const besideLamp = { ...lamp, pos: [coffee.pos[0] + 0.4, otto.pos[1], coffee.pos[2]] as [number, number, number] };
    // Two deep, so the carry is followed past the first rider: a tray on a stool on
    // the ottoman.
    const withStool = standOn([...withOttoman, besideLamp], otto, stool);
    const stack = standOn(withStool, withStool.at(-1)!, tray);
    expect(ridingParents(stack).lamp).toBe(coffee.id);
    expect(seatsOnTops(stack)).toEqual(['otto on table-1']);
    const { parts: out, down: moved } = down(stack);
    expect(seatsOnTops(out)).toEqual([]);
    besideIt(out, 'otto', coffee, 0);
    const rides = ridingParents(out);
    expect(rides.stool, 'the stool is still on the ottoman').toBe('otto');
    expect(rides.tray, 'the tray is still on the stool').toBe('stool');
    expect(byId(out, 'stool').pos[1]).toBeCloseTo(level.dimMM[2] / 1000, 12);
    expect(byId(out, 'lamp')).toBe(besideLamp);
    expect(moved.map((i) => out[i].id).sort()).toEqual(['otto', 'stool', 'tray']);
    // Lowest first, whatever the order in the room: listed before the ottoman, the
    // stool would otherwise be set down on its own, and then again with the ottoman.
    const reversed = down([...stack].reverse()).parts;
    for (const p of out) expect(byId(reversed, p.id).pos, p.id).toEqual(p.pos);
  });

  it('a seat on something on a table is on that table too', () => {
    const dining = part('dining', { category: 'table', shape: 'box', dimMM: [1600, 900, 750], pos: [0, 0, 0] });
    const board = part('board', { category: 'other', shape: 'box', dimMM: [800, 500, 50] });
    const withBoard = standOn([dining], dining, board);
    const onBoard = standOn(withBoard, withBoard[1], stool);
    const { parts: out, down: moved } = down(onBoard);
    expect(moved).toEqual([2]);
    besideIt(out, 'stool', dining, 0);
    expect(out[1]).toBe(onBoard[1]);
  });

  it('a seat kept where it is, carrying a kept piece, or in a group stays as the user left it', () => {
    const withOttoman = standOn(room, coffee, ottoman);
    const parts = standOn(withOttoman, withOttoman.at(-1)!, tray);
    const o = parts.length - 2;
    const t = parts.length - 1;
    const keep = (i: number) => parts.map((_, k) => k === i);
    expect(down(parts, keep(o))).toEqual({ parts, down: [] });
    expect(down(parts, keep(t))).toEqual({ parts, down: [] });
    const grouped = parts.map((p, k) => (k === o ? { ...p, groupId: 'g' } : p));
    expect(down(grouped)).toEqual({ parts: grouped, down: [] });
    // …and the control: free, the same pair comes down together.
    expect(down(parts).down).toEqual([o, t]);
  });

  it('an idea writes what the search moved and everything set down, once each', () => {
    expect(ideaMoved([4, 1, 7], [7, 9])).toEqual([1, 4, 7, 9]);
    expect(ideaMoved([], [])).toEqual([]);
  });

  it('a lamp on a nightstand is not a seat: the seeded rooms have nothing to set down', () => {
    const riders: Record<string, number> = {};
    for (const id of ['rect', 'open', 'l', 't', 'u'] as LayoutId[]) {
      const footprint = footprintForLayout(id, 6, 5);
      const scene = defaultScene(id, 6, 5, { footprint, height: 2.5 });
      riders[id] = Object.keys(ridingParents(scene)).length;
      expect(seatsDown(scene, free(scene), footprint), id).toEqual({ parts: scene, down: [] });
    }
    // Only the U stands anything on anything (its two lamps on their nightstands), so
    // that is the one room this sweep can fail in: pinned, so losing it is seen.
    expect(riders).toEqual({ rect: 0, open: 0, l: 0, t: 0, u: 2 });
  });
});

describe('each idea is named from where it puts things', () => {
  // A 2 m sofa, 0.9 m deep. Its back is `depth / 2` behind its centre along -front.
  const sofa = part('Sofa', { name: 'Sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 800] });
  const tv = part('TV', { name: 'TV', category: 'tv', shape: 'tv', dimMM: [1400, 60, 800], wallMounted: true });
  const win = part('Window', { name: 'Window', category: 'other', shape: 'window', dimMM: [1200, 80, 1200], wallMounted: true });
  const rug = part('Rug', { name: 'Rug', category: 'rug', shape: 'rug', dimMM: [2000, 1400, 10] });
  const lamp = part('Lamp', { name: 'Lamp', category: 'lamp', shape: 'lamp-floor', dimMM: [400, 400, 1600] });

  // Facing +z (yaw 0) with its back to the north wall at z = -2.
  const againstNorth = (gap: number) => at(0, -D / 2 + 0.45 + gap, 0);

  it('by a wall, facing the screen in front of it', () => {
    const parts = [sofa, tv];
    const idea = { placements: [againstNorth(0.02), at(0, D / 2 - 0.03, Math.PI)], moved: [0] };
    expect(ideaCaption(parts, RECT, idea)).toEqual({ lead: 'Sofa against a wall, facing the TV', count: '1 piece moves' });
  });

  it('"against a wall" is the tolerance a wall drag uses, at both ends', () => {
    const parts = [sofa];
    const lead = (gap: number) => ideaCaption(parts, RECT, { placements: [againstNorth(gap)], moved: [0] }).lead;
    expect(lead(WALL_ATTACH_TOL - 0.005)).toBe('Sofa against a wall');
    expect(lead(WALL_ATTACH_TOL + 0.005)).toBe('Sofa in the open');
  });

  it('only what stands inside the forward cone is faced, at both edges', () => {
    const parts = [sofa, tv];
    const lead = (deg: number) => {
      const r = 1.5;
      const a = (deg * Math.PI) / 180;
      return ideaCaption(parts, RECT, { placements: [at(0, -1, 0), at(Math.sin(a) * r, -1 + Math.cos(a) * r, 0)], moved: [0] })
        .lead;
    };
    const edge = (FACING_HALF_ANGLE * 180) / Math.PI;
    expect(lead(edge - 1)).toMatch(/facing the TV$/);
    expect(lead(edge + 1)).not.toMatch(/facing/);
    // Behind it is never faced, however well aligned.
    expect(lead(180)).not.toMatch(/facing/);
  });

  it('a screen outranks a nearer window', () => {
    const parts = [sofa, win, tv];
    const idea = { placements: [at(0, -1, 0), at(0, 0.2, 0), at(0, 1.9, 0)], moved: [0] };
    expect(ideaCaption(parts, RECT, idea).lead).toBe('Sofa in the open, facing the TV');
  });

  it('only a piece a person uses from the front is said to face anything', () => {
    // A coffee table pointing its mesh at the door is not "facing the door".
    const table = part('Table', { name: 'Coffee table', category: 'table', shape: 'coffee-table', dimMM: [1100, 600, 450] });
    const door = part('Door', { name: 'Door', category: 'door', shape: 'door', dimMM: [900, 50, 2100], wallMounted: true });
    const idea = { placements: [at(0, -1, 0), at(0, 1.9, 0)], moved: [0] };
    expect(ideaCaption([table, door], RECT, idea).lead).toBe('Coffee table in the open');
    expect(ideaCaption([sofa, door], RECT, idea).lead).toBe('Sofa in the open, facing the door');
  });

  it('names what is faced by what it is, never by what someone typed', () => {
    // "facing Bay window" is not a sentence, and lowercasing a name turns "TV" into
    // "tv"; the role's own words are safe in both directions.
    const bay = { ...win, name: 'Bay window' };
    const idea = { placements: [at(0, -1, 0), at(0, 0.5, 0)], moved: [0] };
    expect(ideaCaption([sofa, bay], RECT, idea).lead).toBe('Sofa in the open, facing the window');
    const telly = { ...tv, name: 'TV · 65″' };
    expect(ideaCaption([sofa, telly], RECT, idea).lead).toBe('Sofa in the open, facing the TV');
  });

  it('an anchor this idea leaves where it is is not what the caption is about', () => {
    // The sofa kept in place: every idea would otherwise be captioned by it, alike.
    const parts = [sofa, lamp];
    const idea = { placements: [againstNorth(0.02), at(2.7, 1.7, 0)], moved: [1] };
    expect(ideaCaption(parts, RECT, idea).lead).toMatch(/^Lamp /);
    expect(ideaCaption(parts, RECT, { ...idea, moved: [0, 1] }).lead).toMatch(/^Sofa /);
  });

  it('with no anchor, names the largest solid piece that moved, never the rug', () => {
    const parts = [rug, lamp];
    const idea = { placements: [at(0, 0), at(2.7, -1.7, 0)], moved: [0, 1] };
    const c = ideaCaption(parts, RECT, idea);
    expect(c.lead).toMatch(/^Lamp /);
    expect(c.count).toBe('2 pieces move');
    expect(ideaCaption([rug], RECT, { placements: [at(0, 0)], moved: [0] })).toEqual({ lead: null, count: '1 piece moves' });
  });
});

describe('a saved idea gets a name no other layout has', () => {
  it('takes the idea\'s own name when it is free, and counts up when it is not', () => {
    expect(freeName('Idea 1', ['Layout A'])).toBe('Idea 1');
    expect(freeName('Idea 1', ['Idea 1'])).toBe('Idea 1 (2)');
    expect(freeName('Idea 1', ['Idea 1', 'Idea 1 (2)', 'Idea 1 (3)'])).toBe('Idea 1 (4)');
  });
});

describe('pages', () => {
  it('three on a phone and four anywhere wider — decision D6', () => {
    expect(IDEAS_PER_PAGE).toEqual({ phone: 3, wide: 4 });
    expect(MAX_IDEAS).toBe(36);
    expect(DRY_SEARCHES).toBe(3);
  });

  it('slices and labels a page, and claims no range it cannot show', () => {
    const ideas = [1, 2, 3, 4, 5, 6];
    expect(pageOf(ideas, 1, 4)).toEqual([5, 6]);
    expect(pageRange(0, 4, 6)).toBe('1–4');
    expect(pageRange(1, 4, 6)).toBe('5–6');
    expect(pageRange(1, 4, 5)).toBe('5');
    expect(pageRange(1, 4, 4)).toBeNull();
  });

  it('keeps one page ahead, and stops at the ceiling or when the room runs dry', () => {
    expect(wantsMore(7, 0, 4, 0)).toBe(true);
    expect(wantsMore(8, 0, 4, 0)).toBe(false);
    expect(wantsMore(8, 1, 4, 0)).toBe(true);
    expect(wantsMore(0, 0, 4, DRY_SEARCHES - 1)).toBe(true);
    expect(wantsMore(0, 0, 4, DRY_SEARCHES)).toBe(false);
    expect(wantsMore(MAX_IDEAS - 1, 20, 4, 0)).toBe(true);
    expect(wantsMore(MAX_IDEAS, 20, 4, 0)).toBe(false);
  });
});
