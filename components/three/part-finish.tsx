'use client';

// A piece's wood and fabric finish, applied to every surface it draws.
//
// One context, provided by `PartGeometry` around the whole piece, and read by the
// four places a material is made — `Box`, the instanced sets' `InstanceMaterial`,
// and `FinishMaterial` below (a `HardParts` primitive, a lamp shade). Threading a
// prop through ninety renderers instead is how one of them gets missed, and a missed
// one is a piece whose legs are lacquered and whose top is not.
//
// **Absent is unchanged.** With no choice made, every surface resolves to exactly the
// preset and roughness its renderer asked for; the finish only REPLACES a wood or
// fabric preset when one has been picked, and then its own roughness wins over the
// renderer's, because that roughness is half of what the user picked.

import { createContext, useContext, type ComponentProps } from 'react';
import type { FabricFinish, WoodFinish } from '@/lib/part-finish';
import { PHYSICAL_SURFACES, SURFACE, type SurfaceKey } from './materials';

export type FinishChoice = { wood?: WoodFinish; fabric?: FabricFinish };

export const PartFinishContext = createContext<FinishChoice | undefined>(undefined);

/** One object per combination, so the context value is stable without a hook —
 *  `PartGeometry` is also walked as a plain function by the geometry tests. */
const VALUES = new Map<string, FinishChoice>();
export function finishChoice(wood: WoodFinish | undefined, fabric: FabricFinish | undefined): FinishChoice | undefined {
  if (!wood && !fabric) return undefined;
  const key = `${wood ?? ''}|${fabric ?? ''}`;
  let v = VALUES.get(key);
  if (!v) VALUES.set(key, (v = { wood, fabric }));
  return v;
}

const WOOD_KEYS: ReadonlySet<string> = new Set(['wood', 'woodSatin']);
const WOOD_TO: Record<WoodFinish, SurfaceKey | null> = { natural: null, painted: 'woodPainted', lacquered: 'woodLacquer' };
const FABRIC_TO: Record<FabricFinish, SurfaceKey | null> = { linen: null, velvet: 'velvet', boucle: 'boucle' };

/** What a requested surface becomes under a finish. `owns` is true when the finish
 *  replaced it, which is when the finish's roughness — not the renderer's — applies. */
export function finishedSurface(key: SurfaceKey | undefined, f: FinishChoice | undefined): { key: SurfaceKey | undefined; owns: boolean } {
  if (!key || !f) return { key, owns: false };
  const to = WOOD_KEYS.has(key) && f.wood ? WOOD_TO[f.wood] : key === 'fabric' && f.fabric ? FABRIC_TO[f.fabric] : null;
  return to ? { key: to, owns: true } : { key, owns: false };
}

/** The same, for the instanced sets, which are handed a preset OBJECT rather than a key. */
export function finishedPreset<T extends object | undefined>(preset: T, f: FinishChoice | undefined): T | (typeof SURFACE)[SurfaceKey] {
  if (!preset || !f) return preset;
  for (const k of ['wood', 'woodSatin', 'fabric'] as const) {
    if (preset === SURFACE[k]) {
      const to = finishedSurface(k, f).key;
      return to && to !== k ? SURFACE[to] : preset;
    }
  }
  return preset;
}

export function usePartFinish(): FinishChoice | undefined {
  return useContext(PartFinishContext);
}

type MaterialProps = Omit<ComponentProps<'meshPhysicalMaterial'>, 'ref'>;

/** A material for one surface of a piece, finished. `physical` asks for the cloth
 *  shader even unfinished (a lamp shade has always had its sheen); a finish that turns
 *  a surface into velvet or bouclé gets it either way. */
export function FinishMaterial({
  surface,
  physical = false,
  roughness,
  ...rest
}: { surface?: SurfaceKey; physical?: boolean } & MaterialProps) {
  const fin = finishedSurface(surface, usePartFinish());
  const preset = fin.key ? SURFACE[fin.key] : undefined;
  const r = (fin.owns ? undefined : roughness) ?? preset?.roughness;
  const usePhysical = physical || (fin.owns && fin.key !== undefined && PHYSICAL_SURFACES.includes(fin.key));
  return usePhysical ? (
    <meshPhysicalMaterial {...preset} {...rest} roughness={r} />
  ) : (
    <meshStandardMaterial {...(preset as object)} {...(rest as object)} roughness={r} />
  );
}
