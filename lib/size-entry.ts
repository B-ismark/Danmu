// The room size a new room starts at — typed on the shape picker, or left alone.
//
// Most people do not know their room's measurements, so the step is skippable and
// the fields start filled with the shape's typical size. That makes three states
// the screen has to tell apart, and they are the whole of this module:
//
//   · UNTOUCHED — `null`. The fields follow whichever shape is selected, and the
//     room is saved at that shape's typical size. Picking another shape changes the
//     numbers, because nobody typed them.
//   · TYPED — a `SizeEntry`. The numbers are the user's and stay put when the shape
//     changes: the room is the same room whichever outline they are trying on.
//   · TYPED AND UNFINISHED — the same entry holding text that is not a size yet: an
//     empty box, `4.`, a width of 80 m. That is ordinary mid-typing, not an error,
//     so the drawing keeps showing the last size that WAS one (`good`) instead of
//     jumping back to the preset or collapsing to nothing between keystrokes.
//
// The text is kept as text, in the unit it was typed in, because a field that
// re-renders what you are typing mangles it (`4.` becomes `4`, and the dot you just
// pressed disappears). Changing the unit mid-entry converts what can be converted and
// leaves the rest exactly as typed.
//
// Nothing here clamps. A size outside the room range is REFUSED with a sentence
// naming the range (`rangeSentence`), which reads the same `boundsToUnit` call the
// fields' arrows are bounded by, so the number the user is told and the number the
// arrows can reach are one. Clamping a typed 80 m to 50 m would be resizing
// someone's room to fit, which is the thing CLAUDE.md rule 2 forbids.
//
// Pure — no React — so the rule for what gets saved can be tested without a screen.

import type { DimUnit } from './store';
import { ROOM_AXES, roomAxisRange, roomAxisWithin, type RoomAxis, type RoomDims } from './dimension-ranges';
import { boundsToUnit, fromMM, precisionFor, toMM } from './units';

/** The three fields' text, in `ROOM_AXES` order. */
export type SizeText = [string, string, string];

/** What the user has typed. `good` is the last in-range size per axis, in metres. */
export type SizeEntry = { unit: DimUnit; text: SizeText; good: RoomDims };

/** A size as the fields show it: the studio's own format (`RoomDimsEditor`), so the
 *  same room reads the same on both screens. */
export function sizeText(dims: RoomDims, unit: DimUnit): SizeText {
  return ROOM_AXES.map((a) => metresToText(dims[a], a, unit)) as SizeText;
}

/** One field's text as metres, or NaN when it is not a number at all.
 *
 *  `Number` rather than `parseFloat`, because `parseFloat('4 m')` is 4 and
 *  `parseFloat('4..5')` is 4 — a field that quietly reads the front of what you
 *  typed saves a room you did not type. And an empty box is NaN rather than the
 *  `0` that `Number('')` would give, which is a size, just an illegal one. */
export function textToMetres(raw: string, unit: DimUnit): number {
  const t = raw.trim();
  if (t === '') return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? toMM(n, unit) / 1000 : NaN;
}

/** `metres` written in `unit` at the fields' precision — and, when the size is one
 *  the room may have, written so it still IS one.
 *
 *  Nearest rounding alone is not enough, for the reason `boundsToUnit` rounds inward:
 *  a width of exactly 1 m is 3.2808 ft, which the field shows as `3.28`, and 3.28 ft
 *  is 0.9997 m — outside the range. Typing a legal 1 m and then switching to feet
 *  would turn the field red for a number the user never typed. So a legal size that
 *  nearest rounding carries out of range is rounded toward the inside instead. An
 *  illegal one is left at nearest: it is already wrong, and nudging it would make it
 *  a different wrong number. */
function metresToText(metres: number, axis: RoomAxis, unit: DimUnit): string {
  const p = precisionFor(unit);
  const v = fromMM(metres * 1000, unit);
  const nearest = v.toFixed(p);
  const shown = textToMetres(nearest, unit);
  if (!roomAxisWithin(axis, metres) || roomAxisWithin(axis, shown)) return nearest;
  // Toward the inside means away from whichever end the rounding crossed — decided
  // by where the SHOWN number fell, not by where the size sits: 1.0008 m is above the
  // floor and still rounds below it in feet.
  const f = Math.pow(10, p);
  const inward = shown < roomAxisRange(axis).min ? Math.ceil(v * f) / f : Math.floor(v * f) / f;
  return inward.toFixed(p);
}

/** The entry re-expressed in `unit`. A field holding a number is converted; a field
 *  holding something that is not one yet (`''`, `-`) keeps its text, because
 *  converting it would mean inventing what the user meant. */
export function entryInUnit(e: SizeEntry, unit: DimUnit): SizeEntry {
  if (e.unit === unit) return e;
  const text = e.text.map((t, i) => {
    const m = textToMetres(t, e.unit);
    return Number.isFinite(m) ? metresToText(m, ROOM_AXES[i], unit) : t;
  }) as SizeText;
  return { unit, text, good: e.good };
}

/** What the fields show: the typed text, or the shape's typical size when nothing
 *  has been typed. */
export function shownText(e: SizeEntry | null, preset: RoomDims, unit: DimUnit): SizeText {
  return e ? entryInUnit(e, unit).text : sizeText(preset, unit);
}

/** The size the drawing shows: the last in-range value typed on each axis, or the
 *  shape's typical size when nothing has been typed. */
export function drawnDims(e: SizeEntry | null, preset: RoomDims): RoomDims {
  return e ? e.good : preset;
}

/** One keystroke into field `i`. The first keystroke is what turns an untouched
 *  screen into a typed one, starting from whatever the fields were showing. */
export function typeInto(
  e: SizeEntry | null,
  preset: RoomDims,
  unit: DimUnit,
  i: 0 | 1 | 2,
  raw: string,
): SizeEntry {
  const base: SizeEntry = e ? entryInUnit(e, unit) : { unit, text: sizeText(preset, unit), good: preset };
  const text = [...base.text] as SizeText;
  text[i] = raw;
  const axis = ROOM_AXES[i];
  const m = textToMetres(raw, unit);
  const good = roomAxisWithin(axis, m) ? { ...base.good, [axis]: m } : base.good;
  return { unit, text, good };
}

/** The axes whose text is not a size the room may have, in `ROOM_AXES` order. */
export function badAxes(text: SizeText, unit: DimUnit): RoomAxis[] {
  return ROOM_AXES.filter((a, i) => !roomAxisWithin(a, textToMetres(text[i], unit)));
}

/** The room to save, or null when any field is not a size it may have. All three or
 *  nothing: saving the two good sides of a half-typed room would build a room nobody
 *  described. */
export function enteredDims(text: SizeText, unit: DimUnit): RoomDims | null {
  if (badAxes(text, unit).length > 0) return null;
  const out = {} as RoomDims;
  ROOM_AXES.forEach((a, i) => {
    out[a] = textToMetres(text[i], unit);
  });
  return out;
}

/** One field's arrow limits, in the field's own unit. */
export function axisBounds(axis: RoomAxis, unit: DimUnit): { min: number; max: number } {
  const r = roomAxisRange(axis);
  return boundsToUnit(r.min * 1000, r.max * 1000, unit);
}

/** What to say under a field that does not hold a size, in the user's unit — from
 *  the same bounds its arrows obey. Worded as what to do, so it reads the same for
 *  an empty box as for 80 m. */
export function rangeSentence(axis: RoomAxis, unit: DimUnit): string {
  const b = axisBounds(axis, unit);
  return `Enter a ${axis} from ${b.min} to ${b.max} ${unit}.`;
}
