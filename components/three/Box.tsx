'use client';

// Rounded box primitive — the workhorse for furniture bodies. Soft beveled
// corners (RoundedBox) catch the key light + ambient occlusion, which is what
// stops parts reading as flat slabs. Hard ink outlines are OFF by default now
// (they were the main "flat CAD" tell); small accent calls can still opt back in
// by passing edgeOpacity > 0.

import { Edges, RoundedBox } from '@react-three/drei';
import type { ReactNode } from 'react';

type Props = {
  size: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  edgeColor?: string;
  /** 0 = no outline (default). Accent parts can pass a small value. */
  edgeOpacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** roughness override (default 0.8 — slight sheen reads less plasticky/flat). */
  roughness?: number;
  metalness?: number;
  children?: ReactNode;
};

export function Box({
  size,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  color,
  edgeColor = '#3a352e',
  edgeOpacity = 0,
  emissive,
  emissiveIntensity = 0,
  roughness = 0.8,
  metalness = 0,
  children,
}: Props) {
  // Bevel radius scaled to the smallest dimension, clamped so thin panels
  // (doors, shelves, TV) don't collapse.
  const minDim = Math.min(size[0], size[1], size[2]);
  const radius = Math.min(0.03, Math.max(0.004, minDim * 0.18));
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={size} radius={radius} smoothness={3} steps={1} castShadow receiveShadow>
        <meshStandardMaterial
          color={color}
          roughness={roughness}
          metalness={metalness}
          envMapIntensity={0.5}
          emissive={emissive ?? '#000000'}
          emissiveIntensity={emissiveIntensity}
        />
        {edgeOpacity > 0 && (
          <Edges threshold={30} renderOrder={1}>
            <lineBasicMaterial color={edgeColor} transparent opacity={edgeOpacity} />
          </Edges>
        )}
      </RoundedBox>
      {children}
    </group>
  );
}
