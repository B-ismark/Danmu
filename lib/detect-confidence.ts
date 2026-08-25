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
 *  Local and cloud share a number on purpose — see the note above. The split that
 *  matters is what the number is WORTH, and for cloud the answer is "not much", so
 *  the corroboration check below is what actually gates it. */
const AUTO_CONFIRM: Record<DetectSource, number | 'always'> = {
  // The user drew the box. There is nothing here for them to confirm.
  manual: 'always',
  // A class score, and a real one. Most true positives sit below this.
  local: 0.85,
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
 *  self-report and no measurement is not two pieces of evidence; it is none. */
export function shouldAutoConfirm(d: Pick<Detection, 'conf' | 'source'>, verdict: LabelVerdict['status']): boolean {
  const bar = AUTO_CONFIRM[sourceOf(d)];
  if (bar === 'always') return true;
  return verdict === 'ok' && d.conf >= bar;
}

/** How to name a source to the user. Short, because it sits in a metadata line
 *  beside the category and the wall. */
export function sourceLabel(s: DetectSource): string {
  switch (s) {
    case 'local':
      return 'On-device';
    case 'cloud':
      return 'Cloud';
    case 'manual':
      return 'You';
  }
}
