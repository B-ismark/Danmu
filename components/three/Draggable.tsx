'use client';

// Part interaction. Two ways to move furniture:
//   1. DIRECT DRAG (game-style, the default): press a part and drag it across
//      the floor — it slides, snaps to walls when wall-mounted, stops against
//      obstacles, and tints red while the spot is invalid. Scroll rotates it
//      mid-drag; on touch, a second finger twists it.
//   2. GIZMO (precision): Maya-style W=move E=rotate R=scale TransformControls
//      on the selected part.
// Both paths resolve through the same deterministic placement pipeline
// (containment → wall snap → gravity → exact OBB collision) and commit through
// the same code, so behaviour never diverges. On an invalid drop the part rests
// at the LAST VALID spot of the drag (slide-up-to-the-obstacle), not back where
// it started.
//
// TOUCH: a plain touch-drag on furniture must NOT pick it up. In a furnished
// room almost every pixel is a part, so grabbing on contact left nowhere to
// orbit the camera from. Instead a touch has to dwell (~280ms) to pick the part
// up — the standard mobile "long-press to move" contract — and a touch that
// moves first is handed straight back to OrbitControls.
//
// PERFORMANCE: the canvas runs frameloop="demand", so every imperative mutation
// here asks for its own frame. Pointer input arrives faster than the display
// refreshes, so moves are coalesced to one placement resolve per animation frame,
// and the world snapshot the resolve reads is built ONCE per gesture (nothing
// else can move while you are dragging).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TransformControls } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Group, Mesh, MeshStandardMaterial, Plane, Vector3 } from 'three';
import { gestureOwnedByOther, useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { currentRoomScene } from '@/lib/room-scene';
import { useDragLive } from '@/lib/drag-live';
import { collidesAt, isParametric, type ScenePart } from '@/lib/scene-spec';
import { isFloorStanding, ridesWall } from '@/lib/physics';
import { clampDims } from '@/lib/dimension-ranges';
import { moodKeyDirection, DEFAULT_BEARING_DEG } from '@/lib/lighting-moods';
import { castsSunShadow } from '@/lib/sun-shadow';
import { type SnapLine } from '@/lib/item-snap';
import { resolvePlacement as resolveDrag, snapSteps } from '@/lib/drag-resolve';
import { cascadeTransform, snapshotDescendants, wouldCreateCycle, type DescendantOffset } from '@/lib/rigid-parent';
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

// Touch pick-up: dwell time, and how far the finger may drift while dwelling
// before we decide it is a camera gesture and let go.
const HOLD_MS = 280;
const HOLD_SLOP = 10;

/** Only one part may own a pointer gesture at a time. Without this, the second
 *  finger of a twist landing on neighbouring furniture starts a competing
 *  pick-up on THAT part and the two fight over draggingId. */
let _gestureOwner: string | null = null;

/** Coarse-pointer (finger / stylus) detection, resolved once and cached. Drives
 *  the gizmo handle size: drei's default 0.8 is far under a 44px target. */
let _coarse: boolean | null = null;
function coarsePointer(): boolean {
  if (_coarse === null) {
    _coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
  }
  return _coarse;
}

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
  cast,
  shapeKey,
}: {
  groupRef: { current: Group | null };
  finish?: ScenePart['finish'];
  colorKey?: string;
  dimKey?: string;
  /** Whether this piece may write into the key light's shadow map. False only for
   *  a wall-rider with the sun on the far side of its wall — see
   *  `lib/sun-shadow.ts` for why that is the piece's problem and not the wall's. */
  cast: boolean;
  /** The part's shape, which is NOT read in the body — it is a dependency.
   *
   *  `PartGeometry` dispatches on `part.shape`, so changing a piece's model remounts
   *  this whole subtree, and the meshes declare `castShadow` in their own JSX
   *  (`Box.tsx`, `DynamicPart.tsx`). While both said `true` the two could not
   *  disagree; now they can, and the JSX wins on remount. The Inspector's model
   *  picker writes `dimMM` on the PART rather than as a `dims` override, so none of
   *  the other keys change, the effect would not re-run, and the impossible shadow
   *  came back and stayed until the piece was recoloured or the mood switched. The
   *  same dep gap was already losing the finish on a model change. */
  shapeKey: string;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.traverse((o) => {
      const mesh = o as Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      // Part meshes receive soft shadows always, and cast unless the sun is
      // behind the wall this one is bolted to (`cast`). Idempotent — safe to
      // re-set on every pass, which is what lets the gate follow the north dial.
      mesh.castShadow = cast;
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
    // Materials were mutated outside React — nothing else will ask for a repaint.
    invalidate();
  }, [groupRef, finish, colorKey, dimKey, cast, shapeKey, invalidate]);
  return null;
}

// Scratch objects for the direct-drag raycast (no per-frame allocation).
const _plane = new Plane(new Vector3(0, 1, 0), 0);
const _hit = new Vector3();

export function Draggable({ partId, children }: { partId: string; children: ReactNode }) {
  const ref = useRef<Group | null>(null);
  const [obj, setObj] = useState<Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const part = useScene((s) => s.parts.find((p) => p.id === partId));
  // Field-level: containment + gravity need the polygon and the ceiling, nothing
  // else on `room`. Subscribing to the whole object re-rendered every part in the
  // scene on every tick of a wall drag (and on every wall repaint).
  const footprint = useScene((s) => s.room.footprint);
  const roomHeight = useScene((s) => s.room.height);

  const storedPos = useStudio((s) => s.positions[partId]);
  const storedRot = useStudio((s) => s.rotations[partId]);
  const storedDim = useStudio((s) => s.dims[partId]);

  const isSelected = useStudio((s) => s.selectedPartId === partId);
  const inSelection = useStudio((s) => s.selection.includes(partId));
  const isHovered = useStudio((s) => s.hoveredPartId === partId);
  const mode = useStudio((s) => s.transformMode);
  const snapMode = useStudio((s) => s.snapMode);
  // Snap increments, from the same module that applies them during a resolve, so
  // the gizmo's steps and the drag's magnetism can never drift apart.
  const { translate: translationSnap, rotate: rotationSnap } = snapSteps(snapMode);

  // The shadow gate. A wall-mounted piece may only cast into the sun's shadow map
  // when the sun is on the room side of the wall it is bolted to — walls never
  // cast (the dollhouse view culls the near ones), so the light goes through the
  // plaster and a TV on the far wall was dropping an impossible shadow across the
  // floor. `lib/sun-shadow.ts` holds the reasoning and the sign.
  //
  // `moodKeyDirection`, not `moodSunDirection`: the studio moods have a key light
  // too, at a fixed three-quarter position that is realised twelve metres outside
  // the room, so it stands behind the south and east walls exactly as a low sun
  // does. Reading the sun function exempted them and left the original bug
  // standing on half the walls, in the brightest mood of the set.
  //
  // Two deliberate choices about WHICH rotation this reads. It is the resolved
  // one (`storedRot ?? part.rot`), because a piece the user has turned must be
  // gated on where it now faces and not on where it was authored. And it is the
  // STORE's value rather than `ref.current.rotation.y`, which runs ahead of the
  // store mid-drag: a dot product against the live mesh would flip casting on and
  // off across the sign change while the piece turns, and a flickering shadow is
  // worse than a wrong one.
  const lighting = useStudio((s) => s.lighting);
  const bearingDeg = useScene((s) => s.room.site?.bearingDeg) ?? DEFAULT_BEARING_DEG;
  const castsShadow = part
    ? castsSunShadow(
        moodKeyDirection(lighting, bearingDeg),
        storedRot ?? part.rot,
        ridesWall(part.category, part.shape),
        part.shape,
      )
    : true;

  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setDim = useStudio((s) => s.setDim);
  const setParent = useStudio((s) => s.setParent);
  const clearParent = useStudio((s) => s.clearParent);
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
    invalidate(); // transform written straight to the object3D, not via props
  }, [storedPos, storedRot, storedDim, part, invalidate]);

  /** Snapshot every part at its effective (user-overridden) transform so
   *  collision + support see the world as it currently looks.
   *
   *  Read through getState() rather than a subscription: the override maps are
   *  replaced wholesale by their setters, so subscribing to them re-rendered
   *  EVERY Draggable on every commit — and they are never read during render,
   *  only inside these handlers. */
  function buildEffSnapshot(): ScenePart[] {
    return currentRoomScene();
  }

  // The snapshot is built ONCE per gesture and reused for every tick of it.
  // Nothing else can move while you hold a part, so re-cloning all N parts on
  // each pointermove (then feeding that to snapToNeighbors + collidesAt over all
  // N) was pure waste at input rate. Cleared when the gesture ends.
  const effCache = useRef<ScenePart[] | null>(null);
  function effParts(): ScenePart[] {
    if (!effCache.current) effCache.current = buildEffSnapshot();
    return effCache.current;
  }

  // Rigid parenting: whatever is (physically, live) resting on this part,
  // recursively. Computed once per gesture from the same frozen snapshot as
  // `effParts()` — `parentIds` cannot change mid-gesture (`setParent`/
  // `clearParent` are only ever called from `commit()`, after which both
  // caches are cleared), so there's no staleness risk in caching this too.
  const descCache = useRef<DescendantOffset[] | null>(null);
  function descendants(): DescendantOffset[] {
    if (!descCache.current) {
      descCache.current = snapshotDescendants(partId, effParts(), useStudio.getState().parentIds);
    }
    return descCache.current;
  }

  /** `effParts()` with this part's own descendants filtered out — otherwise a
   *  part being dragged can transiently resolve its own gravity/collision
   *  against a child this same commit is about to move out from under it. */
  function selfEffParts(): ScenePart[] {
    const desc = descendants();
    if (desc.length === 0) return effParts();
    const skip = new Set(desc.map((d) => d.id));
    return effParts().filter((p) => !skip.has(p.id));
  }

  /** The deterministic placement pipeline, which now lives in
   *  `lib/drag-resolve.ts` so the 2D plan resolves a drag the same way this does.
   *  What stays here is only what is genuinely three-side: the live mount height
   *  off the object3D being animated. */
  function resolvePlacement(
    rawX: number,
    rawZ: number,
    rot: number,
    dim: [number, number, number],
    effParts: ScenePart[],
  ): { pos: [number, number, number]; rot: number; valid: boolean; snapLines?: SnapLine[]; supportId?: string } {
    if (!part) return { pos: [rawX, 0, rawZ], rot, valid: false };
    return resolveDrag({
      part,
      rawX,
      rawZ,
      rot,
      dim,
      parts: effParts,
      footprint,
      roomHeight,
      snapMode,
      currentY: ref.current?.position.y,
    });
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
    invalidate(); // the object3D moved imperatively — request the repaint
  }

  function commit() {
    if (!ref.current || !part) return;
    const dim = currentDim();
    const eff = selfEffParts();
    const p = ref.current.position;
    let resolved = resolvePlacement(p.x, p.z, ref.current.rotation.y, dim, eff);

    // Invalid drop → rest at the last collision-free spot seen during this drag
    // (slide-up-to-the-obstacle); fall back to the pre-drag position.
    if (!resolved.valid) {
      const back = lastFreePos.current ?? lastValidPos.current;
      if (back) {
        const r = resolvePlacement(back[0], back[2], ref.current.rotation.y, dim, eff);
        resolved = r.valid
          ? r
          : { pos: [back[0], back[1], back[2]], rot: ref.current.rotation.y, valid: true, supportId: r.supportId };
      }
    }

    const [x, y, z] = resolved.pos;
    ref.current.position.set(x, y, z);
    ref.current.rotation.y = resolved.rot;
    setPosition(partId, [x, y, z]);
    setRotation(partId, resolved.rot);
    setDim(partId, dim);

    // Rigid parenting: dropping ON something IS what creates the relationship;
    // dropping onto the floor (or a refused cycle) breaks it. Established/
    // broken before the cascade below, using `parentIds` as it stood at
    // drag-start (this part's own link can't affect who its own descendants
    // are, so the ordering here doesn't matter to `descendants()`).
    if (resolved.supportId && !wouldCreateCycle(partId, resolved.supportId, useStudio.getState().parentIds)) {
      setParent(partId, resolved.supportId);
    } else {
      clearParent(partId);
    }

    // Carry along whatever is (physically, still) resting on this part —
    // rotation-correct, computed before the groupId loop below so that loop
    // can skip anything already placed here.
    const desc = descendants();
    const descendantIds = new Set(desc.map((d) => d.id));
    if (desc.length > 0) {
      for (const m of cascadeTransform(partId, resolved.pos, resolved.rot, desc)) {
        setPosition(m.id, m.pos);
        setRotation(m.id, m.rot);
      }
    }

    // Merged group: shift every other group member by the same translation
    // delta so the set moves as one. Only on a move (not scale/rotate). Skips
    // anything the rigid cascade above already placed — that cascade is
    // rotation-correct and must win over this translate-only one for a part
    // that happens to be both a merge-group member and a resting-on-top child.
    if (part.groupId && dragStartPos.current) {
      const sx = dragStartPos.current;
      const dx = x - sx[0];
      const dz = z - sx[2];
      if (dx !== 0 || dz !== 0) {
        // The group moves as one, so each sibling shifts from where it EFFECTIVELY
        // is — reading `o.pos` alone would snap every already-moved sibling back to
        // where the scene was authored.
        for (const o of currentRoomScene()) {
          if (o.id === partId || o.groupId !== part.groupId || descendantIds.has(o.id)) continue;
          setPosition(o.id, [o.pos[0] + dx, o.pos[1], o.pos[2] + dz]);
        }
      }
    }

    lastValidPos.current = [x, y, z];
    lastFreePos.current = null;
    setDragInvalid(false);
    setLive(null);
    invalidate();
  }

  // ─── Coalesced resolve ────────────────────────────────────────────────────
  // Pointer / wheel / twist events all just record their intent; one rAF tick
  // resolves and applies it. Multiple events inside a frame collapse into the
  // single placement the user will actually see.
  const pendingPos = useRef<[number, number] | null>(null);
  const pendingRot = useRef<number | null>(null);
  const raf = useRef(0);

  function flushGesture() {
    raf.current = 0;
    if (!ref.current || !part) return;
    const pp = pendingPos.current;
    const pr = pendingRot.current;
    pendingPos.current = null;
    pendingRot.current = null;
    if (pp === null && pr === null) return;
    const x = pp ? pp[0] : ref.current.position.x;
    const z = pp ? pp[1] : ref.current.position.z;
    const rot = pr ?? ref.current.rotation.y;
    const dim = currentDim();
    liveUpdate(resolvePlacement(x, z, rot, dim, selfEffParts()), dim);
  }

  function schedule() {
    if (!raf.current) raf.current = requestAnimationFrame(flushGesture);
  }

  function flushNow() {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
    flushGesture();
  }

  // ─── Direct drag (game-style) ─────────────────────────────────────────────
  // Press a part and pull it across the floor. A 4px threshold keeps plain
  // clicks as selection. While active, OrbitControls is off (draggingId) and
  // scrolling (or a second finger) rotates the part.
  const drag = useRef<{
    pointerId: number;
    started: boolean;
    /** false while a touch is still dwelling — the camera still owns the gesture */
    armed: boolean;
    hold: number;
    startClient: [number, number];
    planeY: number;
    offX: number;
    offZ: number;
  } | null>(null);

  // True for the life of a TransformControls (gizmo) grab on this part — set in
  // its onMouseDown, cleared in its onMouseUp. Guards onPointerDown above
  // against a second touch point starting a competing direct-drag on the same
  // mesh while the gizmo is already writing its transform.
  const gizmoActive = useRef(false);

  // Two-finger twist. Tracked at window level so the second finger does not have
  // to land on the part itself — on a nightstand there is barely room for one.
  const touchPts = useRef(new Map<number, [number, number]>());
  const twist = useRef<{ secondId: number; baseAngle: number; baseRot: number } | null>(null);

  function onWinDown(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerType !== 'touch' || e.pointerId === d.pointerId) return;
    touchPts.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (twist.current || !d.armed) return;
    const a = touchPts.current.get(d.pointerId);
    if (!a || !ref.current) return;
    twist.current = {
      secondId: e.pointerId,
      baseAngle: Math.atan2(e.clientY - a[1], e.clientX - a[0]),
      baseRot: ref.current.rotation.y,
    };
    // A twist counts as a real gesture even if the part never slid, so the
    // rotation is committed on release instead of being visually orphaned.
    if (!d.started) {
      d.started = true;
      dragStartPos.current = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      lastFreePos.current = null;
      effCache.current = buildEffSnapshot();
      descCache.current = null;
    }
  }

  function onWinMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerType !== 'touch') return;
    touchPts.current.set(e.pointerId, [e.clientX, e.clientY]);
    const t = twist.current;
    if (!t) return;
    const a = touchPts.current.get(d.pointerId);
    const b = touchPts.current.get(t.secondId);
    if (!a || !b) return;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    // Screen Y grows downward, so a clockwise twist increases `angle`, while a
    // positive Y rotation in three is counter-clockwise seen from above.
    let rot = t.baseRot - (angle - t.baseAngle);
    if (rotationSnap) rot = Math.round(rot / rotationSnap) * rotationSnap;
    pendingRot.current = rot;
    schedule();
  }

  function onWinUp(e: PointerEvent) {
    touchPts.current.delete(e.pointerId);
    if (twist.current?.secondId === e.pointerId) twist.current = null;
  }

  // Window listeners are attached imperatively for the life of a touch drag, so
  // they must not capture a stale render. These wrappers stay identity-stable
  // while always calling the current handler.
  const latest = useRef({ onWinDown, onWinMove, onWinUp });
  latest.current = { onWinDown, onWinMove, onWinUp };
  const bound = useRef<{ down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null>(null);

  function attachTouch() {
    if (bound.current) return;
    const b = {
      down: (e: PointerEvent) => latest.current.onWinDown(e),
      move: (e: PointerEvent) => latest.current.onWinMove(e),
      up: (e: PointerEvent) => latest.current.onWinUp(e),
    };
    window.addEventListener('pointerdown', b.down);
    window.addEventListener('pointermove', b.move);
    window.addEventListener('pointerup', b.up);
    window.addEventListener('pointercancel', b.up);
    bound.current = b;
  }

  function detachTouch() {
    const b = bound.current;
    if (!b) return;
    window.removeEventListener('pointerdown', b.down);
    window.removeEventListener('pointermove', b.move);
    window.removeEventListener('pointerup', b.up);
    window.removeEventListener('pointercancel', b.up);
    bound.current = null;
    touchPts.current.clear();
    twist.current = null;
  }

  // Release everything if the part unmounts mid-gesture (deleted, undone, room
  // swapped). Without this, `draggingId` is left pointing at a part that no
  // longer exists — onPointerUp/TransformControls' onMouseUp are the only other
  // places that clear it, and an unmount skips both — which the exclusivity
  // guards in Pickable/Draggable would then read as "some other gesture owns
  // every part, forever," freezing hover/select/drag on the whole room.
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (drag.current?.hold) window.clearTimeout(drag.current.hold);
      if (_gestureOwner === partId) _gestureOwner = null;
      if (useStudio.getState().draggingId === partId) setDragging(null);
      detachTouch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function onPointerDown(e: ThreeEvent<PointerEvent>) {
    if (!part || !ref.current) return;
    if (e.button !== 0) return;
    // Space held = the press belongs to the camera pan, not to the furniture
    // under it. Checked before stopPropagation so nothing here claims the
    // gesture; OrbitControls listens on the canvas element directly and gets the
    // event either way, but setDragging below would have switched it off.
    if (useStudio.getState().panKeyHeld) return;
    // Alt held = the press is asking WHICH piece, not moving one. `Pickable`
    // answers it on the click; starting a drag here first would nudge the very
    // piece the user is saying they did not mean. Same reasoning as the pan guard
    // above, and checked in the same place for the same reason.
    if (e.altKey) return;
    // The gizmo's own handles run their interaction — only grab presses on the
    // part body itself.
    e.stopPropagation();

    // The gizmo already owns this part's transform — a second finger pressing
    // its mesh body (not the handle) must not start a competing direct-drag
    // that fights the gizmo for the same position/rotation.
    if (gizmoActive.current) return;
    // A second finger is a twist, not a new grab — whether it lands on this part
    // or on the sideboard next to it.
    if (_gestureOwner && _gestureOwner !== partId) return;
    if (drag.current && e.pointerType === 'touch' && e.pointerId !== drag.current.pointerId) return;
    // A gizmo transform (or another part's direct drag) already owns the
    // gesture — the cursor landing on this part mid-rotate must not start a
    // second one here.
    if (gestureOwnedByOther(partId)) return;

    const planeY = isFloorStanding(part.category, part.shape) ? ref.current.position.y : 0;
    _plane.set(_plane.normal.set(0, 1, 0), -planeY);
    if (!e.ray.intersectPlane(_plane, _hit)) return;
    const isTouch = e.pointerType === 'touch';
    drag.current = {
      pointerId: e.pointerId,
      started: false,
      armed: !isTouch,
      hold: 0,
      startClient: [e.clientX, e.clientY],
      planeY,
      offX: _hit.x - ref.current.position.x,
      offZ: _hit.z - ref.current.position.z,
    };
    _gestureOwner = partId;
    (e.target as Element).setPointerCapture(e.pointerId);
    if (isTouch) {
      touchPts.current.set(e.pointerId, [e.clientX, e.clientY]);
      attachTouch();
      // Dwell to pick up. Until then the camera keeps the gesture, which is the
      // only way to orbit a room where furniture covers the whole viewport.
      drag.current.hold = window.setTimeout(() => {
        const d = drag.current;
        if (!d) return;
        d.armed = true;
        setDragging(partId);
        // Selecting on pick-up is the feedback that the part is now in hand.
        if (!useStudio.getState().selection.includes(partId)) useStudio.getState().setSelected(partId);
      }, HOLD_MS);
    } else {
      // Park the camera immediately so the press never orbits.
      setDragging(partId);
    }
  }

  /** Give the gesture back to OrbitControls — a touch that moved before it
   *  dwelled was a camera drag all along. */
  function abandonDrag(e: ThreeEvent<PointerEvent>) {
    const d = drag.current;
    if (!d) return;
    if (d.hold) window.clearTimeout(d.hold);
    try {
      (e.target as Element).releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
    drag.current = null;
    if (_gestureOwner === partId) _gestureOwner = null;
    detachTouch();
  }

  function onPointerMove(e: ThreeEvent<PointerEvent>) {
    const d = drag.current;
    if (!d || !part || !ref.current) return;
    if (!d.armed) {
      const drift = Math.hypot(e.clientX - d.startClient[0], e.clientY - d.startClient[1]);
      if (drift > HOLD_SLOP) abandonDrag(e);
      return;
    }
    // While twisting, the fingers are rotating the part — not sliding it.
    if (twist.current) {
      e.stopPropagation();
      return;
    }
    if (!d.started) {
      const dist = Math.hypot(e.clientX - d.startClient[0], e.clientY - d.startClient[1]);
      if (dist < 4) return;
      d.started = true;
      dragStartPos.current = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      lastFreePos.current = null;
      effCache.current = buildEffSnapshot(); // one world snapshot for the gesture
      descCache.current = null;
      if (!inSelection) useStudio.getState().setSelected(partId);
      document.body.style.cursor = 'grabbing';
    }
    e.stopPropagation();
    _plane.set(_plane.normal.set(0, 1, 0), -d.planeY);
    if (!e.ray.intersectPlane(_plane, _hit)) return;
    // Raw, deliberately. `resolvePlacement` quantises to the snap grid as its
    // first step now, so both tabs get the grid from one place; rounding here as
    // well is how the 3D view and the plan came to disagree about where it is.
    pendingPos.current = [_hit.x - d.offX, _hit.z - d.offZ];
    schedule();
  }

  function onPointerUp(e: ThreeEvent<PointerEvent>) {
    const d = drag.current;
    if (!d) return;
    if (d.hold) window.clearTimeout(d.hold);
    drag.current = null;
    if (_gestureOwner === partId) _gestureOwner = null;
    detachTouch();
    try {
      (e.target as Element).releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.cursor = '';
    if (d.started) {
      flushNow(); // land the last sub-frame move before resolving the drop
      commit();
    }
    effCache.current = null;
    descCache.current = null;
    if (d.armed) setDragging(null);
    setLive(null);
    setDragInvalid(false);
  }

  function onWheel(e: ThreeEvent<WheelEvent>) {
    // Rotate the part under the cursor mid-drag (Sims-style). Touch gets the
    // same job done with a second finger — see onWinMove.
    const d = drag.current;
    if (!d || !d.started || !part || !ref.current) return;
    e.stopPropagation();
    const step = rotationSnap ?? Math.PI / 36; // 5° when snapping is off
    const dir = e.deltaY > 0 ? 1 : -1;
    pendingRot.current = (pendingRot.current ?? ref.current.rotation.y) + dir * step;
    schedule();
  }

  // ─── Gizmo live feedback ──────────────────────────────────────────────────
  function onGizmoChange() {
    if (!ref.current || !part) return;
    if (mode !== 'translate') return; // rotate/scale resolve on commit
    const p = ref.current.position;
    pendingPos.current = [p.x, p.z];
    schedule();
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
        <FinishApplier
          groupRef={ref}
          finish={part.finish}
          colorKey={part.color}
          dimKey={storedDim?.join()}
          cast={castsShadow}
          shapeKey={part.shape}
        />
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
          // Fingers need a target roughly twice the size a mouse does.
          size={coarsePointer() ? 1.5 : 0.8}
          translationSnap={mode === 'translate' ? translationSnap : null}
          rotationSnap={mode === 'rotate' ? rotationSnap : null}
          onObjectChange={onGizmoChange}
          onMouseDown={() => {
            gizmoActive.current = true;
            setDragging(partId);
            const pp = ref.current?.position;
            dragStartPos.current = pp ? [pp.x, pp.y, pp.z] : null;
            lastFreePos.current = null;
            effCache.current = buildEffSnapshot();
            descCache.current = null;
          }}
          onMouseUp={() => {
            flushNow();
            commit();
            effCache.current = null;
            descCache.current = null;
            setDragging(null);
            gizmoActive.current = false;
          }}
        />
      )}
    </>
  );
}
