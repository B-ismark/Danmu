'use client';

// Room shell — floor, grid, and four walls rendered as a "dollhouse".
//
// Backface culling for the walls: each wall is a single-sided plane whose front
// face normal points INTO the room. three renders only front faces (the default
// FrontSide), so:
//   • walls on the far side of the room have normals pointing toward the camera
//     → rendered (you see the room's back walls), and
//   • the wall between the camera and the room has its normal pointing away
//     → culled, so it never blocks the view.
// As the user orbits, whichever wall is nearest the camera disappears and the
// others stay — all four exist, none of them occlude. No per-frame work; the GPU
// does the culling for free.

import { useMemo, useState } from 'react';
import { DoubleSide, FrontSide, Shape, ShapeGeometry, Vector2 } from 'three';
import { type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { wallSegments, footprintBounds } from '@/lib/footprint';
import { floorNormal, floorRoughness } from '@/lib/textures';

const WALL = '#ECE9E1';
const FLOOR = '#E6E1D6';
const ACCENT = '#E2613A';
const FLOOR_NORMAL_SCALE = new Vector2(0.25, 0.25);

export function RoomShell() {
  const { height, footprint, wallColors } = useScene((s) => s.room);
  const showGrid = useStudio((s) => s.showGrid);
  const selectedWall = useStudio((s) => s.selectedWall);
  const setSelectedWall = useStudio((s) => s.setSelectedWall);
  const [hoverWall, setHoverWall] = useState<number | null>(null);

  const gridLines = useMemo(() => {
    const lines: Array<[[number, number, number], [number, number, number]]> = [];
    // Span the footprint bounding box — it may be off-centre after wall moves.
    const b = footprintBounds(footprint);
    const div = 14;
    for (let i = 0; i <= div; i++) {
      const u = b.minX + (i / div) * b.width;
      lines.push([
        [u, 0.002, b.minZ],
        [u, 0.002, b.maxZ],
      ]);
    }
    for (let j = 0; j <= 10; j++) {
      const v = b.minZ + (j / 10) * b.depth;
      lines.push([
        [b.minX, 0.002, v],
        [b.maxX, 0.002, v],
      ]);
    }
    return lines;
  }, [footprint]);

  // Floor geometry from the polygon footprint. Shape is built in XY; the mesh is
  // laid flat with rot[-90°] about X which maps shape-Y → world -Z, so we feed
  // (x, -z) to keep the floor aligned with the walls (placed in XZ).
  const floorGeo = useMemo(() => {
    const shape = new Shape();
    footprint.forEach((p, i) => (i ? shape.lineTo(p[0], -p[1]) : shape.moveTo(p[0], -p[1])));
    shape.closePath();
    return new ShapeGeometry(shape);
  }, [footprint]);

  // One inward-facing single-sided wall per polygon edge — the near one culls.
  const walls = useMemo(() => wallSegments(footprint), [footprint]);

  return (
    <group>
      {/* Floor — double-sided so it reads from above and below. */}
      <mesh geometry={floorGeo} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial
          color={FLOOR}
          roughness={0.92}
          metalness={0}
          side={DoubleSide}
          normalMap={floorNormal()}
          normalScale={FLOOR_NORMAL_SCALE}
          roughnessMap={floorRoughness()}
        />
      </mesh>

      {showGrid &&
        gridLines.map((pts, i) => (
          <Line key={i} points={pts} color="#131311" transparent opacity={0.06} lineWidth={0.5} />
        ))}

      {/* Walls — single-sided, normal points inward → near wall back-face-culls.
          Clickable to select + paint; selected/hovered wall gets an accent frame. */}
      {walls.map((wl, i) => {
        const color = wallColors?.[i] ?? WALL;
        const isSel = selectedWall === i;
        const isHov = hoverWall === i;
        return (
          <group key={`w-${i}`}>
            <mesh
              position={[wl.x, height / 2, wl.z]}
              rotation={[0, wl.yaw, 0]}
              receiveShadow
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                setSelectedWall(i);
              }}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHoverWall(i);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHoverWall((h) => (h === i ? null : h));
                document.body.style.cursor = '';
              }}
            >
              <planeGeometry args={[wl.len, height]} />
              <meshStandardMaterial color={color} roughness={0.96} metalness={0} side={FrontSide} />
            </mesh>
            {/* Selection / hover frame — drawn just inside the room face so it
                reads on the visible side. Marked as an editor helper so the AI
                snapshot (SceneCapture) strips it before rendering. */}
            {(isSel || isHov) && (
              <group userData={{ helper: true }}>
                <Line
                  points={[
                    [wl.x - (wl.len / 2) * Math.cos(wl.yaw), 0.02, wl.z + (wl.len / 2) * Math.sin(wl.yaw)],
                    [wl.x + (wl.len / 2) * Math.cos(wl.yaw), 0.02, wl.z - (wl.len / 2) * Math.sin(wl.yaw)],
                    [wl.x + (wl.len / 2) * Math.cos(wl.yaw), height - 0.02, wl.z - (wl.len / 2) * Math.sin(wl.yaw)],
                    [wl.x - (wl.len / 2) * Math.cos(wl.yaw), height - 0.02, wl.z + (wl.len / 2) * Math.sin(wl.yaw)],
                    [wl.x - (wl.len / 2) * Math.cos(wl.yaw), 0.02, wl.z + (wl.len / 2) * Math.sin(wl.yaw)],
                  ]}
                  color={ACCENT}
                  lineWidth={isSel ? 2.5 : 1.2}
                  transparent
                  opacity={isSel ? 1 : 0.5}
                />
              </group>
            )}
          </group>
        );
      })}

      {/* Skirting along the inner base of each wall. */}
      {walls.map((wl, i) => (
        <mesh key={`sk-${i}`} position={[wl.x, 0.05, wl.z]} rotation={[0, wl.yaw, 0]}>
          <planeGeometry args={[wl.len, 0.1]} />
          <meshStandardMaterial color="#D8D3C6" roughness={0.9} side={FrontSide} />
        </mesh>
      ))}
    </group>
  );
}
