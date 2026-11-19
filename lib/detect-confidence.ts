// Who said so, and what their confidence is worth.
//
// `Detection.conf` is one field carrying numbers from three unrelated scales, and
// the review screen used to compare all three against a single `0.85`:
//
//   · **local** — a class score off the ONNX head (lib/local-detect.ts), emitted
//     above 0.35 after NMS. Discriminative: a high one really does mean the model
//     saw a strong instance, and most true positives never reach 0.85.
//   · **cloud** — a number the language model wrote about its own answer. Self-
//     reports from an LLM cluster high and narrow; in practice almost everything
//     comes back 0.8–0.95, so 0.85 is barely a bar at all.
//   · **manual** — a literal `1`, written by the code because the USER drew the
//     box. Not a confidence in any sense; a sentinel standing in for "not
//     applicable".
//
// So the same threshold auto-confirmed nearly every cloud row and nearly no local
// row, in a UI where "confirmed" means the user has vouched for it.
//
// **The fix is not a second invented digit.** Raising an uncalibrated self-report
// from 0.85 to 0.9 would look like calibration while being a guess, and the numbers
// in `AUTO_CONFIRM` are deliberately not the interesting part of this file. What
// changed is that a detection now needs INDEPENDENT corroboration: the geometry
// must have measured it and agreed with its label. A model's opinion of itself is
// not evidence about itself, and the camera is the one voice in the pipeline that
// did not come from a model.

import type { Detection } from './detection';
import type { LabelVerdict } from './label-repair';

export type DetectSource = 'local' | 'cloud' | 'manual';

/** The bar `conf` must clear, per source. `'always'` means the source does not
 *  report a confidence worth testing.
 *
 *  **Local used to share cloud's 0.85, and that ticked nothing.** Measured on eight
 *  runs of four real photographed rooms (two lenses each), 11 of 180 rows started
 *  ticked, and three runs ticked none — so Continue built an empty room and the
 *  review was a long tick-everything chore. The comment that number sat under
 *  already said why: a local score is a real class score and most true positives
 *  sit below 0.85. Among rows the geometry measured and agreed with (`'ok'`), those
 *  scoring 0.5–0.85 were right about as often as those above, judged by eye against
 *  the photos — one wrong in the hotel (a luggage rack read as a stool), at most
 *  one in each of the others. Below 0.5 they were not (the hotel's painting read as
 *  a curtain at 0.36). So the bar is 0.5, and the
 *  corroboration requirement below does the real gating. Rows nothing measured stay
 *  unticked whatever they score: the ones above 0.7 in that test were pendant
 *  lamps, one of them hanging in the next room.
 *
 *  Cloud keeps 0.85 — its number is a self-report, and moving it would be a guess
 *  dressed as calibration (see the note above). */
const AUTO_CONFIRM: Record<DetectSource, number | 'always'> = {
  // The user drew the box. There is nothing here for them to confirm.
  manual: 'always',
  // A class score, and a real one. Measured, not chosen — see above.
  local: 0.5,
  // Kept rather than raised. A tighter bar on a compressed self-report is theatre.
  cloud: 0.85,
};

/** A detection with no `source` is one persisted before this field existed, and the
 *  only path that produced those was the cloud call. The conservative reading, and
 *  it matters little in practice: a cached room's `locked` flags are read back from
 *  the record rather than recomputed. */
export function sourceOf(d: Pick<Detection, 'source'>): DetectSource {
  return d.source ?? 'cloud';
}

/** Should the review screen tick this row before the user has looked at it?
 *
 *  Two conditions, and the second is the one that changed. A row is auto-confirmed
 *  only when its own source clears its own bar AND the geometry independently
 *  measured it and agreed with the word — verdict `'ok'`.
 *
 *  **`'unmeasured'` is not agreement**, and treating it as one was a live bug in the
 *  caller this replaces: it tested `status !== 'suspect'`, which let through every
 *  row the camera never got a look at. `lib/label-repair.ts` says so in as many
 *  words — "a caller that treats `unmeasured` as `ok` claims the geometry agreed
 *  with the AI" — and the review screen was that caller. An uncalibrated
 *  self-report and no measurement is not two pieces of evidence; it is one, and it
 *  is the weakest one available. */
export function shouldAutoConfirm(d: Pick<Detection, 'conf' | 'source'>, verdict: LabelVerdict['status']): boolean {
  const bar = AUTO_CONFIRM[sourceOf(d)];
  if (bar === 'always') return true;
  return verdict === 'ok' && d.conf >= bar;
}

/** How to name a source to the user, or null when there is nothing worth saying.
 *  Short, because it sits in a metadata line beside the wall. Only a box the person
 *  drew is named: which engine found the rest is not something they can act on. */
export function sourceLabel(s: DetectSource): string | null {
  return s === 'manual' ? 'You' : null;
}
