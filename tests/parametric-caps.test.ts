import { describe, expect, it } from 'vitest';
import {
  fanColumn,
  pendantDrop,
  isParametric,
  FAN_HUB_H,
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
