'use client';

// Rounded box primitive — the workhorse for furniture bodies. Soft beveled
// corners (RoundedBox) catch the key light + ambient occlusion, which is what
// stops parts reading as flat slabs. Hard ink outlines are OFF by default now
// (they were the main "flat CAD" tell); small accent calls can still opt back in
// by passing edgeOpacity > 0.
//
// A bevel is only worth its vertex count when you can see it. The radius is
// clamped to 18% of the smallest dimension, so anything under ~5cm (legs, slats,
// rails, shelf boards, book spines, grille louvres) gets a sub-1cm fillet that
// is sub-pixel at any sane camera distance — those fall through to a plain
// 12-triangle boxGeometry instead of RoundedBox's few hundred, in the shadow
// pass too. Visually identical, an order of magnitude cheaper.
//
// BoxInstances / PlaneInstances below exist because the parametric shapes repeat
// ONE element dozens-to-hundreds of times: a maxed bookshelf is 7 bays × 42
// books = 294 spines, a 5m curtain is 45 pleats, a 2m radiator 33 fins. As
// individual meshes that is 300 geometries + 300 materials + 300 draw calls for
// a single object. As an InstancedMesh it is one of each.

import { Edges, RoundedBox } from '@react-three/drei';
// R3F 9 dropped the per-element `*Props` aliases; the element prop types now
// come off the `ThreeElements` map instead.
import type { ThreeElements } from '@react-three/fiber';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Color, DoubleSide, Euler, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import { PHYSICAL_SURFACES, SURFACE, type SurfaceKey } from './materials';
import { DETAIL } from '@/lib/scene-palette';

/** Below this (metres) the clamped bevel is invisible — skip RoundedBox. */
const BEVEL_FLOOR = 0.05;

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
  /** roughness override. Defaults to the surface preset's, else 0.8. */
  roughness?: number;
  metalness?: number;
  /** Named surface from ./materials — microrelief and, for cloth, the sheen lobe.
   *  Taken by NAME rather than as a spread object so the caller cannot pair a
   *  preset with a material element that silently drops half of it. */
  surface?: SurfaceKey;
  children?: ReactNode;
};

export function Box({
  size,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  color,
  edgeColor = DETAIL.edge,
  edgeOpacity = 0,
  emissive,
  emissiveIntensity = 0,
  roughness,
  metalness,
  surface,
  children,
}: Props) {
  // Bevel radius scaled to the smallest dimension, clamped so thin panels
  // (doors, shelves, TV) don't collapse.
  const minDim = Math.min(size[0], size[1], size[2]);
  const radius = Math.min(0.03, Math.max(0.004, minDim * 0.18));
  const preset = surface ? SURFACE[surface] : undefined;
  const matProps = {
    color,
    envMapIntensity: 0.5,
    emissive: emissive ?? '#000000',
    emissiveIntensity,
    ...preset,
    roughness: roughness ?? preset?.roughness ?? 0.8,
    metalness: metalness ?? preset?.metalness ?? 0,
  };
  // meshPhysicalMaterial is the heavier shader, so it is used only where the
  // preset actually needs it — cloth, for its sheen. Everything else stays on
  // meshStandardMaterial exactly as before.
  const material =
    surface && PHYSICAL_SURFACES.includes(surface) ? (
      <meshPhysicalMaterial {...matProps} />
    ) : (
      <meshStandardMaterial {...matProps} />
    );
  const outline = edgeOpacity > 0 && (
    <Edges threshold={30} renderOrder={1}>
      <lineBasicMaterial color={edgeColor} transparent opacity={edgeOpacity} />
    </Edges>
  );
  return (
    <group position={position} rotation={rotation}>
      {minDim < BEVEL_FLOOR ? (
        <mesh castShadow receiveShadow>
          <boxGeometry args={size} />
          {material}
          {outline}
        </mesh>
      ) : (
        <RoundedBox args={size} radius={radius} smoothness={3} steps={1} castShadow receiveShadow>
          {material}
          {outline}
        </RoundedBox>
      )}
      {children}
    </group>
  );
}

// ─── Instanced repeats ────────────────────────────────────────────────────────

export type InstanceItem = {
  /** centre, in the parent group's local space */
  pos: [number, number, number];
  /** box: [w, h, d]. plane: [w, h] (the third value is ignored) */
  size: [number, number, number];
  /** optional local euler rotation, radians */
  rot?: [number, number, number];
  /** per-instance albedo, multiplied over the shared material colour. Only the
   *  bookshelf needs it (every spine a different colour, one material). */
  color?: string;
};

// Module-level scratch — composing a matrix per instance must not allocate.
const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _c = new Color();

/** Writes one transform (and optional colour) per item into the InstancedMesh.
 *  Runs in a layout effect, never per frame — the geometry is static once the
 *  part's dims are resolved. */
function useInstanceTransforms(items: InstanceItem[]) {
  const ref = useRef<InstancedMesh | null>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    let tinted = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      _p.set(it.pos[0], it.pos[1], it.pos[2]);
      _e.set(it.rot?.[0] ?? 0, it.rot?.[1] ?? 0, it.rot?.[2] ?? 0);
      _q.setFromEuler(_e);
      // Unit geometry scaled to the item's size — one geometry serves every
      // variation, which is what makes the whole set a single upload.
      _s.set(it.size[0] || 1e-4, it.size[1] || 1e-4, it.size[2] || 1);
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      if (it.color) {
        mesh.setColorAt(i, _c.set(it.color));
        tinted = true;
      }
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // InstancedMesh keeps its own bounds; without this the whole set can be
    // frustum-culled from the wrong place.
    mesh.computeBoundingSphere();
  }, [items]);
  return ref;
}

type InstancedProps = {
  items: InstanceItem[];
  /** shared albedo. Pass '#ffffff' when items carry their own colour. */
  color: string;
  /** extra material props — normally a SURFACE preset from ./materials. */
  surface?: Omit<ThreeElements['meshStandardMaterial'], 'color'>;
};

/** One draw call for N boxes — book spines, radiator fins, rack slats. */
export function BoxInstances({ items, color, surface }: InstancedProps) {
  const ref = useInstanceTransforms(items);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.8} envMapIntensity={0.5} {...surface} />
    </instancedMesh>
  );
}

/** One draw call for N double-sided planes — curtain pleats. */
export function PlaneInstances({ items, color, surface }: InstancedProps) {
  const ref = useInstanceTransforms(items);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial color={color} side={DoubleSide} envMapIntensity={0.5} {...surface} />
    </instancedMesh>
  );
}
