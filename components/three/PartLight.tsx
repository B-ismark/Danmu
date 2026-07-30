'use client';

// The light a fixture actually casts.
//
// Before this, every lamp in the scene was an emissive material: the shade glowed
// and the room did not change. Switching to the Evening mood dimmed everything
// while the floor lamp standing in the middle of it contributed nothing at all,
// which is the exact opposite of what an evening lighting study is for.
//
// Three things this has to get right:
//
//  · **Units.** Intensity is candela (three has been photometric since r155) and
//    comes from the fixture's lumens via lib/light-units, so a 400 lm bedside lamp
//    is genuinely half a 800 lm floor lamp.
//  · **Cost.** A shadow-casting POINT light is a cube map — six scene renders per
//    bake. A spot light is one. So only shaded downward fixtures cast, only on
//    'High', and only the two brightest in the room (see useCastsShadow).
//  · **Where the bulb is.** A light at the part's origin sits on the floor and
//    lights the underside of its own shade. LIGHT_ANCHORS puts it where the
//    geometry in DynamicPart actually draws the bulb.

import { useLayoutEffect, useRef } from 'react';
import type { Object3D, SpotLight as ThreeSpotLight } from 'three';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { lightFor, type ScenePart, type Shape } from '@/lib/scene-spec';
import { candelaFromLumens, candelaFromLumensInCone, hexFromKelvin } from '@/lib/light-units';

/**
 * Candela → renderer intensity.
 *
 * The scene's exposure is artistic, not photometric: the key light runs at ~1.1
 * where real daylight is five figures of lux. Feeding raw candela in would put a
 * bedside lamp an order of magnitude above the sun. This one constant re-bases
 * photometric values into the range the rest of the lighting already uses — the
 * RATIOS between fixtures come from the real units and survive it, which is the
 * part that matters.
 *
 * Tuned by looking at it, which is the only way: inverse-square falls off hard at
 * domestic range, so the number is set by the NEAR field, not the far one. A
 * floor lamp stands well under a metre from the sofa it lights, and the first
 * value tried here (0.1) put ~18 units on the nearest cushion — a white blob in
 * Evening, and a lamp that visibly blew out upholstery at midday.
 *
 * At 0.02 an 800 lm bulb reads ~0.6 at 1.5 m against the key light's 1.1: clearly
 * present, rolled off rather than clipped up close, and correctly almost
 * invisible at midday, which is what an 800 lm bulb does in daylight.
 */
const LIGHT_SCALE = 0.02;

/** How many lights may cast a shadow at once, on High. Each one is a full extra
 *  depth pass over the scene. */
const MAX_SHADOW_CASTERS = 2;

/** Where the bulb sits inside each fixture, in the part's local metres. These
 *  track the geometry in DynamicPart — a light at the origin would sit on the
 *  floor and illuminate the inside of its own shade. */
const LIGHT_ANCHORS: Partial<Record<Shape, [number, number, number]>> = {
  'lamp-table': [0, 0.4, 0],
  'lamp-floor': [0, 1.66, 0],
  // The pendant's geometry hangs from a mount at +0.6 and swings; the bulb ends
  // up just below the part origin.
  'lamp-pendant': [0, -0.05, 0],
};

/** Whether this fixture is one of the brightest few, and so allowed a shadow.
 *
 *  Returns a boolean rather than the set, so a lamp re-renders when its own
 *  standing changes and not every time any part in the scene moves. */
function useCastsShadow(id: string): boolean {
  const hidden = useStudio((s) => s.hidden);
  return useScene((s) => {
    const ranked = s.parts
      .filter((p) => !hidden[p.id] && lightFor(p) !== null && lightFor(p)!.coneDeg !== undefined)
      .sort((a, b) => (lightFor(b)?.lumens ?? 0) - (lightFor(a)?.lumens ?? 0))
      .slice(0, MAX_SHADOW_CASTERS);
    return ranked.some((p) => p.id === id);
  });
}

export function PartLight({ part }: { part: ScenePart }) {
  const quality = useStudio((s) => s.quality);
  const casts = useCastsShadow(part.id);
  const spot = useRef<ThreeSpotLight>(null);
  const target = useRef<Object3D>(null);

  // A spot light aims at its `target`, which by default is a detached Object3D at
  // the world origin. Pointing it means giving it an object that lives in the
  // scene graph — as a sibling here, so it inherits the lamp's transform and
  // keeps aiming down as the lamp is dragged.
  useLayoutEffect(() => {
    if (spot.current && target.current) spot.current.target = target.current;
  });

  const spec = lightFor(part);
  if (!spec) return null;

  const at = LIGHT_ANCHORS[part.shape] ?? [0, 0, 0];
  const color = hexFromKelvin(spec.kelvin);
  const hi = quality === 'high';

  if (spec.coneDeg !== undefined) {
    const intensity = candelaFromLumensInCone(spec.lumens, spec.coneDeg) * LIGHT_SCALE;
    return (
      <group position={at}>
        <spotLight
          ref={spot}
          intensity={intensity}
          color={color}
          angle={(Math.min(179, spec.coneDeg) / 2) * (Math.PI / 180)}
          penumbra={0.6}
          decay={2}
          castShadow={hi && casts}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0005}
          shadow-normalBias={0.02}
          shadow-camera-near={0.1}
          shadow-camera-far={12}
        />
        {/* Straight down. Never rendered — it exists to be aimed at. */}
        <object3D ref={target} position={[0, -3, 0]} />
      </group>
    );
  }

  // Bare bulb: radiates everywhere, and never casts — a shadow-casting point
  // light costs six renders and a table lamp does not earn them.
  return (
    <pointLight
      position={at}
      intensity={candelaFromLumens(spec.lumens) * LIGHT_SCALE}
      color={color}
      decay={2}
    />
  );
}
