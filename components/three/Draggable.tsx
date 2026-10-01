'use client';

// Part interaction. Two ways to move furniture:
//   1. DIRECT DRAG (game-style, the default): press a part and drag it across
//      the floor — it slides, snaps to walls when wall-mounted, stops against
//      obstacles, and tints red while the spot is invalid. Scroll rotates it
//      mid-drag; on touch, a second finger twists it. A wall piece is dragged
//      across its WALL instead (`lib/wall-drag.ts`), so it goes up and down as
//      well as along. This is the whole of Move mode: the piece is its own handle,
//      and the translate arrows that used to sit on it are gone.
//   2. HANDLES (precision), on the selected part: R = rotate is drei's
//      TransformControls, reduced to its one vertical ring; S = scale is three
//      stretch handles (`StretchHandles.tsx`), each on the face it moves. W is
//      Move. NOT "W=move E=rotate R=scale", which is what this line said for a long
//      time and is wrong twice over: the modes are set in
//      components/studio/KeyboardShortcuts.tsx, and E is not one of them — Q and E
//      ORBIT THE CAMERA (components/three/CameraRig.tsx, NAV_KEYS). The cost of that
//      sentence was a hand-off note telling the user to "press E and turn it", which
//      spun the camera instead, so the gesture it was asking about went unchecked and
//      came back as a question rather than an answer.
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
import { Group, Mesh, Plane, Vector3 } from 'three';
import { gestureOwnedByOther, useStudio } from '@/lib/store';
import { clearDragClick, suppressClickAfterDrag } from '@/lib/drag-click';
import { claimPressForGizmo, clearGizmoClick, holdPress, releasePress } from '@/lib/gizmo-press';
import { useScene } from '@/lib/scene-store';
import { currentRiderRelation, currentRoomScene, useSettledY } from '@/lib/room-scene';
import { renderBaseDim, resolvePart } from '@/lib/transforms';
import { useDragLive } from '@/lib/drag-live';
import { refusalAfterGesture, REFUSAL_HOLD_MS } from '@/lib/refusal';
import { announce } from '@/lib/announce';
import {
  groupScaleForDim,
  isParametric,
  selectionForPick,
  type ScenePart,
} from '@/lib/scene-spec';
import { anchorFor, followsPointerUp, isFloorStanding } from '@/lib/physics';
import { wallDragTarget, wallGrip, wallPlaneHit, type WallGrip } from '@/lib/wall-drag';
import { stretchedDim, stretchedOrigin, type StretchAxis } from '@/lib/stretch';
import { StretchHandles } from './StretchHandles';
import { CutAway } from './CutAway';
import { clampDims } from '@/lib/dimension-ranges';
import { type SnapLine } from '@/lib/item-snap';
import {
  resolvePlacement as resolveDrag,
  snapSteps,
  refusalCause,
  type Resolved,
} from '@/lib/drag-resolve';
import { convoyRestore, gestureFor, leadInherited, planConvoy, resolveConvoy, settleLead, travellingWorld, type Convoy, type ConvoyResult } from '@/lib/drag-convoy';
import { Pickable } from './Pickable';
import { Highlight } from './Highlight';
import { Wobble } from './Wobble';
import { playSound } from '@/lib/sound';

// Touch pick-up: dwell time, and how far the finger may drift while dwelling
// before we decide it is a camera gesture and let go.
const HOLD_MS = 280;
const HOLD_SLOP = 10;

/** Only one part may own a pointer gesture at a time. Without this, the second
 *  finger of a twist landing on neighbouring furniture starts a competing
 *  pick-up on THAT part and the two fight over draggingId. */
let _gestureOwner: string | null = null;

/** Coarse-pointer (finger / stylus) detection, resolved once and cached. Drives
 *  the handle sizes: drei's default 0.8 is far under a 44px target. */
let _coarse: boolean | null = null;
function coarsePointer(): boolean {
  if (_coarse === null) {
    _coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
  }
  return _coarse;
}

// Every mesh of a part casts and receives. Whether the sun can actually reach a
// piece is the room's question, not the piece's: the walls and ceiling cast, so a
// piece on a wall the sun is behind is simply in shadow (`RoomShell.tsx`).
//
// It re-runs when the part's meshes can have been replaced. `PartGeometry`
// dispatches on `part.shape`, so a model change remounts the whole subtree, and a
// resize can change how many meshes there are (a plant regrows, a shelf gains a
// module). The Inspector's model picker writes `dimMM` on the PART rather than as
// a `dims` override, which is why the shape is a key of its own.
function ShadowCaster({
  groupRef,
  dimKey,
  shapeKey,
}: {
  groupRef: { current: Group | null };
  dimKey?: string;
  shapeKey: string;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.traverse((o) => {
      const mesh = o as Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    // Meshes were changed outside React, so nothing else will ask for a repaint.
    invalidate();
  }, [groupRef, dimKey, shapeKey, invalidate]);
  return null;
}

// Scratch objects for the direct-drag raycast (no per-frame allocation).
const _plane = new Plane(new Vector3(0, 1, 0), 0);
const _hit = new Vector3();

type Dim3 = [number, number, number];
type Vec3 = [number, number, number];

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
  const settledY = useSettledY(partId);

  const isSelected = useStudio((s) => s.selectedPartId === partId);
  const inSelection = useStudio((s) => s.selection.includes(partId));
  const isHovered = useStudio((s) => s.hoveredPartId === partId);
  /** Being carried right now — a wall piece on the camera's side of the room is
   *  kept in view while it is (`CutAway`'s `held`). */
  const isDraggingThis = useStudio((s) => s.draggingId === partId);
  const mode = useStudio((s) => s.transformMode);
  const snapMode = useStudio((s) => s.snapMode);
  // Snap increments, from the same module that applies them during a resolve, so
  // the handles' steps and the drag's magnetism can never drift apart.
  const { translate: translationSnap, rotate: rotationSnap } = snapSteps(snapMode);
  /** The same grid, as the millimetre step a stretch rounds a size to. */
  const sizeStepMM = translationSnap ? Math.round(translationSnap * 1000) : null;

  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setTransformsFor = useStudio((s) => s.setTransformsFor);
  const setDim = useStudio((s) => s.setDim);
  const landOn = useStudio((s) => s.landOn);
  const setDragging = useStudio((s) => s.setDragging);
  const setLive = useDragLive((s) => s.setLive);
  /** Is THIS piece one of the ones the current gesture cannot place?
   *
   *  A per-part selector rather than a subscription to the whole live channel: the
   *  selector runs on every frame of every drag in the room, but it returns a
   *  boolean, so React re-renders this part only when its own answer flips. That is
   *  what keeps the channel's promise — per-frame updates re-render the few light
   *  consumers, never the whole part tree. */
  // `refusedIds` is the same answer for a gesture with no drag frame — a turn from the
  // context menu or an accelerator. Unioned here rather than read as a second boolean so
  // the selector still returns a primitive and the per-part re-render promise holds.
  const blockedHere = useDragLive(
    (s) => !!s.live?.blockedIds?.includes(partId) || s.refusedIds.includes(partId),
  );

  // Red tint while the live drag spot is invalid. Only flips at boundary
  // crossings, so it never causes per-frame React churn.
  const [dragInvalid, setDragInvalid] = useState(false);

  /** What the last refusal SAID, so a streak that changes its mind says so and one
   *  that does not stays quiet. See `liveUpdate`. */
  const saidRef = useRef<string | null>(null);
  /** Whether the last live frame was held by an alignment guide, so the snap
   *  sound plays on the frame it locks and not on every frame it holds. */
  const snappedRef = useRef(false);
  const lastValidPos = useRef<[number, number, number] | null>(null);
  // Last collision-free spot DURING the current drag — an invalid drop falls
  // back here (slide up to the obstacle) instead of reverting the whole drag.
  const lastFreePos = useRef<[number, number, number] | null>(null);
  /** The angle it had at `lastFreePos`, written with it and read only beside it. A
   *  turn never moves the piece, so a spot without its angle is not a pose it fitted
   *  in: the ring swung a tucked chair's back up through its desk and the drop kept
   *  that angle at the one spot it had fitted (see `turnSwingsInto`). */
  const lastFreeRot = useRef<number | null>(null);
  /** The angle it STANDS at — the last one a resolve gave it, or the one it began the
   *  gesture at — as opposed to `rotation.y`, which the ring turns live and a wheel or
   *  twist is about to. A turn asks which wall its back is against at THIS angle
   *  (`standsAt` in `lib/drag-resolve.ts`), or a small piece in a corner turned onto
   *  the next wall. */
  const standRot = useRef<number | null>(null);
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
  /** Clears the refusal `commit()` leaves on screen when a gesture ends somewhere
   *  the piece does not fit — see the block at the end of `commit()`. A ref, and
   *  cleared on unmount, because it outlives the gesture by design and would
   *  otherwise write to a store from a part that has been deleted. */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  // Apply transforms whenever stored values change.
  useEffect(() => {
    if (!ref.current || !part) return;
    const p = storedPos ?? part.pos;
    // `settledY`, when this piece rides something whose height changed: neither
    // transform layer holds that Y, because nothing wrote one. Resizing a desk moves
    // its top and nothing else, so without this the lamp on it renders at the height
    // the desk used to be — and from overhead in the plan it looks right (§ 12).
    ref.current.position.set(p[0], settledY ?? p[1], p[2]);
    ref.current.rotation.y = storedRot ?? part.rot;
    // Parametric parts — whatever `isParametric` says — rebuild
    // their geometry from the effective dim — the mesh must NOT be group-scaled
    // or it would stretch on top of the rebuild. A stretch handle still scales
    // the group live during a pull; commit() stores the size and this effect
    // resets the scale to 1, leaving the geometry to redraw at the new size.
    if (storedDim && !isParametric(part.shape)) {
      const [sx, sy, sz] = groupScaleForDim(part.dimMM, storedDim);
      ref.current.scale.set(sx, sy, sz);
    } else {
      ref.current.scale.set(1, 1, 1);
    }
    lastValidPos.current = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
    invalidate(); // transform written straight to the object3D, not via props
  }, [storedPos, storedRot, storedDim, settledY, part, invalidate]);

  /** Snapshot every part at its effective (user-overridden) transform so
   *  collision + support see the world as it currently looks.
   *
   *  Read through getState() rather than a subscription: the override maps are
   *  replaced wholesale by their setters, so subscribing to them would re-render
   *  EVERY Draggable on every commit — and they are never read during render,
   *  only inside these handlers.
   *
   *  `useSettledY` above does subscribe to those same maps, and does not cost that,
   *  because its SELECTOR returns a number: zustand compares the result with
   *  `Object.is`, so this component re-renders only when its own piece's settled Y
   *  changes. Reading the whole map after subscribing is the version that would make
   *  this paragraph false again. */
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
  // `effParts()`, and that is a decision rather than a safe assumption: this drag
  // writes the relation only in `commit()`, after which both caches are cleared, but
  // a copy or a panel button can write it too, and a link written while the pointer
  // is down waits for the next gesture — the same reason the world is a snapshot
  // (`PlanView`'s `dragRef.world` says why a live one shifts the company twice).
  const convoyCache = useRef<Convoy | null>(null);
  function convoy(): Convoy {
    if (!convoyCache.current) {
      convoyCache.current = planConvoy({
        draggedId: partId,
        parts: effParts(),
        selection: useStudio.getState().selection,
        restsOn: currentRiderRelation(),
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
   *  time rather than remembered at pointer-down: `gizmoActive` is set when a
   *  handle takes the press and cleared after `commit()` on its release, which is
   *  exactly the span the answer has to cover. */
  function currentGesture(): 'move' | 'turn' {
    return gestureFor(gizmoActive.current, rotOnly.current);
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
    /** Set by a resolve that TURNS the piece where it stands — see `standRot`. */
    standsAt?: { at: [number, number, number]; rot: number },
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
      // A stretch asks to be kept in the room, not re-gridded or re-magnetised
      // where it stands — the same reason `turnInPlace` resolves a turn with snap
      // off. On the grid, a 10 mm wider piece moves its centre 5 mm and that 5 mm
      // rounds, so the side that is supposed to stay still would step.
      snapMode: stretch.current ? 'off' : snapMode,
      currentY: ref.current?.position.y,
      // Where the pointer has a wall piece on its wall, when it is dragging one.
      rawY: wantY.current ?? undefined,
      // Null unless this piece rides a wall and has company: a wall flip mid-drag
      // is a jump the whole set would translate by. See `Convoy.leadEdge`.
      wallEdge: convoy().leadEdge,
      // At the rot and dim being resolved, which a wheel, the turn ring or a
      // stretch can have changed since pointer-down — see `leadInherited`.
      inherited: leadInherited(convoy(), rot, dim),
      standsAt,
    });
  }

  /** The size this piece is at right now: the stretch in flight, else the held
   *  size from the transform layers.
   *
   *  It used to be read back off the group's live SCALE, because drei's scale
   *  gizmo wrote the scale and this turned it into millimetres. Nothing writes the
   *  scale now except the effect above (from the held size) and the stretch (from
   *  its own `dim`), so reading the scale back only reintroduced float noise:
   *  `850 × (1203 / 850)` is not always 1203, and `commit()` writes any difference
   *  through `setDim`. That read was also where a gizmo-era rule lived — snap every
   *  axis to the grid in scale mode — which fired on a plain body DRAG in scale mode
   *  and quietly rounded a detected 853 mm depth to 850.
   *
   *  Read from the store rather than the subscribed `storedDim`: `commit` runs from
   *  handlers that can outlive the render that captured it. */
  function currentDim(): Dim3 {
    if (!part) return [100, 100, 100];
    return stretch.current?.dim ?? resolvePart(part, useStudio.getState()).dimMM;
  }

  /** Per-frame feedback shared by both drag paths. Moves the mesh to the
   *  resolved spot, brings the company with it, records the last collision-free
   *  position, publishes the live channel, and tints the highlight when invalid.
   *
   *  The company moves LIVE, through the store, rather than at the drop. This part
   *  can afford to skip the store because the drag animates its own object3D; the
   *  others cannot be reached that way, and a set that only catches up on release
   *  is indistinguishable from a set that is not coming. */
  // Typed as `Resolved` rather than a hand-written structural copy of it. The copy
  // listed four of the fields and silently dropped any fifth, so when `refusal` was
  // added to carry WHY a spot was refused, this function could not see it and the
  // sentence below went on saying "something is in the way" — a re-declaration of a
  // type is a second source of truth like any other.
  function liveUpdate(resolved: Resolved, dim: [number, number, number]) {
    if (!ref.current || !part) return;
    ref.current.rotation.y = resolved.rot;
    standRot.current = resolved.rot;
    // The convoy has a veto: a spot this piece could take but its company cannot
    // is not a spot the gesture may rest at, so it must not be remembered as the
    // fallback `commit()` slides back to either.
    // The lead goes where the SET can go — `resolved` unless a member ran out of
    // room first, in which case `settleLead` re-resolves this piece at the shorter
    // delta and re-asks the company until the two agree. **Re-resolved, not merely
    // moved**: the limit is a translation, and a translation changes what the piece
    // is standing on and what it is snapped to, so every number below has to come
    // from the settled answer rather than from the one taken at the pointer.
    const settle = settleLead<Resolved>(
      (x, z) => resolvePlacement(x, z, resolved.rot, dim, travelWorld(x, z)),
      (l) => carry(l.pos, l.rot),
      resolved,
    );
    const lead = settle.lead;
    const co = settle.co;
    // A small tick the moment a guide locks on, and not again while it holds.
    const snapped = (lead.snapLines?.length ?? 0) > 0;
    if (snapped && !snappedRef.current) playSound('snap');
    snappedRef.current = snapped;
    ref.current.position.set(lead.pos[0], lead.pos[1], lead.pos[2]);
    // `settled` is part of the legality question, not a diagnostic: an unsettled
    // frame is one where the lead and its set were resolved at DIFFERENT deltas, and
    // committing that is the deformed-but-valid arrival the limit exists to prevent.
    const valid = lead.valid && co.valid && settle.settled;
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
      const namesMember = lead.valid ? co.blocked : undefined;
      const saying = namesMember ? `blocker:${namesMember.id}` : `self:${partId}`;
      if (saidRef.current !== saying) {
        saidRef.current = saying;
        announce(
          namesMember
            ? `${namesMember.name} will not fit there, so the rest of the selection cannot follow.`
            : `${part.name} will not fit there: ${refusalCause(lead)}`,
        );
      }
    }
    if (valid) {
      // The SETTLED position, not the one at the pointer. `commit()`'s invalid-drop
      // fallback slides back to this, and its comment promises "a spot this piece
      // already stood in" — while a set is limited the piece never stands at the
      // pointer, so recording that spot made the fallback commit the lead a whole
      // slide ahead of its members, silently and with `valid` saying true.
      lastFreePos.current = [lead.pos[0], lead.pos[1], lead.pos[2]];
      lastFreeRot.current = lead.rot;
      if (stretch.current) stretch.current.lastFreeDim = dim;
      // Only on a legal step. On an illegal one the set holds at the last legal
      // delta while the piece under the hand goes red and keeps following the
      // pointer — the separation IS the feedback, and the drop reunites them.
      if (co.moves.length > 0) setTransformsFor(co.moves);
    }
    setLive({
      partId,
      // Where the piece IS, which is where it is drawn two dozen lines above.
      // `DragTag` anchors the size tag on these three numbers (it used to build
      // four wall-gap rays from them too), so publishing the pointer's position
      // while the mesh sits at the limited one drew every measurement at a place
      // the piece is not — the hand-typed-measurement failure, arriving as a
      // correctly derived number about the wrong spot.
      x: lead.pos[0],
      y: lead.pos[1],
      z: lead.pos[2],
      rot: lead.rot,
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
      blockedBy: lead.valid && co.blocked ? co.blocked.name : undefined,
    });
    setDragInvalid((prev) => (prev === !valid ? prev : !valid));
    invalidate(); // the object3D moved imperatively — request the repaint
  }

  function commit() {
    if (!ref.current || !part) return;
    let dim = currentDim();
    const p = ref.current.position;
    /** Resolve here, ask the company, and keep going until the lead and its set
     *  agree on one delta — see `settleLead`. Both branches below need it, and the
     *  fallback branch is the one that used to skip it. */
    const settleAt = (rot: number, standsAt?: { at: [number, number, number]; rot: number }) => (x: number, z: number) =>
      resolvePlacement(x, z, rot, dim, travelWorld(x, z), standsAt);
    // Resolved where it stands, so it is asked which wall it stands on — the ring
    // turns `rotation.y` without a resolve, and this is the first one it gets.
    const here = { at: [p.x, p.y, p.z] as [number, number, number], rot: standRot.current ?? ref.current.rotation.y };
    const first = resolvePlacement(p.x, p.z, ref.current.rotation.y, dim, travelWorld(p.x, p.z), here);
    let settle = settleLead<Resolved>(settleAt(first.rot, here), (l) => carry(l.pos, l.rot), first);
    let resolved = settle.lead;
    let co = settle.co;

    // Invalid drop → rest at the last spot of the drag where the WHOLE convoy was
    // clear (slide-up-to-the-obstacle); fall back to the pre-drag position. The
    // convoy is re-asked at that spot rather than assumed, and it comes back legal
    // by construction from both branches — `lastFreePos` is only written on a frame
    // where the company fitted, and `lastValidPos` is this piece's pre-drag
    // position, which makes the delta zero and the company's answer "stay".
    if (!resolved.valid || !co.valid || !settle.settled) {
      const back = lastFreePos.current ?? lastValidPos.current;
      if (back) {
        // A wall piece being dragged up its wall takes its height from the pointer,
        // so the fallback has to hand it the height it had AT `back` — or it would
        // slide back along the wall and stay at the refused height.
        if (wantY.current !== null) wantY.current = back[1];
        // …and a stretch hands back the SIZE it had there. `back` is a spot where
        // the piece fitted at a smaller size; testing it at the refused size is a
        // placement nobody saw, and it would come back refused with the far face
        // moved. With no free frame at all, `back` is the pre-gesture spot and so
        // is the size. Pull a sofa's side into the wall and it rests touching it.
        const st = stretch.current;
        if (st) {
          dim = lastFreePos.current ? (st.lastFreeDim ?? st.startDim) : st.startDim;
          st.dim = dim;
          const [sx, sy, sz] = groupScaleForDim(st.base, dim);
          ref.current.scale.set(sx, sy, sz);
        }
        // …and the ANGLE it had there, which is the whole fallback for a turn: `back`
        // is where it is standing, so resting there at the refused angle is taking
        // the turn. With a free frame, the angle of that frame. With none, the angle
        // the gesture began at — but only if the piece fitted there; one that was
        // already refused where it stood keeps the new angle, as `turnSwingsInto`
        // says, or a piece in a tight spot could never be turned out of it. "Fitted
        // there" means without being MOVED, as there: the resolve clamps into the
        // room first, so a piece poking through a wall comes back valid somewhere
        // else, and it is that piece that most needs to turn.
        const startRot = dragStartRot.current;
        // The angle it stood at, AT `back` — so every re-resolve below is asked which
        // wall it stands on there, as `first` was. Without it a refused turn of a
        // narrow curtain in a corner slid "back" onto the return wall, and read as
        // moved, so it kept the refused angle too.
        const standing = {
          at: back,
          rot: lastFreePos.current ? (lastFreeRot.current ?? ref.current.rotation.y) : (startRot ?? ref.current.rotation.y),
        };
        const atStart = startRot === null ? null : settleAt(startRot, standing)(back[0], back[2]);
        const fittedAtStart =
          atStart !== null && atStart.valid && Math.hypot(atStart.pos[0] - back[0], atStart.pos[2] - back[2]) <= 0.001;
        const restRot = lastFreePos.current
          ? (lastFreeRot.current ?? ref.current.rotation.y)
          : fittedAtStart && startRot !== null
            ? startRot
            : ref.current.rotation.y;
        ref.current.rotation.y = restRot;
        // Rebuilt at `back`, not reused from the drop point: the world the convoy
        // occupies is a function of the delta, so a world built for a spot the
        // gesture is no longer resting at puts the company in the wrong place.
        const back0 = settleAt(ref.current.rotation.y, standing)(back[0], back[2]);
        // Settled here too. `lastFreePos` is a position the whole set could take,
        // so this normally agrees on the first pass — but "normally" is what the
        // first version of this assumed, and a fallback that writes the lead from
        // its own resolve while the members take `co.moves` is precisely the caller
        // `ConvoyResult.leadPos` was added to stop existing.
        settle = settleLead<Resolved>(settleAt(back0.rot, standing), (l) => carry(l.pos, l.rot), back0);
        const r = settle.lead;
        // `r`, whole — never `back` raw with the live angle written beside it, which
        // is what this did. `resolvePlacement` returns a CONTAINMENT-CLAMPED position
        // whether or not the frame came out legal, so throwing it away on the invalid
        // branch discarded the one correction that always applies, and replaced it
        // with a combination nothing had ever run through containment: the pre-gesture
        // position, which was legal for the OLD angle and the OLD size.
        //
        // Harmless for a translate — `back` is a spot this piece already stood in at
        // this angle and size — and the whole defect for a rotate, which never moves
        // the piece, so `back` IS where it is standing and the only thing that
        // changed is the extent being tested against the walls. (A stretch gets
        // its size back with its spot, just above.) Turning the lead of a merged set into its own siblings makes the
        // resolve invalid by collision, so that was the branch every such turn took:
        // the bed kept the angle, kept the position, and was committed with its corner
        // through the plaster. It also claimed `valid: true` on the way out, which is
        // why nothing went red.
        resolved = r;
        co = settle.co;
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
    // are, so the ordering here doesn't matter to the convoy). The plan tab's
    // drop writes it through the same `landOn`.
    landOn(partId, resolved.supportId);

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
    if (co.valid && settle.settled && co.moves.length > 0) setTransformsFor(co.moves);

    lastValidPos.current = [x, y, z];
    lastFreePos.current = null;
    // The gesture is over, so the next refusal is news again even if it names the
    // same piece. Without this a drag that ended while refusing left the key set and
    // the following drag hit the same obstacle in silence.
    saidRef.current = null;

    // ── Does the placement we just committed actually fit? ────────────────────
    //
    // This used to end `setDragInvalid(false)` and `setLive(null)`, unconditionally,
    // on every path — so a gesture that ends refused had its refusal COMPUTED here
    // and cleared on the same tick, by the next two lines. The plan does the
    // opposite: `PlanView`'s turn says in its own comment that the turn is taken
    // either way, because refusing it would make a piece in a tight corner
    // unturnable, and then it holds a red outline on the piece. 3D took the same
    // turn and said nothing, which is what a user sees as "the couch is cutting
    // through the wall instead of being constrained" — the geometry is the plan's
    // geometry, and the difference is entirely in whether anything said so.
    //
    // Reported as a defect after exactly that. Measured: a 4 m sofa turned 90° in a
    // 6 × 3 room resolves to `pos.z = 0.5` spanning `[-1.5, 2.5]` against a room of
    // `[-1.5, 1.5]` — 1.000 m through the south wall, `valid: false`.
    //
    // A translate or a stretch cannot normally get here: its fallback rests at a
    // spot — and for a stretch a size — this piece already occupied. A ROTATE can,
    // and does, because `back` is where the piece is standing and the only thing
    // that changed is the extent being tested against the walls — which is also
    // why the fallback's own comment claiming it "comes back legal by
    // construction" is not true of every gesture.
    //
    // Held rather than latched, and on the channel that already draws it: every
    // refused piece reads `blockedIds` through its own per-part selector, so the set
    // goes red exactly as it does mid-drag, and one timer clears the lot. The same
    // window the plan fades over, from the same constant, because two surfaces
    // disagreeing about how long a refusal stays up is the next version of this bug.
    const refusal = refusalAfterGesture({
      draggedId: partId,
      placementValid: resolved.valid,
      convoyValid: co.valid,
      blockedIds: co.blockedIds,
      blockedByName: co.blocked?.name,
    });
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    // Heard as well as seen: a set-down whose knock is lower for a bigger piece,
    // or the low double bump of a piece that would not go.
    playSound(refusal ? 'blocked' : 'drop', { size: Math.max(...dim) / 2500 });
    if (!refusal) {
      setDragInvalid(false);
      setLive(null);
    } else {
      setLive({
        partId,
        x,
        y,
        z,
        rot: resolved.rot,
        dimMM: dim,
        floor: isFloorStanding(part.category, part.shape),
        valid: false,
        blockedIds: refusal.ids,
        blockedBy: refusal.by,
      });
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        setDragInvalid(false);
        setLive(null);
        invalidate();
      }, REFUSAL_HOLD_MS);
    }
    invalidate();
  }

  // ─── Coalesced resolve ────────────────────────────────────────────────────
  // Pointer / wheel / twist events all just record their intent; one rAF tick
  // resolves and applies it. Multiple events inside a frame collapse into the
  // single placement the user will actually see.
  const pendingPos = useRef<[number, number] | null>(null);
  const pendingRot = useRef<number | null>(null);
  const raf = useRef(0);
  /** The height the pointer is asking for, while a wall piece is dragged across
   *  its wall; null for every other gesture. Read by `resolvePlacement` rather
   *  than passed through `flushGesture`, so `settleLead`'s re-resolves and the
   *  drop in `commit()` land at the same height as the frame the user saw. */
  const wantY = useRef<number | null>(null);
  /** The pull in flight on a stretch handle. `dim` is the size it has pulled the
   *  piece to so far; everything else is fixed at the press. */
  const stretch = useRef<{
    axis: StretchAxis;
    side: 1 | -1;
    /** What the group draws at scale 1 — the base a size becomes a scale against. */
    base: Dim3;
    startDim: Dim3;
    dim: Dim3;
    startScale: Vector3;
    /** The last size at which the whole placement fitted — `lastFreePos`'s
     *  partner, written on the same frames. A pull that ends refused rests at
     *  this size, the way a drag that ends refused rests at that spot. */
    lastFreeDim: Dim3 | null;
    /** False until the pointer has actually pulled; a press and release with no
     *  travel writes nothing. */
    pulled: boolean;
  } | null>(null);

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
    // A wheel or a twist with the piece held still is a turn where it stands.
    const turning =
      pp === null ? { at: [x, ref.current.position.y, z] as [number, number, number], rot: standRot.current ?? ref.current.rotation.y } : undefined;
    liveUpdate(resolvePlacement(x, z, rot, dim, travelWorld(x, z), turning), dim);
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
    /** The pick-up has been heard — a touch hears it at the dwell, a mouse at the
     *  first move — so the move after a dwell does not play it a second time. */
    heard: boolean;
    hold: number;
    startClient: [number, number];
    planeY: number;
    offX: number;
    offZ: number;
    /** Where on its wall the pointer took hold of a wall piece, when this drag
     *  moves it across the wall rather than across the floor. Null for a floor
     *  drag — including a wall piece's, when the press met its wall edge-on or
     *  when company is following it (see `onPointerMove`). */
    wall: WallGrip | null;
  } | null>(null);

  // True for the life of a handle grab on this part — the rotate ring's
  // onMouseDown to its onMouseUp, or a stretch handle's press to its release.
  // Guards onPointerDown above against a second touch point starting a competing
  // direct-drag on the same mesh while a handle is already writing its transform.
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
      // Same as the pick-up above: past here the gesture has done something.
      releasePress(partId);
      dragStartPos.current = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      dragStartRot.current = ref.current.rotation.y;
      standRot.current = dragStartRot.current;
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
      // A stretch draws its size as a group scale until it commits; put that back
      // too, or the piece keeps the cancelled size on screen while the store holds
      // the old one.
      if (stretch.current) g.scale.copy(stretch.current.startScale);
      wantY.current = null;
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
      releasePress(partId);
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
    // …and the gizmo's own gate, for the same reason — a rotate released over bare
    // floor produces no click, so the gate it armed has to be dropped by the next
    // press rather than by a click that never comes.
    //
    // **But NOT while a gesture is still in flight, which is where the two gates
    // stop being the same rule.** `drag-click` arms on pointer-UP, so any later
    // press is necessarily a new gesture. This one arms on pointer-DOWN, so a
    // SECOND pointer landing mid-rotate reaches here while the gate is doing its
    // job — and an unconditional clear disarmed it one line before the guards below
    // would have refused the press anyway. Two fingers on a merged group and the
    // click ending the rotate drills into it, which is the one thing this gate
    // exists to stop. Both readings are needed: `gizmoActive` catches a press on
    // the turning piece's own body (where `draggingId` IS this part), and
    // `gestureOwnedByOther` catches one on any neighbour.
    if (!gizmoActive.current && !gestureOwnedByOther(partId)) clearGizmoClick();
    if (useStudio.getState().panKeyHeld) return;
    // Alt held = the press is asking WHICH piece, not moving one. `Pickable`
    // answers it on the click; starting a drag here first would nudge the very
    // piece the user is saying they did not mean. Same reasoning as the pan guard
    // above, and checked in the same place for the same reason.
    if (e.altKey) return;
    // Claim the press against the rest of the R3F tree — the pieces behind this
    // one, and the room shell.
    //
    // **It said "the gizmo's own handles run their interaction, so only presses on
    // the part body itself get here", and that is precisely the belief this
    // function now exists to correct.** R3F never sees the gizmo: it raycasts only
    // objects carrying handlers, and drei's `TransformControls` is a `<primitive>`
    // with none, so a press on a ring, an arrow or a translate plane arrives here
    // like any other. `stopPropagation` cannot help with that — it orders siblings
    // in one raycast, and the gizmo is not in the raycast at all. What handles it is
    // `holdPress` below. Left uncorrected, this comment is an argument for deleting
    // that as redundant plumbing, 45 lines above the code that disproves it.
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
    // A wall piece is gripped on its wall as well, and which of the two planes the
    // drag follows is settled when it starts. Null when the ray meets the wall
    // edge-on: a grazing plane turns a pixel of travel into metres along the wall,
    // so that press drags across the floor as before.
    let wall: WallGrip | null = null;
    if (followsPointerUp(part.category, part.shape)) {
      const at: Vec3 = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      const o = e.ray.origin;
      const dir = e.ray.direction;
      const hit = wallPlaneHit([o.x, o.y, o.z], [dir.x, dir.y, dir.z], at, ref.current.rotation.y);
      if (hit) wall = wallGrip(hit, at, ref.current.rotation.y);
    }
    const isTouch = e.pointerType === 'touch';
    rotOnly.current = false;
    wantY.current = null;
    drag.current = {
      pointerId: e.pointerId,
      started: false,
      armed: !isTouch,
      heard: false,
      hold: 0,
      startClient: [e.clientX, e.clientY],
      planeY,
      offX: _hit.x - ref.current.position.x,
      offZ: _hit.z - ref.current.position.z,
      wall,
    };
    _gestureOwner = partId;
    (e.target as Element).setPointerCapture(e.pointerId);
    // R3F handed this press to furniture without ever asking the gizmo, because
    // the gizmo is invisible to its raycaster. If the press was in fact aimed at a
    // handle, the gizmo's `mouseDown` — microseconds away, in this same DOM
    // dispatch — takes it back through here. Everything above is bookkeeping;
    // nothing has moved yet, which is what makes handing it back lossless.
    // `lib/gizmo-press.ts` has the whole reasoning.
    const captureTarget = e.target as Element;
    const capturedId = e.pointerId;
    holdPress(partId, () => {
      const d = drag.current;
      if (d?.hold) window.clearTimeout(d.hold);
      drag.current = null;
      if (_gestureOwner === partId) _gestureOwner = null;
      detachTouch();
      try {
        captureTarget.releasePointerCapture(capturedId);
      } catch {
        /* already released */
      }
      // No cursor write here, deliberately. This press never set one — `grabbing`
      // is set by the first move that actually starts a drag — so clearing would
      // discard the `pointer` that `Pickable` put up on hover, and `Pickable` only
      // re-sets it on a fresh `pointerover`. The pointer has not left the mesh, so
      // none is coming: the whole rotate would run under the default arrow and stay
      // there afterwards.
      // Only if it is still ours. A touch press has not called `setDragging` at
      // all yet — that waits for the dwell — so `draggingId` here may belong to
      // nobody or to somebody else, and clearing it unconditionally would park
      // another gesture's camera guard.
      if (useStudio.getState().draggingId === partId) setDragging(null);
    });
    if (isTouch) {
      touchPts.current.set(e.pointerId, [e.clientX, e.clientY]);
      attachTouch();
      // Dwell to pick up. Until then the camera keeps the gesture, which is the
      // only way to orbit a room where furniture covers the whole viewport.
      drag.current.hold = window.setTimeout(() => {
        const d = drag.current;
        if (!d) return;
        d.armed = true;
        d.heard = true;
        playSound('pick');
        // The press has become a pick-up, so the window `holdPress` is for has
        // closed — see the note at the hold itself. Everything below this line is
        // something to undo rather than nothing.
        releasePress(partId);
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
    releasePress(partId);
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
      if (!d.heard) playSound('pick');
      d.heard = true;
      // Same as the pick-up above: past here the gesture has done something.
      releasePress(partId);
      dragStartPos.current = [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      dragStartRot.current = ref.current.rotation.y;
      standRot.current = dragStartRot.current;
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
      // Up the wall only when nothing is following. A member keeps its own height
      // (`resolveConvoy` resolves each at its start y), so lifting the lead would
      // pull a set of prints apart vertically — the "arrives deformed" failure the
      // convoy exists to prevent. The set slides along the wall together instead.
      // Asked here, after the selection above, because the press may just have
      // picked up a whole merged group.
      if (d.wall && convoy().members.length > 0) d.wall = null;
    }
    e.stopPropagation();
    if (d.wall) {
      // The plane is rebuilt from where the piece is NOW, not where it was
      // pressed: after a corner it is the next wall's, and the grip is re-laid
      // along that wall. A frame whose ray grazes it is skipped rather than read.
      const g = ref.current;
      const o = e.ray.origin;
      const dir = e.ray.direction;
      // And the wall is the one under the pointer when that is another one —
      // `wallDragTarget` holds the switch and its corner margin.
      const t = wallDragTarget(
        [o.x, o.y, o.z],
        [dir.x, dir.y, dir.z],
        [g.position.x, g.position.y, g.position.z],
        g.rotation.y,
        d.wall,
        footprint,
        roomHeight,
      );
      if (!t) return;
      // Raw, like the floor drag below: the resolve owns the grid, the wall and
      // the floor-to-ceiling clamp.
      wantY.current = t[1];
      pendingPos.current = [t[0], t[2]];
      schedule();
      return;
    }
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
    releasePress(partId);
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
    // After the commit, which reads it: the next gesture on this piece may be a
    // rotate, and a stale height would lift it.
    wantY.current = null;
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

  // ─── Stretch handles (scale mode) ─────────────────────────────────────────
  // The dots in `StretchHandles` report a pull in metres; the size, the origin
  // that keeps the far face still, and the landing are worked out here, through
  // the same resolve and the same `commit()` as every other gesture.
  function pressStretch(axis: StretchAxis, side: 1 | -1): boolean {
    const g = ref.current;
    if (!part || !g) return false;
    if (gizmoActive.current || drag.current || gestureOwnedByOther(partId)) return false;
    // Arms the click gate: the click that ends the pull must not select whatever
    // is under the pointer by then. Nothing holds this press to hand back — R3F
    // gave it to the dot, which stopped it there.
    claimPressForGizmo();
    gizmoActive.current = true;
    setDragging(partId);
    dragStartPos.current = [g.position.x, g.position.y, g.position.z];
    dragStartRot.current = g.rotation.y;
    standRot.current = dragStartRot.current;
    cancelled.current = false;
    lastFreePos.current = null;
    wantY.current = null;
    effCache.current = buildEffSnapshot();
    convoyCache.current = null;
    const startDim = currentDim();
    stretch.current = {
      axis,
      side,
      base: renderBaseDim(part, useStudio.getState()),
      startDim,
      dim: startDim,
      startScale: g.scale.clone(),
      lastFreeDim: null,
      pulled: false,
    };
    return true;
  }

  function pullStretch(metres: number) {
    const st = stretch.current;
    const g = ref.current;
    const start = dragStartPos.current;
    if (!st || !g || !part || !start || cancelled.current) return;
    if (!st.pulled) playSound('pick');
    st.pulled = true;
    st.dim = stretchedDim(st.startDim, st.axis, metres, sizeStepMM, (d) => clampDims(part.category, part.shape, d));
    const [sx, sy, sz] = groupScaleForDim(st.base, st.dim);
    g.scale.set(sx, sy, sz);
    // From the START every frame (`stretchedOrigin` says why), at the angle the
    // pull began at: a wall piece's resolve may re-aim it, and the far face is
    // where it was when the pull started.
    const o = stretchedOrigin(start, dragStartRot.current ?? g.rotation.y, st.axis, st.side, st.startDim, st.dim, isFloorStanding(part.category, part.shape));
    // Y goes on the object, where the resolve reads a centred piece's height.
    g.position.set(o[0], o[1], o[2]);
    pendingPos.current = [o[0], o[2]];
    schedule();
  }

  function releaseStretch() {
    if (stretch.current?.pulled && !cancelled.current) {
      flushNow();
      commit();
    }
    // After `commit()`, which reads the stretched size through `currentDim()`.
    stretch.current = null;
    effCache.current = null;
    convoyCache.current = null;
    setDragging(null);
    gizmoActive.current = false;
  }

  if (!part) return null;

  // `blockedHere` as well as `dragInvalid`: the first is "some gesture cannot place
  // me", which is how a member that is not under the hand finds out, and the second
  // is this part's own resolve while IT is the one being dragged.
  const refused = dragInvalid || blockedHere;
  const highlightState = refused ? 'invalid' : inSelection ? 'selected' : 'hovered';
  // What this group draws at scale 1 — the effective dim for a parametric piece,
  // which is rebuilt at it, and the authored one for everything else, which wears
  // the resize as a group scale. Same split `Highlight` and `CutAway` read below.
  const renderedDim = isParametric(part.shape) ? (storedDim ?? part.dimMM) : part.dimMM;

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
        <ShadowCaster groupRef={ref} dimKey={(storedDim ?? part.dimMM).join()} shapeKey={part.shape} />
        {/* The lean while carried and the rock when set down — drawn only, on an
            inner group the transform layers never see (lib/wobble.ts). */}
        <Wobble
          targetRef={ref}
          partId={partId}
          enabled={isFloorStanding(part.category, part.shape) && part.category !== 'rug'}
          halfW={renderedDim[0] / 2000}
          halfD={renderedDim[1] / 2000}
        >
          <Pickable partId={partId}>{children}</Pickable>
        </Wobble>
        {/* Wall pieces leave with their wall in the dollhouse cut-away — unless held:
            a selected or dragged piece stays in view. The depth is the authored one
            for a group-scaled piece (the scale carries the rest) and the effective
            one for a parametric piece, which is rebuilt at it. */}
        {anchorFor(part.category, part.shape).startsWith('wall') && (
          <CutAway
            groupRef={ref}
            depthMM={(isParametric(part.shape) ? (storedDim ?? part.dimMM) : part.dimMM)[1]}
            held={inSelection || isDraggingThis}
          />
        )}
        {(inSelection || isHovered || refused) && (
          <Highlight
            dimMM={renderedDim}
            sizeMM={storedDim ?? part.dimMM}
            anchor={anchorFor(part.category, part.shape)}
            state={highlightState}
          />
        )}
      </group>
      {isSelected && obj && mode === 'scale' && (
        <StretchHandles
          targetRef={ref}
          liveDim={currentDim}
          floorStanding={isFloorStanding(part.category, part.shape)}
          heightSide={anchorFor(part.category, part.shape) === 'ceiling' ? -1 : 1}
          depthSide={anchorFor(part.category, part.shape).startsWith('wall') ? 1 : null}
          coarse={coarsePointer()}
          onPress={pressStretch}
          onPull={pullStretch}
          onRelease={releaseStretch}
        />
      )}
      {/* Rotate only. Move has no handle — the piece is the handle — and scale has
          the stretch handles above. One ring, around the vertical: furniture
          turns on the floor, it does not tip. */}
      {isSelected && obj && mode === 'rotate' && (
        <TransformControls
          object={obj}
          mode="rotate"
          showX={false}
          showY
          showZ={false}
          // Fingers need a target roughly twice the size a mouse does.
          size={coarsePointer() ? 1.5 : 0.8}
          rotationSnap={rotationSnap}
          onMouseDown={() => {
            // This fires only when `pointerDown` found an axis — the press really
            // did land on a handle — and three-stdlib re-runs its hover test at the
            // press point first, so it is right for a finger as well as a mouse.
            //
            // R3F has already dispatched this same press to whatever furniture sits
            // behind the ring, which for a bed's rotate arc is routinely the
            // nightstand beside it. Take it back before anything else here runs:
            // `setDragging` below must be the LAST word on who owns the gesture.
            claimPressForGizmo();
            gizmoActive.current = true;
            // `commit()` on the release sets the piece down with a knock, so the
            // grab is heard too — otherwise the gizmo is the one gesture that lands
            // without ever having been lifted.
            playSound('pick');
            setDragging(partId);
            const pp = ref.current?.position;
            dragStartPos.current = pp ? [pp.x, pp.y, pp.z] : null;
            dragStartRot.current = ref.current?.rotation.y ?? null;
            standRot.current = dragStartRot.current;
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
