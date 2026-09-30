'use client';

// Scale mode's controls: three handles, one per size, each sitting on the face it
// moves. Pull the side dot and the piece gets wider on that side while the other
// side stays where it stands; the front dot does the depth, the top dot the
// height.
//
// They replaced drei's scale gizmo, which put nine controls on the piece's pivot —
// three coloured cubes, three grey ones, three planes — and grew the piece from
// its centre, so both sides moved and nothing on screen said which of the nine
// did what. The arithmetic is `lib/stretch.ts`; this file is only where the dots
// are drawn and which pointer is on them.
//
// Which side a dot is on follows the camera (`facingSide`), so it is never hidden
// behind its own piece. Two exceptions, both about what is behind the piece: a
// wall piece's depth dot is always on its front, because its back is on the
// plaster, and a ceiling piece's height dot is underneath, because its top is on
// the ceiling.
//
// A dot is a fixed size ON SCREEN, not in the room — a handle that shrinks to a
// speck when you step back is not a handle. Depth-tested like the selection base
// (`Highlight.tsx`): R3F delivers a press to the nearest thing under it, so a dot
// drawn through another piece would be one you can see and cannot press.

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BackSide, Plane, Vector3, type Group, type OrthographicCamera, type PerspectiveCamera } from 'three';
import { SCENE } from '@/lib/scene-palette';
import { consumeGizmoClick } from '@/lib/gizmo-press';
import {
  dragPlaneNormal,
  facingSide,
  pulledBy,
  stretchDirection,
  STRETCH_INDEX,
  type StretchAxis,
} from '@/lib/stretch';

type Vec3 = [number, number, number];

const AXES: StretchAxis[] = ['width', 'depth', 'height'];
/** On-screen diameter of the visible dot, in CSS px. */
const DOT_PX = { fine: 14, coarse: 22 };
/** On-screen diameter of what a press can land on. 44 px under a finger is the
 *  usual minimum touch target; a mouse gets a smaller, still forgiving one. */
const HIT_PX = { fine: 26, coarse: 44 };

const noRaycast = () => null;
const _hit = new Vector3();

export function StretchHandles({
  targetRef,
  liveDim,
  floorStanding,
  heightSide,
  depthSide,
  coarse,
  onPress,
  onPull,
  onRelease,
}: {
  /** The piece's outer group — its live position, turn and scale. */
  targetRef: { current: Group | null };
  /** The size the piece is drawn at right now, in mm, the stretch in flight included. */
  liveDim: () => [number, number, number];
  floorStanding: boolean;
  /** +1 puts the height dot on top; −1 underneath, for a piece hung from the ceiling. */
  heightSide: 1 | -1;
  /** A fixed side for the depth dot, or null to follow the camera. */
  depthSide: 1 | -1 | null;
  coarse: boolean;
  /** A press landed on a dot. False means another gesture owns the pointer and
   *  the press is left alone. */
  onPress: (axis: StretchAxis, side: 1 | -1) => boolean;
  /** How far the face has been pulled out since the press, in metres. */
  onPull: (metres: number) => void;
  onRelease: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const viewportH = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  const nodes = useRef<Record<StretchAxis, Group | null>>({ width: null, depth: null, height: null });
  const sides = useRef<Record<StretchAxis, 1 | -1>>({ width: 1, depth: 1, height: 1 });
  const active = useRef<{ axis: StretchAxis; pointerId: number; dir: Vec3; plane: Plane; start: Vec3 } | null>(null);
  const [hot, setHot] = useState<StretchAxis | null>(null);

  // Mounted for as long as the piece is selected in scale mode, so a mode switch
  // (S → W on the keyboard) mid-pull unmounts it with the pointer still down. The
  // release is what lands the pull and hands the camera back; skipping it leaves
  // `draggingId` set and the camera parked.
  const release = useRef(onRelease);
  release.current = onRelease;
  useEffect(
    () => () => {
      if (active.current) {
        active.current = null;
        document.body.style.cursor = '';
        release.current();
      }
    },
    [],
  );

  useFrame(() => {
    const g = targetRef.current;
    if (!g) return;
    const dim = liveDim();
    const rot = g.rotation.y;
    const centre: Vec3 = [g.position.x, floorStanding ? g.position.y + dim[2] / 2000 : g.position.y, g.position.z];
    const cam: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
    // World metres per CSS pixel at the piece's distance, so a dot is the same
    // size on screen however far away the camera is.
    let perPx: number;
    if ((camera as OrthographicCamera).isOrthographicCamera) {
      const o = camera as OrthographicCamera;
      perPx = (o.top - o.bottom) / o.zoom / Math.max(1, viewportH);
    } else {
      const dist = Math.hypot(cam[0] - centre[0], cam[1] - centre[1], cam[2] - centre[2]);
      const fov = ((camera as PerspectiveCamera).fov ?? 50) * (Math.PI / 180);
      perPx = (2 * dist * Math.tan(fov / 2)) / Math.max(1, viewportH);
    }
    const r = ((coarse ? DOT_PX.coarse : DOT_PX.fine) / 2) * perPx;
    for (const axis of AXES) {
      const node = nodes.current[axis];
      if (!node) continue;
      // Held for the length of a pull: a dot that hopped to the other side
      // mid-gesture would reverse what the same pointer travel means.
      if (!active.current) {
        sides.current[axis] =
          axis === 'height'
            ? heightSide
            : axis === 'depth' && depthSide !== null
              ? depthSide
              : facingSide(rot, axis, centre, cam);
      }
      const d = stretchDirection(rot, axis, sides.current[axis]);
      // Just off the face, clear of it by more than the dot's own radius.
      const off = dim[STRETCH_INDEX[axis]] / 2000 + r * 1.6;
      node.position.set(centre[0] + d[0] * off, centre[1] + d[1] * off, centre[2] + d[2] * off);
      node.scale.setScalar(r);
      // Only the dot being pulled while a pull is on — the other two are not
      // part of the gesture and would read as though they were.
      node.visible = !active.current || active.current.axis === axis;
    }
  });

  function press(axis: StretchAxis) {
    return (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || active.current) return;
      const node = nodes.current[axis];
      const g = targetRef.current;
      if (!node || !g) return;
      // Ours before anything else looks at it: the piece behind the dot must not
      // start a drag of its own from the same press.
      e.stopPropagation();
      const side = sides.current[axis];
      const dir = stretchDirection(g.rotation.y, axis, side);
      const at = node.position;
      const n = dragPlaneNormal(dir, [camera.position.x - at.x, camera.position.y - at.y, camera.position.z - at.z]);
      if (!n) return;
      const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(n[0], n[1], n[2]), at);
      if (!e.ray.intersectPlane(plane, _hit)) return;
      if (!onPress(axis, side)) return;
      (e.target as Element).setPointerCapture(e.pointerId);
      active.current = { axis, pointerId: e.pointerId, dir, plane, start: [_hit.x, _hit.y, _hit.z] };
      document.body.style.cursor = 'grabbing';
      invalidate();
    };
  }

  function move(e: ThreeEvent<PointerEvent>) {
    const a = active.current;
    if (!a || e.pointerId !== a.pointerId) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(a.plane, _hit)) return;
    onPull(pulledBy(a.start, [_hit.x, _hit.y, _hit.z], a.dir));
  }

  function up(e: ThreeEvent<PointerEvent>) {
    const a = active.current;
    if (!a || e.pointerId !== a.pointerId) return;
    e.stopPropagation();
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    active.current = null;
    document.body.style.cursor = '';
    setHot(null);
    onRelease();
    invalidate();
  }

  return (
    <group userData={{ helper: true }}>
      {AXES.map((axis) => {
        const lit = hot === axis;
        return (
          <group
            key={axis}
            ref={(n) => {
              nodes.current[axis] = n;
            }}
            onPointerDown={press(axis)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHot(axis);
              if (!active.current) document.body.style.cursor = 'grab';
              invalidate();
            }}
            onPointerOut={() => {
              setHot((h) => (h === axis ? null : h));
              if (!active.current) document.body.style.cursor = '';
              invalidate();
            }}
            onClick={(e) => {
              // The click that ends a pull lands here more often than not. It is
              // not a click on the piece behind, and the gate `onPress` armed is
              // spent here so it cannot eat the next real click somewhere else.
              e.stopPropagation();
              consumeGizmoClick();
            }}
          >
            {/* What a press lands on: bigger than the dot, drawn as nothing. */}
            <mesh scale={(coarse ? HIT_PX.coarse : HIT_PX.fine) / (coarse ? DOT_PX.coarse : DOT_PX.fine)}>
              <sphereGeometry args={[1, 12, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>
            <mesh raycast={noRaycast} renderOrder={2}>
              <sphereGeometry args={[1, 24, 16]} />
              <meshBasicMaterial color={lit ? SCENE.accentHover : SCENE.accent} toneMapped={false} />
            </mesh>
            {/* A pale rim, so the dot reads against a terracotta sofa as well as
                against the floor. */}
            <mesh raycast={noRaycast} scale={1.3}>
              <sphereGeometry args={[1, 24, 16]} />
              <meshBasicMaterial color={SCENE.glass} side={BackSide} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
