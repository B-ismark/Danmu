'use client';

// Part interaction. Two ways to move furniture:
//   1. DIRECT DRAG (game-style, the default): press a part and drag it across
//      the floor — it slides, snaps to walls when wall-mounted, stops against
//      obstacles, and tints red while the spot is invalid. Scroll rotates it
//      mid-drag.
//   2. GIZMO (precision): Maya-style W=move E=rotate R=scale TransformControls
//      on the selected part.
// Both paths resolve through the same deterministic placement pipeline
// (containment → wall snap → gravity → exact OBB collision) and commit through
// the same code, so behaviour never diverges. On an invalid drop the part rests
// at the LAST VALID spot of the drag (slide-up-to-the-obstacle), not back where
// it started.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TransformControls } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';
import { Group, Mesh, MeshStandardMaterial, Plane, Vector3 } from 'three';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { useDragLive } from '@/lib/drag-live';
import { collidesAt, isParametric, isWallMountedPart, type ScenePart } from '@/lib/scene-spec';
import { groundY, isFloorStanding, snapToWall } from '@/lib/physics';
import { pointInFootprint, footprintBounds } from '@/lib/footprint';
import { clampDims } from '@/lib/dimension-ranges';
import { obbFromPart, obbInsidePoly } from '@/lib/geometry';
import { snapToNeighbors, type SnapLine } from '@/lib/item-snap';
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

// Scratch objects for the direct-drag raycast (no per-frame allocation).
const _plane = new Plane(new Vector3(0, 1, 0), 0);
const _hit = new Vector3();

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
  const allRotations = useStudio((s) => s.rotations);
  const allDims = useStudio((s) => s.dims);

  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setDim = useStudio((s) => s.setDim);
  const setDragging = useStudio((s) => s.setDragging);
  const setLive = useDragLive((s) => s.setLive);

  // Red tint while the live drag spot is invalid. Only flips at boundary
  // crossings, so it never causes per-frame React churn.
  const [dragInvalid, setDragInvalid] = useState(false);

  const lastValidPos = useRef<[number, number, number] | null>(null);
  // Last collision-free spot DURING the current drag — an invalid drop falls
  // back here (slide up to the obstacle) instead of reverting the whole drag.
  const lastFreePos = useRef<[number, number, number] | null>(null);
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

  /** Snapshot every part at its effective (user-overridden) transform so
   *  collision + support see the world as it currently looks. */
  function effSnapshot(): ScenePart[] {
    return allParts.map((o) => ({
      ...o,
      pos: allPositions[o.id] ?? o.pos,
      rot: allRotations[o.id] ?? o.rot,
      dimMM: allDims[o.id] ?? o.dimMM,
    }));
  }

  /** The shared deterministic placement pipeline: containment clamp → wall
   *  snap (wall-mounted) → gravity/support → vertical clamp. Returns the
   *  resolved position + whether it is a legal spot (in-room, collision-free). */
  function resolvePlacement(
    rawX: number,
    rawZ: number,
    rot: number,
    dim: [number, number, number],
    effParts: ScenePart[],
  ): { pos: [number, number, number]; rot: number; valid: boolean; snapLines?: SnapLine[] } {
    if (!part) return { pos: [rawX, 0, rawZ], rot, valid: false };

    // Containment clamp — keep the part's whole rotated footprint inside the
    // bounding box of the room (footprints can be off-centre after independent
    // wall moves).
    const halfW = dim[0] / 2000;
    const halfD = dim[1] / 2000;
    const c = Math.abs(Math.cos(rot));
    const sn = Math.abs(Math.sin(rot));
    const extX = halfW * c + halfD * sn;
    const extZ = halfW * sn + halfD * c;
    const bnd = footprintBounds(room.footprint);
    let x = Math.max(bnd.minX + extX, Math.min(bnd.maxX - extX, rawX));
    let z = Math.max(bnd.minZ + extZ, Math.min(bnd.maxZ - extZ, rawZ));
    let outRot = rot;
    let snapLines: SnapLine[] | undefined;

    // Wall-mounted items (TV, mirror, painting, AC, curtain) ride the NEAREST
    // wall — edge-exact against the footprint polygon, so they slide along
    // L/T/U inner walls too, always facing into the room.
    const wallMounted = isWallMountedPart(part.category, part.shape);
    if (wallMounted) {
      const snapped = snapToWall([x, 0, z], dim, room.footprint);
      x = snapped.x;
      z = snapped.z;
      if (snapped.rot !== undefined) outRot = snapped.rot;
    } else if (snapMode !== 'off') {
      // Magnetic item-to-item snapping — edges flush / centres aligned against
      // neighbouring furniture (Sims-style). Reported lines drive the green
      // alignment guides in MeasureGuides.
      const snapped = snapToNeighbors(x, z, outRot, dim, effParts, partId);
      x = Math.max(bnd.minX + extX, Math.min(bnd.maxX - extX, snapped.x));
      z = Math.max(bnd.minZ + extZ, Math.min(bnd.maxZ - extZ, snapped.z));
      if (snapped.lines.length > 0) snapLines = snapped.lines;
    }

    // Gravity rules:
    //   floor-standing items (sofa, bed, fridge, wardrobe, etc.) MUST sit on a
    //     surface — top of another part if XZ overlap exists, else the floor.
    //   wall / ceiling-mounted items anchor to their canonical mounting height.
    const centered = !isFloorStanding(part.category, part.shape);
    const partH = dim[2] / 1000;
    let y: number;
    if (part.category === 'rug') {
      y = 0;
    } else if (!centered) {
      y = topmostSupport(effParts, partId, x, z) ?? 0;
    } else {
      // Wall/ceiling-mounted: keep the user's chosen mount height (set via the
      // gizmo's Y axis or the Inspector) while sliding along walls. Fresh parts
      // (no meaningful current y yet) fall back to the canonical height.
      const curY = ref.current?.position.y ?? NaN;
      y = Number.isFinite(curY) && curY > 0.01 ? curY : groundY(part.category, part.shape, dim, room.height);
    }

    // Vertical containment — keep the whole part between floor and ceiling.
    if (centered) {
      y = Math.max(partH / 2 + 0.02, Math.min(room.height - partH / 2 - 0.02, y));
    } else if (y + partH > room.height - 0.02) {
      y = Math.max(0, room.height - 0.02 - partH);
    }

    // Legality: inside the actual polygon (catches L/T/U notches the bounding
    // box can't) + collision-free. Wall-mounted parts skip the polygon check —
    // the snap just put them exactly on an edge.
    const slightlyShrunk = obbFromPart([x, y, z], outRot, [dim[0] - 10, dim[1] - 10, dim[2]]);
    const inRoom =
      wallMounted ||
      part.category === 'rug' ||
      (obbInsidePoly(slightlyShrunk, room.footprint) && pointInFootprint(x, z, room.footprint));
    const collides = collidesAt(effParts, partId, [x, y, z], outRot, dim);

    return { pos: [x, y, z], rot: outRot, valid: inRoom && !collides, snapLines };
  }

  /** Current dims from the group's live scale (the scale gizmo writes scale,
   *  commit converts to mm), clamped into the shape's real-world range. */
  function currentDim(): [number, number, number] {
    if (!ref.current || !part) return part?.dimMM ?? [100, 100, 100];
    const s = ref.current.scale;
    let dim: [number, number, number] = [
      part.dimMM[0] * s.x,
      part.dimMM[1] * s.z,
      part.dimMM[2] * s.y,
    ];
    if (mode === 'scale') {
      // Snap the resulting dims to the increment (TransformControls has no
      // native scaleSnap)…
      if (snapMode !== 'off') {
        const stepMM = snapMode === 'fine' ? 10 : 50;
        dim = [
          Math.max(stepMM, Math.round(dim[0] / stepMM) * stepMM),
          Math.max(stepMM, Math.round(dim[1] / stepMM) * stepMM),
          Math.max(stepMM, Math.round(dim[2] / stepMM) * stepMM),
        ];
      }
      // …then clamp into the trustable range for this shape (a laptop can't
      // stretch to a metre; a dining table legitimately can).
      dim = clampDims(part.category, part.shape, dim);
      ref.current.scale.set(dim[0] / part.dimMM[0], dim[2] / part.dimMM[2], dim[1] / part.dimMM[1]);
    }
    return dim;
  }

  /** Per-frame feedback shared by both drag paths. Moves the mesh to the
   *  resolved spot, records the last collision-free position, publishes the
   *  live channel, and tints the highlight when invalid. */
  function liveUpdate(resolved: { pos: [number, number, number]; rot: number; valid: boolean; snapLines?: SnapLine[] }, dim: [number, number, number]) {
    if (!ref.current || !part) return;
    ref.current.position.set(resolved.pos[0], resolved.pos[1], resolved.pos[2]);
    ref.current.rotation.y = resolved.rot;
    if (resolved.valid) lastFreePos.current = [resolved.pos[0], resolved.pos[1], resolved.pos[2]];
    setLive({
      partId,
      x: resolved.pos[0],
      y: resolved.pos[1],
      z: resolved.pos[2],
      rot: resolved.rot,
      dimMM: dim,
      floor: isFloorStanding(part.category, part.shape),
      valid: resolved.valid,
      snapLines: resolved.snapLines,
    });
    setDragInvalid((prev) => (prev === !resolved.valid ? prev : !resolved.valid));
  }

  function commit() {
    if (!ref.current || !part) return;
    const dim = currentDim();
    const effParts = effSnapshot();
    const p = ref.current.position;
    let resolved = resolvePlacement(p.x, p.z, ref.current.rotation.y, dim, effParts);

    // Invalid drop → rest at the last collision-free spot seen during this drag
    // (slide-up-to-the-obstacle); fall back to the pre-drag position.
    if (!resolved.valid) {
      const back = lastFreePos.current ?? lastValidPos.current;
      if (back) {
        const r = resolvePlacement(back[0], back[2], ref.current.rotation.y, dim, effParts);
        resolved = r.valid ? r : { pos: [back[0], back[1], back[2]], rot: ref.current.rotation.y, valid: true };
      }
    }

    const [x, y, z] = resolved.pos;
    ref.current.position.set(x, y, z);
    ref.current.rotation.y = resolved.rot;
    setPosition(partId, [x, y, z]);
    setRotation(partId, resolved.rot);
    setDim(partId, dim);

    // Merged group: shift every other group member by the same translation
    // delta so the set moves as one. Only on a move (not scale/rotate).
    if (part.groupId && dragStartPos.current) {
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
    lastFreePos.current = null;
    setDragInvalid(false);
    setLive(null);
  }

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

  // ─── Direct drag (game-style) ─────────────────────────────────────────────
  // Press a part and pull it across the floor. A 4px threshold keeps plain
  // clicks as selection. While active, OrbitControls is off (draggingId) and
  // scrolling rotates the part.
  const drag = useRef<{
    pointerId: number;
    started: boolean;
    startClient: [number, number];
    planeY: number;
    offX: number;
    offZ: number;
  } | null>(null);

  function onPointerDown(e: ThreeEvent<PointerEvent>) {
    if (!part || !ref.current) return;
    if (e.button !== 0) return;
    // The gizmo's own handles run their interaction — only grab presses on the
    // part body itself.
    e.stopPropagation();
    const planeY = isFloorStanding(part.category, part.shape) ? ref.current.position.y : 0;
    _plane.set(_plane.normal.set(0, 1, 0), -planeY);
    if (!e.ray.intersectPlane(_plane, _hit)) return;
    drag.current = {
      pointerId: e.pointerId,
      started: false,
      startClient: [e.clientX, e.clientY],
      planeY,
      offX: _hit.x - ref.current.position.x,
      offZ: _hit.z - ref.current.position.z,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
    // Park the camera immediately so the press never orbits.
    setDragging(partId);
  }

  function onPointerMove(e: ThreeEvent<PointerEvent>) {
    const d = drag.current;
    if (!d || !part || !ref.current) return;
    if (!d.started) {
      const dist = Math.hypot(e.clientX - d.startClient[0], e.clientY - d.startClient[1]);
      if (dist < 4) return;
      d.started = true;
      dragStartPos.current = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      lastFreePos.current = null;
      if (!inSelection) useStudio.getState().setSelected(partId);
      document.body.style.cursor = 'grabbing';
    }
    e.stopPropagation();
    _plane.set(_plane.normal.set(0, 1, 0), -d.planeY);
    if (!e.ray.intersectPlane(_plane, _hit)) return;
    let nx = _hit.x - d.offX;
    let nz = _hit.z - d.offZ;
    if (translationSnap) {
      nx = Math.round(nx / translationSnap) * translationSnap;
      nz = Math.round(nz / translationSnap) * translationSnap;
    }
    const dim = currentDim();
    liveUpdate(resolvePlacement(nx, nz, ref.current.rotation.y, dim, effSnapshot()), dim);
  }

  function onPointerUp(e: ThreeEvent<PointerEvent>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      (e.target as Element).releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.cursor = '';
    if (d.started) commit();
    setDragging(null);
    setLive(null);
    setDragInvalid(false);
  }

  function onWheel(e: ThreeEvent<WheelEvent>) {
    // Rotate the part under the cursor mid-drag (Sims-style).
    const d = drag.current;
    if (!d || !d.started || !part || !ref.current) return;
    e.stopPropagation();
    const step = rotationSnap ?? Math.PI / 36; // 5° when snapping is off
    const dir = e.deltaY > 0 ? 1 : -1;
    const rot = ref.current.rotation.y + dir * step;
    const dim = currentDim();
    liveUpdate(
      resolvePlacement(ref.current.position.x, ref.current.position.z, rot, dim, effSnapshot()),
      dim,
    );
  }

  // ─── Gizmo live feedback ──────────────────────────────────────────────────
  function onGizmoChange() {
    if (!ref.current || !part) return;
    if (mode !== 'translate') return; // rotate/scale resolve on commit
    const p = ref.current.position;
    const dim = currentDim();
    liveUpdate(resolvePlacement(p.x, p.z, ref.current.rotation.y, dim, effSnapshot()), dim);
  }

  // Translate / Scale: all 3 axes. Rotate: Y only (around vertical).
  const showX = mode !== 'rotate';
  const showY = true;
  const showZ = mode !== 'rotate';

  if (!part) return null;

  const highlightState = dragInvalid ? 'invalid' : inSelection ? 'selected' : 'hovered';

  return (
    <>
      <group
        ref={(node) => {
          ref.current = node;
          setObj(node);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <FinishApplier groupRef={ref} finish={part.finish} colorKey={part.color} dimKey={storedDim?.join()} />
        <Pickable partId={partId}>{children}</Pickable>
        {(inSelection || isHovered || dragInvalid) && (
          <Highlight
            dimMM={isParametric(part.shape) ? (storedDim ?? part.dimMM) : part.dimMM}
            floorStanding={isFloorStanding(part.category, part.shape)}
            state={highlightState}
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
          onObjectChange={onGizmoChange}
          onMouseDown={() => {
            setDragging(partId);
            const pp = ref.current?.position;
            dragStartPos.current = pp ? [pp.x, pp.y, pp.z] : null;
            lastFreePos.current = null;
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
