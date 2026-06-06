'use client';

// Single source of truth selector. Combines:
//   useScene  — base parts (scene-spec from detection or defaults)
//   useStudio — runtime transform overrides (positions, rotations, dims)
// Returns ScenePart[] with overrides merged. Components consume this instead of
// reaching into both stores.

import { useScene } from './scene-store';
import { useStudio } from './store';
import type { ScenePart } from './scene-spec';

export function useRoomScene(): ScenePart[] {
  const parts = useScene((s) => s.parts);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);

  return parts.map((p) => ({
    ...p,
    pos: positions[p.id] ?? p.pos,
    rot: rotations[p.id] ?? p.rot,
    dimMM: dims[p.id] ?? p.dimMM,
  }));
}

export function useRoomPart(id: string | null): ScenePart | undefined {
  const parts = useRoomScene();
  if (!id) return undefined;
  return parts.find((p) => p.id === id);
}
