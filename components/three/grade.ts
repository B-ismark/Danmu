// The 'high' quality grading step: three's own ACES filmic curve, applied as a
// post-processing effect because the composer turns the renderer's tone mapping
// off (it renders into a linear half-float target and leaves the curve to a pass).
//
// Why not postprocessing's ToneMappingEffect, which does the same maths: it grades
// EVERY pixel, and the backdrop is not part of the room. On 'fast' the renderer
// tone-maps materials only — a `scene.background` colour is a CLEAR, and a clear is
// never tone-mapped — so the paper around the room is exactly `L.bg`. Graded, the
// same paper came out 251,248,241 → 225,224,222: the page's own background colour,
// visibly greyer inside the canvas than outside it, on the quality that is the
// default. So this gate reads depth and leaves the cleared backdrop (depth 1.0)
// exactly as the clear wrote it, and both qualities agree on the one surface that
// is supposed to match the page.
//
// `toneMappingExposure` is not a uniform of ours: `tonemapping_pars_fragment`
// declares it and three's renderer uploads `gl.toneMappingExposure` into every
// program that has it, so each mood's `exposure` reaches this pass untouched.

import { Effect, EffectAttribute } from 'postprocessing';

const fragmentShader = /* glsl */ `
#include <tonemapping_pars_fragment>
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // A cleared pixel reads exactly 1.0; anything drawn is strictly nearer.
  outputColor = depth < 1.0 ? vec4(ACESFilmicToneMapping(inputColor.rgb), inputColor.a) : inputColor;
}
`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', fragmentShader, { attributes: EffectAttribute.DEPTH });
  }
}
