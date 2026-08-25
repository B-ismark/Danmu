'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import { Group } from 'three';
import { gestureOwnedByOther, useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { cycleThrough, type CycleState } from '@/lib/plan-hit';
import { pickIdsFrom, PART_ID_KEY } from '@/lib/pick-through';
import { openPickMenu } from '@/components/studio/SceneContextMenu';

// The Alt-click cycle's memory. Module-scoped rather than per-component because
// the handler that fires belongs to whichever piece is in FRONT, and that changes
// as you step through the stack — a ref inside one Pickable would be the wrong
// one by the second press. `cycleThrough` restarts by itself whenever the pointer
// has moved or the candidates changed, so this needs no invalidation of its own.
let altCycle: CycleState | null = null;

// Wraps any subtree with hover/click handling that drives the studio store.
// Stops propagation so nested pickables don't double-fire.
export function Pickable({
  partId,
  children,
  onClick,
}: {
  partId: string;
  children: ReactNode;
  onClick?: (id: string) => void;
}) {
  const setHovered = useStudio((s) => s.setHovered);
  const setSelected = useStudio((s) => s.setSelected);
  const setSelection = useStudio((s) => s.setSelection);
  const toggleInSelection = useStudio((s) => s.toggleInSelection);
  const toggleOpen = useStudio((s) => s.toggleOpen);
  const ref = useRef<Group>(null);

  // A part that disappears from under the cursor never fires `pointerout`, so the
  // store went on pointing at it — and `Highlight` kept drawing the hover box on
  // whatever took its place. Deleting the hovered piece does this, and so does
  // hiding it with V (Room filters hidden parts out of the tree entirely).
  useEffect(
    () => () => {
      if (useStudio.getState().hoveredPartId === partId) useStudio.getState().setHovered(null);
      document.body.style.cursor = '';
    },
    [partId],
  );

  return (
    <group
      ref={ref}
      // What makes a hit on any mesh in this subtree traceable back to a piece —
      // read by `lib/pick-through` when Alt-click asks what else is under the
      // cursor. The scene is full of things that are not furniture (the shell,
      // wall hit planes, gizmo arcs, guides, light helpers) and this is what tells
      // them apart.
      userData={{ [PART_ID_KEY]: partId }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        // A part mid-drag/gizmo-transform owns the gesture; the cursor sweeping
        // over another part's screen space (a wide rotate arc, say) must not
        // steal hover out from under it.
        if (gestureOwnedByOther(partId)) return;
        setHovered(partId);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        // Surrender only hover this part actually HOLDS. `onPointerOver` above
        // declines to take hover while another part owns the gesture, but the
        // matching out still fires — so a rotate arc sweeping off a neighbour
        // cleared the *dragged* part's highlight, which is the same theft the
        // guard above exists to stop, arriving one event later. Same shape as the
        // unmount effect a few lines up.
        if (useStudio.getState().hoveredPartId === partId) setHovered(null);
        // The cursor belongs to whoever owns the gesture: `grabbing` has to
        // outlive the pointer leaving this mesh, which a fast drag does routinely.
        if (useStudio.getState().draggingId === null) document.body.style.cursor = '';
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        // Same exclusivity as onPointerOver, for the click that would otherwise
        // reselect whatever the cursor ended up over when the gesture released.
        if (gestureOwnedByOther(partId)) return;
        // A Space + left-drag that happens to pass over furniture is a camera
        // pan; it must not re-select whatever it flew across.
        if (useStudio.getState().panKeyHeld) return;
        // ── Alt: choose between pieces that overlap on screen ────────────────
        // The one question a plain click cannot answer, because only the frontmost
        // handler runs. `e.intersections` is the whole depth-sorted list from this
        // same raycast, so the candidates cost nothing extra.
        //
        // Alt rather than Ctrl deliberately: Ctrl+click IS right-click on macOS,
        // and Shift already toggles the multi-selection. It matches Blender, where
        // Alt-click pops the list of everything under the cursor and Shift-Alt adds
        // to the selection instead of replacing it.
        if (e.altKey) {
          // Firefox reads Alt+click on some elements as "download", and a window
          // manager may claim Alt-drag; neither should reach the browser.
          e.nativeEvent.preventDefault();
          const ids = pickIdsFrom(e.intersections);
          // Client pixels, not `e.point`: whether this is the same press repeated
          // is a question about the hand, and in world units the answer depends on
          // how far the camera happens to be pulled back. See `SAME_SPOT_PX`.
          const step = cycleThrough(e.nativeEvent.clientX, e.nativeEvent.clientY, ids, altCycle);
          altCycle = step.state;
          if (!step.id) return;
          if (e.shiftKey) toggleInSelection(step.id);
          else setSelected(step.id);
          // The list opens on the first Alt-click of a spot — seeing what is there
          // is the point — and stays out of the way while you keep pressing to step
          // deeper. One piece under the cursor needs no list at all.
          if (step.fresh && ids.length > 1) {
            openPickMenu(e.nativeEvent.clientX, e.nativeEvent.clientY, ids);
          }
          return;
        }
        // Shift-click toggles this part in/out of the multi-selection.
        if (e.shiftKey) {
          toggleInSelection(partId);
          return;
        }
        // Plain click: if the part belongs to a merged group, select the whole
        // group (they move as one); otherwise single-select.
        const parts = useScene.getState().parts;
        const me = parts.find((p) => p.id === partId);
        if (me?.groupId) {
          setSelection(parts.filter((p) => p.groupId === me.groupId).map((p) => p.id), partId);
        } else {
          setSelected(partId);
        }
        onClick?.(partId);
      }}
      // Double-click opens/closes drawers + doors on parts that support it
      // (nightstand, wardrobe); harmless no-op otherwise.
      onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (gestureOwnedByOther(partId)) return;
        toggleOpen(partId);
      }}
    >
      {children}
    </group>
  );
}

export function useSelected(partId: string) {
  return useStudio((s) => s.selectedPartId === partId);
}
