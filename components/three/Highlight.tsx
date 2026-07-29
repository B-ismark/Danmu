'use client';

// Visual feedback for pointer interaction with a part. The studio store already
// tracks hoveredPartId / selectedPartId (see lib/store.ts) and Pickable writes
// to them, but nothing was drawn on the mesh — so a user could not SEE what they
// were touching or what was selected (only the cursor changed + the gizmo
// appeared). This renders, inside the part's group (so it inherits the live
// position / rotation / scale), three cues:
//
//   • hovered  → a soft outlined bounding box (subtle, depth-tested)
//   • selected → a bright accent bounding box that shows THROUGH occluders
//                (depthTest off) so the selection is never lost behind a wall,
//                plus a footprint outline on the resting surface for placement.
//
// Box dims come from the part's BASE dimMM. The group's runtime scale (set in
// Draggable from the gizmo) multiplies these the same way it scales the
// geometry, so the highlight always tracks the real size.

import { useMemo } from 'react';
import { Edges, Line } from '@react-three/drei';
import { SCENE } from '@/lib/scene-palette';

export function Highlight({
  dimMM,
  floorStanding,
  state,
}: {
  dimMM: [number, number, number];
  floorStanding: boolean;
  /** 'invalid' wins over 'selected' wins over 'hovered' — caller decides. */
  state: 'selected' | 'hovered' | 'invalid';
}) {
  const w = dimMM[0] / 1000;
  const d = dimMM[1] / 1000;
  const h = dimMM[2] / 1000;

  // Floor-standing geometry is anchored base-at-0, so its centre is h/2.
  // Wall / ceiling-mounted geometry is drawn around the group origin (centre 0).
  const centerY = floorStanding ? h / 2 : 0;
  const selected = state !== 'hovered';
  // All three from lib/scene-palette — the same terracotta / sage / danger the
  // panels use, so a selection reads identically in the 3D view, the plan and
  // the inspector.
  const color = state === 'invalid' ? SCENE.invalid : selected ? SCENE.accent : SCENE.accentHover;

  // Footprint loop on the resting surface (local y ≈ 0). Only meaningful for
  // floor / surface-resting parts — wall-mounted items have no footprint.
  const footprint = useMemo<[number, number, number][]>(() => {
    const hw = w / 2;
    const hd = d / 2;
    const y = 0.004;
    return [
      [-hw, y, -hd],
      [hw, y, -hd],
      [hw, y, hd],
      [-hw, y, hd],
      [-hw, y, -hd],
    ];
  }, [w, d]);

  return (
    // userData.helper lets SceneCapture hide this while it grabs the PNG, so an
    // editor-only cue never bakes into the exported image.
    <group userData={{ helper: true }}>
      {/* Bounding box — slightly inflated so its edges sit just outside the mesh. */}
      <mesh position={[0, centerY, 0]} renderOrder={998}>
        <boxGeometry args={[w * 1.03, h * 1.03, d * 1.03]} />
        <meshBasicMaterial
          transparent
          opacity={selected ? 0.05 : 0.03}
          color={color}
          depthWrite={false}
          depthTest={!selected}
        />
        <Edges threshold={15} renderOrder={999}>
          <lineBasicMaterial
            color={color}
            transparent
            opacity={selected ? 1 : 0.55}
            // Selection shows through occluders; hover respects depth so it
            // does not bleed through other furniture while scrubbing the scene.
            depthTest={!selected}
          />
        </Edges>
      </mesh>

      {selected && floorStanding && (
        <Line points={footprint} color={color} lineWidth={state === 'invalid' ? 2.5 : 1.5} transparent opacity={state === 'invalid' ? 0.95 : 0.7} />
      )}
    </group>
  );
}
