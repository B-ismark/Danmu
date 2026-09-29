// The words a wall goes by, and the one reader of them.
//
// A leaf module, and that is its reason for existing. `slotOf` was born in
// `lib/detect-prompt.ts`, beside the prompt whose words it reads back, but the saved
// record needs it too (`lib/detection-record.ts`), and detect-prompt imports
// scene-spec, which imports detection-record: moving the reader there would close
// that loop. Here it imports nothing but a type.
//
// NORTH…WEST are the words the PROMPT uses for the four photos, not a claim about
// the compass — the ids are a cyclic order (`lib/capture-slots.ts`), and nothing
// here knows where north is.

import type { CaptureSlot } from './storage';

export const SLOT_NAME: Record<CaptureSlot, string> = { n: 'NORTH', e: 'EAST', s: 'SOUTH', w: 'WEST' };

/** A wall as a reply may name it. The prompt asks for `"n"`, but it also calls the
 *  walls NORTH, EAST, SOUTH and WEST, and heads each photo `--- N WALL ---`, so a
 *  reply in any of those forms — `N WALL` and `north wall` included — is the
 *  prompt's own words read back, not a guess about which wall was meant. A Map
 *  rather than an object, so `"constructor"` is not a wall. */
const SLOT_OF = new Map<string, CaptureSlot>(
  (Object.entries(SLOT_NAME) as [CaptureSlot, string][]).flatMap(([code, name]) => [
    [code, code],
    [name.toLowerCase(), code],
  ]),
);

/** The wall code a reply's `slot` names, or undefined when it names none. */
export function slotOf(v: unknown): CaptureSlot | undefined {
  return typeof v === 'string' ? SLOT_OF.get(v.trim().toLowerCase().replace(/\s+wall$/, '')) : undefined;
}
