import { describe, it, expect } from 'vitest';
import {
  axisBounds,
  badAxes,
  drawnDims,
  enteredDims,
  entryInUnit,
  rangeSentence,
  shownText,
  sizeText,
  textToMetres,
  typeInto,
  type SizeEntry,
  type SizeText,
} from '@/lib/size-entry';
import { ROOM_AXES, roomAxisRange, roomAxisWithin, type RoomDims } from '@/lib/dimension-ranges';
import { boundsToUnit, fromMM, precisionFor } from '@/lib/units';
import { offeredSizes } from './helpers/offered-sizes';

const UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const;
const RECT: RoomDims = { width: 6, depth: 4, height: 2.8 };
const U: RoomDims = { width: 6, depth: 5, height: 2.8 };

/** All three fields typed, one keystroke each, in `unit`. */
const typed = (text: SizeText, unit: (typeof UNITS)[number]): SizeEntry =>
  text.reduce<SizeEntry | null>((e, t, i) => typeInto(e, RECT, unit, i as 0 | 1 | 2, t), null)!;

describe('reading a field', () => {
  it('reads a number in the unit it was typed in', () => {
    expect(textToMetres('4.2', 'm')).toBeCloseTo(4.2, 9);
    expect(textToMetres('420', 'cm')).toBeCloseTo(4.2, 9);
    expect(textToMetres('10', 'ft')).toBeCloseTo(3.048, 9);
    expect(textToMetres(' 4.2 ', 'm')).toBeCloseTo(4.2, 9);
  });

  // `parseFloat` reads the front of whatever it is given, which is how a field saves
  // a room nobody typed. Each of these is text a person really produces.
  it.each([['4 m'], ['4..5'], ['4,5'], ['abc'], ['-'], ['.'], ['Infinity']])('%j is not a size', (raw) => {
    expect(textToMetres(raw, 'm')).toBeNaN();
  });

  // `Number('')` is 0 — a size, just an illegal one. An empty box is not a size.
  it('an empty box is not a size, and not zero', () => {
    expect(textToMetres('', 'm')).toBeNaN();
    expect(textToMetres('   ', 'm')).toBeNaN();
  });
});

describe('untouched, the fields follow the shape', () => {
  it('shows the selected preset, in the user unit', () => {
    expect(shownText(null, RECT, 'm')).toEqual(['6.00', '4.00', '2.80']);
    expect(shownText(null, U, 'm')).toEqual(['6.00', '5.00', '2.80']);
    expect(shownText(null, RECT, 'cm')).toEqual(['600.0', '400.0', '280.0']);
    expect(drawnDims(null, U)).toBe(U);
  });

  // The studio's own format, so one room reads the same on the two screens.
  it('uses the same text the studio editor does', () => {
    expect(sizeText(RECT, 'ft')).toEqual(['19.69', '13.12', '9.19']);
    expect(sizeText(RECT, 'mm')).toEqual(['6000', '4000', '2800']);
  });

  // Every size the picker offers must be a room the picker will save, in every unit,
  // or pressing the CTA without touching anything refuses its own suggestion.
  // Typing into one box leaves the other two showing the shape's size, and those have
  // to save as that size — not as its rounding in feet, which is 6.0015 m for 6.
  it('every offered preset is a savable room in every unit', () => {
    const offered = offeredSizes();
    expect(offered.length).toBe(5);
    for (const o of offered) {
      const dims: RoomDims = { width: o.width, depth: o.depth, height: 2.8 };
      for (const unit of UNITS) {
        const shown = sizeText(dims, unit);
        expect(badAxes(shown, unit), `${o.id} in ${unit}`).toEqual([]);
        const e = typeInto(null, dims, unit, 2, shown[2]);
        const saved = enteredDims(e, unit);
        expect(saved, `${o.id} in ${unit}`).not.toBeNull();
        expect([saved!.width, saved!.depth], `${o.id} in ${unit}`).toEqual([o.width, o.depth]);
      }
    }
  });
});

describe('typed, the numbers are the user’s', () => {
  it('the first keystroke starts from what was showing', () => {
    const e = typeInto(null, RECT, 'm', 0, '4.2');
    expect(e.text).toEqual(['4.2', '4.00', '2.80']);
    expect(e.good).toEqual({ width: 4.2, depth: 4, height: 2.8 });
  });

  it('stays put when the shape changes', () => {
    const e = typeInto(null, RECT, 'm', 1, '3.6');
    // The screen passes whichever preset is now selected; a typed entry ignores it.
    expect(shownText(e, U, 'm')).toEqual(['6.00', '3.6', '2.80']);
    expect(drawnDims(e, U)).toEqual({ width: 6, depth: 3.6, height: 2.8 });
  });

  // Mid-typing is not an error. The drawing keeps the last size that WAS one rather
  // than jumping back to the preset or collapsing between keystrokes.
  it('text that is not a size yet keeps the last good size drawn', () => {
    let e = typeInto(null, RECT, 'm', 0, '4.2');
    e = typeInto(e, RECT, 'm', 0, '');
    expect(e.text[0]).toBe('');
    expect(e.good.width).toBe(4.2);
    e = typeInto(e, RECT, 'm', 0, '80');
    expect(e.good.width).toBe(4.2);
    e = typeInto(e, RECT, 'm', 0, '0.5');
    expect(e.good.width).toBe(4.2);
    e = typeInto(e, RECT, 'm', 0, '5');
    expect(e.good.width).toBe(5);
  });

  // The field shows what was typed, exactly. Re-rendering it as a number eats the
  // dot you just pressed.
  it('keeps the text exactly as typed', () => {
    const e = typeInto(null, RECT, 'm', 0, '4.');
    expect(e.text[0]).toBe('4.');
    expect(e.good.width).toBe(4);
  });

  it('judges each axis against its own range', () => {
    // 1.5 is a legal side and an illegal ceiling.
    const w = typeInto(null, RECT, 'm', 0, '1.5');
    expect(w.good.width).toBe(1.5);
    const h = typeInto(null, RECT, 'm', 2, '1.5');
    expect(h.good.height).toBe(2.8);
    expect(badAxes(h.text, 'm')).toEqual(['height']);
  });
});

describe('changing the unit mid-entry', () => {
  it('converts what is a number and leaves the rest as typed', () => {
    let e = typeInto(null, RECT, 'm', 0, '4.2');
    e = typeInto(e, RECT, 'm', 1, '');
    e = typeInto(e, RECT, 'm', 2, 'abc');
    const cm = entryInUnit(e, 'cm');
    expect(cm.unit).toBe('cm');
    expect(cm.text).toEqual(['420.0', '', 'abc']);
    expect(cm.good).toBe(e.good);
  });

  // The page never converts the entry it holds; it asks `shownText` in whatever unit
  // is selected now. So the fields show the new unit's numbers the moment the unit
  // changes, before anyone types again. Digits left behind from the old unit would
  // describe a different room under the new unit's name: 4.20 read as feet is 1.28 m.
  it('shows the typed room in the unit selected now', () => {
    const e = typeInto(null, RECT, 'm', 0, '4.2');
    expect(shownText(e, RECT, 'ft')).toEqual(['13.78', '13.12', '9.19']);
    expect(shownText(e, U, 'cm')).toEqual(['420.0', '400.0', '280.0']);
  });

  it('is the identity in the same unit', () => {
    const e = typeInto(null, RECT, 'm', 0, '4.');
    expect(entryInUnit(e, 'm')).toBe(e);
  });

  it('a keystroke after a unit change lands in the new unit', () => {
    const e = typeInto(null, RECT, 'm', 0, '4.2');
    const next = typeInto(e, RECT, 'cm', 1, '350');
    expect(next.unit).toBe('cm');
    expect(next.text).toEqual(['420.0', '350', '280.0']);
    expect(next.good.depth).toBeCloseTo(3.5, 9);
  });

  // 1 m is 3.2808 ft, which nearest rounding writes as 3.28 — 0.9997 m, outside the
  // range. A legal size must not turn red because the unit changed under it.
  it('a legal size stays legal in every unit, at both ends of every range', () => {
    for (const axis of ROOM_AXES) {
      const r = roomAxisRange(axis);
      for (const metres of [r.min, r.max]) {
        for (const from of UNITS) {
          const i = ROOM_AXES.indexOf(axis) as 0 | 1 | 2;
          // Typed exactly on the bound, in the unit where it is exact: metres.
          const typed = typeInto(null, RECT, 'm', i, String(metres));
          const there = entryInUnit(typed, from);
          for (const to of UNITS) {
            const back = entryInUnit(there, to);
            expect(
              roomAxisWithin(axis, textToMetres(back.text[i], to)),
              `${axis} ${metres} m → ${from} → ${to}: ${back.text[i]}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  // And an illegal one is not nudged into legality by the same rounding.
  it('an illegal size stays illegal', () => {
    const e = typeInto(null, RECT, 'm', 0, '0.999');
    for (const unit of UNITS) {
      expect(badAxes(entryInUnit(e, unit).text, unit), unit).toEqual(['width']);
    }
  });

  // The case above types in the coarsest unit, so nothing it converts to can round it
  // back in. Typed in a finer one it could: 996 mm read `1.00` in metres, lost its red,
  // and saved the preset's width. So: one step outside each end, typed in every unit,
  // read in every other.
  it('an illegal size stays illegal from every unit into every other, at both ends', () => {
    let crossings = 0;
    let pairs = 0;
    for (const axis of ROOM_AXES) {
      const i = ROOM_AXES.indexOf(axis);
      const r = roomAxisRange(axis);
      for (const from of UNITS) {
        // The nearest number this unit's field can hold on the wrong side of each end.
        const f = Math.pow(10, precisionFor(from));
        const lo = (Math.ceil(fromMM(r.min * 1000, from) * f) - 1) / f;
        const hi = (Math.floor(fromMM(r.max * 1000, from) * f) + 1) / f;
        for (const out of [lo, hi]) {
          const text = out.toFixed(precisionFor(from));
          const e = typeInto(null, RECT, from, i as 0 | 1 | 2, text);
          for (const to of UNITS) {
            const there = entryInUnit(e, to);
            expect(badAxes(there.text, to), `${axis} ${text} ${from} → ${there.text[i]} ${to}`).toEqual([axis]);
            expect(enteredDims(e, to), `${axis} ${text} ${from} → ${to}`).toBeNull();
            pairs++;
            // Would nearest rounding alone have shown this one as a legal size?
            const nearest = fromMM(textToMetres(text, from) * 1000, to).toFixed(precisionFor(to));
            if (roomAxisWithin(axis, textToMetres(nearest, to))) crossings++;
          }
        }
      }
    }
    // Every pair was reached, and nearest rounding alone carries this many inside.
    expect(pairs).toBe(150);
    expect(crossings).toBe(36);
  });
});

describe('what gets saved', () => {
  it('all three or nothing', () => {
    expect(enteredDims(typed(['4.2', '3.6', '2.5'], 'm'), 'm')).toEqual({ width: 4.2, depth: 3.6, height: 2.5 });
    expect(enteredDims(typed(['4.2', '', '2.5'], 'm'), 'm')).toBeNull();
    expect(enteredDims(typed(['4.2', '3.6', '80'], 'm'), 'm')).toBeNull();
    expect(enteredDims(typed(['4 m', '3.6', '2.5'], 'm'), 'm')).toBeNull();
  });

  it('in the unit it was typed in', () => {
    const d = enteredDims(typed(['420', '360', '250'], 'cm'), 'cm')!;
    expect(d.width).toBeCloseTo(4.2, 9);
    expect(d.depth).toBeCloseTo(3.6, 9);
    expect(d.height).toBeCloseTo(2.5, 9);
  });

  // The fields show a converted size rounded to the unit now selected; the room is
  // the size that was typed. Read back from the text, a typed 4237 mm saved as the
  // 4.24 m it reads once the unit is metres.
  it('the size typed, not the rounding a unit change shows', () => {
    const e = typed(['4237', '3608', '2462'], 'mm');
    expect(entryInUnit(e, 'm').text).toEqual(['4.24', '3.61', '2.46']);
    expect(enteredDims(e, 'm')).toEqual({ width: 4.237, depth: 3.608, height: 2.462 });
    // …and a keystroke in the new unit writes its own field and leaves the others' size.
    const more = typeInto(e, RECT, 'ft', 0, '14');
    expect(more.text.slice(1)).toEqual(['11.84', '8.08']);
    const saved = enteredDims(more, 'ft')!;
    expect(saved.width).toBeCloseTo(4.2672, 9);
    expect([saved.depth, saved.height]).toEqual([3.608, 2.462]);
  });

  // Nothing clamps. 80 m is refused, not quietly saved as 50.
  it('refuses rather than clamps, on every axis and at both ends', () => {
    for (const axis of ROOM_AXES) {
      const i = ROOM_AXES.indexOf(axis);
      const r = roomAxisRange(axis);
      for (const bad of [r.min - 0.01, r.max + 0.01]) {
        const text = ['4', '4', '2.8'] as SizeText;
        text[i] = String(bad);
        expect(enteredDims(typed(text, 'm'), 'm'), `${axis} ${bad}`).toBeNull();
        expect(badAxes(text, 'm')).toEqual([axis]);
      }
      for (const ok of [r.min, r.max]) {
        const text = ['4', '4', '2.8'] as SizeText;
        text[i] = String(ok);
        expect(enteredDims(typed(text, 'm'), 'm')?.[axis], `${axis} ${ok}`).toBe(ok);
      }
    }
  });

  it('names every bad axis, in the rule’s order', () => {
    expect(badAxes(['', '0', '99'], 'm')).toEqual(['width', 'depth', 'height']);
    expect(badAxes(['4', '4', '2.8'], 'm')).toEqual([]);
  });
});

describe('the sentence and the arrows are one number', () => {
  it('reads the same bounds the arrows carry', () => {
    for (const axis of ROOM_AXES) {
      const r = roomAxisRange(axis);
      for (const unit of UNITS) {
        const b = boundsToUnit(r.min * 1000, r.max * 1000, unit);
        expect(axisBounds(axis, unit)).toEqual(b);
        expect(rangeSentence(axis, unit)).toBe(`Enter a ${axis} from ${b.min} to ${b.max} ${unit}.`);
      }
    }
  });

  it('reads the way a person does', () => {
    expect(rangeSentence('width', 'm')).toBe('Enter a width from 1 to 50 m.');
    expect(rangeSentence('height', 'm')).toBe('Enter a height from 1.8 to 12 m.');
    expect(rangeSentence('depth', 'ft')).toBe('Enter a depth from 3.3 to 164 ft.');
    expect(rangeSentence('height', 'ft')).toBe('Enter a height from 6 to 39.3 ft.');
  });

  // The arrows cannot reach a number the sentence calls wrong, and every number the
  // sentence names is one the save accepts.
  it('both named ends are savable', () => {
    for (const axis of ROOM_AXES) {
      for (const unit of UNITS) {
        const b = axisBounds(axis, unit);
        for (const v of [b.min, b.max]) {
          expect(roomAxisWithin(axis, textToMetres(String(v), unit)), `${axis} ${v} ${unit}`).toBe(true);
        }
      }
    }
  });
});

describe('an entry is plain data', () => {
  it('never mutates the entry it is given', () => {
    const e: SizeEntry = typeInto(null, RECT, 'm', 0, '4.2');
    const snap = JSON.stringify(e);
    typeInto(e, RECT, 'm', 1, '3');
    entryInUnit(e, 'ft');
    expect(JSON.stringify(e)).toBe(snap);
  });
});
