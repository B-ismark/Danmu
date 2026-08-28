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
import { clearDragClick, suppressClickAfterDrag } from '@/lib/drag-click';
import { useScene } from '@/lib/scene-store';
import { currentRoomScene } from '@/lib/room-scene';
import { renderBaseDim, resolvePart } from '@/lib/transforms';
import { useDragLive } from '@/lib/drag-live';
import { announce } from '@/components/studio/KeyboardShortcuts';
import {
  dimFromGroupScale,
  groupScaleForDim,
  isParametric,
  selectionForPick,
  type ScenePart,
} from '@/lib/scene-spec';
import { isFloorStanding } from '@/lib/physics';
import { clampDims } from '@/lib/dimension-ranges';
import { type SnapLine } from '@/lib/item-snap';
import { resolvePlacement as resolveDrag, snapSteps } from '@/lib/drag-resolve';
import { wouldCreateCycle } from '@/lib/rigid-parent';
import { convoyRestore, gestureFor, planConvoy, resolveConvoy, travellingWorld, type Convoy, type ConvoyResult } from '@/lib/drag-convoy';
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
  shapeKey,
}: {
  groupRef: { current: Group | null };
  finish?: ScenePart['finish'];
  colorKey?: string;
  dimKey?: string;
  /** The part's shape, which is NOT read in the body — it is a dependency, and it
   *  is load-bearing.
   *
   *  `PartGeometry` dispatches on `part.shape`, so changing a piece's model remounts
   *  this whole subtree and its materials come back fresh. The Inspector's model
   *  picker writes `dimMM` on the PART rather than as a `dims` override, so no other
   *  key in the dep array below changes — the effect did not re-run, and the FINISH
   *  was silently lost: pick a new model for a polished piece and it came back matte
   *  until something else made you recolour it.
   *
   *  It arrived alongside a per-piece sun-shadow gate that has since been deleted
   *  (the room is a closed shell now — see `components/three/RoomShell.tsx`), and it
   *  is easy to read as the other half of that removal. It is not. The finish bug
   *  predates the gate and is still here. */
  shapeKey: string;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.traverse((o) => {
      const mesh = o as Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      // Part meshes cast and receive. Whether the sun can actually reach a piece is
      // the room's question, not the piece's: the walls and ceiling cast, so a piece
      // on a wall the sun is behind is simply in shadow (`RoomShell.tsx`).
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
    // Materials were mutated outside React — nothing else will ask for a repaint.
    invalidate();
  }, [groupRef, finish, colorKey, dimKey, shapeKey, invalidate]);
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

  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setTransformsFor = useStudio((s) => s.setTransformsFor);
  const setDim = useStudio((s) => s.setDim);
  const setParent = useStudio((s) => s.setParent);
  const clearParent = useStudio((s) => s.clearParent);
  const setDragging = useStudio((s) => s.setDragging);
  const setLive = useDragLive((s) => s.setLive);
  /** Is THIS piece one of the ones the current gesture cannot place?
   *
   *  A per-part selector rather than a subscription to the whole live channel: the
   *  selector runs on every frame of every drag in the room, but it returns a
   *  boolean, so React re-renders this part only when its own answer flips. That is
   *  what keeps the channel's promise — per-frame updates re-render the few light
   *  consumers, never the whole part tree. */
  const blockedHere = useDragLive((s) => !!s.live?.blockedIds?.includes(partId));

  // Red tint while the live drag spot is invalid. Only flips at boundary
  // crossings, so it never causes per-frame React churn.
  const [dragInvalid, setDragInvalid] = useState(false);

  /** What the last refusal SAID, so a streak that changes its mind says so and one
   *  that does not stays quiet. See `liveUpdate`. */
  const saidRef = useRef<string | null>(null);
  const lastValidPos = useRef<[number, number, number] | null>(null);
  // Last collision-free spot DURING the current drag — an invalid drop falls
  // back here (slide up to the obstacle) instead of reverting the whole drag.
  const lastFreePos = useRef<[number, number, number] | null>(null);
  // Position captured at drag start — used to move merged-group siblings by the
  // same delta when the dragged part belongs to a group.
  const dragStartPos = useRef<[number, number, number] | null>(null);
  /** Where it was pointing when the gesture began, for the same reason as
   *  `dragStartPos`: `convoyRestore` replays the cascade from BOTH, and a restore
   *  that put the position back but not the rotation would leave a turned desk's
   *  lamp orbiting a pivot that no longer matches it. */
  const dragStartRot = useRef<number | null>(null);
  /** Set by Escape. The gesture is over as far as the scene is concerned, but the
   *  pointer is still down and the browser still holds the capture — so rather
   *  than tear down here and leave `onPointerUp` to return early past its own
   *  `releasePointerCapture`, the release runs the normal teardown and skips only
   *  the commit. Same for the gizmo's `onMouseUp`. */
  const cancelled = useRef(false);

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
      const [sx, sy, sz] = groupScaleForDim(part.dimMM, storedDim);
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

  // Everything this gesture carries: whatever is (physically, live) resting on
  // this part, the rest of the multi-selection, and any merged group either of
  // those belongs to. Computed once per gesture from the same frozen snapshot as
  // `effParts()` — `parentIds` cannot change mid-gesture (`setParent`/
  // `clearParent` are only ever called from `commit()`, after which both caches
  // are cleared), so there's no staleness risk in caching this either.
  const convoyCache = useRef<Convoy | null>(null);
  function convoy(): Convoy {
    if (!convoyCache.current) {
      convoyCache.current = planConvoy({
        draggedId: partId,
        parts: effParts(),
        selection: useStudio.getState().selection,
        parentIds: useStudio.getState().parentIds,
        footprint,
        roomHeight,
      });
    }
    return convoyCache.current;
  }

  /** `effParts()` with the travelling company moved to where the gesture is taking
   *  it — see `travellingWorld`, which is the same list the members resolve
   *  against. It filtered them out instead, which is why dragging two chairs
   *  selected side by side refused on the first pixel (each was the other's
   *  obstacle, at the position it was about to leave) and, once that was fixed by
   *  deletion rather than by shifting, why dragging a lamp that was selected along
   *  with the desk under it dropped the lamp on the floor.
   *
   *  Takes the RAW pointer position, not the resolved one: the accepted delta is
   *  what this call is on the way to working out. */
  function travelWorld(rawX: number, rawZ: number): ScenePart[] {
    const c = convoy();
    if (c.travelling.size <= 1) return effParts();
    const start = dragStartPos.current;
    const dx = start ? rawX - start[0] : 0;
    const dz = start ? rawZ - start[2] : 0;
    // `c.own`: this piece's own rigid children ride along, so they are not in its
    // way and — the half that bit — cannot be its floor. See `travellingWorld`.
    return travellingWorld(c, effParts(), dx, dz, c.own);
  }

  /** Which gesture is in flight — `lib/drag-convoy.ts` owns the rule, and the
   *  reasoning, because in here it could not be tested. Both refs are read at call
   *  time rather than remembered at pointer-down: `gizmoActive` is set in the
   *  gizmo's own `onMouseDown` and cleared after `commit()` in its `onMouseUp`,
   *  which is exactly the span the answer has to cover. */
  function currentGesture(): 'move' | 'turn' {
    return gestureFor(gizmoActive.current, mode, rotOnly.current);
  }

  /** Where the company lands for a given transform of this part. */
  function carry(pos: [number, number, number], rot: number): ConvoyResult {
    return resolveConvoy({
      gesture: currentGesture(),
      convoy: convoy(),
      draggedId: partId,
      pos,
      rot,
      startPos: dragStartPos.current ?? pos,
      // The whole world: `resolveConvoy` subtracts the convoy per member itself.
      parts: effParts(),
      footprint,
      roomHeight,
      // Read live, not captured at pointer-down: the first legal frame of THIS
      // gesture is what creates a member's override, and the zero-delta frame that
      // has to put it back may well be the second one.
      memberHasPosOverride: (id) => useStudio.getState().positions[id] !== undefined,
    });
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
      // Null unless this piece rides a wall and has company: a wall flip mid-drag
      // is a jump the whole set would translate by. See `Convoy.leadEdge`.
      wallEdge: convoy().leadEdge,
    });
  }

  /** Current dims from the group's live scale (the scale gizmo writes scale,
   *  commit converts to mm), clamped into the shape's real-world range. */
  function currentDim(): [number, number, number] {
    if (!ref.current || !part) return part?.dimMM ?? [100, 100, 100];
    // What this group renders at scale 1 — which is NOT always the authored size.
    //
    // A parametric shape (sofa, curtain, WARDROBE, bookshelf, shoe-rack) rebuilds
    // its geometry from the effective dim, so the effect above deliberately leaves
    // its group at scale 1 and the mesh carries the resize. Everything else keeps
    // authored geometry and wears the resize as a group scale. Multiplying the
    // AUTHORED dim by the live scale is only right for the second kind: for the
    // first it returns the authored size no matter how the piece was resized, and
    // `commit()` writes that straight back through `setDim` — so resizing a
    // wardrobe and then merely MOVING it threw the resize away, in exactly the five
    // shapes `isParametric` names and nowhere else, which is why it reported as
    // "sometimes".
    //
    // Read from the store rather than the subscribed `storedDim`: `commit` runs from
    // handlers that can outlive the render that captured it.
    const base = renderBaseDim(part, useStudio.getState());
    let dim = dimFromGroupScale(base, ref.current.scale);
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
      const [sx, sy, sz] = groupScaleForDim(base, dim);
      ref.current.scale.set(sx, sy, sz);
    }
    return dim;
  }

  /** Per-frame feedback shared by both drag paths. Moves the mesh to the
   *  resolved spot, brings the company with it, records the last collision-free
   *  position, publishes the live channel, and tints the highlight when invalid.
   *
   *  The company moves LIVE, through the store, rather than at the drop. This part
   *  can afford to skip the store because the drag animates its own object3D; the
   *  others cannot be reached that way, and a set that only catches up on release
   *  is indistinguishable from a set that is not coming. */
  function liveUpdate(resolved: { pos: [number, number, number]; rot: number; valid: boolean; snapLines?: SnapLine[] }, dim: [number, number, number]) {
    if (!ref.current || !part) return;
    ref.current.position.set(resolved.pos[0], resolved.pos[1], resolved.pos[2]);
    ref.current.rotation.y = resolved.rot;
    // The convoy has a veto: a spot this piece could take but its company cannot
    // is not a spot the gesture may rest at, so it must not be remembered as the
    // fallback `commit()` slides back to either.
    const co = carry(resolved.pos, resolved.rot);
    const valid = resolved.valid && co.valid;
    // Say it, not just draw it. Design.md claimed both tabs spoke this sentence;
    // only the plan did, and there was no `announce(` anywhere under
    // components/three/ — so in 3D a refusal was a colour change and a tag, and to
    // a screen reader it was nothing at all. Keyed on what is being said so a drag
    // held against one obstacle says it once, and a drag whose blocker CHANGES says
    // the new one. Cleared on every legal frame, so the next refusal speaks again.
    if (valid) {
      saidRef.current = null;
    } else {
      // The same gate the size tag applies to `blockedBy` below, and it has to be
      // the same one: when the piece under the hand is ITSELF stuck, "blocked" is
      // already the right word and naming a member points at the wrong piece. The
      // two had drifted — the tag on `resolved.valid && co.blocked`, this sentence
      // on `co.blocked` alone — so on a frame where the dragged piece and a member
      // were both stuck, the tag read "blocked" with no name while the live region
      // spoke a different piece's name. A sighted screen-reader user got two
      // answers; anyone relying on the sentence got the wrong piece.
      const namesMember = resolved.valid ? co.blocked : undefined;
      const saying = namesMember ? `blocker:${namesMember.id}` : `self:${partId}`;
      if (saidRef.current !== saying) {
        saidRef.current = saying;
        announce(
          namesMember
            ? `${namesMember.name} will not fit there — the rest of the selection cannot follow.`
            : `${part.name} will not fit there — something is in the way.`,
        );
      }
    }
    if (valid) {
      lastFreePos.current = [resolved.pos[0], resolved.pos[1], resolved.pos[2]];
      // Only on a legal step. On an illegal one the set holds at the last legal
      // delta while the piece under the hand goes red and keeps following the
      // pointer — the separation IS the feedback, and the drop reunites them.
      if (co.moves.length > 0) setTransformsFor(co.moves);
    }
    setLive({
      partId,
      x: resolved.pos[0],
      y: resolved.pos[1],
      z: resolved.pos[2],
      rot: resolved.rot,
      dimMM: dim,
      floor: isFloorStanding(part.category, part.shape),
      valid,
      // Every piece to draw red — the whole set, exactly as the plan draws it. The
      // dragged piece is always in it, because it is the one outline guaranteed to be
      // on screen and a refusal with nothing visible reads as the drag being broken;
      // the members are in it because 3D named one in the size tag and outlined
      // nobody, so the piece actually in trouble could be off the side of the view
      // with nothing pointing at it. Empty on a legal frame rather than stale.
      blockedIds: valid ? [] : [partId, ...co.blockedIds],
      // Only when this piece itself fits: if the thing under the hand is the
      // problem, `blocked` is already the right word and naming a member would
      // point at the wrong piece. `co.blocked` was computed here from the start
      // and then dropped on the floor, so the 3D tab refused a set in silence
      // while the plan named the piece — one rule, two consumers, again.
      blockedBy: resolved.valid && co.blocked ? co.blocked.name : undefined,
      snapLines: resolved.snapLines,
    });
    setDragInvalid((prev) => (prev === !valid ? prev : !valid));
    invalidate(); // the object3D moved imperatively — request the repaint
  }

  function commit() {
    if (!ref.current || !part) return;
    const dim = currentDim();
    const p = ref.current.position;
    let resolved = resolvePlacement(p.x, p.z, ref.current.rotation.y, dim, travelWorld(p.x, p.z));
    let co = carry(resolved.pos, resolved.rot);

    // Invalid drop → rest at the last spot of the drag where the WHOLE convoy was
    // clear (slide-up-to-the-obstacle); fall back to the pre-drag position. The
    // convoy is re-asked at that spot rather than assumed, and it comes back legal
    // by construction from both branches — `lastFreePos` is only written on a frame
    // where the company fitted, and `lastValidPos` is this piece's pre-drag
    // position, which makes the delta zero and the company's answer "stay".
    if (!resolved.valid || !co.valid) {
      const back = lastFreePos.current ?? lastValidPos.current;
      if (back) {
        // Rebuilt at `back`, not reused from the drop point: the world the convoy
        // occupies is a function of the delta, so a world built for a spot the
        // gesture is no longer resting at puts the company in the wrong place.
        const r = resolvePlacement(back[0], back[2], ref.current.rotation.y, dim, travelWorld(back[0], back[2]));
        // `r`, whole — never `back` raw with the live angle written beside it, which
        // is what this did. `resolvePlacement` returns a CONTAINMENT-CLAMPED position
        // whether or not the frame came out legal, so throwing it away on the invalid
        // branch discarded the one correction that always applies, and replaced it
        // with a combination nothing had ever run through containment: the pre-gesture
        // position, which was legal for the OLD angle and the OLD size.
        //
        // Harmless for a translate — `back` is a spot this piece already stood in at
        // this angle and size — and the whole defect for the other two gestures, since
        // a rotate and a scale never move the piece, so `back` IS where it is standing
        // and the only thing that changed is the extent being tested against the
        // walls. Turning the lead of a merged set into its own siblings makes the
        // resolve invalid by collision, so that was the branch every such turn took:
        // the bed kept the angle, kept the position, and was committed with its corner
        // through the plaster. It also claimed `valid: true` on the way out, which is
        // why nothing went red.
        resolved = r;
        co = carry(r.pos, r.rot);
      }
    }

    const [x, y, z] = resolved.pos;
    ref.current.position.set(x, y, z);
    ref.current.rotation.y = resolved.rot;
    setPosition(partId, [x, y, z]);
    setRotation(partId, resolved.rot);
    // A write is not free. Per lib/transforms.ts an override PINS its value against
    // a re-detect and persists into IndexedDB and the scene file, and this stamped
    // one on every drop — so every piece the user had ever merely moved was pinned
    // at its size, by a gesture that never touched a size. Same reason
    // `ConvoyMove.rot` is optional, one field over.
    const heldDim = resolvePart(part, useStudio.getState()).dimMM;
    if (dim[0] !== heldDim[0] || dim[1] !== heldDim[1] || dim[2] !== heldDim[2]) setDim(partId, dim);

    // Rigid parenting: dropping ON something IS what creates the relationship;
    // dropping onto the floor (or a refused cycle) breaks it. Established/
    // broken before the cascade below, using `parentIds` as it stood at
    // drag-start (this part's own link can't affect who its own descendants
    // are, so the ordering here doesn't matter to the convoy).
    if (resolved.supportId && !wouldCreateCycle(partId, resolved.supportId, useStudio.getState().parentIds)) {
      setParent(partId, resolved.supportId);
    } else {
      clearParent(partId);
    }

    // Everything the gesture carried, landed in one store update: this part's
    // rigid children about its resolved pivot, the rest of the multi-selection and
    // any merged group either belongs to, each by the delta this part accepted.
    // See lib/drag-convoy.ts — the three used to be two hand-written loops here
    // and one nowhere at all.
    // `co.valid` gates this, as `ConvoyResult.moves` says it must. `liveUpdate`
    // and the plan's `moveTo` both gated it and this did not, so a drop with no
    // legal frame behind it (`lastFreePos` and `lastValidPos` both null, i.e. the
    // very first gesture on a freshly loaded room) wrote the refused arrangement.
    // Members are only ever written on a legal frame, so skipping them here leaves
    // them at the last delta the whole set could take — which is the fallback the
    // block above describes.
    if (co.valid && co.moves.length > 0) setTransformsFor(co.moves);

    lastValidPos.current = [x, y, z];
    lastFreePos.current = null;
    setDragInvalid(false);
    // The gesture is over, so the next refusal is news again even if it names the
    // same piece. Without this a drag that ended while refusing left the key set and
    // the following drag hit the same obstacle in silence.
    saidRef.current = null;
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
    // Cleared FIRST, before any early return. It sat after the `cancelled` check,
    // so pressing Escape mid-drag and then moving the pointer once more left the
    // id set forever: `schedule()` is gated on `!raf.current`, so the NEXT drag of
    // this piece scheduled nothing, published no live update, and the mesh sat
    // frozen under the cursor until the drop teleported it. The third drag was
    // fine again, which is what made it read as flaky rather than broken.
    raf.current = 0;
    // Escape ended this gesture; the pointer is just still down.
    if (cancelled.current) return;
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
    liveUpdate(resolvePlacement(x, z, rot, dim, travelWorld(x, z)), dim);
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

  /** True while the last thing the user did to this piece was TURN it rather than
   *  slide it — a wheel notch or a two-finger twist.
   *
   *  `currentGesture` needs it because the gizmo is not the only way to rotate.
   *  `resolveConvoy` is told which gesture is in flight precisely because the
   *  containment clamp is a function of ROTATION: turn a 2 m sofa against a wall
   *  and its z half-extent grows, so the piece is legitimately pushed away from the
   *  plaster and the resolved position moves although the pointer never did. Read
   *  as a translation, that push is copied to the whole selection. The gizmo path
   *  was covered from the start; the wheel and the twist set `pendingRot` without
   *  ever touching `gizmoActive`, so both still reported "move" and still carried
   *  the set across the room. Cleared by the first pointer move that actually
   *  slides the piece, so a drag-then-turn-then-drag reports each honestly. */
  const rotOnly = useRef(false);

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
      dragStartRot.current = ref.current.rotation.y;
      cancelled.current = false;
      lastFreePos.current = null;
      effCache.current = buildEffSnapshot();
      convoyCache.current = null;
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
    rotOnly.current = true;
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

  // Escape during a drag puts everything back — which the 3D tab could not do at
  // all until now, while the 2D plan could. Not a missing branch: there was no
  // handler here, so the key fell through to the studio's global Escape, which
  // means "deselect", and the piece simply stayed wherever the pointer had got to.
  //
  // The restore is `convoyRestore`, the same function the plan calls, for the
  // reason the plan's own comment gives: a cancelled drag has to put back the lamp
  // that rode along on the desk and every member of a merged set, not just the
  // piece under the hand. It replays the pure cascade from the start transform
  // rather than keeping a second snapshot of it.
  //
  // One listener per part, attached for the component's life and gated on this
  // part actually being mid-gesture. The alternative — subscribing to
  // `draggingId` so the effect could attach and detach — would re-render every
  // Draggable in the room twice per gesture, to save a string comparison that
  // only happens when someone presses Escape. Capture phase, so it beats the
  // global handler; and it declines the key whenever no drag is in flight, which
  // is what leaves that global meaning intact the rest of the time.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const live = (drag.current?.started ?? false) || gizmoActive.current;
      const g = ref.current;
      const start = dragStartPos.current;
      const startRot = dragStartRot.current;
      // A press that never became a drag has no start transform to go back to,
      // and Escape then means what it means everywhere else.
      if (!live || cancelled.current || !g || !start || startRot === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (raf.current) {
        cancelAnimationFrame(raf.current);
        raf.current = 0;
      }
      cancelled.current = true;
      pendingPos.current = null;
      pendingRot.current = null;
      g.position.set(start[0], start[1], start[2]);
      g.rotation.y = startRot;
      setTransformsFor(
        convoyRestore(
          convoy(),
          partId,
          start,
          startRot,
          // Put back only what this gesture could have written. Nothing here writes
          // the dragged piece's own transform until `commit()`, so on the ordinary
          // Escape both answers are false and the piece under the hand is left
          // alone — it has already been moved back on the object3D four lines up.
          (id) => useStudio.getState().positions[id] !== undefined,
          (id) => useStudio.getState().rotations[id] !== undefined,
        ),
      );
      setLive(null);
      setDragInvalid(false);
      saidRef.current = null;
      document.body.style.cursor = '';
      invalidate(); // the object3D moved imperatively — ask for the repaint
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId, setTransformsFor, setLive, invalidate]);

  // Release everything if the part unmounts mid-gesture (deleted, undone, room
  // swapped). Without this, `draggingId` is left pointing at a part that no
  // longer exists — onPointerUp/TransformControls' onMouseUp are the only other
  // places that clear it, and an unmount skips both — which the exclusivity
  // guards in Pickable/Draggable would then read as "some other gesture owns
  // every part, forever," freezing hover/select/drag on the whole room.
  //
  // It is also the whole of the cancelled-pointer story, and an explicit
  // `onPointerCancel` prop here would be dead plumbing rather than a second
  // safety net. R3F never dispatches `onPointerCancel` to an instance: the prop
  // name only selects which DOM event to listen for (`DOM_EVENTS` maps it to
  // `['pointercancel', true]`), and the handler attached for both
  // `pointerleave` and `pointercancel` is `() => cancelPointer([])`, which walks
  // `internal.hovered` calling `onPointerOut` and `onPointerLeave` and nothing
  // else. `handlers.onPointerCancel` appears nowhere in the built package —
  // there is no dispatch path, not merely a shared one. So a cancelled pointer
  // reaches this component as an unmount or as nothing, and the teardown below
  // is what covers it.
  //
  // (@react-three/fiber 9.6.1, `dist/events-*.esm.js`, `cancelPointer`.) The
  // version is named on purpose: `package.json` declares `^9.6.1` and will
  // float, and this is the one claim in this file that cannot be checked
  // against this repo alone — naming it is what lets the next reader tell
  // "still true" from "was true". Asked by danmu-62, read out of the installed
  // dist by danmu-f4.
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
    // A drag released off-mesh never produced the click its flag was waiting for.
    // Cleared before any of the guards below, because `drag-click.ts` states the
    // invariant "every click on a piece is preceded by a press on it, and the press
    // calls `clearDragClick`" — and the Alt guard used to return first, so the
    // Alt-click after such a drag was swallowed and did nothing at all.
    clearDragClick();
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

    // The horizontal plane the pointer ray is intersected with, and it is the
    // plane the PIECE is in. It used to be the floor for anything not
    // floor-standing, which is where a drag stops tracking the thing you grabbed:
    // a ceiling fan sits at ~2.35 m, so the ray was intersected two metres below
    // it and every pixel of pointer movement became a much larger move of the
    // floor point it was following. Reported as being unable to steer a fan to the
    // middle of the ceiling. A TV at 1.4 m had a milder version of the same.
    //
    // `offX`/`offZ` are measured in this same plane just below, so the grab offset
    // stays exact whatever the height — which is why the branch was never needed:
    // a floor piece resting on a table already reads its own y here.
    const planeY = ref.current.position.y;
    _plane.set(_plane.normal.set(0, 1, 0), -planeY);
    if (!e.ray.intersectPlane(_plane, _hit)) return;
    const isTouch = e.pointerType === 'touch';
    rotOnly.current = false;
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
        // Selecting on pick-up is the feedback that the part is now in hand, and it
        // must take the same set a CLICK would — `selectionForPick`, which is where
        // "merged" lives now. `setSelected` left a merged sibling behind whenever the
        // gesture was a press-drag with no click before it.
        if (!useStudio.getState().selection.includes(partId)) {
          const sel = useStudio.getState().selection;
          useStudio.getState().setSelection(selectionForPick(useScene.getState().parts, partId, sel), partId);
        }
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
    // Past that guard the pointer really is sliding the piece, so whatever the last
    // wheel notch or twist said, this frame is a move. See `rotOnly`.
    rotOnly.current = false;
    if (!d.started) {
      const dist = Math.hypot(e.clientX - d.startClient[0], e.clientY - d.startClient[1]);
      if (dist < 4) return;
      d.started = true;
      dragStartPos.current = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      dragStartRot.current = ref.current.rotation.y;
      cancelled.current = false;
      lastFreePos.current = null;
      effCache.current = buildEffSnapshot(); // one world snapshot for the gesture
      convoyCache.current = null;
      // Same rule as the touch pick-up above: a press that starts a drag selects
      // what a click would have selected.
      if (!inSelection) {
        const sel = useStudio.getState().selection;
        useStudio.getState().setSelection(selectionForPick(useScene.getState().parts, partId, sel), partId);
      }
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
      // …unless Escape already put everything back, in which case committing
      // would write the start transform back as if it were a drop.
      if (!cancelled.current) {
        flushNow(); // land the last sub-frame move before resolving the drop
        commit();
      }
      // The DOM click that ends this gesture means "select just this piece" to
      // `Pickable`, which would collapse the very selection the drag just moved.
      // A cancelled drag needs this as much as a committed one: the release still
      // produces a click, and the selection it would collapse is the one Escape
      // just restored.
      suppressClickAfterDrag();
    }
    effCache.current = null;
    convoyCache.current = null;
    if (d.armed) setDragging(null);
    setLive(null);
    setDragInvalid(false);
    saidRef.current = null;
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
    rotOnly.current = true;
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

  // `blockedHere` as well as `dragInvalid`: the first is "some gesture cannot place
  // me", which is how a member that is not under the hand finds out, and the second
  // is this part's own resolve while IT is the one being dragged.
  const refused = dragInvalid || blockedHere;
  const highlightState = refused ? 'invalid' : inSelection ? 'selected' : 'hovered';

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
          shapeKey={part.shape}
        />
        <Pickable partId={partId}>{children}</Pickable>
        {(inSelection || isHovered || refused) && (
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
            dragStartRot.current = ref.current?.rotation.y ?? null;
            cancelled.current = false;
            lastFreePos.current = null;
            effCache.current = buildEffSnapshot();
            convoyCache.current = null;
          }}
          onMouseUp={() => {
            if (!cancelled.current) {
              flushNow();
              commit();
            }
            effCache.current = null;
            convoyCache.current = null;
            setDragging(null);
            gizmoActive.current = false;
          }}
        />
      )}
    </>
  );
}
