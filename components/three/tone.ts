// The room's tone curve, in one place, because two paths apply it: the renderer
// on 'fast' and `GradeEffect` on 'high' (the composer switches the renderer's own
// curve off). Both read `gl.toneMappingExposure`.
//
// Neutral, not ACES. ACES (three's `ACESFilmicToneMapping`) lifts the shadows and
// rolls every highlight toward grey — a wall lit at 0.9 came out 0.74 — and pulls
// saturation from bright colours, so a warm room read as one band of beige and
// the saved picture looked washed out. Khronos PBR Neutral keeps a material's
// colour as authored up to 0.76 and only then compresses, so a sage sofa stays
// sage and a white shade stays white.
//
// The two curves do not agree on brightness: ACES pre-scales by 1/0.6, Neutral
// does not, so at one exposure Neutral's mid-grey comes out about a third darker
// (0.18 maps to 0.14 against ACES's 0.21).
// `EXPOSURE_MATCH` carries every mood's authored `exposure` across rather than
// re-tuning ten moods by hand; the moods stay relative to each other as they were.

import { NeutralToneMapping } from 'three';

/** The curve, as the renderer takes it and as GLSL names it — one object, so the
 *  'fast' path and `GradeEffect` cannot be pointed at two different curves. The GLSL
 *  name is three's own function in `tonemapping_pars_fragment`, and
 *  `tests/tone.test.ts` holds it to the constant. */
export const TONE = { mapping: NeutralToneMapping, glsl: 'NeutralToneMapping' } as const;

/** Chosen by eye, not derived, and the derivation is why it is not higher. Matching
 *  Neutral's MID-GREY to ACES takes ~1.4; that lifts everything above it too, so a
 *  lit wall comes out brighter than any mood was authored for. Rendered at 1.0, 1.25
 *  and 1.45 from the starter room's export: 1.0 is a darker room than the moods
 *  meant, 1.45 brightens it past them, and 1.25 matches the old picture's average
 *  brightness (0.568 against 0.579 grey) with Neutral's colour. */
export const EXPOSURE_MATCH = 1.25;
