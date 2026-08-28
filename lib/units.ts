// Dimension unit conversions. Internal storage stays in mm; display units convert.

import type { DimUnit } from './store';

const MM_PER: Record<DimUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

export function fromMM(valueMM: number, unit: DimUnit): number {
  return valueMM / MM_PER[unit];
}

export function toMM(value: number, unit: DimUnit): number {
  return value * MM_PER[unit];
}

/** Reasonable step for input sliders / increments per unit. */
export function stepFor(unit: DimUnit): number {
  switch (unit) {
    case 'mm':
      return 10;
    case 'cm':
      return 1;
    case 'm':
      return 0.05;
    case 'in':
      return 0.5;
    case 'ft':
      return 0.1;
  }
}

/** Decimal places for display per unit. */
export function precisionFor(unit: DimUnit): number {
  switch (unit) {
    case 'mm':
      return 0;
    case 'cm':
      return 1;
    case 'm':
      return 2;
    case 'in':
      return 1;
    case 'ft':
      return 2;
  }
}

export function formatDim(valueMM: number, unit: DimUnit): string {
  const v = fromMM(valueMM, unit);
  return v.toFixed(precisionFor(unit));
}

/** Decimals implied by a step, so 0.01 steps don't produce 2.7300000000000004.
 *  Lives here rather than in `NumberField` because `boundToUnit` below rounds to
 *  the step's precision and the stepper's own output uses this same call — two
 *  copies of it and the bound and the value it clamps disagree.
 *
 *  It is NOT the precision the field DISPLAYS at. That is `precisionFor`, which
 *  is finer for ft (2 vs 1) and cm (1 vs 0), so a legal value stored exactly on a
 *  bound can render just outside it. An earlier version of this comment claimed
 *  the two were the same; they are not, and the gap is real enough to have moved
 *  a ceiling the wrong way. `NumberField.bump` refuses a clamp that would push a
 *  value against the arrow, which is where that gap is now answered — it cannot
 *  be answered here, because rounding a bound OUTWARD would let the arrows reach
 *  a room the commit then refuses. */
export function decimalsOf(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** A bound expressed in mm, converted into `unit` and rounded so the number a
 *  stepper lands on stays INSIDE the range.
 *
 *  Both halves matter and each was wrong on its own. `RoomDimsEditor` handed
 *  `NumberField` a bound in METRES while the field's value was in the user's
 *  unit, so a room 5 m wide showed `500.0` cm against a max of 50 and one press
 *  of the up chevron clamped it to 50 cm — a room destroyed by one arrow, in four
 *  of the five units. And a plain conversion is not enough on its own: 1.8 m is
 *  5.90551 ft, which the field renders as `5.9` — two millimetres BELOW the floor
 *  its own stepper exists to hold. So the rounding goes toward the interior, at
 *  the step's precision, and the epsilon is there because `1.8 * 100` is
 *  180.00000000000003.
 *
 *  The sentence under the fields reads its range off the same call, which is what
 *  makes the number the user is told and the bound the arrows obey the same one.
 *
 *  Deliberately NOT exported: one end of a range cannot tell whether rounding it
 *  inward has left an interval. `boundsToUnit` is the only way in. */
function boundToUnit(valueMM: number, unit: DimUnit, side: 'min' | 'max'): number {
  const p = Math.pow(10, decimalsOf(stepFor(unit)));
  const raw = fromMM(valueMM, unit) * p;
  return (side === 'min' ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9)) / p;
}

/** A range in mm as the pair of bounds a stepper in `unit` should carry.
 *
 *  Rounding each end inward is only safe while it leaves an interval, and for
 *  narrow ranges in a coarse unit it does not. A mirror's depth is 15–60 mm, which
 *  in feet is 0.049–0.197 and rounds to 0.1 at BOTH ends — a stepper whose two
 *  chevrons produce the same number and looks broken. A door's 35–60 mm is worse:
 *  it rounds to a min of 0.2 and a max of 0.1, and `NumberField.bump` applies
 *  `max` first and `min` second, so an inverted pair pins every press to `min` —
 *  pressing DOWN on a door's depth in feet raised it past its own maximum and
 *  stuck there. Fourteen shape/axis/unit combinations did one or the other, all
 *  of them in feet.
 *
 *  Below one step of the display unit the stepper cannot express the range at all,
 *  so the exact conversion is the better answer there: it puts the clamp region in
 *  the right place and leaves `clampDims` — which clamps rather than refuses — to
 *  catch a value the field's own rounding lands just outside. The room editor never
 *  reaches that branch, its ranges being metres wide, and could not afford it if it
 *  did: an out-of-range room is REFUSED rather than clamped, which is the whole
 *  reason the inward rounding exists. */
export function boundsToUnit(minMM: number, maxMM: number, unit: DimUnit): { min: number; max: number } {
  const min = boundToUnit(minMM, unit, 'min');
  const max = boundToUnit(maxMM, unit, 'max');
  if (min < max) return { min, max };
  return { min: fromMM(minMM, unit), max: fromMM(maxMM, unit) };
}

/** One press of a stepper chevron: the text a field holds, plus `steps`, giving
 *  the text it should hold next.
 *
 *  Lives here rather than in `NumberField` because it is arithmetic over bounds
 *  this module produces, and because the component could not be tested — the
 *  door-depth and ceiling-height failures below were both found by reading, after
 *  shipping, in a control with no test of its own.
 *
 *  The clamps are the point of the thing: they keep the arrows inside the range
 *  the commit will accept, which is what `boundsToUnit` exists to express. What
 *  they must never do is move the value the OPPOSITE way to the press. The bounds
 *  arrive rounded to the step grid while a field renders at `precisionFor` — finer
 *  for ft (2 vs 1) and cm (1 vs 0) — so a perfectly legal stored value can sit
 *  just outside its own rounded bound, and an unguarded clamp then throws it
 *  across: a 1.8 m ceiling shows `5.91` ft against a min of `6`, and DOWN
 *  committed 1828.8 mm, raising the ceiling and regrading every piece hung from
 *  it. `clampDims` parks part sizes exactly on a bound as a matter of routine, so
 *  this is the ordinary case and not a corner of it.
 *
 *  At a bound, then, a press simply does nothing — which is what "you are already
 *  at the minimum" ought to feel like. `max` is applied before `min` and that
 *  order is deliberate: an inverted pair can only come from a range narrower than
 *  one step, and `boundsToUnit` refuses to produce one.
 *
 *  Two properties, and they are separate questions asked in the same place: a press
 *  never moves the value AGAINST its own arrow, and a press never lands OUTSIDE
 *  [min, max]. The second is not implied by the first — the clamps run before
 *  `toFixed` and the rounding can carry a clamped value back out — and it is the
 *  one that used to put a mirror's depth on 0 mm. Both are swept over the whole
 *  catalog and every room axis in `tests/units.test.ts`, at both ends, in all five
 *  units. */
export function steppedValue(
  current: string,
  steps: number,
  min: number,
  max: number | undefined,
  step: number,
): string {
  const n = Number(current);
  const base = Number.isFinite(n) ? n : min;
  let next = base + steps * step;
  if (max !== undefined) next = Math.min(max, next);
  next = Math.max(min, next);
  const out = next.toFixed(decimalsOf(step));
  // Judged on the ROUNDED result, because rounding is the second way a press can
  // reverse itself and it is not the same way as the clamp. When a range is
  // narrower than one step, `boundsToUnit` hands back the exact conversion rather
  // than a grid-aligned pair — so a rug's 3-40 mm height in feet displays `0.13`,
  // UP clamps it to the exact maximum 0.1312, and `toFixed(1)` renders that `0.1`.
  // The stored value is fine (`clampDims` sees to that); the user still watches
  // the number fall when they press the up arrow.
  //
  // And `current` back rather than `base.toFixed(...)`, because re-rendering at the
  // step's precision is itself lossy in exactly these cases: 5.91 ft would come
  // back as "5.9" — 1798.3 mm, below the 1800 mm floor the guard exists to defend.
  // Doing nothing has to mean leaving the text alone.
  const landed = Number(out);
  if (steps < 0 && landed > base) return current;
  if (steps > 0 && landed < base) return current;
  // …and it must not land OUTSIDE the range either. The clamps above are applied
  // before `toFixed`, and the rounding can carry the clamped value straight back
  // out: a mirror's 15-60 mm depth in feet displays `0.05`, DOWN clamps to the
  // exact minimum 0.049 and renders `"0.0"` — 0 mm, a depth the mirror does not
  // have. `Inspector.commitDebounced` then refuses it for being <= 0, so nothing
  // commits, nothing re-renders, and the field sits showing 0.0 with no message
  // anywhere on the path. UP from the same spot renders `0.2`, which is 60.96 mm,
  // over the 60 mm maximum — the whole range crossed by one chevron.
  //
  // 366 combinations did this, all in feet, 122 of them landing on exactly zero;
  // measured by danmu-cb over 55,500 presses, and unchanged by the direction guard
  // above, which answers a different question. Where a range is narrower than one
  // step of the display unit the stepper simply cannot express it, so the honest
  // answer is that the arrows do nothing and the typed value governs — the same
  // conclusion `boundsToUnit` reaches when it falls back to the exact conversion.
  if (landed < min - 1e-9) return current;
  if (max !== undefined && landed > max + 1e-9) return current;
  return out;
}

export const UNIT_OPTIONS: { id: DimUnit; label: string }[] = [
  { id: 'm', label: 'Meters (m)' },
  { id: 'cm', label: 'Centimeters (cm)' },
  { id: 'mm', label: 'Millimeters (mm)' },
  { id: 'ft', label: 'Feet (ft)' },
  { id: 'in', label: 'Inches (in)' },
];
