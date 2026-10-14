import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXPOSURE_MATCH, TONE } from '@/components/three/tone';

// Two paths apply the room's tone curve — the renderer on 'fast', GradeEffect's
// shader on 'high' — and they agree only because both read `TONE`.

describe('the tone curve', () => {
  it('names the GLSL function of the same curve the renderer is given', () => {
    // three exports each curve's enum under the same name as its GLSL function.
    expect((THREE as unknown as Record<string, unknown>)[TONE.glsl]).toBe(TONE.mapping);
    expect(THREE.ShaderChunk.tonemapping_pars_fragment).toContain(`vec3 ${TONE.glsl}( vec3 color )`);
  });

  it('is Neutral, at the exposure chosen from the export comparison', () => {
    expect(TONE.mapping).toBe(THREE.NeutralToneMapping);
    expect(EXPOSURE_MATCH).toBe(1.25);
  });
});
