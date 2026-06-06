'use client';

// Drag handle for moving the selected wall. Renders a grabbable knob on the
// inside face of the selected wall; dragging it along the wall's normal pushes
// the wall out (bigger room) or in (smaller). The move resolves to a width/depth
// change about the room centre (see scene-store `moveWall`), so the dragged edge
// tracks the pointer while everything stays centred on the origin.
//
// Drag is driven by window listeners + a manual raycast (not mesh onPointerMove)
// so it keeps firing even when the cursor leaves the small knob — the same
// pattern Room.tsx uses for catalog drops.
//
// The whole group is flagged `userData.helper` so SceneCapture strips it from
// the snapshot the AI preview renders from.

import { useEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { wallSegments } from '@/lib/footprint';

const ACCENT = '#E2613A';
const _ray = new Raycaster();
const _ndc = new Vector2();
const _hit = new Vector3();

export function WallHandles() {
  const room = useScene((s) => s.room);
  const moveWall = useScene((s) => s.moveWall);
  const selectedWall = useStudio((s) => s.selectedWall);
  const setDragging = useStudio((s) => s.setDragging);
  const { camera, gl } = useThree();

  const seg = useMemo(() => {
    if (selectedWall === null) return null;
    return wallSegments(room.footprint)[selectedWall] ?? null;
  }, [room.footprint, selectedWall]);

  const drag = useRef<{
    plane: Plane;
    outX: number;
    outZ: number;
    downAlong: number;
    prevTotal: number;
  } | null>(null);

  // Window-level drag: raycast the pointer onto a horizontal plane at the knob
  // height and project the displacement onto the wall's outward normal.
  useEffect(() => {
    function move(ev: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const rect = gl.domElement.getBoundingClientRect();
      _ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      _ray.setFromCamera(_ndc, camera);
      if (!_ray.ray.intersectPlane(d.plane, _hit)) return;
      const total = _hit.x * d.outX + _hit.z * d.outZ - d.downAlong;
      const step = total - d.prevTotal;
      d.prevTotal = total;
      // Resize about centre moves each opposite wall by delta/2 → feed 2× so the
      // grabbed edge tracks the pointer 1:1.
      if (step !== 0 && selectedWall !== null) moveWall(selectedWall, step * 2);
    }
    function up() {
      if (!drag.current) return;
      drag.current = null;
      setDragging(null);
      document.body.style.cursor = '';
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [camera, gl, moveWall, selectedWall, setDragging]);

  if (selectedWall === null || !seg) return null;

  const handleY = room.height * 0.5;
  // Inward normal (toward centroid) — wallSegments encodes it as yaw = atan2(nx,nz).
  const inX = Math.sin(seg.yaw);
  const inZ = Math.cos(seg.yaw);
  const outX = -inX;
  const outZ = -inZ;
  // Sit the knob just inside the wall face so it's easy to grab.
  const hx = seg.x + inX * 0.18;
  const hz = seg.z + inZ * 0.18;

  function onDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    drag.current = {
      plane: new Plane(new Vector3(0, 1, 0), -handleY),
      outX,
      outZ,
      downAlong: e.point.x * outX + e.point.z * outZ,
      prevTotal: 0,
    };
    setDragging('__wall__');
    document.body.style.cursor = 'grabbing';
  }

  // Orient the arrow knob along the wall normal.
  const yaw = Math.atan2(outX, outZ);

  return (
    <group userData={{ helper: true }} position={[hx, handleY, hz]} rotation={[0, yaw, 0]}>
      <mesh
        onPointerDown={onDown}
        onPointerOver={() => {
          if (!drag.current) document.body.style.cursor = 'grab';
        }}
        onPointerOut={() => {
          if (!drag.current) document.body.style.cursor = '';
        }}
      >
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshStandardMaterial color={ACCENT} roughness={0.4} metalness={0.1} emissive={ACCENT} emissiveIntensity={0.25} />
      </mesh>
      {/* Double-headed arrow hint along the normal (pointer-transparent). */}
      {[1, -1].map((dir) => (
        <mesh key={dir} position={[0, 0, dir * 0.28]} rotation={[dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0]} raycast={() => null}>
          <coneGeometry args={[0.07, 0.16, 16]} />
          <meshStandardMaterial color={ACCENT} roughness={0.5} emissive={ACCENT} emissiveIntensity={0.2} />
        </mesh>
      ))}
    </group>
  );
}
