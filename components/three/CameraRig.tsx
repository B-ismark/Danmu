'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MOUSE, Vector3 } from 'three';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';

const PRESETS = {
  free: { pos: [4.2, 3.6, 4.8] as const, target: [0, 1.0, 0] as const },
  front: { pos: [0, 1.6, 5.8] as const, target: [0, 1.2, 0] as const },
  top: { pos: [0, 8.5, 0.2] as const, target: [0, 0, 0] as const },
  iso: { pos: [5.0, 4.5, 5.5] as const, target: [0, 1.0, 0] as const },
};

export function CameraRig() {
  const view = useStudio((s) => s.viewPreset);
  const dragging = useStudio((s) => s.draggingId);
  // Space + left-drag pans — the gesture every 3D tool shares, and the reason the
  // right button is now free for the context menu. Panning used to be RIGHT only,
  // which both hid it behind the least-used button and spent the one press that
  // had no other meaning in the studio. Space is tracked once, in
  // KeyboardShortcuts, so the 2D plan can pan the same way.
  const panKey = useStudio((s) => s.panKeyHeld);
  const frameToken = useStudio((s) => s.frameSelectedToken);
  const partsRef = useScene((s) => s.parts);
  const ctrlRef = useRef<OrbitControlsImpl>(null);
  const { invalidate } = useThree();
  const targetCam = useRef(new Vector3());
  const targetLook = useRef(new Vector3());
  const animatingUntil = useRef(0);
  // Only the F key (which bumps frameSelectedToken) should frame a part. Track
  // the last handled token so merely *selecting* a different part never moves
  // the camera — previously `selectedId` was an effect dep, so once the token
  // was non-zero, every selection swung the camera to the new part.
  const lastFrameToken = useRef(0);

  useEffect(() => {
    const p = PRESETS[view];
    targetCam.current.set(p.pos[0], p.pos[1], p.pos[2]);
    targetLook.current.set(p.target[0], p.target[1], p.target[2]);
    animatingUntil.current = performance.now() + 800;
    invalidate();
  }, [view, invalidate]);

  // Frame the selected part — ONLY when the F key bumps the token (not on select).
  useEffect(() => {
    if (frameToken === lastFrameToken.current) return;
    lastFrameToken.current = frameToken;
    if (frameToken === 0) return;
    const selectedId = useStudio.getState().selectedPartId;
    if (!selectedId) return;
    const part = partsRef.find((p) => p.id === selectedId);
    if (!part) return;
    const radius = Math.max(part.dimMM[0], part.dimMM[1], part.dimMM[2]) / 1000;
    const dist = Math.max(2.5, radius * 2.5);
    targetLook.current.set(part.pos[0], part.pos[1] + part.dimMM[2] / 2000, part.pos[2]);
    targetCam.current.set(
      part.pos[0] + dist * 0.7,
      part.pos[1] + dist * 0.6,
      part.pos[2] + dist * 0.7,
    );
    animatingUntil.current = performance.now() + 700;
    invalidate();
  }, [frameToken, partsRef, invalidate]);

  return (
    <>
      <OrbitControls
        ref={ctrlRef}
        enabled={!dragging}
        enablePan
        screenSpacePanning={false}
        // RIGHT is deliberately absent, not MOUSE.PAN: three reads the button
        // through this map, so leaving it out is how the button is handed to the
        // context menu. Middle-drag still dollies.
        mouseButtons={{ LEFT: panKey ? MOUSE.PAN : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY }}
        enableDamping
        dampingFactor={0.12}
        makeDefault
        minDistance={2.2}
        maxDistance={14}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI - 0.15}
        target={[0, 1.0, 0]}
        onChange={() => invalidate()}
      />
      <CameraTween
        camRef={targetCam}
        lookRef={targetLook}
        ctrlRef={ctrlRef}
        animatingUntil={animatingUntil}
      />
      <KeyboardNav ctrlRef={ctrlRef} enabled={!dragging} />
    </>
  );
}

function CameraTween({
  camRef,
  lookRef,
  ctrlRef,
  animatingUntil,
}: {
  camRef: MutableRefObject<Vector3>;
  lookRef: MutableRefObject<Vector3>;
  ctrlRef: MutableRefObject<OrbitControlsImpl | null>;
  animatingUntil: MutableRefObject<number>;
}) {
  const { camera, invalidate } = useThree();
  useFrame(() => {
    if (performance.now() > animatingUntil.current) return;
    const k = 0.08;
    camera.position.lerp(camRef.current, k);
    if (ctrlRef.current) {
      ctrlRef.current.target.lerp(lookRef.current, k);
      ctrlRef.current.update();
    }
    invalidate();
  });
  return null;
}

// Build-mode keyboard navigation (Paralives-style). Arrow keys pan across the
// floor plane, Q/E orbit. Respects frameloop="demand" by invalidating while keys
// are held.
//
// WASD is NOT a pan. It was, conditionally — only while nothing was selected,
// because W/S/R are the gizmo modes (see KeyboardShortcuts.tsx) and a selected
// part had to keep them. A binding that means one thing with a selection and
// another without it is a binding nobody can learn: the same key moved the room
// or changed the tool depending on state the keyboard gives no feedback about,
// and pressing W to switch to Move with nothing selected slid the camera
// instead. It was also undocumented — the help card only ever advertised the
// arrows and Q/E — so removing it takes nothing anyone was told they had.
const NAV_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e']);
const UP = new Vector3(0, 1, 0);

function KeyboardNav({
  ctrlRef,
  enabled,
}: {
  ctrlRef: MutableRefObject<OrbitControlsImpl | null>;
  enabled: boolean;
}) {
  const { camera, invalidate } = useThree();
  const keys = useRef<Set<string>>(new Set());

  useEffect(() => {
    function isTyping(t: EventTarget | null) {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }
    function down(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (!NAV_KEYS.has(k)) return;
      e.preventDefault(); // stop arrow-key page scroll
      keys.current.add(k);
      invalidate();
    }
    function up(e: KeyboardEvent) {
      keys.current.delete(e.key.toLowerCase());
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    const ks = keys.current;
    const ctrl = ctrlRef.current;
    if (!enabled || ks.size === 0 || !ctrl) return;

    const panSpeed = 3.2 * delta;
    const rotSpeed = 1.8 * delta;

    // Ground-plane forward (camera→target, flattened) + right vectors.
    const fwd = new Vector3().subVectors(ctrl.target, camera.position);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new Vector3().crossVectors(fwd, UP).normalize();

    const move = new Vector3();
    if (ks.has('arrowup')) move.add(fwd);
    if (ks.has('arrowdown')) move.sub(fwd);
    if (ks.has('arrowright')) move.add(right);
    if (ks.has('arrowleft')) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(panSpeed);
      camera.position.add(move);
      ctrl.target.add(move);
    }

    // Q/E orbit camera around the target about the vertical axis.
    let ang = 0;
    if (ks.has('q')) ang += rotSpeed;
    if (ks.has('e')) ang -= rotSpeed;
    if (ang !== 0) {
      const off = new Vector3().subVectors(camera.position, ctrl.target);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const nx = off.x * cos - off.z * sin;
      const nz = off.x * sin + off.z * cos;
      off.x = nx;
      off.z = nz;
      camera.position.copy(ctrl.target).add(off);
    }

    ctrl.update();
    invalidate();
  });
  return null;
}
