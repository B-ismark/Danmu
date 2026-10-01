import { describe, expect, it } from 'vitest';
import type { ScenePart } from '@/lib/scene-spec';
import { fixedBand, SET_SQUARE_RAD, standsInSet } from '@/lib/layout-rules';
import { formationSets, rigidSets, withCompany } from '@/lib/layout-solve';

// A dining table and the chairs at it, a bed and the nightstands at its head, are one
// body to the arranger without anyone merging them — but only while they STAND as one.
// See `docs/what-is-still-open.md` § 52 for what that bought Suggest and Ideas.

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape'>): ScenePart => ({
  name: over.id,
  pos: [0, 0, 0],
  rot: 0,
  dimMM: [500, 500, 500],
  locked: false,
  ...over,
});

const CHAIR_BAND = fixedBand('chair-table')![1];
const STAND_BAND = fixedBand('nightstand-bed')![1];

// A 1500 × 850 table at the origin, square to the room: its long edges at z = ±0.425,
// its ends at x = ±0.75.
const table = (over: Partial<ScenePart> = {}) =>
  part({ id: 'table', category: 'table', shape: 'desk-standard', dimMM: [1500, 850, 750], ...over });
/** A 500 × 500 dining chair `gap` beyond the table's +Z edge at `x`, facing the table
 *  (front −Z is `rot` π), turned `turn` off that. */
const chair = (id: string, x: number, gap: number, turn = 0, over: Partial<ScenePart> = {}) =>
  part({ id, category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [x, 0, 0.425 + gap + 0.25], rot: Math.PI + turn, ...over });

// A 1400 × 2000 bed at the origin, head at −Z (z = −1), sides at x = ±0.7.
const bed = (over: Partial<ScenePart> = {}) =>
  part({ id: 'bed', category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 500], ...over });
/** A 450 × 400 nightstand `gap` beside the bed's +X side, its back `fromHead` in from
 *  the head line. */
const stand = (id: string, gap: number, fromHead = 0, turn = 0, over: Partial<ScenePart> = {}) =>
  part({ id, category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0.7 + gap + 0.225, 0, -1 + fromHead + 0.2], rot: turn, ...over });

describe('standsInSet: a dining chair', () => {
  it('square at the long side, inside the band, is in the set', () => {
    expect(standsInSet(chair('c', 0.3, CHAIR_BAND - 0.05), table())).toBe(true);
  });

  it('tucked right in counts, and so does the end of the table', () => {
    expect(standsInSet(chair('c', 0, -0.2), table())).toBe(true);
    // At the +X end, facing −X (front (sin rot, cos rot) = (−1, 0)).
    const end = part({ id: 'e', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0.75 + 0.1 + 0.25, 0, 0], rot: -Math.PI / 2 });
    expect(standsInSet(end, table())).toBe(true);
  });

  it('beyond the band is not', () => {
    expect(standsInSet(chair('c', 0.3, CHAIR_BAND + 0.05), table())).toBe(false);
  });

  it('turned off square to the table is not, either way, and facing away is not', () => {
    const just = SET_SQUARE_RAD - 0.005;
    const past = SET_SQUARE_RAD + 0.005;
    expect(standsInSet(chair('c', 0, 0.1, just), table())).toBe(true);
    expect(standsInSet(chair('c', 0, 0.1, -just), table())).toBe(true);
    expect(standsInSet(chair('c', 0, 0.1, past), table())).toBe(false);
    expect(standsInSet(chair('c', 0, 0.1, -past), table())).toBe(false);
    expect(standsInSet(chair('c', 0, 0.1, Math.PI / 6), table())).toBe(false);
    expect(standsInSet(chair('c', 0, 0.1, Math.PI), table())).toBe(false);
  });

  it('round the corner is not, though it is well inside the band', () => {
    // Centre at x = 1.05, beyond the end; 0.05 m off the end and 0.1 m off the side.
    const corner = chair('c', 1.05, 0.1);
    expect(standsInSet(corner, table())).toBe(false);
    // …and the same chair slid back along the edge to its run is.
    expect(standsInSet(chair('c', 0.7, 0.1), table())).toBe(true);
  });

  it('a stool has no front, so it stands in the set at any turn', () => {
    const stool = (turn: number) =>
      part({ id: 's', category: 'chair', shape: 'stool', dimMM: [350, 350, 450], pos: [0, 0, 0.425 + 0.1 + 0.175], rot: turn });
    for (const turn of [0, Math.PI / 6, Math.PI / 4, 2]) expect(standsInSet(stool(turn), table()), `${turn}`).toBe(true);
  });

  it('reads in the table\'s own frame: the same set turned 30° still stands', () => {
    const turn = Math.PI / 6;
    const c = chair('c', 0.3, 0.1);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    // three.js's convention: local (x, z) → world (x cos + z sin, −x sin + z cos).
    const turned: ScenePart = { ...c, pos: [c.pos[0] * cos + c.pos[2] * sin, 0, -c.pos[0] * sin + c.pos[2] * cos], rot: c.rot + turn };
    expect(standsInSet(turned, table({ rot: turn }))).toBe(true);
    expect(standsInSet(c, table({ rot: turn }))).toBe(false);
  });
});

describe('standsInSet: a nightstand', () => {
  it('beside the bed at its head, inside the band, is in the set', () => {
    expect(standsInSet(stand('n', STAND_BAND - 0.05), bed())).toBe(true);
    // A quarter turn is still square to the bed.
    const quarter = stand('n', 0.05, 0, Math.PI / 2);
    expect(standsInSet({ ...quarter, pos: [0.7 + 0.05 + 0.2, 0, -1 + 0.225] }, bed())).toBe(true);
  });

  it('beyond the band, at the foot, or halfway down the side is not', () => {
    expect(standsInSet(stand('n', STAND_BAND + 0.05), bed())).toBe(false);
    expect(standsInSet(stand('n', 0.05, 2 - 0.4), bed())).toBe(false);
    expect(standsInSet(stand('n', 0.05, 0.8), bed())).toBe(false);
    // Its back may sit just inside the band of the head line, and not past it.
    expect(standsInSet(stand('n', 0.05, STAND_BAND - 0.02), bed())).toBe(true);
    expect(standsInSet(stand('n', 0.05, STAND_BAND + 0.02), bed())).toBe(false);
  });

  it('behind the headboard is not beside the bed', () => {
    expect(standsInSet(part({ id: 'n', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, -1.25] }), bed())).toBe(false);
  });

  it('turned off square is not', () => {
    expect(standsInSet(stand('n', 0.05, 0, SET_SQUARE_RAD - 0.005), bed())).toBe(true);
    expect(standsInSet(stand('n', 0.05, 0, -SET_SQUARE_RAD - 0.005), bed())).toBe(false);
    expect(standsInSet(stand('n', 0.05, 0, Math.PI / 12), bed())).toBe(false);
    expect(standsInSet(stand('n', 0.05, 0, Math.PI / 4), bed())).toBe(false);
  });
});

describe('standsInSet: what is never a set', () => {
  it('off the floor, or on a wall', () => {
    expect(standsInSet(chair('c', 0, 0.1, 0, { pos: [0, 0.5, 0.775] }), table())).toBe(false);
    expect(standsInSet(chair('c', 0, 0.1), table({ pos: [0, 0.5, 0] }))).toBe(false);
    expect(standsInSet(stand('n', 0.05, 0, 0, { wallMounted: true }), bed())).toBe(false);
  });

  it('the wrong pair: a chair and a bed, a nightstand and a table, a table and its chair', () => {
    expect(standsInSet(part({ id: 'c', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0.975, 0, -0.8] }), bed())).toBe(false);
    expect(standsInSet(part({ id: 'n', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0.75] }), table())).toBe(false);
    expect(standsInSet(table(), chair('c', 0, 0.1))).toBe(false);
  });

  it('a coffee table is not a dining table', () => {
    const low = table({ shape: 'coffee-table', dimMM: [1200, 600, 420] });
    expect(standsInSet(part({ id: 'c', category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0.3 + 0.1 + 0.25], rot: Math.PI }), low)).toBe(false);
  });
});

describe('formationSets', () => {
  it('a table leads the chairs at it, and a chair across the room is not one of them', () => {
    const far = chair('far', 0, 1.5);
    const parts = [chair('a', -0.3, 0.1), table(), far, chair('b', 0.3, 0.1)];
    expect(formationSets(parts, [true, true, true, true])).toEqual([[1, 0, 3]]);
  });

  it('a table knocked 8° with its chairs left square is no set: squared alone, it puts the room back', () => {
    const knocked = table({ rot: (-8 * Math.PI) / 180 });
    expect(formationSets([knocked, chair('a', -0.3, 0.1), chair('b', 0.3, 0.1)], [true, true, true])).toEqual([]);
    expect(formationSets([table(), chair('a', -0.3, 0.1), chair('b', 0.3, 0.1)], [true, true, true])).toEqual([[0, 1, 2]]);
  });

  it('a table with no chair at it is no set', () => {
    expect(formationSets([table(), chair('far', 0, 1.5)], [true, true])).toEqual([]);
  });

  it('a nightstand between twin beds joins the nearer, the lower index on a tie', () => {
    const other = (x: number) => bed({ id: 'bed2', pos: [x, 0, 0] });
    const n = stand('n', 0.05);
    // n's +X side is at 1.2; a bed beyond it 0.08 off is further than bed 1's 0.05…
    const nearer = formationSets([bed(), other(1.2 + 0.08 + 0.7), n], [true, true, true]);
    expect(nearer).toEqual([[0, 2]]);
    // …0.03 off is nearer, and a nightstand at bed 2's head from that side too.
    const flipped = formationSets([bed(), other(1.2 + 0.03 + 0.7), n], [true, true, true]);
    expect(flipped).toEqual([[1, 2]]);
    // A tie, made exact by symmetry rather than by arithmetic that happens to agree:
    // the nightstand at x = 0 and a bed 0.05 off each side of it.
    const mid = { ...n, pos: [0, 0, n.pos[2]] as [number, number, number] };
    const d = 0.225 + 0.05 + 0.7;
    const left = bed({ id: 'left', pos: [-d, 0, 0] });
    const right = bed({ id: 'right', pos: [d, 0, 0] });
    expect(formationSets([left, right, mid], [true, true, true])).toEqual([[0, 2]]);
    // The order of the room decides the tie, not which bed is which.
    expect(formationSets([right, left, mid], [true, true, true])).toEqual([[0, 2]]);
  });

  it('sets come out anchor first, by the anchor\'s place in the room', () => {
    const t = table({ pos: [0, 0, 3] });
    const c = chair('c', 0, 0.1);
    const atT = { ...c, pos: [c.pos[0], 0, c.pos[2] + 3] as [number, number, number] };
    const parts = [stand('n', 0.05), atT, bed(), t];
    expect(formationSets(parts, [true, true, true, true])).toEqual([[2, 0], [3, 1]]);
  });

  it('a pinned or merged piece is in none: neither as a member nor as an anchor', () => {
    const room = () => [table(), chair('a', -0.3, 0.1), chair('b', 0.3, 0.1)];
    expect(formationSets(room(), [true, false, true])).toEqual([[0, 2]]);
    expect(formationSets(room(), [false, true, true])).toEqual([]);
    const merged = room();
    merged[1] = { ...merged[1], groupId: 'g' };
    expect(formationSets(merged, [true, true, true])).toEqual([[0, 2]]);
    const mergedTable = room();
    mergedTable[0] = { ...mergedTable[0], groupId: 'g' };
    expect(formationSets(mergedTable, [true, true, true])).toEqual([]);
  });
});

describe('rigidSets and withCompany read the sets the room stands in', () => {
  it('rigidSets lists the merged sets, then the room\'s, and says which are which', () => {
    const sofa = part({ id: 'sofa', category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 880], pos: [4, 0, 4], groupId: 'g' });
    const lamp = part({ id: 'lamp', category: 'lamp', shape: 'lamp-floor', dimMM: [300, 300, 1600], pos: [5.2, 0, 4], groupId: 'g' });
    const parts = [table(), chair('a', 0, 0.1), sofa, lamp];
    const r = rigidSets(parts, [true, true, true, true]);
    expect(r.sets).toEqual([[2, 3], [0, 1]]);
    expect(r.formation).toEqual([false, true]);
    expect([...r.setOf]).toEqual([1, 1, 0, 0]);
  });

  it('naming a table brings the chairs at it; naming a chair does not bring the table', () => {
    const parts = [table(), chair('a', -0.3, 0.1), chair('b', 0.3, 0.1), chair('far', 0, 1.5)];
    expect([...withCompany(new Set(['table']), parts)].sort()).toEqual(['a', 'b', 'table']);
    expect([...withCompany(new Set(['a']), parts)]).toEqual(['a']);
  });

  it('a pinned chair stays out of its table\'s company', () => {
    const parts = [table(), chair('a', -0.3, 0.1, 0, { locked: true }), chair('b', 0.3, 0.1)];
    expect([...withCompany(new Set(['table']), parts)].sort()).toEqual(['b', 'table']);
  });
});
