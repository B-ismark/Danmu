'use client';

// Hides a wall piece's COLOUR when the dollhouse cut-away removes its wall, and
// nothing else. See `lib/near-wall.ts` for the question; this is the answer's
// mechanics, and the mechanics are the part with a trap in them.
//
// **Not `visible = false`, and not a layer.** Both take the piece out of the
// shadow pass as well: three skips an invisible object there, and in r184
// `WebGLShadowMap.renderObject` tests layers against the MAIN camera, not the
// light's. The curtains on the cut-away wall are still hanging in the room the
// sun comes into, so hiding them that way would move the shadows every time the
// camera orbited past a wall. Instead the materials stop writing colour and depth
// (the same opt-out as the shell's shadow-only ceiling) while the shadow pass,
// which draws with its own depth material, keeps casting them.
//
// It also stops the piece taking clicks while it is gone, so a press on the sofa
// behind an invisible window selects the sofa.
//
// Re-applied every frame while cut away, not just on the transition: a recolour
// or a model change remounts the piece's inline materials fresh, and those would
// otherwise draw until the camera next crossed the wall. The work is a traverse
// of one wall piece's handful of meshes, on frames that are being drawn anyway.

import { useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import type { Group, Material, Mesh, Raycaster, Intersection } from 'three';
import { cutAwayWithWall } from '@/lib/near-wall';

type Saved = { __cutDepthWrite?: boolean };
const NO_PICK = (_r: Raycaster, _i: Intersection[]) => {};

function apply(g: Group, cut: boolean) {
  g.traverse((o) => {
    const mesh = o as Mesh & { __cutRaycast?: Mesh['raycast'] };
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    if (cut && mesh.raycast !== NO_PICK) {
      mesh.__cutRaycast = mesh.raycast;
      mesh.raycast = NO_PICK;
    } else if (!cut && mesh.raycast === NO_PICK) {
      mesh.raycast = mesh.__cutRaycast!;
    }
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Array<Material & { userData: Saved }>;
    for (const m of mats) {
      if (cut) {
        if (m.colorWrite === false) continue;
        m.userData.__cutDepthWrite = m.depthWrite;
        m.colorWrite = false;
        m.depthWrite = false;
      } else if (m.userData.__cutDepthWrite !== undefined) {
        m.colorWrite = true;
        m.depthWrite = m.userData.__cutDepthWrite;
        delete m.userData.__cutDepthWrite;
      }
    }
  });
}

export function CutAway({ groupRef, depthMM }: { groupRef: RefObject<Group | null>; depthMM: number }) {
  const was = useRef(false);
  useFrame(({ camera }) => {
    const g = groupRef.current;
    if (!g) return;
    const p = g.position;
    const cut = cutAwayWithWall(
      [camera.position.x, camera.position.y, camera.position.z],
      [p.x, p.y, p.z],
      g.rotation.y,
      (depthMM / 1000) * g.scale.z,
    );
    if (cut || was.current) apply(g, cut);
    was.current = cut;
  });
  return null;
}
