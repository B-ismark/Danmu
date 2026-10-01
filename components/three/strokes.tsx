'use client';

// Outline strokes — drei's <Edges> and <Line> — and the one layer they live on.
//
// **A stroke is not a surface, but it is built from one.** Both are three-stdlib
// `LineSegments2`: a Mesh whose geometry is a single template quad, x −1..1 and
// y −1..2 in the stroke's own frame, instanced once per segment. Only
// `LineMaterial`'s vertex shader turns that quad into a line. Any pass that swaps
// the material draws the quad itself — a 2 × 3 m sheet — and drei's
// <ContactShadows> does exactly that: it sets `scene.overrideMaterial` to a depth
// material and renders the whole scene from below the floor. Nothing in it is
// filtered by `castShadow`.
//
// At rest the sheets stand upright, seen exactly edge-on from straight below,
// and draw nothing. **The carry is what showed them:** a piece leans while it is
// moved (`lib/wobble.ts`), the lean tips each sheet off edge-on, and the floor
// shadow — re-baked every frame of a drag — painted a dark streak two metres long
// through each outlined part. A bed's four edged legs gave two, at its head and its
// foot. Pieces with no outline (a sofa, a wardrobe) never showed it, which is why
// it read as a bed bug.
//
// So every stroke goes on `STROKE_LAYER` and not on layer 0. The main camera sees
// both (`SeeStrokes`); the contact-shadow camera keeps three's default of layer
// 0 alone, so a stroke is never an occluder there. The cast shadow maps are not
// this layer's business: three r184 tests layers against the MAIN camera in the
// shadow pass (see `CutAway.tsx`), and no stroke casts.
// Off layer 0 also means off the default raycaster, which costs nothing — drei's
// <Edges> already refuses rays, and nothing presses a grid or a wall frame. And no
// stroke casts because `Draggable`'s `ShadowCaster`, which turns casting on for every
// mesh in a piece, asks `isStroke` and skips them: a stroke IS a mesh to three.
//
// **The colour is a prop, never a material child.** drei v10 spreads its leftover
// props onto the `LineMaterial` too, so a `<lineBasicMaterial>` child attaches to
// that material's `.material` and does nothing — every outline drew opaque white at
// 1 px whatever colour it asked for. The wrappers' props have no `children`, so
// `tsc` refuses the old spelling rather than letting it draw white in silence.
//
// `tests/strokes.test.tsx` fails on a drei <Edges> or <Line> imported anywhere
// else, because a stroke that skips this file brings the streak straight back.

import { Edges as DreiEdges, Line as DreiLine } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect, type ComponentProps } from 'react';
import type { Object3D } from 'three';

export const STROKE_LAYER = 1;

export function Edges(props: Omit<ComponentProps<typeof DreiEdges>, 'children'>) {
  return <DreiEdges {...props} layers={STROKE_LAYER} />;
}

export function Line(props: Omit<ComponentProps<typeof DreiLine>, 'children'>) {
  return <DreiLine {...props} layers={STROKE_LAYER} />;
}

/** Is this object one of the strokes above? Asked by the layer, which is the one
 *  thing every stroke here has and no surface does. */
export function isStroke(o: Object3D): boolean {
  return o.layers.isEnabled(STROKE_LAYER) && !o.layers.isEnabled(0);
}

/** Lets the main camera see the stroke layer. Mounted once, inside the Canvas. */
export function SeeStrokes() {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    camera.layers.enable(STROKE_LAYER);
    // frameloop="demand" — nothing else asks for the frame that shows them.
    invalidate();
  }, [camera, invalidate]);
  return null;
}
