// Does the seat rule's fit test describe the furniture as it is drawn?
//
// `tuckProfile` (`lib/layout-rules.ts`) says how high the part of a seat that goes under
// a surface reaches, and how much clear height a surface has under it. Those are facts
// about DRAWINGS, and the drawings are TSX renderers that no gate reaches — CLAUDE.md
// rule 2's corollary, and the reason the ottoman's welt could stop at 0.9 h for as long
// as it existed. So this walks the renderer (`tests/helpers/geometry-walk.ts`) for every
// shape and category that can reach a seat or surface role, at the bottom, catalogue and
// top of its height range, and holds the two numbers to what it draws.
//
// The census is pinned as literals, not counts that merely have to be positive: which
// (shape, category) pairs reach a role that tucks, and which of the catalogue's own
// pairings leave room. A new shape that sits at a table fails here until its drawing has
// been measured, because the default — solid, nothing tucks — is only a safe answer
// while it is a true one.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({
  useStudio: (sel: (s: unknown) => unknown) =>
    sel({ dims: {}, openState: new Proxy({}, { get: () => 0 }), hidden: {}, quality: 'high' }),
}));
// A material carries no geometry; see `tests/footprint-fidelity.test.tsx` for why the
// presets cannot be spread here.
vi.mock('@/components/three/materials', () => ({
  SURFACE: new Proxy({}, { get: () => ({}) }),
  PHYSICAL_SURFACES: ['fabric'],
}));

import { PartGeometry } from '@/components/three/DynamicPart';
import { CATEGORIES, PART_LIBRARY, SHAPES, type Category, type ScenePart, type Shape } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { hasFloorSharers, sharesFloor, tuckProfile, tucksUnder, TUCKED_CLASH_SHARE, type Role } from '@/lib/layout-rules';
import { convexHull, occupiedPts, pointInHull, walk } from './helpers/geometry-walk';

const TOLERANCE_MM = 1;
/** Rows whose shape `tuckProfile` has a case for — pinned so the exactness test cannot
 *  pass by measuring nothing. */
const NAMED_ROWS = 153;
/** Anything whose bottom is this close to the floor stands on it — a leg, a panel. */
const ON_FLOOR_MM = 2;

const SEATS: Role[] = ['dining-chair', 'office-chair', 'ottoman'];
const SURFACES: Role[] = ['dining-table', 'desk', 'coffee-table'];

type Dim = [number, number, number];

function drawn(shape: Shape, category: Category, dimMM: Dim) {
  const part = { id: 'p', name: shape, shape, category, dimMM, pos: [0, 0, 0], rot: 0, color: '#b07a52' } as unknown as ScenePart;
  const rep = walk(PartGeometry({ part, locked: false }));
  expect(Object.keys(rep.unhandled), `${shape}/${category}: unhandled`).toEqual([]);
  expect(Object.keys(rep.threw), `${shape}/${category}: threw`).toEqual([]);
  expect(rep.prims.length, `${shape}/${category}: drew nothing`).toBeGreaterThan(0);
  return rep.prims;
}

/** The highest drawn point of whatever reaches into the front `TUCKED_CLASH_SHARE` of
 *  the depth. The front is local +Z (`lib/geometry.ts`). */
function drawnTuckMM(shape: Shape, category: Category, dimMM: Dim): number {
  const hd = dimMM[1] / 2000;
  const cut = hd - TUCKED_CLASH_SHARE * 2 * hd;
  const reaching = drawn(shape, category, dimMM).filter((p) => occupiedPts(p).some(([, z]) => z >= cut));
  return Math.max(...reaching.map((p) => p.y[1])) * 1000;
}

/** The lowest underside of anything off the floor that is not sitting on something
 *  that is — an apron, a shelf, a rail, not a freezer's lid or a welt's overhang. With
 *  nothing like that, the piece is solid to the floor and nothing goes under it. */
function drawnKneeMM(shape: Shape, category: Category, dimMM: Dim): number {
  const prims = drawn(shape, category, dimMM).map((p) => ({ y: p.y, hull: convexHull(occupiedPts(p)) }));
  const floor = prims.filter((p) => p.y[0] * 1000 <= ON_FLOOR_MM);
  // Inside the declared box only: a freezer's lid handle hangs 35 mm proud of its
  // front, and the air under a handle is not room for a seat.
  const hw = dimMM[0] / 2000, hd = dimMM[1] / 2000;
  const N = 12;
  const overOpenFloor = (hull: Array<[number, number]>): boolean => {
    const xs = hull.map(([x]) => x), zs = hull.map(([, z]) => z);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    let inside = 0, open = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = x0 + ((i + 0.5) / N) * (x1 - x0), z = z0 + ((j + 0.5) / N) * (z1 - z0);
      if (!pointInHull(x, z, hull) || Math.abs(x) > hw || Math.abs(z) > hd) continue;
      inside++;
      if (!floor.some((f) => pointInHull(x, z, f.hull))) open++;
    }
    return inside > 0 && open / inside >= 0.5;
  };
  const over = prims.filter((p) => p.y[0] * 1000 > ON_FLOOR_MM && overOpenFloor(p.hull));
  return over.length ? Math.min(...over.map((p) => p.y[0])) * 1000 : 0;
}

/** Every (shape, category) that reaches a role the fit test reads, at every height
 *  it is measured at. `roleOf` reads the size, so the same pair can reach a surface
 *  role at one height and not at another. */
type Row = { shape: Shape; category: Category; dimMM: Dim; role: Role; kind: 'seat' | 'surface'; profile: number };

const rows: Row[] = SHAPES.flatMap((shape) =>
  CATEGORIES.flatMap((category): Row[] => {
    const range = dimRangeFor(category, shape);
    const lib = PART_LIBRARY.find((l) => l.shape === shape && l.category === category)?.dimMM;
    const plan: [number, number] = lib ? [lib[0], lib[1]] : [range.min[0], range.min[1]];
    const heights = [...new Set([range.min[2], lib?.[2] ?? range.min[2], range.max[2]])];
    return heights.flatMap((h): Row[] => {
      const dimMM: Dim = [plan[0], plan[1], h];
      const p = tuckProfile({ shape, category, dimMM });
      if (SEATS.includes(p.role)) return [{ shape, category, dimMM, role: p.role, kind: 'seat', profile: p.tuckMM }];
      if (SURFACES.includes(p.role)) return [{ shape, category, dimMM, role: p.role, kind: 'surface', profile: p.kneeMM }];
      return [];
    });
  }),
);

describe('the fit test reads the furniture as it is drawn', () => {
  it('the roles it reads are exactly the ones that share floor', () => {
    // If `FLOOR_SHARERS` grows a role, this sweep has to grow with it. `Role` is a type
    // with no runtime list, so the roles are the ones anything in the catalogue reaches.
    const reached = new Set(
      SHAPES.flatMap((shape) =>
        CATEGORIES.flatMap((category) => {
          const r = dimRangeFor(category, shape);
          const lib = PART_LIBRARY.find((l) => l.shape === shape && l.category === category)?.dimMM;
          return [r.min, r.max, ...(lib ? [lib] : [])].map((dimMM) => tuckProfile({ shape, category, dimMM }).role);
        }),
      ),
    );
    expect([...reached].filter(hasFloorSharers).sort()).toEqual([...SEATS, ...SURFACES].sort());
    for (const s of SEATS) for (const t of SEATS) expect(sharesFloor(s, t), `${s}/${t}`).toBe(false);
    for (const s of SURFACES) for (const t of SURFACES) expect(sharesFloor(s, t), `${s}/${t}`).toBe(false);
  });

  it('the sweep has a fixed denominator', () => {
    // Every (shape, category, height) that reads as a seat or a surface. A literal, so a
    // shape that stops reaching a role — or starts — is a decision someone sees.
    //
    // 245 / 168 / 77 until a stool became a seat under every category (`ROLE_BY_SHAPE`),
    // because the settle pass's seat gate reads the role and a stool filed as `other` went
    // up onto the coffee table beside it. All 36 new rows and all 4 lost ones are the
    // stool's — measured, with every other row identical: its 9 rows (3 dining chair, 2
    // ottoman, 2 dining table, 2 desk) became 45, every one a dining chair.
    expect([rows.length, rows.filter((r) => r.kind === 'seat').length, rows.filter((r) => r.kind === 'surface').length]).toEqual([281, 208, 73]);
    expect(rows.filter((r) => r.shape === 'stool').map((r) => r.role).every((r) => r === 'dining-chair')).toBe(true);
    expect(rows.filter((r) => r.shape === 'stool').length).toBe(45);
  });

  // Measured both ways, and the two directions are not the same kind of fact. A profile
  // that claims a seat LOWER, or a surface ROOMIER, than it is drawn tucks a piece into
  // another: never allowed. One that claims less room than the drawing has refuses a
  // tuck the furniture would take: allowed only where it is written down, below.
  const seatRows = () => rows.filter((r) => r.kind === 'seat').map((r) => ({ ...r, drawn: drawnTuckMM(r.shape, r.category, r.dimMM) }));
  const surfaceRows = () => rows.filter((r) => r.kind === 'surface').map((r) => ({ ...r, drawn: drawnKneeMM(r.shape, r.category, r.dimMM) }));
  const label = (r: { shape: Shape; category: Category; dimMM: Dim; profile: number; drawn: number }) =>
    `${r.shape}/${r.category} h${r.dimMM[2]}: profile ${r.profile.toFixed(1)}, drawn ${r.drawn.toFixed(1)}`;

  it('no seat is taken as lower than it is drawn', () => {
    expect(seatRows().filter((r) => r.profile < r.drawn - TOLERANCE_MM).map(label)).toEqual([]);
  });

  it('no surface is taken as leaving more room than it is drawn with', () => {
    expect(surfaceRows().filter((r) => r.profile > r.drawn + TOLERANCE_MM).map(label)).toEqual([]);
  });

  it('where the profile is more careful than the drawing, and why', () => {
    // Each of these is a shape the profile takes as solid — the default — while its
    // drawing leaves a little room. None is worth a case of its own:
    //   plane       a flat 5 mm sheet, whatever it is called.
    //   tv-console  a 42–60 mm toe-kick. No seat goes under that.
    // A stool was the third, read as a table by its size under two categories. It is a
    // seat under every category now, so it is never asked as a surface.
    // A shape that joins this list has had a drawing change under it, and should be
    // measured and, if it now makes real room, given a case in `tuckProfile`.
    const byShape = (rs: Array<{ shape: Shape }>) => [...new Set(rs.map((r) => r.shape))].sort();
    expect(byShape(seatRows().filter((r) => r.profile > r.drawn + TOLERANCE_MM))).toEqual(['plane']);
    expect(byShape(surfaceRows().filter((r) => r.profile < r.drawn - TOLERANCE_MM))).toEqual(['plane', 'tv-console']);
  });

  it('the shapes it names are measured exactly', () => {
    // The other direction's cases are the ones with a formula, and a formula that is
    // merely safe could be safe by a mile — a desk's knee room written as 0 would pass
    // both one-sided tests above. So these are held to the drawing both ways.
    const named = new Set<Shape>(['chair-dining', 'chair-office', 'desk-standard', 'desk-l', 'coffee-table']);
    const off = [...seatRows(), ...surfaceRows()].filter((r) => named.has(r.shape) && Math.abs(r.profile - r.drawn) > TOLERANCE_MM);
    expect(off.map(label)).toEqual([]);
    expect(rows.filter((r) => named.has(r.shape)).length).toBe(NAMED_ROWS);
  });
});

describe('the catalogue pairings that leave room', () => {
  // What a person meets: the Library's seats against its surfaces, plus a dining table,
  // which the Library only reaches as a desk-category piece and a room reaches as the
  // `table` category — the same shape drawn with an apron rather than a cable rail.
  type Item = { label: string; category: Category; shape: Shape; dimMM: Dim };
  const DINING_TABLE: Item = { label: 'Dining table', category: 'table', shape: 'desk-standard', dimMM: [1200, 600, 750] };
  const items: Item[] = [...PART_LIBRARY, DINING_TABLE];
  const seats = items.filter((l) => SEATS.includes(tuckProfile(l).role));
  const surfaces = items.filter((l) => SURFACES.includes(tuckProfile(l).role));
  const pairs = seats.flatMap((a) => surfaces.filter((b) => sharesFloor(tuckProfile(a).role, tuckProfile(b).role)).map((b) => [a, b] as const));

  it('reads the pieces it means to', () => {
    expect(tuckProfile(DINING_TABLE).role).toBe('dining-table');
    expect(seats.map((l) => l.label)).toEqual(['Dining chair', 'Office chair', 'Ottoman', 'Stool']);
    expect(surfaces.map((l) => l.label)).toEqual(['Coffee table', 'Dining / desk table', 'L-shaped desk', 'Dining table']);
  });

  it('at the sizes they are added at', () => {
    // The ottoman at the coffee table is the one that changed: the table's lower shelf is
    // a quarter of the way up, so there is no room under it for anything, and an ottoman
    // beside one is an ordinary piece beside it.
    expect(pairs.map(([a, b]) => `${a.label} → ${b.label}: ${tucksUnder(a, b) ? 'tucks' : 'no'}`)).toEqual([
      'Dining chair → Dining / desk table: tucks',
      'Dining chair → L-shaped desk: tucks',
      'Dining chair → Dining table: tucks',
      'Office chair → Dining / desk table: tucks',
      'Office chair → L-shaped desk: tucks',
      'Office chair → Dining table: tucks',
      'Ottoman → Coffee table: no',
      'Ottoman → Dining / desk table: tucks',
      'Ottoman → L-shaped desk: tucks',
      'Ottoman → Dining table: tucks',
      'Stool → Dining / desk table: tucks',
      'Stool → L-shaped desk: tucks',
      'Stool → Dining table: tucks',
    ]);
  });

  it('a seat that meets the underside exactly goes under it', () => {
    // Touching is clearing: a seat whose top meets the underside has not gone into it.
    // The sweep below never lands on this, because every knee it reaches ends in a 5.
    const desk = items.find((l) => l.label === 'Dining / desk table')!;
    const stool = items.find((l) => l.label === 'Stool')!;
    const at = (h: number): Item => ({ ...stool, dimMM: [stool.dimMM[0], stool.dimMM[1], h] });
    expect(tuckProfile(at(675)).tuckMM).toBe(tuckProfile(desk).kneeMM);
    expect(tucksUnder(at(675), desk)).toBe(true);
    expect(tucksUnder(at(676), desk)).toBe(false);
  });

  it('across every height either can be set to', () => {
    // 10 mm steps over both ranges, the plan held at the catalogue's. Counted rather
    // than listed; the counts are literals so a drawing that moves shows up here.
    const at = (l: Item, h: number): Item => ({ ...l, dimMM: [l.dimMM[0], l.dimMM[1], h] });
    const heights = (l: Item) => {
      const r = dimRangeFor(l.category, l.shape);
      return Array.from({ length: Math.floor((r.max[2] - r.min[2]) / 10) + 1 }, (_, i) => r.min[2] + i * 10);
    };
    const counts = pairs.map(([a, b]) => {
      let fit = 0, all = 0;
      for (const ha of heights(a)) for (const hb of heights(b)) {
        const [pa, pb] = [tuckProfile(at(a, ha)), tuckProfile(at(b, hb))];
        if (!sharesFloor(pa.role, pb.role)) continue;
        all++;
        if (tucksUnder(at(a, ha), at(b, hb))) fit++;
      }
      return `${a.label} → ${b.label}: ${fit}/${all}`;
    });
    // Read down it: a dining chair goes under everything but the lowest dining table
    // with the tallest chairs (`tests/seat-support.test.ts` holds that corner); an
    // office chair's armrests are what decide it, and the catalogue's needs a desk of
    // 690 mm or more; an ottoman goes under everything but a coffee table and the
    // lowest tops with the tallest ottomans.
    expect(counts).toEqual([
      'Dining chair → Dining / desk table: 1116/1116',
      'Dining chair → L-shaped desk: 1116/1116',
      'Dining chair → Dining table: 1113/1116',
      'Office chair → Dining / desk table: 965/1581',
      'Office chair → L-shaped desk: 965/1581',
      'Office chair → Dining table: 765/1581',
      'Ottoman → Coffee table: 0/936',
      'Ottoman → Dining / desk table: 800/806',
      'Ottoman → L-shaped desk: 800/806',
      'Ottoman → Dining table: 778/806',
      'Stool → Dining / desk table: 1100/1271',
      'Stool → L-shaped desk: 1100/1271',
      'Stool → Dining table: 1018/1271',
    ]);
  });
});
