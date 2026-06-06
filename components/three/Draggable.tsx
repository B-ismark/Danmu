'use client';

// Maya-style transform: gizmo attaches to selected part. W=move E=rotate R=scale.
// Reads scene defaults from useScene + overrides from useStudio.
// Commits with collision check (rugs/mats exempt) — reverts on overlap.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TransformControls } from '@react-three/drei';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { collidesAt, isParametric, isWallMountedPart, type ScenePart } from '@/lib/scene-spec';
import { groundY, isFloorStanding } from '@/lib/physics';
import { pointInFootprint } from '@/lib/footprint';
import { Pickable } from './Pickable';
import { Highlight } from './Highlight';

// Roughness/metalness + reflection strength per surface finish. envMapIntensity
// leans on the scene IBL so 'polished'/'metal' actually catch reflections (the
// cheap stand-in for clearcoat/physical materials).
const FINISH_PRESET: Record<'matte' | 'satin' | 'polished' | 'metal', { roughness: number; metalness: number; env: number }> = {
  matte: { roughness: 0.95, metalness: 0.0, env: 0.5 },
  satin: { roughness: 0.6, metalness: 0.0, env: 1.0 },
  polished: { roughness: 0.22, metalness: 0.05, env: 1.6 },
  metal: { roughness: 0.32, metalness: 0.85, env: 1.8 },
};

type FinishMat = MeshStandardMaterial & {
  userData: { __origRough?: number; __origMetal?: number; __origEnv?: number };
};

// Applies the part's surface finish to every standard material in the group by
// overriding roughness/metalness. Caches each material's original values the
// first time it's touched so 'auto' restores the shape's hand-tuned look. Skips
// emissive materials (lamp glows, screens) so light sources stay lit. Re-runs
// when finish/colour/dims change — those recreate the inline materials, so the
// override is re-applied to the fresh instances.
function FinishApplier({
  groupRef,
  finish,
  colorKey,
  dimKey,
}: {
  groupRef: { current: Group | null };
  finish?: ScenePart['finish'];
  colorKey?: string;
  dimKey?: string;
}) {
  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.traverse((o) => {
      const mesh = o as Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      // Part meshes cast + receive soft shadows (gated at the light/Canvas by
      // the quality setting). Idempotent — safe to re-set on every pass.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!(m instanceof MeshStandardMaterial)) continue;
        const mat = m as FinishMat;
        if (mat.emissiveIntensity && mat.emissiveIntensity > 0) continue; // keep lights lit
        if (mat.userData.__origRough === undefined) {
          mat.userData.__origRough = mat.roughness;
          mat.userData.__origMetal = mat.metalness;
          mat.userData.__origEnv = mat.envMapIntensity;
        }
        if (finish && finish !== 'auto') {
          const p = FINISH_PRESET[finish];
          mat.roughness = p.roughness;
          mat.metalness = p.metalness;
          mat.envMapIntensity = p.env;
        } else {
          mat.roughness = mat.userData.__origRough!;
          mat.metalness = mat.userData.__origMetal ?? 0;
          mat.envMapIntensity = mat.userData.__origEnv ?? 1;
        }
        mat.needsUpdate = true;
      }
    });
  }, [groupRef, finish, colorKey, dimKey]);
  return null;
}

export function Draggable({ partId, children }: { partId: string; children: ReactNode }) {
  const ref = useRef<Group | null>(null);
  const [obj, setObj] = useState<Group | null>(null);

  const part = useScene((s) => s.parts.find((p) => p.id === partId));
  const allParts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);

  const storedPos = useStudio((s) => s.positions[partId]);
  const storedRot = useStudio((s) => s.rotations[partId]);
  const storedDim = useStudio((s) => s.dims[partId]);

  const isSelected = useStudio((s) => s.selectedPartId === partId);
  const inSelection = useStudio((s) => s.selection.includes(partId));
  const isHovered = useStudio((s) => s.hoveredPartId === partId);
  const mode = useStudio((s) => s.transformMode);
  const snapMode = useStudio((s) => s.snapMode);
  // Snap increments. 'fine' = 10mm / 15° (nudging); 'coarse' = 50mm / 45° (which
  // also lands cleanly on 90/135/180°); 'off' = free drag.
  const translationSnap =
    snapMode === 'off' ? null : snapMode === 'fine' ? 0.01 : 0.05;
  const rotationSnap =
    snapMode === 'off' ? null : snapMode === 'fine' ? Math.PI / 12 : Math.PI / 4;

  // Live override maps — needed so support/collision sees furniture where it
  // ACTUALLY is (after the user moved it), not its stale detected position.
  const allPositions = useStudio((s) => s.positions);
  const allDims = useStudio((s) => s.dims);

  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setDim = useStudio((s) => s.setDim);
  const setDragging = useStudio((s) => s.setDragging);

  const lastValidPos = useRef<[number, number, number] | null>(null);
  // Position captured at drag start — used to move merged-group siblings by the
  // same delta when the dragged part belongs to a group.
  const dragStartPos = useRef<[number, number, number] | null>(null);

  // Apply transforms whenever stored values change.
  useEffect(() => {
    if (!ref.current || !part) return;
    const p = storedPos ?? part.pos;
    ref.current.position.set(p[0], p[1], p[2]);
    ref.current.rotation.y = storedRot ?? part.rot;
    // Parametric parts (sofa, curtain, wardrobe, bookshelf, shoe-rack) rebuild
    // their geometry from the effective dim — the mesh must NOT be group-scaled
    // or it would stretch on top of the rebuild. The scale-gizmo still scales
    // live during a drag; commit() converts that to a dim and this effect resets
    // the scale to 1, leaving the geometry to redraw at the new size.
    if (storedDim && !isParametric(part.shape)) {
      const sx = storedDim[0] / part.dimMM[0];
      const sy = storedDim[2] / part.dimMM[2];
      const sz = storedDim[1] / part.dimMM[1];
      ref.current.scale.set(sx, sy, sz);
    } else {
      ref.current.scale.set(1, 1, 1);
    }
    lastValidPos.current = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
  }, [storedPos, storedRot, storedDim, part]);

  function commit() {
    if (!ref.current || !part) return;
    const p = ref.current.position;

    // current dim (may have changed via scale)
    const s = ref.current.scale;
    const dim: [number, number, number] = [
      part.dimMM[0] * s.x,
      part.dimMM[1] * s.z,
      part.dimMM[2] * s.y,
    ];

    // Dimension snapping on scale — TransformControls has no scaleSnap, so we
    // snap the resulting dims to the increment (10mm fine / 50mm coarse) and
    // write the snapped scale back so the mesh matches what gets committed.
    if (mode === 'scale' && snapMode !== 'off') {
      const stepMM = snapMode === 'fine' ? 10 : 50;
      dim[0] = Math.max(stepMM, Math.round(dim[0] / stepMM) * stepMM);
      dim[1] = Math.max(stepMM, Math.round(dim[1] / stepMM) * stepMM);
      dim[2] = Math.max(stepMM, Math.round(dim[2] / stepMM) * stepMM);
      ref.current.scale.set(dim[0] / part.dimMM[0], dim[2] / part.dimMM[2], dim[1] / part.dimMM[1]);
    }

    // Containment clamp — keep the part's whole rotated footprint inside the
    // walls so nothing pokes through (the thin dollhouse walls now reveal any
    // overhang). Project the half-extents onto the world axes for the current
    // yaw; a thin wall-hung item ends up with a tiny inset so it sits flush.
    const rot = ref.current.rotation.y;
    const halfW = dim[0] / 2000;
    const halfD = dim[1] / 2000;
    const c = Math.abs(Math.cos(rot));
    const sn = Math.abs(Math.sin(rot));
    const extX = halfW * c + halfD * sn;
    const extZ = halfW * sn + halfD * c;
    let x = Math.max(-room.width / 2 + extX, Math.min(room.width / 2 - extX, p.x));
    let z = Math.max(-room.depth / 2 + extZ, Math.min(room.depth / 2 - extZ, p.z));
    // Non-rectangular rooms: if the centre left the polygon (e.g. dragged into an
    // L/U notch), snap back to the last valid spot instead of floating over void.
    if (!pointInFootprint(x, z, room.footprint) && lastValidPos.current) {
      x = lastValidPos.current[0];
      z = lastValidPos.current[2];
    }

    // Relationship snap — wall-mounted items (TV, mirror, painting, AC, curtain)
    // snap flush to the NEAREST wall instead of floating mid-room. Position only;
    // rotation stays user-controlled. Rectangular-bounds approximation.
    if (isWallMountedPart(part.category, part.shape)) {
      const hw = room.width / 2;
      const hd = room.depth / 2;
      const dW = x + hw, dE = hw - x, dS = z + hd, dN = hd - z;
      const m = Math.min(dW, dE, dS, dN);
      if (m === dW) x = -hw + extX;
      else if (m === dE) x = hw - extX;
      else if (m === dS) z = -hd + extZ;
      else z = hd - extZ;
    }

    // Gravity rules:
    //   floor-standing items (sofa, bed, fridge, wardrobe, etc.) MUST sit on a
    //     surface — top of another part if XZ overlap exists, else the floor.
    //   wall / ceiling-mounted items (TV, fan, mirror, AC, curtain) anchor to
    //     their canonical mounting height regardless of drag.
    // `centered` (mesh drawn around the group origin) is the source of truth for
    // wall/ceiling-mounted parts — derived from the anchor, not the possibly-stale
    // wallMounted flag, so mirrors etc. behave even if mislabelled on add.
    // Snapshot every OTHER part at its effective (overridden) pos + dims so a
    // laptop dropped on a moved table actually finds the table's top.
    const effParts: ScenePart[] = allParts.map((o) => ({
      ...o,
      pos: allPositions[o.id] ?? o.pos,
      dimMM: allDims[o.id] ?? o.dimMM,
    }));

    const centered = !isFloorStanding(part.category, part.shape);
    const partH = dim[2] / 1000;
    let y = p.y;
    if (part.category === 'rug') {
      y = 0;
    } else if (!centered) {
      const support = topmostSupport(effParts, partId, x, z);
      y = support ?? 0;
    } else {
      // wall / ceiling mounted — clamp to canonical height for current dim.
      y = groundY(part.category, part.shape, dim, room.height);
    }

    // Vertical containment — keep the whole part between floor and ceiling.
    if (centered) {
      // centred mesh: clamp the centre so neither edge crosses floor/ceiling.
      y = Math.max(partH / 2 + 0.02, Math.min(room.height - partH / 2 - 0.02, y));
    } else {
      if (y + partH > room.height - 0.02) y = Math.max(0, room.height - 0.02 - partH);
    }

    // collision check (Y-aware, so stacking passes) — against effective positions
    const proposedPos: [number, number, number] = [x, y, z];
    if (collidesAt(effParts, partId, proposedPos, ref.current.rotation.y, dim) && lastValidPos.current) {
      const lp = lastValidPos.current;
      ref.current.position.set(lp[0], lp[1], lp[2]);
      setPosition(partId, lp);
      return;
    }

    ref.current.position.set(x, y, z);
    setPosition(partId, [x, y, z]);
    setRotation(partId, ref.current.rotation.y);
    setDim(partId, dim);

    // Merged group: shift every other group member by the same translation
    // delta so the set moves as one. Only on a move (not scale/rotate).
    if (mode === 'translate' && part.groupId && dragStartPos.current) {
      const sx = dragStartPos.current;
      const dx = x - sx[0];
      const dz = z - sx[2];
      if (dx !== 0 || dz !== 0) {
        for (const o of allParts) {
          if (o.id === partId || o.groupId !== part.groupId) continue;
          const op = allPositions[o.id] ?? o.pos;
          setPosition(o.id, [op[0] + dx, op[1], op[2] + dz]);
        }
      }
    }

    lastValidPos.current = [x, y, z];
  }

  // (FinishApplier defined at module scope below)

  /** Return Y of the highest part top under (x,z) within mover's footprint, or null. */
  function topmostSupport(
    parts: ScenePart[],
    movingId: string,
    x: number,
    z: number,
  ): number | null {
    let best: number | null = null;
    for (const o of parts) {
      if (o.id === movingId) continue;
      if (o.category === 'rug') continue;
      if (o.wallMounted) continue;
      const ow = o.dimMM[0] / 1000;
      const od = o.dimMM[1] / 1000;
      const oh = o.dimMM[2] / 1000;
      const dx = x - o.pos[0];
      const dz = z - o.pos[2];
      // Mover centre must sit over the support's footprint — a circle test
      // grabbed a neighbour's top (mid-air) instead of dropping to the floor.
      if (Math.abs(dx) < ow / 2 + 0.05 && Math.abs(dz) < od / 2 + 0.05) {
        const top = o.pos[1] + oh;
        if (best === null || top > best) best = top;
      }
    }
    return best;
  }

  // Translate / Scale: all 3 axes. Rotate: Y only (around vertical).
  const showX = mode !== 'rotate';
  const showY = true;
  const showZ = mode !== 'rotate';

  if (!part) return null;

  return (
    <>
      <group
        ref={(node) => {
          ref.current = node;
          setObj(node);
        }}
      >
        <FinishApplier groupRef={ref} finish={part.finish} colorKey={part.color} dimKey={storedDim?.join()} />
        <Pickable partId={partId}>{children}</Pickable>
        {(inSelection || isHovered) && (
          <Highlight
            dimMM={isParametric(part.shape) ? (storedDim ?? part.dimMM) : part.dimMM}
            floorStanding={isFloorStanding(part.category, part.shape)}
            state={inSelection ? 'selected' : 'hovered'}
          />
        )}
      </group>
      {isSelected && obj && (
        <TransformControls
          object={obj}
          mode={mode}
          showX={showX}
          showY={showY}
          showZ={showZ}
          size={0.8}
          translationSnap={mode === 'translate' ? translationSnap : null}
          rotationSnap={mode === 'rotate' ? rotationSnap : null}
          onMouseDown={() => {
            setDragging(partId);
            const pp = ref.current?.position;
            dragStartPos.current = pp ? [pp.x, pp.y, pp.z] : null;
          }}
          onMouseUp={() => {
            commit();
            setDragging(null);
          }}
        />
      )}
    </>
  );
}
