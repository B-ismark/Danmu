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
// does not, so at one exposure Neutral's mid-tones sit about a third darker.
// `EXPOSURE_MATCH` carries every mood's authored `exposure` across rather than
// re-tuning ten moods by hand; the moods stay relative to each other as they were.

import { NeutralToneMapping } from 'three';

export const TONE_MAPPING = NeutralToneMapping;

export const EXPOSURE_MATCH = 1.25;
