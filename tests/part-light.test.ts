// @vitest-environment jsdom
// Where a ceiling light's spot actually emits from.
//
// three's SpotLight constructs at Object3D.DEFAULT_UP — one metre UP — so a
// `<spotLight>` without a position prop emits a metre above its group. The ceiling
// light's did: on High the shadow-only ceiling occluded it, the room stayed dark
// under it, and the light leaked in through the tops of the walls. These tests apply
// the real props to a real SpotLight, the way R3F does, and ask where it ends up.

import { describe, expect, it } from 'vitest';
import { Group, SpotLight, Vector3 } from 'three';
import { applyProps } from '@react-three/fiber';
import { spotLightProps } from '@/components/three/PartLight';
import { groundY } from '@/lib/physics';
import { lightAnchor, lightFor, PART_LIBRARY } from '@/lib/scene-spec';

function builtSpot() {
  const spec = lightFor({ shape: 'lamp-ceiling' })!;
  expect(spec.coneDeg).toBeDefined();
  const light = new SpotLight();
  applyProps(light as never, spotLightProps({ ...spec, coneDeg: spec.coneDeg! }, false) as never);
  return light;
}

describe('a ceiling light emits from its own diffuser', () => {
  it('sits at the origin of its anchor group, not three\'s default one metre up', () => {
    const light = builtSpot();
    expect(light.position.toArray()).toEqual([0, 0, 0]);
  });

  it('stays below the ceiling it hangs from, in every room height', () => {
    const row = PART_LIBRARY.find((r) => r.shape === 'lamp-ceiling')!;
    for (const ceiling of [2.4, 2.8, 3.2]) {
      const part = new Group();
      part.position.set(0, groundY('lamp', 'lamp-ceiling', [...row.dimMM] as [number, number, number], ceiling), 0);
      const anchor = new Group();
      anchor.position.fromArray(lightAnchor('lamp-ceiling', [...row.dimMM] as [number, number, number]));
      const light = builtSpot();
      part.add(anchor);
      anchor.add(light);
      part.updateMatrixWorld(true);
      const y = light.getWorldPosition(new Vector3()).y;
      expect(y).toBeLessThan(ceiling);
      // …and at the fitting, not somewhere down in the room.
      expect(y).toBeGreaterThan(ceiling - row.dimMM[2] / 1000);
    }
  });
});
