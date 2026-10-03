import type { LayoutId } from '@/lib/footprint';
import { LAYOUT_IDS } from '@/lib/storage';
import { PRESET_HEIGHT, ROOM_PRESETS } from '@/lib/room-presets';

/** The room sizes onboarding OFFERS, and the ceiling it gives them, read from the
 *  module both room-making screens build from.
 *
 *  **Two files assert things about "a brand-new room" and both used to name their own
 *  numbers.** `tests/scene-seed.test.ts` hand-typed the five presets and
 *  `tests/starter-navigability.test.ts` parsed them, which is worse than either one
 *  alone: resize the `u` preset and the parsing file goes red while the hand-typed one
 *  carries on measuring 6.0 x 5.0 and stays green — two gates over one property,
 *  disagreeing about which room they are gating. They read this instead.
 *
 *  This used to PARSE the presets out of `app/onboarding/layout-pick/page.tsx`, with a
 *  guard against every way a regex over source can silently narrow, because a page
 *  exports nothing a test can import. The presets live in `lib/room-presets.ts` now
 *  (the empty Rooms page's starter room is made from them too), so the list is
 *  imported and the parse, with its truncation traps, is gone. The vocabulary and
 *  size checks stay: they guard the data, not the parse. */

export type OfferedSize = { id: LayoutId; width: number; depth: number };

const SOURCE = 'lib/room-presets.ts';

/** Every `{ id, width, depth }` the picker offers, in the order it offers them. */
export function offeredSizes(): OfferedSize[] {
  const out: OfferedSize[] = ROOM_PRESETS.map((p) => ({ id: p.id, width: p.width, depth: p.depth }));
  if (out.length === 0) throw new Error(`${SOURCE}: no presets at all`);
  for (const o of out) {
    if (!(o.width > 0) || !(o.depth > 0)) throw new Error(`${SOURCE}: ${o.id} is ${o.width} x ${o.depth}`);
    // A lowercase typo passes the dimension guard — and
    // `footprintForLayout`'s `default:` branch hands back a RECTANGLE for an id it does
    // not know, so a `describe.each` over this list would sweep a rectangle labelled
    // `rec` and pass every assertion in it. The runtime vocabulary is the only thing
    // that can say no.
    if (!(LAYOUT_IDS as readonly string[]).includes(o.id)) {
      throw new Error(`${SOURCE}: '${o.id}' is not in LAYOUT_IDS — a typo would be built as a rectangle`);
    }
  }
  return out;
}

/** The ceiling every preset room is saved with. */
export function offeredHeight(): number {
  if (!(PRESET_HEIGHT > 0)) throw new Error(`${SOURCE}: PRESET_HEIGHT is ${PRESET_HEIGHT}`);
  return PRESET_HEIGHT;
}
