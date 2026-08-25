import { describe, it, expect } from 'vitest';
import { hitsAt, hitsInRect, planPaintOrder, nextInCycle, SAME_SPOT_M } from '@/lib/plan-hit';
import type { ScenePart } from '@/lib/scene-spec';

function part(p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'dimMM' | 'pos'>): ScenePart {
  return {
    name: p.id,
    category: 'table',
    shape: 'coffee-table',
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

// A rug, a table on it, a lamp on the table — all centred on the origin, added in
// the order that used to decide which one a click got.
const RUG = part({ id: 'rug', pos: [0, 0, 0], dimMM: [3000, 2000, 10] });
const TABLE = part({ id: 'table', pos: [0, 0, 0], dimMM: [1200, 800, 400] });
const LAMP = part({ id: 'lamp', pos: [0, 0, 0], dimMM: [200, 200, 500] });
const STACK = [LAMP, RUG, TABLE];

describe('planPaintOrder', () => {
  it('paints biggest first, so the small piece ends up on top', () => {
    expect(planPaintOrder(STACK).map((p) => p.id)).toEqual(['rug', 'table', 'lamp']);
  });

  it('is stable for equal footprints', () => {
    const a = part({ id: 'a', pos: [0, 0, 0], dimMM: [500, 500, 500] });
    const b = part({ id: 'b', pos: [1, 0, 0], dimMM: [500, 500, 500] });
    expect(planPaintOrder([a, b]).map((p) => p.id)).toEqual(['a', 'b']);
    expect(planPaintOrder([b, a]).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('does not care what order the furniture was added in', () => {
    const one = planPaintOrder([LAMP, RUG, TABLE]).map((p) => p.id);
    const two = planPaintOrder([TABLE, LAMP, RUG]).map((p) => p.id);
    expect(one).toEqual(two);
  });
});

describe('hitsAt', () => {
  it('returns every piece under the point, front-to-back', () => {
    expect(hitsAt(0, 0, STACK)).toEqual(['lamp', 'table', 'rug']);
  });

  it('drops the pieces the point misses', () => {
    // 0.5 m out along x: past the lamp (0.1) but inside the table (0.6).
    expect(hitsAt(0.5, 0, STACK)).toEqual(['table', 'rug']);
    // 1.0 m out: only the rug (1.5) still reaches.
    expect(hitsAt(1.0, 0, STACK)).toEqual(['rug']);
  });

  it('is empty over bare floor', () => {
    expect(hitsAt(9, 9, STACK)).toEqual([]);
  });

  it('agrees with what the drawing paints on top', () => {
    const painted = planPaintOrder(STACK).map((p) => p.id);
    expect(hitsAt(0, 0, STACK)[0]).toBe(painted[painted.length - 1]);
  });

  it('respects rotation', () => {
    const long = part({ id: 'long', pos: [0, 0, 0], dimMM: [2000, 400, 400], rot: 0 });
    const turned = { ...long, rot: Math.PI / 2 };
    // (0.8, 0) is inside the unrotated piece along its length…
    expect(hitsAt(0.8, 0, [long])).toEqual(['long']);
    // …and outside it once the piece is turned a quarter turn.
    expect(hitsAt(0.8, 0, [turned])).toEqual([]);
    expect(hitsAt(0, 0.8, [turned])).toEqual(['long']);
  });

  it('tests a round piece as the ellipse, not as its box', () => {
    const round = part({ id: 'round', pos: [0, 0, 0], dimMM: [1000, 1000, 400], circle: true });
    const square = { ...round, id: 'square', circle: false };
    // The corner of the bounding square: 0.49 out on both axes is 0.69 from the
    // centre, so it is inside the square and outside the inscribed circle.
    expect(hitsAt(0.49, 0.49, [square])).toEqual(['square']);
    expect(hitsAt(0.49, 0.49, [round])).toEqual([]);
    // Straight out along one axis, both contain it.
    expect(hitsAt(0.49, 0, [round])).toEqual(['round']);
  });

  it('does not filter hidden parts — that is the caller policy', () => {
    // Nothing about a part says "hidden"; the store does. So the only assertion
    // available is that the caller's filter is what changes the answer.
    const visible = STACK.filter((p) => p.id !== 'lamp');
    expect(hitsAt(0, 0, visible)).toEqual(['table', 'rug']);
  });
});

describe('hitsInRect', () => {
  const A = part({ id: 'a', pos: [-2, 0, 0], dimMM: [600, 600, 600] });
  const B = part({ id: 'b', pos: [0, 0, 0], dimMM: [600, 600, 600] });
  const C = part({ id: 'c', pos: [2, 0, 0], dimMM: [600, 600, 600] });

  it('catches what it fully encloses', () => {
    expect(hitsInRect({ x0: -0.5, z0: -0.5, x1: 0.5, z1: 0.5 }, [A, B, C])).toEqual(['b']);
  });

  it('catches what it merely brushes', () => {
    // Stops 2.1 m out — 0.2 m into C's 0.3 m half-width, enclosing none of it.
    // Front-to-back, and these three are the same size, so the later-added piece
    // is the one in front.
    expect(hitsInRect({ x0: -0.1, z0: -0.1, x1: 2.1, z1: 0.1 }, [A, B, C])).toEqual(['c', 'b']);
  });

  it('does not care which corner the drag started from', () => {
    const forward = hitsInRect({ x0: -2.4, z0: -0.4, x1: 0.4, z1: 0.4 }, [A, B, C]);
    const backward = hitsInRect({ x0: 0.4, z0: 0.4, x1: -2.4, z1: -0.4 }, [A, B, C]);
    expect(forward).toEqual(backward);
    expect(forward).toEqual(['b', 'a']);
  });

  it('is empty when it touches nothing', () => {
    expect(hitsInRect({ x0: 8, z0: 8, x1: 9, z1: 9 }, [A, B, C])).toEqual([]);
  });

  it('orders its catch like hitsAt', () => {
    const wide = hitsInRect({ x0: -9, z0: -9, x1: 9, z1: 9 }, STACK);
    expect(wide).toEqual(['lamp', 'table', 'rug']);
  });
});

describe('nextInCycle', () => {
  it('takes the topmost on a fresh press', () => {
    const r = nextInCycle(0, 0, STACK, null);
    expect(r.id).toBe('lamp');
    expect(r.state).toEqual({ x: 0, z: 0, ids: ['lamp', 'table', 'rug'], index: 0 });
  });

  it('steps deeper on a repeat press at the same spot', () => {
    const first = nextInCycle(0, 0, STACK, null);
    const second = nextInCycle(0, 0, STACK, first.state);
    const third = nextInCycle(0, 0, STACK, second.state);
    expect([second.id, third.id]).toEqual(['table', 'rug']);
  });

  it('wraps back to the top rather than dead-ending', () => {
    let state = null as ReturnType<typeof nextInCycle>['state'];
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nextInCycle(0, 0, STACK, state);
      seen.push(r.id);
      state = r.state;
    }
    expect(seen).toEqual(['lamp', 'table', 'rug', 'lamp']);
  });

  it('restarts when the press moves away, even onto the same pieces', () => {
    // Table and rug both reach far enough that the candidate list is unchanged —
    // so distance is the only thing that can invalidate the cycle here.
    const pair = [RUG, TABLE];
    const first = nextInCycle(0, 0, pair, null);
    expect(first.id).toBe('table');
    const moved = nextInCycle(SAME_SPOT_M * 2, 0, pair, first.state);
    expect(moved.candidates).toEqual(['table', 'rug']);
    expect(moved.id).toBe('table');
    expect(moved.state?.index).toBe(0);
  });

  it('tolerates a press that only twitched', () => {
    const first = nextInCycle(0, 0, STACK, null);
    const twitch = nextInCycle(SAME_SPOT_M / 2, 0, STACK, first.state);
    expect(twitch.id).toBe('table');
  });

  it('restarts when the candidates changed under it', () => {
    const first = nextInCycle(0, 0, STACK, null);
    // The lamp is deleted between presses: honouring index 1 would now mean the
    // rug, silently skipping the table.
    const without = nextInCycle(0, 0, [RUG, TABLE], first.state);
    expect(without.id).toBe('table');
    expect(without.state?.index).toBe(0);
  });

  it('reports nothing over bare floor, and forgets the cycle', () => {
    const first = nextInCycle(0, 0, STACK, null);
    const miss = nextInCycle(9, 9, STACK, first.state);
    expect(miss.id).toBeNull();
    expect(miss.state).toBeNull();
    expect(miss.candidates).toEqual([]);
  });
});
