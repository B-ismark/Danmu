'use client';

// The translucent piece that follows a Library drag over the 3D room, standing exactly
// where the drop would put it.
//
// Where it stands is `planPiece` (`lib/add-piece.ts`) — the drop's own computation —
// so a lamp over a desk shows ON the desk, a wall piece shows snapped to its wall, and
// a sofa aimed at a spot the armchair holds shows at the clear spot it will move to.
// A piece the drop would refuse shows in the refusal colour, with the reason beside
// the pointer: finding that out only after letting go is what this exists to prevent.
//
// The body is the real `PartGeometry`, made see-through after it mounts: every
// material is CLONED before it is touched (the shapes share some materials, and
// fading a shared one would fade the real piece too), shadows and lights are switched
// off, and the meshes refuse raycasts so the ghost can never be the thing a click or
// the drop's own ray hits.

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import { Color, type Group, type Light, type Material, type Mesh } from 'three';
import { dropCarry, type Ghost } from '@/lib/drop-carry';
import { isRoundPart, type ScenePart } from '@/lib/scene-spec';
import { SCENE } from '@/lib/scene-palette';
import { PartGeometry } from './DynamicPart';

const useGhost = () => useSyncExternalStore(dropCarry.subscribe, dropCarry.ghost, () => null);

/** How see-through the ghost is: solid enough to judge its size against the room,
 *  faint enough never to be mistaken for a piece that is already there. */
export const GHOST_OPACITY = 0.45;
const REFUSED = new Color(SCENE.invalid);
const noRaycast = () => {};

export function DropGhost() {
  const ghost = useGhost();
  const invalidate = useThree((s) => s.invalidate);
  // The scene draws on demand; a ghost that moved without asking would not be seen.
  useLayoutEffect(() => invalidate(), [ghost, invalidate]);
  return ghost?.plan.pose ? <GhostBody ghost={ghost} /> : null;
}

function GhostBody({ ghost }: { ghost: Ghost }) {
  const { item, plan } = ghost;
  const refused = 'refused' in plan;
  const pose = plan.pose;
  // One part per carried item: re-keying on every move would remount the geometry
  // sixty times a second.
  const part = useMemo<ScenePart>(
    () => ({
      id: '__ghost__',
      name: item.label,
      category: item.category,
      shape: item.shape,
      dimMM: item.dimMM,
      pos: [0, 0, 0],
      rot: 0,
      locked: false,
      circle: isRoundPart(item.shape),
    }),
    [item],
  );
  const ref = useRef<Group>(null);
  // The faded copies are ours, not R3F's: it disposes the materials it created, which
  // are no longer on any mesh, so without this every drag would leave its copies on
  // the GPU for the rest of the session.
  const clones = useRef(new Set<Material>());
  useEffect(() => {
    const made = clones.current;
    return () => {
      made.forEach((m) => m.dispose());
      made.clear();
    };
  }, []);
  useLayoutEffect(() => {
    ref.current?.traverse((o) => {
      if ((o as Light).isLight) {
        o.visible = false;
        return;
      }
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = noRaycast;
      if (!mesh.userData.ghosted) {
        const fade = (m: Material) => {
          const c = m.clone();
          c.transparent = true;
          c.opacity = GHOST_OPACITY * (m.transparent ? m.opacity : 1);
          c.depthWrite = false;
          c.userData.color = (c as Material & { color?: Color }).color?.clone();
          clones.current.add(c);
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fade) : fade(mesh.material);
        mesh.userData.ghosted = true;
      }
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const col = (m as Material & { color?: Color }).color;
        const was = m.userData.color as Color | undefined;
        if (col && was) col.copy(refused ? REFUSED : was);
      }
    });
  });
  if (!pose) return null;
  return (
    <group ref={ref} position={pose.pos} rotation-y={pose.rot}>
      <PartGeometry part={part} locked={false} />
    </group>
  );
}

/** The reason a drop here would be refused, beside the pointer. A DOM element over
 *  the canvas rather than text in the scene, so it reads at one size at any zoom. */
export function DropGhostSay() {
  const ghost = useGhost();
  if (!ghost || !('refused' in ghost.plan)) return null;
  return (
    <p className="drop-ghost-say t-micro" role="status" style={{ left: ghost.at.x, top: ghost.at.y }}>
      {ghost.plan.refused}
    </p>
  );
}
