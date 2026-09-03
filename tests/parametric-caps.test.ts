import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  consoleSlabs,
  doorHandleY,
  drawerSlide,
  fanColumn,
  isParametric,
  moduleRangeFor,
  pendantDrop,
  radiatorFins,
  stoolSeat,
  windowPanes,
  FAN_HUB_H,
  MODULE_RANGE,
  PART_LIBRARY,
  SHAPES,
  type Shape,
} from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';

// § 36 — an absolute inside a non-parametric renderer cannot survive a group scale.
//
// `ShapeDispatch` hands a NON-parametric shape its AUTHORED `dimMM`, and `Draggable`
// then scales the whole group by `storedDim / dimMM`, per axis. A **proportion of the
// declared size** survives that untouched. An **absolute** does not: it is chosen
// before the scale exists and never sees it.
//
// The class has two faces and the second was missed on the first sweep:
//
//   a CAP      `min(FAN_HUB_H, h * 0.4)`     — a motor is a real object
//   a MODULE   `max(1, round(w / 0.7))`      — a pane is a real width
//
// Both are an absolute chosen at one size. A cap is then stretched past itself; a
// count is frozen and its members stretched instead. `fan` and `lamp-pendant` were
// found by review, `tv-console` / `stool` / `nightstand` / `door` by grepping for the
// first form, and `window` / `radiator` only by a second review asking what else had
// the second. That progression is why this file ends with a completeness sweep rather
// than a list.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

/** The catalogue size a shape ships at, read from `PART_LIBRARY` rather than typed.
 *
 *  Typed literals were the first version, and they were a second source of truth for
 *  the one fact this file is about. Worse than usual here, because the table below is
 *  PRINTED on every green run and quoted in `docs/what-is-still-open.md`: retune a
 *  catalogue size and the literals go on agreeing with each other while the report
 *  describes a piece the app no longer ships, green. */
function authoredDim(shape: Shape): [number, number, number] {
  const item = PART_LIBRARY.find((i) => i.shape === shape);
  if (!item) throw new Error(`no catalogue entry for ${shape} — this table is out of date`);
  return item.dimMM;
}

/** …and its category from the same row, so `dimRangeFor` is asked the question the app
 *  asks. Hand-typing this was decoration: every shape here has a `BY_SHAPE` row, so
 *  `dimRangeFor` never consults the category and a wrong one changed nothing. */
function authoredCategory(shape: Shape) {
  const item = PART_LIBRARY.find((i) => i.shape === shape);
  if (!item) throw new Error(`no catalogue entry for ${shape}`);
  return item.category;
}

type CapRow = {
  shape: Shape;
  /** Which `dimMM` axis the absolute is read off. */
  axis: 0 | 1 | 2;
  /** The quantity that DISTORTS — what a group scale would multiply. **In METRES**,
   *  like every other length in the geometry helpers, and stated because the two
   *  module rows read a width in millimetres and divided by a count: they printed
   *  `1600000.0 mm` for a window pane before this line existed. The ratios were
   *  right either way — a unit error cancels in a quotient — which is exactly why
   *  only the printed table showed it. */
  read: (mm: number) => number;
  what: string;
};

/** Every absolute-bearing helper, and the axis it reads.
 *
 *  `read` returns the quantity a group scale would multiply, which is not always what
 *  the helper returns: for a module count the distorted quantity is the module's own
 *  width (`mm / count`), not the count, and reading the count instead reports the row
 *  inert. The rule is "what does the user watch get bigger". */
const CAPS: CapRow[] = [
  { shape: 'fan', axis: 2, read: (mm) => fanColumn(mm).hubH, what: 'the motor housing' },
  {
    shape: 'lamp-pendant', axis: 2,
    read: (mm) => pendantDrop(authoredDim('lamp-pendant')[0], mm).domeH,
    what: 'the shade',
  },
  { shape: 'tv-console', axis: 2, read: (mm) => consoleSlabs(mm).top, what: 'the top slab' },
  { shape: 'tv-console', axis: 2, read: (mm) => consoleSlabs(mm).foot, what: 'the plinth' },
  { shape: 'stool', axis: 2, read: stoolSeat, what: 'the seat pad' },
  { shape: 'nightstand', axis: 1, read: drawerSlide, what: 'the drawer slide' },
  { shape: 'door', axis: 2, read: doorHandleY, what: 'the handle height' },
  { shape: 'window', axis: 0, read: (mm) => mm / 1000 / windowPanes(mm), what: 'the pane width' },
  { shape: 'radiator', axis: 0, read: (mm) => mm / 1000 / radiatorFins(mm), what: 'the fin pitch' },
];

/** Worst disagreement between drawing at the stored size and drawing at the authored
 *  size then scaling, over a row's whole band.
 *
 *  **Both directions**, because the class has a floor form as well as a cap form:
 *  `max(absolute, k·mm)` violates by drawing too SMALL, and a one-sided `drawn/honest`
 *  reports that as inert — which tells the next reader to delete the row when the right
 *  action is the opposite one. Sampled across the band rather than at its ends, because
 *  a count is a STEP function whose worst case sits wherever `round` last flipped. */
function worstRatio(row: CapRow): number {
  const band = dimRangeFor(authoredCategory(row.shape), row.shape);
  const authored = authoredDim(row.shape)[row.axis];
  const lo = band.min[row.axis];
  const hi = band.max[row.axis];
  let worst = 1;
  for (let k = 0; k <= 40; k++) {
    const mm = lo + ((hi - lo) * k) / 40;
    const honest = row.read(mm);
    if (honest <= 0) continue;
    const drawn = row.read(authored) * (mm / authored);
    if (drawn <= 0) continue;
    worst = Math.max(worst, drawn / honest, honest / drawn);
  }
  return worst;
}

describe('an absolute is violated by a group scale, so its shape must be parametric', () => {
  it('the ceiling fan: a taller fan draws a thicker motor than its own cap allows', () => {
    const authoredH = authoredDim('fan')[2];
    const storedH = dimRangeFor('fan', 'fan').max[2];
    const drawn = fanColumn(authoredH).hubH * (storedH / authoredH);
    const honest = fanColumn(storedH).hubH;

    expect(honest, 'the cap binds at the top of the band').toBeCloseTo(FAN_HUB_H, 9);
    expect(drawn, 'and a group scale walks straight through it').toBeGreaterThan(honest);
    expect(drawn / honest).toBeCloseTo(2.25, 6);
    expect(isParametric('fan')).toBe(true);
  });

  it('the pendant lamp: a narrow, long drop draws a shade four times its cap', () => {
    const [authoredW, , authoredH] = authoredDim('lamp-pendant');
    const band = dimRangeFor('lamp', 'lamp-pendant');
    // Narrowest and longest, both legal — the shade's cap is against its own WIDTH, so
    // exposing the worst of it takes the two axes moving in opposite directions, which
    // is why the per-axis sweep below reads this row milder.
    const storedW = band.min[0];
    const storedH = band.max[2];
    const authored = pendantDrop(authoredW, authoredH);
    const drawnDomeH = authored.domeH * (storedH / authoredH);
    const drawnDomeR = authored.domeR * (storedW / authoredW);
    const honest = pendantDrop(storedW, storedH);

    expect(honest.domeH, "the helper's own cap is the width one at this size")
      .toBeCloseTo(honest.domeR * 1.2, 9);
    expect(drawnDomeH, 'and the group scale draws a shade far past it')
      .toBeGreaterThan(drawnDomeR * 1.2);
    expect(drawnDomeH).toBeCloseTo(0.36, 6);
    expect(honest.domeH).toBeCloseTo(0.09, 6);
    expect(isParametric('lamp-pendant')).toBe(true);
  });

  it('the extent is unharmed either way, which is why no size test could see this', () => {
    // § 34's claim still holds: `top - bottom` is a pure proportion of the declared
    // height, so it scales correctly and every assertion about a piece's SIZE stayed
    // green. A proportion defect inside a correct extent is why a catalogue sweep could
    // not see this one.
    //
    // Swept rather than asserted at a single size: the first version checked
    // `fanColumn` at exactly 450 mm, and `docs/visual-check.md` was quoting it as
    // holding "for every shape".
    const fband = dimRangeFor('fan', 'fan');
    for (let mm = fband.min[2]; mm <= fband.max[2]; mm += 25) {
      const g = fanColumn(mm);
      expect(g.top - g.bottom, `fan at ${mm} mm`).toBeCloseTo(mm / 1000, 9);
    }
    const pband = dimRangeFor('lamp', 'lamp-pendant');
    for (let mm = pband.min[2]; mm <= pband.max[2]; mm += 50) {
      const g = pendantDrop(350, mm);
      expect(g.top - g.bottom, `pendant at ${mm} mm`).toBeCloseTo(mm / 1000, 9);
    }
  });
});

describe('every absolute-bearing helper in the catalogue', () => {
  it('has a table that is not empty, so the assertions below mean something', () => {
    // Measured: the whole of this describe was per-row, so `CAPS = []` passed every
    // assertion in it. A gate that exists to stop a class recurring has to notice first
    // that it has been emptied.
    expect(CAPS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(CAPS.map((r) => r.shape)).size, 'distinct shapes covered').toBeGreaterThanOrEqual(8);
  });

  it('really is distorted by a group scale, at some legal size', () => {
    // The premise. A row whose absolute never binds anywhere in its band is a
    // proportion wearing a `min()` and does not belong here — that is a finding, not a
    // pass.
    const inert = CAPS.filter((row) => worstRatio(row) <= 1 + 1e-9).map((r) => `${r.shape} · ${r.what}`);
    expect(inert, 'an absolute that never binds is a proportion in disguise').toEqual([]);
  });

  it('and therefore every one of their shapes is parametric', () => {
    expect.assertions(CAPS.length);
    for (const row of CAPS) {
      expect(
        isParametric(row.shape),
        `${row.shape}: ${row.what} is chosen against an absolute, so its geometry owns its size`,
      ).toBe(true);
    }
  });

  it('reports how far each was out, and pins that the report is not a table of zeroes', () => {
    // Printed on every green run (the `detect-pipeline` precedent) because the SHAPE of
    // the class is the interesting thing, not the boolean. Asserted as well as printed:
    // the first version's only assertion was `rows.length === CAPS.length`, which
    // `Array.prototype.map` cannot make false — so the numbers quoted in
    // `docs/what-is-still-open.md` were coming off an ungated table.
    const out: string[] = [];
    for (const row of CAPS) {
      const band = dimRangeFor(authoredCategory(row.shape), row.shape);
      const authored = authoredDim(row.shape)[row.axis];
      const at = band.max[row.axis];
      const drawn = row.read(authored) * (at / authored);
      const honest = row.read(at);
      expect(honest, `${row.shape} · ${row.what}: nothing to compare against`).toBeGreaterThan(0);
      expect(Number.isFinite(drawn / honest), `${row.shape} · ${row.what}`).toBe(true);
      out.push(
        '  ' + `${row.shape} · ${row.what}`.padEnd(32) +
        String(authored).padStart(5) + ' → ' + String(at).padStart(5) + ' mm   ' +
        'drawn ' + (drawn * 1000).toFixed(1).padStart(7) + '   ' +
        'honest ' + (honest * 1000).toFixed(1).padStart(7) + '   worst ' +
        worstRatio(row).toFixed(2) + 'x',
      );
    }
    console.log('\n  § 36 — what a group scale did to each absolute-bearing detail\n' + out.join('\n') + '\n');
    expect(out.length).toBe(CAPS.length);
  });
});

describe('completeness — because a list cannot notice what is missing from it', () => {
  it('every parametric shape either tiles or is in the cap table', () => {
    // A member of `PARAMETRIC_SHAPES` is there for one of exactly two reasons. Anything
    // in neither is a shape somebody added without recording why, which is the state
    // that set was in before this file existed.
    const capped = new Set(CAPS.map((r) => r.shape));
    const unexplained = SHAPES.filter((s) => isParametric(s) && !moduleRangeFor(s) && !capped.has(s));
    expect(unexplained, 'parametric for no recorded reason').toEqual([]);
  });

  it('and every shape in the cap table is parametric — the other direction', () => {
    const notParametric = [...new Set(CAPS.map((r) => r.shape))].filter((s) => !isParametric(s));
    expect(notParametric).toEqual([]);
  });

  it('every MODULE_RANGE shape is parametric, which is the tiling half', () => {
    // Restated from `tests/module-tiling.test.ts` deliberately: that file sweeps the
    // ranges, this one sweeps the set, and they meet here so a shape cannot fall
    // between them.
    for (const shape of Object.keys(MODULE_RANGE) as Shape[]) {
      expect(isParametric(shape), `${shape} tiles but is not parametric`).toBe(true);
    }
  });

  it('no NON-parametric renderer still chooses an absolute a group scale would stretch', () => {
    // A regex over source, and the exception is named rather than assumed. The data
    // genuinely lives in `DynamicPart.tsx` — that is the defect — and the point is to
    // catch the NEXT one written there, which no import can do. Same shape as
    // `tests/color-tokens.test.ts`, which reads `globals.css` because that is where the
    // values are.
    //
    // The filter that makes it meaningful is WHOSE renderer the absolute sits in. An
    // absolute inside a parametric shape is fine — that shape is handed the effective
    // dim and drawn at scale 1, so its constants are chosen against the size actually
    // being rendered. `SofaGeo`'s `min(0.18, w * 0.12)` armrest is the same expression
    // as the ones this branch moved, and has never been a defect for exactly that
    // reason. So each hit is mapped to its enclosing renderer, and the renderer to the
    // shapes whose `case` arms return it — read out of the dispatch rather than typed.
    const src = readFileSync('components/three/DynamicPart.tsx', 'utf8');
    const lines = src.split('\n');

    /** renderer -> the shapes dispatched to it, straight out of the switch. */
    const shapesFor = new Map<string, string[]>();
    for (const m of src.matchAll(/case '([^']+)':\s*\n\s*return <(\w+)/g)) {
      shapesFor.set(m[2], [...(shapesFor.get(m[2]) ?? []), m[1]]);
    }
    expect(shapesFor.size, 'the dispatch was not parsed').toBeGreaterThan(20);

    /** Which renderer a line sits inside. */
    const ownerOf = (line: number): string => {
      for (let i = line - 1; i >= 0; i--) {
        const m = /^(?:export )?function (\w+)\(/.exec(lines[i]);
        if (m) return m[1];
      }
      return '(module scope)';
    };

    /** Absolutes that are NOT this class, each with its reason. */
    const ALLOWED = [
      // A floor below the whole legal band: `tv`'s depth range starts at 40 mm, so this
      // can never bind and so never distorts. Kept because a zero-depth panel out of a
      // malformed import would still be nonsense.
      'const d = Math.max(0.03, part.dimMM[1] / 1000);',
      // Colour arithmetic, not geometry — a byte clamp inside `shade()`.
      'const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * 255)));',
    ];

    const unexplained: string[] = [];
    for (const m of src.matchAll(/Math\.(min|max)\(\s*[\d.]+\s*,/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      const text = lines[line - 1].trim();
      if (ALLOWED.includes(text)) continue;
      const owner = ownerOf(line);
      const shapes = shapesFor.get(owner) ?? [];
      // An unmapped renderer cannot be judged, so it is REPORTED rather than skipped:
      // a geometry function nothing dispatches to is itself worth a look.
      if (shapes.length > 0 && shapes.every((sh) => isParametric(sh as Shape))) continue;
      unexplained.push(`DynamicPart.tsx:${line}  [${owner} -> ${shapes.join(', ') || '?'}]  ${text}`);
    }
    expect(
      unexplained,
      'an absolute in a NON-parametric renderer is § 36 — move it to lib/ and make its shape parametric, or add it to ALLOWED with a reason',
    ).toEqual([]);
  });
});
