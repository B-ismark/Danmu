// The seven building blocks — worktop, screen, drawer unit, open shelf, door cabinet, slat
// panel, seat pad — as lists of parts, swept over every size each may be.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.
//
// Four things are held here, and the first is the reason the forms live in `lib/` and not
// in the renderer: **nothing leaves its box** (a part past `dimMM` is a piece whose size
// the Inspector, the plan and the clearance report all misstate); **modules tile as
// specified** (a count is `moduleCount` off a `MODULE_RANGE` row, so each module stays in
// its real range at EVERY legal size — the sweep is the assertion, because choosing
// examples is how the 890 mm wardrobe was missed); **absolutes stay absolute** (a 25 mm slab
// is 25 mm at 400 mm and at 1100, which is why six of the seven are parametric); and **an
// option does what its name says** (a worktop on `none` is a slab, a drawer unit without
// `lock` has no barrel).
//
// And the half that is not geometry: the options are `ScenePart.blockStyle`, resolved by
// `blockStyleFor` and carried through a scene file, so a file keeps a choice and refuses a
// value outside its vocabulary — with a report, never silently.

import { describe, expect, it } from 'vitest';
import {
  BLOCK_BANDS,
  BLOCK_ENDS,
  BLOCK_SHAPES,
  blockStyleFor,
  blockStyleKeys,
  isBlockShape,
  type BlockShape,
  type BlockStyle,
} from '@/lib/block-style';
import {
  cabinetPlinth,
  doorCabinetForm,
  doorCount,
  drawerCount,
  drawerPlinth,
  drawerUnitForm,
  openShelfForm,
  screenBand,
  screenForm,
  screenFrame,
  seatPadForm,
  shelfBoard,
  shelfGrid,
  slatBacking,
  slatCount,
  slatPanelForm,
  slatRail,
  worktopForm,
  worktopTop,
  type BlockGlass,
} from '@/lib/block-forms';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { isParametric, moduleRangeFor, PART_LIBRARY, placeNewPart, SHAPES, type ScenePart } from '@/lib/scene-spec';
import { anchorFor } from '@/lib/physics';
import { isObstacle, roleOf } from '@/lib/layout-rules';
import type { HardPart } from '@/lib/hard-goods';
import { buildSceneFile, parseSceneFile, sceneFileJson, sceneFileToRoom } from '@/lib/scene-file';
import type { RoomData, Transforms } from '@/lib/storage';

type Dim = [number, number, number];

const row = (shape: BlockShape) => {
  const r = PART_LIBRARY.find((i) => i.shape === shape);
  if (!r) throw new Error(`${shape} has no Library row`);
  return r;
};
const range = (shape: BlockShape) => dimRangeFor(row(shape).category, shape);

/** Every box a form can be asked to draw: the defaults, each range's two extremes on one
 *  axis at a time, and the all-minimum and all-maximum corners. */
function sizes(shape: BlockShape): Dim[] {
  const r = range(shape);
  const base = row(shape).dimMM;
  const out: Dim[] = [[...base]];
  for (let ax = 0; ax < 3; ax++) {
    for (const edge of [r.min, r.max]) {
      const d: Dim = [...base];
      d[ax] = edge[ax];
      out.push(d);
    }
  }
  out.push([...r.min] as Dim, [...r.max] as Dim);
  return out;
}

/** Where a part reaches, per axis, in metres. A disc lies on the depth axis. */
function reach(p: HardPart | BlockGlass): { lo: Dim; hi: Dim } {
  if ('kind' in p && (p.kind === 'frosted' || p.kind === 'clear')) {
    return { lo: [p.x0, p.y0, p.z0], hi: [p.x1, p.y1, p.z1] };
  }
  const part = p as HardPart;
  if (part.kind === 'box') {
    return {
      lo: [part.pos[0] - part.size[0] / 2, part.pos[1] - part.size[1] / 2, part.pos[2] - part.size[2] / 2],
      hi: [part.pos[0] + part.size[0] / 2, part.pos[1] + part.size[1] / 2, part.pos[2] + part.size[2] / 2],
    };
  }
  if (part.kind === 'disc') {
    return {
      lo: [part.pos[0] - part.r, part.pos[1] - part.r, part.pos[2] - part.t / 2],
      hi: [part.pos[0] + part.r, part.pos[1] + part.r, part.pos[2] + part.t / 2],
    };
  }
  throw new Error(`block forms draw boxes and discs only, got ${part.kind}`);
}

const SLACK = 1e-9;

/** A block's whole form at one size and the resolved style `style` — parts and glass. */
function formOf(shape: BlockShape, dim: Dim, style: BlockStyle = {}): { parts: HardPart[]; glass: BlockGlass[] } {
  const s = blockStyleFor(shape, style);
  switch (shape) {
    case 'worktop': return { parts: worktopForm(dim, s.ends!), glass: [] };
    case 'screen': return screenForm(dim, s.band!);
    case 'drawer-unit': return { parts: drawerUnitForm(dim, s.lock!), glass: [] };
    case 'open-shelf': return { parts: openShelfForm(dim, s.back!), glass: [] };
    case 'door-cabinet': return { parts: doorCabinetForm(dim, s.plinth!), glass: [] };
    case 'slat-panel': return { parts: slatPanelForm(dim, s.backing!), glass: [] };
    case 'seat-pad': {
      const { top } = seatPadForm(dim);
      return {
        parts: [{ kind: 'box', key: 'cushion', tone: 'body', size: top.size, pos: top.pos }],
        glass: [],
      };
    }
  }
}

/** Every option combination a block has — the cartesian product of its keys' vocabularies. */
function styles(shape: BlockShape): BlockStyle[] {
  let out: BlockStyle[] = [{}];
  for (const key of blockStyleKeys(shape)) {
    const values: readonly (string | boolean)[] =
      key === 'ends' ? BLOCK_ENDS : key === 'band' ? BLOCK_BANDS : [true, false];
    out = out.flatMap((o) => values.map((v) => ({ ...o, [key]: v })));
  }
  return out;
}

const named = (parts: HardPart[], prefix: string) => parts.filter((p) => p.key.startsWith(prefix));
const box = (parts: HardPart[], key: string) => {
  const p = parts.find((x) => x.key === key);
  if (!p || p.kind !== 'box') throw new Error(`no box called ${key}`);
  return p;
};

describe('the vocabulary', () => {
  it('names seven blocks, every one a Shape with a Library row of its own', () => {
    expect(BLOCK_SHAPES).toHaveLength(7);
    for (const s of BLOCK_SHAPES) {
      expect(SHAPES, `${s} is not a Shape`).toContain(s);
      expect(isBlockShape(s)).toBe(true);
      expect(PART_LIBRARY.filter((i) => i.shape === s), s).toHaveLength(1);
      expect(row(s).group, `${s} is in the Blocks group`).toBe('Blocks');
    }
    expect(isBlockShape('sofa')).toBe(false);
    expect(PART_LIBRARY.filter((i) => i.group === 'Blocks')).toHaveLength(7);
  });

  it('ships the sizes it was specified at, as a decision', () => {
    // Pinned by name rather than read back: every sweep below measures a block against the
    // size the Library gave it, so retuning a row would move the goalposts with it.
    expect(row('worktop').dimMM).toEqual([1200, 600, 750]);
    expect(row('screen').dimMM).toEqual([1200, 30, 1100]);
    expect(row('drawer-unit').dimMM).toEqual([400, 500, 600]);
    expect(row('open-shelf').dimMM).toEqual([800, 350, 800]);
    expect(row('door-cabinet').dimMM).toEqual([800, 450, 850]);
    expect(row('slat-panel').dimMM).toEqual([1200, 40, 2000]);
    expect(row('seat-pad').dimMM).toEqual([1200, 450, 60]);
    expect(row('worktop').category).toBe('desk');
    expect(row('seat-pad').category).toBe('ottoman');
    expect(row('drawer-unit').category).toBe('shelf');
  });

  it('bounds each block by the band it was specified with', () => {
    const want: Record<BlockShape, [Dim, Dim]> = {
      worktop: [[400, 300, 400], [3000, 1200, 1100]],
      screen: [[300, 20, 300], [2400, 60, 1800]],
      'drawer-unit': [[300, 400, 350], [600, 700, 750]],
      'open-shelf': [[300, 200, 300], [2400, 600, 2400]],
      'door-cabinet': [[300, 300, 300], [2400, 700, 1200]],
      'slat-panel': [[200, 15, 300], [3000, 80, 2800]],
      'seat-pad': [[300, 300, 30], [3000, 700, 150]],
    };
    for (const s of BLOCK_SHAPES) {
      expect([range(s).min, range(s).max], s).toEqual(want[s]);
    }
  });

  it('is parametric exactly where it holds an absolute, which is all but the seat pad', () => {
    for (const s of BLOCK_SHAPES) expect(isParametric(s), s).toBe(s !== 'seat-pad');
  });

  it('tiles exactly the four that divide a span into modules', () => {
    for (const s of BLOCK_SHAPES) {
      expect(moduleRangeFor(s) !== null, s).toBe(['drawer-unit', 'open-shelf', 'door-cabinet', 'slat-panel'].includes(s));
    }
  });
});

describe('blockStyleFor — the defaults', () => {
  it('answers every option a shape has, and only those', () => {
    expect(blockStyleFor('worktop')).toEqual({ ends: 'legs' });
    expect(blockStyleFor('screen')).toEqual({ band: 'frosted' });
    expect(blockStyleFor('drawer-unit')).toEqual({ lock: true });
    expect(blockStyleFor('open-shelf')).toEqual({ back: true });
    expect(blockStyleFor('door-cabinet')).toEqual({ plinth: true });
    expect(blockStyleFor('slat-panel')).toEqual({ backing: false });
    expect(blockStyleFor('seat-pad')).toEqual({});
    // Not a block, or not a shape at all: nothing to resolve.
    expect(blockStyleFor('sofa', { ends: 'panel' })).toEqual({});
    expect(blockStyleFor('hammock')).toEqual({});
  });

  it('keeps a legal choice and ignores one the shape does not have', () => {
    expect(blockStyleFor('worktop', { ends: 'panel' })).toEqual({ ends: 'panel' });
    expect(blockStyleFor('screen', { band: 'none', ends: 'panel' })).toEqual({ band: 'none' });
    expect(blockStyleFor('drawer-unit', { lock: false })).toEqual({ lock: false });
    expect(blockStyleFor('slat-panel', { backing: true })).toEqual({ backing: true });
  });

  it('falls back to the default for a value outside the vocabulary, never to garbage', () => {
    const junk = { ends: 'sideways', band: 7, lock: 'yes', back: null, plinth: 0, backing: [] } as unknown as BlockStyle;
    expect(blockStyleFor('worktop', junk)).toEqual({ ends: 'legs' });
    expect(blockStyleFor('screen', junk)).toEqual({ band: 'frosted' });
    expect(blockStyleFor('drawer-unit', junk)).toEqual({ lock: true });
    expect(blockStyleFor('open-shelf', junk)).toEqual({ back: true });
    expect(blockStyleFor('door-cabinet', junk)).toEqual({ plinth: true });
    expect(blockStyleFor('slat-panel', junk)).toEqual({ backing: false });
    expect(blockStyleFor('worktop', null)).toEqual({ ends: 'legs' });
  });

  it('lists the options in the order the Inspector shows them', () => {
    expect(BLOCK_SHAPES.map((s) => blockStyleKeys(s).length)).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(blockStyleKeys('sofa')).toEqual([]);
  });
});

describe('nothing leaves its box', () => {
  for (const shape of BLOCK_SHAPES) {
    it(`${shape}: every part stays inside dimMM, at every size and every option`, () => {
      const out: string[] = [];
      let drawn = 0;
      for (const dim of sizes(shape)) {
        for (const style of styles(shape)) {
          const { parts, glass } = formOf(shape, dim, style);
          expect(parts.length, `${shape} at ${dim} drew nothing`).toBeGreaterThan(0);
          const [w, d, h] = [dim[0] / 1000, dim[1] / 1000, dim[2] / 1000];
          for (const p of [...parts, ...glass]) {
            drawn++;
            const { lo, hi } = reach(p);
            const key = 'key' in p ? p.key : p.kind;
            const bad =
              lo[0] < -w / 2 - SLACK || hi[0] > w / 2 + SLACK ||
              lo[1] < -SLACK || hi[1] > h + SLACK ||
              lo[2] < -d / 2 - SLACK || hi[2] > d / 2 + SLACK;
            if (bad) out.push(`${key} at ${dim.join('x')} ${JSON.stringify(style)}: ${lo.map((v) => v.toFixed(4))} .. ${hi.map((v) => v.toFixed(4))}`);
            // …and it has a body: a zero-thickness part is a plane in the room.
            for (let a = 0; a < 3; a++) {
              if (hi[a] - lo[a] <= 1e-6) out.push(`${key} at ${dim.join('x')} is flat on axis ${a}`);
            }
          }
        }
      }
      expect(drawn, 'the sweep drew parts').toBeGreaterThan(8);
      expect(out.slice(0, 6), `${out.length} parts outside their box`).toEqual([]);
    });
  }

  it('reaches the floor, and the top of its box, wherever the piece is a floor piece', () => {
    // A form that stops short of `h` is a block whose declared height lies; one that starts
    // above 0 floats. The worktop on `none` is the one exception to the floor: its slab IS
    // the piece, at the top of the box.
    for (const shape of BLOCK_SHAPES) {
      for (const dim of sizes(shape)) {
        for (const style of styles(shape)) {
          const { parts, glass } = formOf(shape, dim, style);
          const all = [...parts, ...glass].map(reach);
          const top = Math.max(...all.map((r) => r.hi[1]));
          const bottom = Math.min(...all.map((r) => r.lo[1]));
          expect(top, `${shape} at ${dim} ${JSON.stringify(style)}`).toBeCloseTo(dim[2] / 1000, 9);
          if (shape === 'worktop' && style.ends === 'none') expect(bottom).toBeGreaterThan(0);
          else expect(bottom, `${shape} at ${dim} ${JSON.stringify(style)}`).toBeCloseTo(0, 9);
        }
      }
    }
  });

  it('is exactly as wide and as deep as it says, wherever the piece has a body to the edge', () => {
    // The widest element IS `dimMM[0]` (Design.md § Adding a shape): the top slab, the
    // sides, the rails. The glass and the slats are inside it, and the rest of the box is
    // never short of it.
    for (const shape of BLOCK_SHAPES) {
      for (const dim of sizes(shape)) {
        const { parts, glass } = formOf(shape, dim);
        const all = [...parts, ...glass].map(reach);
        const wide = Math.max(...all.map((r) => r.hi[0])) - Math.min(...all.map((r) => r.lo[0]));
        expect(wide, `${shape} at ${dim}`).toBeCloseTo(dim[0] / 1000, 9);
      }
    }
  });
});

describe('modules tile as specified', () => {
  it('draws the Library presets at the counts they were specified with', () => {
    expect(drawerCount(600)).toBe(3);
    expect(doorCount(800)).toBe(2);
    expect(shelfGrid([800, 350, 800])).toEqual({ cols: 2, rows: 2 });
    expect(slatCount(1200)).toBe(18);
    // …and the forms draw the count, not a number of their own.
    const [w, d, h] = row('drawer-unit').dimMM.map((v) => v) as Dim;
    expect(named(drawerUnitForm([w, d, h], true), 'front-')).toHaveLength(3);
    expect(named(doorCabinetForm(row('door-cabinet').dimMM, true), 'door-')).toHaveLength(2);
    expect(named(slatPanelForm(row('slat-panel').dimMM, false), 'slat-')).toHaveLength(18);
  });

  it('keeps every drawer front inside its module range across the legal height', () => {
    const r = moduleRangeFor('drawer-unit')!;
    const { min, max } = range('drawer-unit');
    const bad: string[] = [];
    for (let h = min[2]; h <= max[2]; h++) {
      const n = drawerCount(h);
      const each = h / 1000 / n;
      if (!Number.isInteger(n) || n < 1 || each < r.min - 1e-9 || each > r.max + 1e-9) bad.push(`${h} mm -> ${n}`);
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('keeps every door, cubby and slat inside its range across the legal width', () => {
    const cases: Array<[string, ModuleRange0, number, number, (mm: number) => number]> = [
      ['door-cabinet', moduleRangeFor('door-cabinet')!, range('door-cabinet').min[0], range('door-cabinet').max[0], doorCount],
      ['slat-panel', moduleRangeFor('slat-panel')!, range('slat-panel').min[0], range('slat-panel').max[0], slatCount],
      ['open-shelf cols', moduleRangeFor('open-shelf')!, range('open-shelf').min[0], range('open-shelf').max[0], (mm) => shelfGrid([mm, 350, 800]).cols],
      ['open-shelf rows', moduleRangeFor('open-shelf')!, range('open-shelf').min[2], range('open-shelf').max[2], (mm) => shelfGrid([800, 350, mm]).rows],
    ];
    for (const [name, r, lo, hi, count] of cases) {
      const bad: string[] = [];
      let prev = 0;
      for (let mm = lo; mm <= hi; mm++) {
        const n = count(mm);
        const each = mm / 1000 / n;
        if (!Number.isInteger(n) || n < 1 || each < r.min - 1e-9 || each > r.max + 1e-9) bad.push(`${mm} mm -> ${n} x ${(each * 1000).toFixed(1)}`);
        if (n < prev) bad.push(`${mm} mm: the count went DOWN ${prev} -> ${n}`);
        prev = n;
      }
      expect(bad.slice(0, 6), name).toEqual([]);
    }
  });

  it('states the module ranges as a decision, not a derivation', () => {
    // The sweeps above measure a module against its OWN declared range, so widening the
    // declaration moves the goalposts with it (`tests/module-tiling.test.ts`, mutated).
    // Each of these is a judgement about what a real one is, and the 2x rule is why none is
    // the round 0.15-0.25 / 0.3-0.45 of the brief: a range narrower than a factor of two
    // has spans no integer count tiles.
    expect(moduleRangeFor('drawer-unit')).toEqual({ min: 0.13, nominal: 0.2, max: 0.27 });
    expect(moduleRangeFor('open-shelf')).toEqual({ min: 0.22, nominal: 0.38, max: 0.45 });
    expect(moduleRangeFor('door-cabinet')).toEqual({ min: 0.3, nominal: 0.42, max: 0.6 });
    expect(moduleRangeFor('slat-panel')).toEqual({ min: 0.045, nominal: 0.065, max: 0.09 });
  });

  it('draws as many boards, uprights and fronts as the count says, at every size', () => {
    for (const dim of sizes('open-shelf')) {
      const { cols, rows } = shelfGrid(dim);
      const parts = openShelfForm(dim, true);
      expect(named(parts, 'board-'), `boards at ${dim}`).toHaveLength(rows + 1);
      expect(named(parts, 'upright-'), `uprights at ${dim}`).toHaveLength(rows * (cols - 1));
    }
    for (const dim of sizes('drawer-unit')) {
      expect(named(drawerUnitForm(dim, true), 'front-'), `drawers at ${dim}`).toHaveLength(drawerCount(dim[2]));
      expect(named(drawerUnitForm(dim, true), 'pull-'), `pulls at ${dim}`).toHaveLength(drawerCount(dim[2]));
    }
    for (const dim of sizes('door-cabinet')) {
      expect(named(doorCabinetForm(dim, true), 'door-'), `doors at ${dim}`).toHaveLength(doorCount(dim[0]));
    }
    for (const dim of sizes('slat-panel')) {
      expect(named(slatPanelForm(dim, false), 'slat-'), `slats at ${dim}`).toHaveLength(slatCount(dim[0]));
    }
  });

  it('never overlaps two siblings: fronts, doors, slats', () => {
    const overlaps = (a: HardPart, b: HardPart) => {
      const A = reach(a);
      const B = reach(b);
      return [0, 1, 2].every((ax) => Math.min(A.hi[ax], B.hi[ax]) - Math.max(A.lo[ax], B.lo[ax]) > 1e-9);
    };
    for (const [shape, prefix, make] of [
      ['drawer-unit', 'front-', (d: Dim) => drawerUnitForm(d, true)],
      ['door-cabinet', 'door-', (d: Dim) => doorCabinetForm(d, true)],
      ['slat-panel', 'slat-', (d: Dim) => slatPanelForm(d, false)],
    ] as const) {
      for (const dim of sizes(shape)) {
        const sib = named(make(dim), prefix);
        for (let i = 0; i < sib.length; i++) {
          for (let j = i + 1; j < sib.length; j++) {
            expect(overlaps(sib[i], sib[j]), `${shape} ${sib[i].key} / ${sib[j].key} at ${dim}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('absolutes stay absolute', () => {
  it('a worktop slab is 25 mm at every height, and the legs and panels stand under it', () => {
    const { min, max } = range('worktop');
    for (const h of [min[2], 600, 750, 1000, max[2]]) {
      expect(worktopTop(h), `${h} mm`).toBeCloseTo(0.025, 12);
      const top = box(worktopForm([1200, 600, h], 'legs'), 'top');
      expect(top.size[1], `top at ${h} mm`).toBeCloseTo(0.025, 9);
      expect(top.pos[1] + top.size[1] / 2, `top meets h at ${h} mm`).toBeCloseTo(h / 1000, 9);
    }
    // …and it is a proportion only where an absolute would eat the piece: never past a
    // fifth of a short one.
    expect(worktopTop(60)).toBeCloseTo(0.012, 12);
  });

  it('a screen frame is 20 mm of aluminium at every width, from a desk-top screen to a divider', () => {
    const { min, max } = range('screen');
    for (const w of [min[0], 600, 1200, 1800, max[0]]) {
      expect(screenFrame(w), `${w} mm`).toBeCloseTo(0.02, 12);
      const { parts } = screenForm([w, 30, 1100], 'frosted');
      expect(box(parts, 'post-l').size[0], `post at ${w} mm`).toBeCloseTo(0.02, 9);
      expect(box(parts, 'post-r').size[0], `post at ${w} mm`).toBeCloseTo(0.02, 9);
      expect(box(parts, 'post-l').tone, 'the frame is aluminium, not the board').toBe('steel');
    }
  });

  it('the band is 300 mm, or 30% of a low screen, and 0 when there is none', () => {
    const { min, max } = range('screen');
    for (const h of [min[2], 600, 1000, 1100, 1800, max[2]]) {
      expect(screenBand(h, 'frosted'), `${h} mm`).toBeCloseTo(Math.min(0.3, h * 0.0003), 12);
      expect(screenBand(h, 'glass')).toBe(screenBand(h, 'frosted'));
      expect(screenBand(h, 'none')).toBe(0);
      const { glass } = screenForm([1200, 30, h], 'frosted');
      expect(glass, `band at ${h} mm`).toHaveLength(1);
      expect(glass[0].y1 - glass[0].y0, `glass at ${h} mm`).toBeCloseTo(Math.min(0.3, h * 0.0003), 9);
    }
  });

  it('a door cabinet toe-kick is 80 mm, and a drawer unit plinth 50 mm, whatever the height', () => {
    for (const h of [600, 850, 1000, 1200]) {
      expect(cabinetPlinth(h), `${h} mm`).toBeCloseTo(0.08, 12);
      expect(box(doorCabinetForm([800, 450, h], true), 'plinth').size[1]).toBeCloseTo(0.08, 9);
    }
    for (const h of [750, 700, 625]) {
      expect(drawerPlinth(h), `${h} mm`).toBeCloseTo(0.05, 12);
    }
    // A low piece is not eaten by it.
    expect(cabinetPlinth(300)).toBeCloseTo(0.045, 12);
    expect(drawerPlinth(350)).toBeCloseTo(0.028, 12);
    expect(drawerPlinth(600)).toBeCloseTo(0.048, 12);
  });

  it('a toe-kick is recessed behind the doors and under the carcass', () => {
    const parts = doorCabinetForm([800, 450, 850], true);
    const plinth = box(parts, 'plinth');
    const door = box(parts, 'door-0');
    // Its front is further back than the doors' face by at least the recess, which is what
    // makes it a toe-kick and not a skirt.
    expect(door.pos[2] + door.size[2] / 2 - (plinth.pos[2] + plinth.size[2] / 2)).toBeGreaterThanOrEqual(0.04 - 1e-9);
  });

  it('a shelf board is 18 mm until the piece is too small for it', () => {
    expect(shelfBoard([800, 350, 800])).toBeCloseTo(0.018, 12);
    expect(shelfBoard([1800, 450, 2000])).toBeCloseTo(0.018, 12);
    expect(shelfBoard([300, 200, 300])).toBeCloseTo(0.015, 12);
    expect(box(openShelfForm([2400, 600, 2400], false), 'board-0').size[1]).toBeCloseTo(0.018, 9);
  });

  it('slat rails are 40 mm and the backing 12 mm, each capped by the piece', () => {
    expect(slatRail(2000)).toBeCloseTo(0.04, 12);
    expect(slatRail(2800)).toBeCloseTo(0.04, 12);
    expect(slatRail(300)).toBeCloseTo(0.015, 12);
    expect(slatBacking(40)).toBeCloseTo(0.012, 12);
    expect(slatBacking(15)).toBeCloseTo(0.0045, 12);
  });

  it('a pull stands inside the declared depth, never past it', () => {
    for (const dim of sizes('drawer-unit')) {
      const pull = box(drawerUnitForm(dim, true), 'pull-0');
      expect(pull.pos[2] + pull.size[2] / 2).toBeLessThanOrEqual(dim[1] / 2000 + SLACK);
    }
  });
});

describe('an option does what its name says', () => {
  it('a worktop on legs has four, on panels two, and on none is the slab alone', () => {
    for (const dim of sizes('worktop')) {
      const legs = worktopForm(dim, 'legs');
      expect(named(legs, 'leg-'), `legs at ${dim}`).toHaveLength(4);
      expect(legs, 'slab and four legs').toHaveLength(5);
      const panels = worktopForm(dim, 'panel');
      expect(named(panels, 'panel-'), `panels at ${dim}`).toHaveLength(2);
      expect(panels).toHaveLength(3);
      expect(worktopForm(dim, 'none').map((p) => p.key), `none at ${dim}`).toEqual(['top']);
    }
  });

  it('legs are slim, square and inset; panels are full depth', () => {
    const [w, d, h] = [1200, 600, 750].map((v) => v / 1000);
    const legs = named(worktopForm([1200, 600, 750], 'legs'), 'leg-').map((p) => box([p], p.key));
    for (const l of legs) {
      expect(l.size[0], 'square').toBeCloseTo(l.size[2], 9);
      expect(l.size[0], 'slim').toBeLessThanOrEqual(0.04 + 1e-9);
      expect(Math.abs(l.pos[0]) + l.size[0] / 2, 'inset from the end').toBeLessThan(w / 2 - 0.04);
      expect(Math.abs(l.pos[2]) + l.size[2] / 2, 'inset from the face').toBeLessThan(d / 2 - 0.04);
      expect(l.pos[1] - l.size[1] / 2, 'on the floor').toBeCloseTo(0, 9);
      expect(l.pos[1] + l.size[1] / 2, 'under the slab').toBeCloseTo(h - 0.025, 9);
    }
    for (const p of named(worktopForm([1200, 600, 750], 'panel'), 'panel-')) {
      const b = box([p], p.key);
      expect(b.size[2], 'full depth, to within a trim').toBeGreaterThan(d - 0.03);
    }
  });

  it('a screen draws its glass only when there is a band, frosted or clear as asked', () => {
    expect(screenForm([1200, 30, 1100], 'none').glass).toEqual([]);
    expect(screenForm([1200, 30, 1100], 'none').parts.some((p) => p.key === 'rail-mid')).toBe(false);
    expect(screenForm([1200, 30, 1100], 'frosted').glass.map((g) => g.kind)).toEqual(['frosted']);
    expect(screenForm([1200, 30, 1100], 'glass').glass.map((g) => g.kind)).toEqual(['clear']);
    expect(screenForm([1200, 30, 1100], 'glass').parts.some((p) => p.key === 'rail-mid')).toBe(true);
    // The board is the piece's colour; the frame is not.
    expect(box(screenForm([1200, 30, 1100], 'frosted').parts, 'board').tone).toBe('body');
    // With no band the board runs to the top rail, so none of the box is empty frame.
    const flush = screenForm([1200, 30, 1100], 'none').parts;
    const board = box(flush, 'board');
    expect(board.pos[1] + board.size[1] / 2).toBeCloseTo(1.1 - 0.02, 9);
  });

  it('the glass band sits inside the frame, thinner than it, and never meets the floor', () => {
    for (const dim of sizes('screen')) {
      for (const g of screenForm(dim, 'frosted').glass) {
        expect(g.z1 - g.z0, `glass thickness at ${dim}`).toBeLessThan(dim[1] / 1000);
        expect(g.y0).toBeGreaterThan(0);
        expect(g.x0).toBeGreaterThan(-dim[0] / 2000);
        expect(g.x1).toBeLessThan(dim[0] / 2000);
      }
    }
  });

  it('a drawer unit has a brass lock on its top drawer only when `lock` is on', () => {
    for (const dim of sizes('drawer-unit')) {
      const on = drawerUnitForm(dim, true);
      const off = drawerUnitForm(dim, false);
      const lock = on.find((p) => p.key === 'lock');
      expect(lock, `lock at ${dim}`).toBeDefined();
      expect(lock!.tone, 'the lock is metal, from the palette, not a literal').toBe('brass');
      expect(off.some((p) => p.key === 'lock'), `no lock at ${dim}`).toBe(false);
      expect(on.length - off.length).toBe(1);
      // On the top front, not on the carcass.
      const top = box(on, `front-${drawerCount(dim[2]) - 1}`);
      const { lo, hi } = reach(lock!);
      expect(lo[1]).toBeGreaterThanOrEqual(top.pos[1] - top.size[1] / 2 - SLACK);
      expect(hi[1]).toBeLessThanOrEqual(top.pos[1] + top.size[1] / 2 + SLACK);
    }
  });

  it('an open shelf has a back panel only when asked, and the cubbies stay open from the front', () => {
    for (const dim of sizes('open-shelf')) {
      expect(openShelfForm(dim, true).some((p) => p.key === 'back'), `back at ${dim}`).toBe(true);
      expect(openShelfForm(dim, false).some((p) => p.key === 'back'), `no back at ${dim}`).toBe(false);
      const back = box(openShelfForm(dim, true), 'back');
      expect(back.pos[2], 'in the rear').toBeLessThan(0);
      expect(back.size[2], 'a thin panel, not a block').toBeLessThanOrEqual(0.006 + 1e-9);
    }
  });

  it('a door cabinet has a plinth only when asked, and stands on the floor without one', () => {
    for (const dim of sizes('door-cabinet')) {
      const withKick = doorCabinetForm(dim, true);
      const without = doorCabinetForm(dim, false);
      expect(withKick.some((p) => p.key === 'plinth'), `plinth at ${dim}`).toBe(true);
      expect(without.some((p) => p.key === 'plinth'), `none at ${dim}`).toBe(false);
      const carcass = box(without, 'carcass');
      expect(carcass.pos[1] - carcass.size[1] / 2, 'on the floor').toBeCloseTo(0, 9);
      const raised = box(withKick, 'carcass');
      expect(raised.pos[1] - raised.size[1] / 2, 'on the plinth').toBeCloseTo(cabinetPlinth(dim[2]), 9);
    }
  });

  it('a slat panel is see-through unless backed, and a backing sits behind the slats', () => {
    for (const dim of sizes('slat-panel')) {
      const open = slatPanelForm(dim, false);
      const backed = slatPanelForm(dim, true);
      expect(open.some((p) => p.key === 'backing'), `open at ${dim}`).toBe(false);
      const backing = box(backed, 'backing');
      for (const s of named(backed, 'slat-')) {
        expect(reach(s).lo[2], `slat in front of the backing at ${dim}`).toBeGreaterThanOrEqual(reach(backing).hi[2] - SLACK);
      }
      // See-through: the gaps between slats are really gaps, which is the width share.
      const slats = named(open, 'slat-').map((p) => box([p], p.key));
      const covered = slats.reduce((sum, s) => sum + s.size[0], 0);
      expect(covered / (dim[0] / 1000), `slats cover 60% of the width at ${dim}`).toBeCloseTo(0.6, 9);
    }
  });

  it('a seat pad is one cushion filling its box', () => {
    for (const dim of sizes('seat-pad')) {
      const { top } = seatPadForm(dim);
      expect(top.size).toEqual([dim[0] / 1000, dim[2] / 1000, dim[1] / 1000]);
      expect(top.pos).toEqual([0, dim[2] / 2000, 0]);
    }
  });

  it('every combination draws, with no two parts sharing a key', () => {
    for (const shape of BLOCK_SHAPES) {
      for (const dim of sizes(shape)) {
        for (const style of styles(shape)) {
          const keys = formOf(shape, dim, style).parts.map((p) => p.key);
          expect(new Set(keys).size, `${shape} ${JSON.stringify(style)} at ${dim} repeats a key`).toBe(keys.length);
        }
      }
    }
  });
});

describe('a scene file carries the choice', () => {
  const ROOM: RoomData = {
    id: 'room-1', createdAt: 1_700_000_000_000, name: 'Studio', layoutId: 'rect', width: 5, depth: 4, height: 2.6,
  };
  const NO_TRANSFORMS: Transforms = { positions: {}, rotations: {}, dims: {} };
  const part = (shape: BlockShape, over: Partial<ScenePart> = {}): ScenePart => ({
    id: `${shape}-1`,
    category: row(shape).category,
    name: row(shape).label,
    shape,
    pos: [0, 0, 0],
    rot: 0,
    dimMM: row(shape).dimMM,
    locked: false,
    ...over,
  });
  const raw = (parts: unknown[]) =>
    JSON.stringify({
      format: 'danmu.scene', version: 1, exportedAt: 1,
      room: { name: 'R', layoutId: 'rect', width: 5, depth: 4, height: 2.6 },
      parts,
    });

  it('writes blockStyle and reads it back, for every block and every option', () => {
    const chosen: ScenePart[] = [
      part('worktop', { blockStyle: { ends: 'panel' } }),
      part('screen', { blockStyle: { band: 'glass' } }),
      part('drawer-unit', { blockStyle: { lock: false } }),
      part('open-shelf', { blockStyle: { back: false } }),
      part('door-cabinet', { blockStyle: { plinth: false } }),
      part('slat-panel', { blockStyle: { backing: true } }),
      part('seat-pad'),
    ];
    const text = sceneFileJson(buildSceneFile(ROOM, chosen, NO_TRANSFORMS, 1));
    expect(text).toContain('"blockStyle"');
    const out = parseSceneFile(text);
    if (!out.ok) throw new Error(out.error);
    expect(out.dropped).toEqual([]);
    expect(out.file.parts.map((p) => p.blockStyle)).toEqual(chosen.map((p) => p.blockStyle));
    // …and it survives the split back into the stores' shapes.
    const { parts } = sceneFileToRoom(out.file);
    expect(parts.map((p) => p.blockStyle)).toEqual(chosen.map((p) => p.blockStyle));
  });

  it('a part that made no choice stores none, and the file stays free of the key', () => {
    const text = sceneFileJson(buildSceneFile(ROOM, [part('worktop')], NO_TRANSFORMS, 1));
    expect(text).not.toContain('blockStyle');
    const out = parseSceneFile(text);
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts[0].blockStyle).toBeUndefined();
    expect(blockStyleFor(out.file.parts[0].shape, out.file.parts[0].blockStyle)).toEqual({ ends: 'legs' });
  });

  it('drops a value outside its vocabulary, keeps the rest, and says so', () => {
    const out = parseSceneFile(
      raw([
        { ...part('worktop'), blockStyle: { ends: 'sideways' } },
        { ...part('screen'), id: 's', blockStyle: { band: 'glass', lock: true } },
        { ...part('drawer-unit'), id: 'd', blockStyle: { lock: 'yes' } },
      ]),
    );
    if (!out.ok) throw new Error(out.error);
    // A part keeps whatever of its options was legal, and none at all when none was.
    expect(out.file.parts.map((p) => p.blockStyle)).toEqual([undefined, { band: 'glass' }, undefined]);
    expect(out.dropped).toHaveLength(3);
    expect(out.dropped[0]).toContain('Worktop');
    expect(out.dropped[0]).toContain('ends');
    expect(out.dropped[0]).toContain('"sideways"');
    expect(out.dropped[0]).toContain('legs, panel, none');
    expect(out.dropped[1]).toContain('lock');
    expect(out.dropped[2]).toContain('true or false');
  });

  it('refuses options on a piece that is no block, and options that are not a set of choices', () => {
    const out = parseSceneFile(
      raw([
        { id: 'sofa', category: 'sofa', name: 'Sofa', shape: 'sofa', pos: [0, 0, 0], rot: 0, dimMM: [2200, 950, 880], locked: false, blockStyle: { ends: 'legs' } },
        { ...part('seat-pad'), id: 'pad', blockStyle: { ends: 'legs' } },
        { ...part('worktop'), id: 'w', blockStyle: 'legs' },
        { ...part('worktop'), id: 'w2', blockStyle: ['legs'] },
      ]),
    );
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts.every((p) => p.blockStyle === undefined)).toBe(true);
    expect(out.dropped).toHaveLength(4);
    expect(out.dropped[0]).toContain('Sofa');
    expect(out.dropped[1]).toContain('Seat pad');
  });

  it('still clamps the size of a block like any other piece', () => {
    // A file's size is a hint, blocks included.
    const out = parseSceneFile(raw([{ ...part('screen'), dimMM: [9000, 900, 9000], blockStyle: { band: 'none' } }]));
    if (!out.ok) throw new Error(out.error);
    expect(out.file.parts[0].dimMM).toEqual(range('screen').max);
    expect(out.file.parts[0].blockStyle).toEqual({ band: 'none' });
  });
});

type ModuleRange0 = { min: number; nominal: number; max: number };

describe('where a block goes in a room', () => {
  const asPart = (shape: BlockShape, over: Partial<ScenePart> = {}): ScenePart => ({
    id: `${shape}-x`, category: row(shape).category, name: shape, shape,
    pos: [0, 0, 0], rot: 0, dimMM: row(shape).dimMM, locked: false, ...over,
  });
  const ROOM = { width: 5, depth: 4, height: 2.8 };

  it('every block stands on the floor, and every obstacle has a role that is not `other`', () => {
    for (const s of BLOCK_SHAPES) {
      expect(anchorFor(row(s).category, s), s).toBe('floor');
      if (isObstacle(asPart(s))) expect(roleOf(asPart(s)), `${s} blocks the floor`).not.toBe('other');
    }
    expect(roleOf(asPart('worktop'))).toBe('desk');
    expect(roleOf(asPart('screen'))).toBe('partition');
    expect(roleOf(asPart('slat-panel'))).toBe('partition');
    expect(roleOf(asPart('drawer-unit'))).toBe('cabinet');
    expect(roleOf(asPart('door-cabinet'))).toBe('cabinet');
    expect(roleOf(asPart('open-shelf'))).toBe('bookshelf');
    expect(roleOf(asPart('seat-pad'))).toBe('other');
    expect(isObstacle(asPart('seat-pad')), 'a cushion is no obstacle').toBe(false);
  });

  it('a seat pad dropped over a door cabinet lands on its top', () => {
    const cab = asPart('door-cabinet', { id: 'cab', pos: [0, 0, 0] });
    const pad = row('seat-pad');
    const at = placeNewPart(pad.category, pad.shape, pad.dimMM, ROOM, [cab], [0, 0]);
    expect(at.supportId).toBe('cab');
    expect(at.pos[1]).toBeCloseTo(row('door-cabinet').dimMM[2] / 1000, 6);
  });
});
