import { describe, expect, it } from 'vitest';
import {
  consoleSlabs,
  doorHandleY,
  drawerSlide,
  fanColumn,
  pendantDrop,
  isParametric,
  stoolSeat,
  FAN_HUB_H,
  type Category,
  type Shape,
} from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';

// § 36 — a cap that is not a proportion cannot survive a group scale.
//
// `ShapeDispatch` hands a NON-parametric shape its AUTHORED `dimMM`, and `Draggable`
// then scales the whole group by `storedDim / dimMM`, per axis. Anything inside the
// geometry that is a **proportion of the declared size** survives that untouched.
// Anything that is an **absolute metre constant** does not: it is chosen before the
// scale exists and never sees it.
//
// Both helpers here cap a part against an absolute, and both caps are the thing that
// stops the shape becoming a spike:
//
//   fanColumn:   hubH  = min(FAN_HUB_H, h * 0.4)     — a motor is a real object
//   pendantDrop: domeH = min(h * 0.4,  r * 1.2)      — a shade is not a funnel
//
// So the invariant is not about these two shapes, it is about the CLASS: if drawing a
// shape at its authored size and scaling gives a different answer from drawing it at
// its stored size, the geometry owns its size and the shape must be parametric.
// `tests/module-tiling.test.ts` holds the other direction — a shape with a
// `MODULE_RANGE` must be parametric — and this holds the direction that has no table.

/** The catalogue sizes these shapes ship at. Both helpers read `dimMM` and nothing
 *  else, so the authored dim is the whole of what a non-parametric render is given. */
const AUTHORED: Partial<Record<Shape, [number, number, number]>> = {
  fan: [1000, 1000, 200],
  'lamp-pendant': [350, 350, 400],
};

describe('a geometry cap is violated by a group scale, so its shape must be parametric', () => {
  it('the ceiling fan: a taller fan draws a thicker motor than its own cap allows', () => {
    const [, , authoredH] = AUTHORED.fan!;
    const band = dimRangeFor('fan', 'fan');
    const storedH = band.max[2];
    // What the app DRAWS today for a non-parametric shape: the helper at the authored
    // size, then the whole group scaled on the height axis.
    const scale = storedH / authoredH;
    const drawn = fanColumn(authoredH).hubH * scale;
    // What the helper says the answer is at that size.
    const honest = fanColumn(storedH).hubH;

    expect(honest, 'the cap binds at the top of the band').toBeCloseTo(FAN_HUB_H, 9);
    expect(drawn, 'and a group scale walks straight through it').toBeGreaterThan(honest);
    // Not a rounding: 450 mm against a 200 mm authored height is 2.25x.
    expect(drawn / honest).toBeCloseTo(2.25, 6);
    expect(
      isParametric('fan'),
      'a shape whose geometry has an absolute cap must rebuild from the current dim',
    ).toBe(true);
  });

  it('the pendant lamp: a narrow, long drop draws a shade four times its cap', () => {
    const [authoredW, , authoredH] = AUTHORED['lamp-pendant']!;
    const band = dimRangeFor('lamp', 'lamp-pendant');
    // Narrowest and longest, both inside the band — the shade's cap is against its own
    // WIDTH, so the two axes have to move in opposite directions to expose it.
    const storedW = band.min[0];
    const storedH = band.max[2];
    const sx = storedW / authoredW;
    const sy = storedH / authoredH;

    const authored = pendantDrop(authoredW, authoredH);
    const drawnDomeH = authored.domeH * sy;
    const drawnDomeR = authored.domeR * sx;
    const honest = pendantDrop(storedW, storedH);

    expect(honest.domeH, "the helper's own cap is the width one at this size")
      .toBeCloseTo(honest.domeR * 1.2, 9);
    expect(drawnDomeH, 'and the group scale draws a shade far past it')
      .toBeGreaterThan(drawnDomeR * 1.2);
    // 150 x 900 against an authored 350 x 400: the drawn shade is 360 mm where the cap
    // asks for 90.
    expect(drawnDomeH).toBeCloseTo(0.36, 6);
    expect(honest.domeH).toBeCloseTo(0.09, 6);
    expect(
      isParametric('lamp-pendant'),
      'a shape whose geometry has an absolute cap must rebuild from the current dim',
    ).toBe(true);
  });

  it('the extent is unharmed either way, which is why no size test could see this', () => {
    // § 34's claim still holds: `top - bottom` is a pure proportion of the declared
    // height, so it scales correctly and every assertion about a piece's SIZE stays
    // green. This is a proportion defect living inside a correct extent, which is
    // exactly why it survived a catalogue sweep.
    const [, , ah] = AUTHORED.fan!;
    const stored = 450;
    const a = fanColumn(ah);
    expect((a.top - a.bottom) * (stored / ah)).toBeCloseTo(stored / 1000, 9);
    const h = fanColumn(stored);
    expect(h.top - h.bottom).toBeCloseTo(stored / 1000, 9);
  });
});

// ─── the class, rather than its two loudest members ────────────────────────
//
// Each row is a shape whose geometry contains a `min(absolute, proportion)`, the
// axis that cap is read off, and the reading itself. The property swept below is
// the one that makes the whole set necessary:
//
//     helper(storedDim)  !=  helper(authoredDim) x (storedDim / authoredDim)
//
// One axis at a time, which makes the printed ratios a LOWER bound rather than the
// worst case. The pendant reads 1.71x here and 4x in its own test above, and both are
// right: its shade is capped against its own WIDTH, so exposing the worst of it takes
// the two axes moving in opposite directions — narrowest and longest — which a
// per-axis sweep cannot express. Where a row's ratio looks mild, check whether its cap
// reads a different axis from the one being swept before believing it.
//
// The right-hand side is what a NON-parametric shape draws — the helper at its
// authored size, then the whole group scaled. When the two disagree, the geometry
// owns its size and the shape must be parametric. Written as a sweep because
// choosing examples is exactly how the first version of this file missed four of the
// six shapes: the fan and the pendant were found by review, and `tv-console`,
// `stool`, `nightstand` and `door` only turned up when someone grepped for the
// SHAPE of the bug rather than for its symptom.
type CapRow = {
  shape: Shape;
  category: Category;
  authored: [number, number, number];
  /** Which `dimMM` axis the cap is read off. */
  axis: 0 | 1 | 2;
  read: (mm: number) => number;
  what: string;
};

const CAPS: CapRow[] = [
  { shape: 'fan', category: 'fan', authored: [1000, 1000, 200], axis: 2,
    read: (mm) => fanColumn(mm).hubH, what: 'the motor housing' },
  { shape: 'lamp-pendant', category: 'lamp', authored: [350, 350, 400], axis: 2,
    read: (mm) => pendantDrop(350, mm).domeH, what: 'the shade' },
  { shape: 'tv-console', category: 'shelf', authored: [1600, 400, 500], axis: 2,
    read: (mm) => consoleSlabs(mm).top, what: 'the top slab' },
  { shape: 'tv-console', category: 'shelf', authored: [1600, 400, 500], axis: 2,
    read: (mm) => consoleSlabs(mm).foot, what: 'the plinth' },
  { shape: 'stool', category: 'chair', authored: [350, 350, 450], axis: 2,
    read: stoolSeat, what: 'the seat pad' },
  { shape: 'nightstand', category: 'nightstand', authored: [450, 400, 550], axis: 1,
    read: drawerSlide, what: 'the drawer slide' },
  { shape: 'door', category: 'door', authored: [900, 50, 2100], axis: 2,
    read: doorHandleY, what: 'the handle height' },
];

describe('every capped helper in the catalogue', () => {
  it('has a cap a group scale would walk through, at some legal size', () => {
    // The premise of the whole file. If a row's cap never binds anywhere in its band,
    // it is a proportion wearing a `min`, and it does not belong in this table — that
    // is a finding, not a pass.
    const inert: string[] = [];
    for (const row of CAPS) {
      const band = dimRangeFor(row.category, row.shape);
      const authored = row.authored[row.axis];
      let worst = 1;
      for (const mm of [band.min[row.axis], authored, band.max[row.axis]]) {
        const drawn = row.read(authored) * (mm / authored);
        const honest = row.read(mm);
        if (honest > 0) worst = Math.max(worst, drawn / honest);
      }
      if (worst <= 1 + 1e-9) inert.push(row.shape + ' / ' + row.what);
    }
    expect(inert, 'a cap that never binds is a proportion wearing a min()').toEqual([]);
  });

  it('and therefore every one of their shapes is parametric', () => {
    for (const row of CAPS) {
      expect(
        isParametric(row.shape),
        row.shape + ': ' + row.what + ' is capped against an absolute, so its geometry owns its size',
      ).toBe(true);
    }
  });

  it('reports how far each one was out, so the table is not just a pass', () => {
    // The `detect-pipeline` precedent: printed on every green run, because the
    // interesting thing is the SHAPE of the class and not the boolean. The fan and
    // the pendant are structural (a motor thicker than the fan is tall, a shade
    // becoming a funnel); the other four are cosmetic and are here because the class
    // is the finding rather than the ugliness.
    const rows = CAPS.map((row) => {
      const band = dimRangeFor(row.category, row.shape);
      const authored = row.authored[row.axis];
      const at = band.max[row.axis];
      const drawn = row.read(authored) * (at / authored);
      const honest = row.read(at);
      return (
        '  ' + (row.shape + ' · ' + row.what).padEnd(34) +
        String(authored).padStart(5) + ' mm → ' + String(at).padStart(5) + ' mm   ' +
        'drawn ' + (drawn * 1000).toFixed(1).padStart(7) + ' mm   ' +
        'cap ' + (honest * 1000).toFixed(1).padStart(7) + ' mm   ' +
        (drawn / honest).toFixed(2) + 'x'
      );
    });
    console.log('\n  § 36 — what a group scale did to each capped detail, at the top of its band\n' +
      rows.join('\n') + '\n');
    expect(rows.length).toBe(CAPS.length);
  });
});
