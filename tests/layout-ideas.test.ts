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
  transformsKey,
  wantsMore,
} from '@/lib/layout-ideas';
import { WALL_ATTACH_TOL } from '@/lib/layout-rules';
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

  it('more than one, led by the one a single press applies, and no two alike', () => {
    const out = shuffleRoom(parts, room, locked, { attempt: 1 });
    expect(out).not.toBeNull();
    // A page of ideas is only a page if a press finds several. Asserted rather than
    // assumed: the gallery exists because the pool was already there.
    expect(out!.ideas.length).toBeGreaterThan(1);
    expect(out!.ideas.length).toBeLessThanOrEqual(out!.clean);
    expect(out!.ideas[0]).toBe(out!.result);
    for (let i = 0; i < out!.ideas.length; i++)
      for (let j = 0; j < i; j++)
        expect(alike(out!.ideas[i].placements, out!.ideas[j].placements)).toBeLessThanOrEqual(REPEAT_SIMILARITY);
  });

  it('none of them repeats what the gallery has already shown', () => {
    const first = shuffleRoom(parts, room, locked, { attempt: 1 })!;
    const shown = first.ideas.map((r) => ({ ids: first.offer.ids, placements: r.placements }));
    // Same attempt, so the same pool: everything in it has been shown, and the
    // honest answer is an empty list — with `result` still the fallback repeat.
    const again = shuffleRoom(parts, room, locked, { attempt: 1, history: shown })!;
    expect(again.ideas).toEqual([]);
    expect(again.result.placements).toEqual(first.result.placements);
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
