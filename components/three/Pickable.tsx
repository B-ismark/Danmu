'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import { Group } from 'three';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';

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
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHovered(partId);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHovered(null);
        document.body.style.cursor = '';
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        // A Space + left-drag that happens to pass over furniture is a camera
        // pan; it must not re-select whatever it flew across.
        if (useStudio.getState().panKeyHeld) return;
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
