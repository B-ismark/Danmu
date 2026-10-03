'use client';

// The see-through piece that follows a Library drag over the 3D room, standing exactly
// where the drop would put it.
//
// Where it stands is `planPiece` (`lib/add-piece.ts`) — the drop's own computation —
// so a lamp over a desk shows ON the desk, a wall piece shows snapped to its wall, and
// a sofa aimed at a spot the armchair holds shows at the clear spot it will move to.
//
// **What it wears is what a carried piece wears, by the same components.** A piece
// dragged in the room stands on `Highlight`'s base (terracotta rim, light red on a
// spot it cannot go) under `SizeTag`'s W × D reading; the ghost mounts those two, with
// the state a carried piece would have, rather than drawing an imitation of them. Its
// first version was a body at 45% opacity with no base and no size, and it read as a
// rumour of a piece rather than a preview of one — the user's word was "too ghostly".
// A refusal is the base going red and the tag saying `blocked`, like a drag, plus
// the reason beside the pointer (`DropGhostSay`): finding that out only after
// letting go is what this exists to prevent.
//
// **It moves without React.** A drag repaints at the pointer's rate, and the first
// version re-rendered the whole `PartGeometry` subtree (and walked every material)
// on every one of those moves, then asked for a frame from a layout effect — so a
// move reached the screen a render and a frame late. Now `dropCarry`'s listener
// writes the pose straight onto the group and invalidates, and React renders only
// when WHAT is shown changes (`ghostLook`): another piece, refused or not, there or
// not. The size tag rides inside the group, so it moves with it for free.
//
// The body is the real `PartGeometry`, made translucent after it mounts: every
// material is CLONED before it is touched (the shapes share some materials, and
// fading a shared one would fade the real piece too), shadows and lights are switched
// off, and the meshes refuse raycasts so the ghost can never be the thing a click or
// the drop's own ray hits.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import type { Group, Light, Material, Mesh } from 'three';
import { dropCarry, ghostLook, sameLook, type GhostLook } from '@/lib/drop-carry';
import type { NewPiece } from '@/lib/add-piece';
import { anchorFor, isFloorStanding } from '@/lib/physics';
import { isRoundPart, type ScenePart } from '@/lib/scene-spec';
import { PartGeometry } from './DynamicPart';
import { Highlight } from './Highlight';
import { SizeTag, sizeTagLift } from './DragTag';

/** How see-through the body is. Solid enough to judge its size, colour and bulk
 *  against the room — 0.45 read as a rumour of a piece — and still translucent
 *  enough, with the base and the tag under and over it, never to be mistaken for a
 *  piece that is already standing there. */
export const GHOST_OPACITY = 0.78;
const noRaycast = () => {};

export function DropGhost() {
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const [look, setLook] = useState<GhostLook | null>(() => ghostLook(dropCarry.ghost()));

  useLayoutEffect(() => {
    function follow() {
      const g = dropCarry.ghost();
      const next = ghostLook(g);
      // Re-rendered only when what is SHOWN changes; a move is a transform write.
      setLook((was) => (sameLook(was, next) ? was : next));
      const pose = g?.plan.pose;
      const node = group.current;
      if (pose && node) {
        node.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        node.rotation.set(0, pose.rot, 0);
      }
      // The scene draws on demand; a ghost that moved without asking would not be seen.
      invalidate();
    }
    follow();
    return dropCarry.subscribe(follow);
  }, [invalidate]);

  // Always mounted, so the listener above has a group to write to on the very first
  // move; hidden, and empty, while nothing is carried.
  return (
    <group ref={group} visible={look !== null} name="drop-ghost">
      {look && <GhostBody item={look.item} refused={look.refused} />}
    </group>
  );
}

const GhostBody = memo(function GhostBody({ item, refused }: { item: NewPiece; refused: boolean }) {
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
  const floor = isFloorStanding(item.category, item.shape);
  return (
    <>
      <FadedBody part={part} />
      {/* The carried piece's own base and tag, in the state a carried piece would be
          in: 'selected' while it may go there, 'invalid' where it may not. */}
      <Highlight dimMM={item.dimMM} sizeMM={item.dimMM} anchor={anchorFor(item.category, item.shape)} state={refused ? 'invalid' : 'selected'} />
      <SizeTag position={[0, sizeTagLift(item.dimMM, floor), 0]} dimMM={item.dimMM} valid={!refused} />
    </>
  );
});

/** The real geometry, translucent. Its own group, so the fade reaches the body and
 *  nothing else — the base and the tag beside it keep the materials they were given. */
function FadedBody({ part }: { part: ScenePart }) {
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
  // Once per piece (the part is memoised on the item), not once per move: this walk
  // ran on every pointer move when the pose was a prop.
  useLayoutEffect(() => {
    ref.current?.traverse((o) => {
      if ((o as Light).isLight) {
        o.visible = false;
        return;
      }
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh.userData.ghosted) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = noRaycast;
      const fade = (m: Material) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = GHOST_OPACITY * (m.transparent ? m.opacity : 1);
        // Writes depth at this opacity: a body this solid showing its own far side
        // through its near one reads as a wireframe, not as a piece.
        c.depthWrite = true;
        clones.current.add(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fade) : fade(mesh.material);
      mesh.userData.ghosted = true;
    });
  }, [part]);
  return (
    <group ref={ref}>
      <PartGeometry part={part} locked={false} />
    </group>
  );
}

const useGhost = () => useSyncExternalStore(dropCarry.subscribe, dropCarry.ghost, () => null);

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
