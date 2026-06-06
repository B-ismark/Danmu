'use client';

// Render a GLB pulled from the local mesh cache (lib/mesh-cache.ts).
// Falls back to null while loading; caller is expected to render the primitive
// shape as a placeholder until this resolves.
//
// Three-stdlib's GLTFLoader works in browser only — this file MUST stay client.

import { useEffect, useMemo, useState } from 'react';
import { Box3, Vector3 } from 'three';
import type { Group } from 'three';
import { GLTFLoader } from 'three-stdlib';
import { meshCache } from '@/lib/mesh-cache';
import type { ScenePart } from '@/lib/scene-spec';

export function CachedMesh({ part }: { part: ScenePart }) {
  const [scene, setScene] = useState<Group | null>(null);

  useEffect(() => {
    if (!part.meshHash) return;
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      const rec = await meshCache.get(part.meshHash!);
      if (!rec?.glb) return;
      url = URL.createObjectURL(rec.glb);
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          if (cancelled) return;
          setScene(gltf.scene);
        },
        undefined,
        // GLB load error — silently fall back; placeholder primitive stays visible.
        () => undefined,
      );
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [part.meshHash]);

  // Compute uniform scale so the GLB's longest axis matches the part's longest
  // dimension, then re-anchor:
  //   - floor-standing parts: bottom of GLB sits on local Y=0 (parent group's
  //     pos[1] is the floor level for these).
  //   - wall-mounted parts: GLB stays centered on local origin so the parent's
  //     mounting-height pos[1] aligns with the mesh's midpoint.
  const fit = useMemo(() => {
    if (!scene) return null;
    const bbox = new Box3().setFromObject(scene);
    const size = new Vector3();
    bbox.getSize(size);
    const longestMesh = Math.max(size.x, size.y, size.z) || 1;
    const longestPart = Math.max(part.dimMM[0], part.dimMM[1], part.dimMM[2]) / 1000;
    const s = longestPart / longestMesh;
    const center = new Vector3();
    bbox.getCenter(center);
    const yOffset = part.wallMounted ? -center.y * s : -bbox.min.y * s;
    return {
      s,
      offset: [-center.x * s, yOffset, -center.z * s] as [number, number, number],
    };
  }, [scene, part.dimMM, part.wallMounted]);

  if (!scene || !fit) return null;
  return (
    <group scale={[fit.s, fit.s, fit.s]} position={fit.offset}>
      <primitive object={scene} />
    </group>
  );
}
