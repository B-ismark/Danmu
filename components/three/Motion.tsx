'use client';

// Subtle idle motion helpers. The canvas already runs frameloop="always", so
// useFrame ticks every frame. Kept gentle — enough to read as "alive" without
// distracting while editing.

import { useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';

/** Continuous spin about Y (ceiling fan blades). */
export function Spin({ speed = 1, children }: { speed?: number; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * speed;
  });
  return <group ref={ref}>{children}</group>;
}

/** Gentle oscillation about an axis (plant sway, pendant swing). Phase is
 *  seeded so multiple instances don't move in lockstep. */
export function Sway({
  amp = 0.04,
  speed = 1.1,
  axis = 'z',
  phase = 0,
  children,
}: {
  amp?: number;
  speed?: number;
  axis?: 'x' | 'z';
  phase?: number;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  useFrame((s) => {
    if (ref.current) ref.current.rotation[axis] = Math.sin(s.clock.elapsedTime * speed + phase) * amp;
  });
  return <group ref={ref}>{children}</group>;
}
