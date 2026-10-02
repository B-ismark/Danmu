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
// BoxInstances below exists because the parametric shapes repeat ONE element
// dozens-to-hundreds of times: a maxed bookshelf is 7 bays × 42 books = 294
// spines, a 2m radiator 33 fins. As
// individual meshes that is 300 geometries + 300 materials + 300 draw calls for
// a single object. As an InstancedMesh it is one of each.

import { RoundedBox } from '@react-three/drei';
// R3F 9 dropped the per-element `*Props` aliases; the element prop types now
// come off the `ThreeElements` map instead.
import type { ThreeElements } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { BufferGeometry, Color, DoubleSide, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import { PHYSICAL_SURFACES, SURFACE, type SurfaceKey } from './materials';
import { Edges } from './strokes';
import { DETAIL } from '@/lib/scene-palette';
import { LEAF_MESH, PLANT_STEM_TAPER, type PlantLeaf, type PlantStem } from '@/lib/plant-form';
import type { SoftItem, SoftMeshData } from '@/lib/soft-goods';

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
    <Edges threshold={30} renderOrder={1} color={edgeColor} transparent opacity={edgeOpacity} />
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
function useInstanceTransforms(items: readonly InstanceItem[], colorOf?: (i: number) => string) {
  const ref = useRef<InstancedMesh | null>(null);
  // The colours, as a value. `colorOf` is a fresh closure every render, so it cannot be a
  // dependency; but the items alone are not enough either, because a memoised form hands
  // back the SAME items when only a colour moved — lock a bed and its scatter cushions
  // kept their unlocked tone, since `bedForm` returns one object per size.
  const tones = colorOf ? items.map((_, i) => colorOf(i)).join('|') : '';
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
      const color = colorOf?.(i) ?? it.color;
      if (color) {
        mesh.setColorAt(i, _c.set(color));
        tinted = true;
      }
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // InstancedMesh keeps its own bounds; without this the whole set can be
    // frustum-culled from the wrong place.
    mesh.computeBoundingSphere();
    // `colorOf` is read, not depended on: `tones` is what it answers, as a value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tones]);
  return ref;
}

type InstancedProps = {
  items: InstanceItem[];
  /** shared albedo. Pass '#ffffff' when items carry their own colour. */
  color: string;
  /** extra material props — normally a SURFACE preset from ./materials. A preset
   *  carrying `sheen` (cloth) gets `meshPhysicalMaterial`, which is the only one of
   *  the two that implements it: the curtains were handed `SURFACE.fabric` on a
   *  standard material for as long as they existed, and three dropped the sheen
   *  without a word — the most visible cloth in a room, drawn as painted card. */
  surface?: Omit<ThreeElements['meshPhysicalMaterial'], 'color'>;
};

function InstanceMaterial({ surface, ...base }: Omit<ThreeElements['meshPhysicalMaterial'], 'surface'> & { surface?: InstancedProps['surface'] }) {
  return surface && 'sheen' in surface ? (
    <meshPhysicalMaterial {...base} {...surface} />
  ) : (
    <meshStandardMaterial {...(base as ThreeElements['meshStandardMaterial'])} {...(surface as ThreeElements['meshStandardMaterial'])} />
  );
}

/** One draw call for N boxes — book spines, radiator fins, rack slats. */
export function BoxInstances({ items, color, surface }: InstancedProps) {
  const ref = useInstanceTransforms(items);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <InstanceMaterial color={color} roughness={0.8} envMapIntensity={0.5} surface={surface} />
    </instancedMesh>
  );
}

/** One draw call for N cylinders, or N spheres: a unit one of diameter 1, scaled to each
 *  item's size — a radiator's tubes and their rounded ends. A cylinder stands on its local
 *  Y, so an item lying along X or Z carries the turn (`strutPose`'s) that lays it there. */
export function RoundInstances({ items, color, surface, unit }: InstancedProps & { unit: 'tube' | 'ball' }) {
  const ref = useInstanceTransforms(items);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      {unit === 'tube' ? <cylinderGeometry args={[0.5, 0.5, 1, 16]} /> : <sphereGeometry args={[0.5, 16, 12]} />}
      <InstanceMaterial color={color} roughness={0.8} envMapIntensity={0.5} surface={surface} />
    </instancedMesh>
  );
}

// ─── Plant parts ─────────────────────────────────────────────────────────────

let leafGeometry: BufferGeometry | null = null;
/** The unit leaf from `LEAF_MESH`, built once and shared by every plant in the room. */
function unitLeaf(): BufferGeometry {
  if (!leafGeometry) {
    leafGeometry = new BufferGeometry();
    leafGeometry.setAttribute('position', new Float32BufferAttribute([...LEAF_MESH.positions], 3));
    leafGeometry.setIndex([...LEAF_MESH.index]);
    leafGeometry.computeVertexNormals();
  }
  return leafGeometry;
}

const NOPICK = () => {};

/** One draw call for every leaf of a plant: the unit leaf, placed per `plantForm`, each
 *  in the palette tone it names. */
export function LeafInstances({
  items,
  tones,
  surface,
  noPick,
}: {
  items: readonly PlantLeaf[];
  tones: readonly string[];
  surface?: InstancedProps['surface'];
  /** Out of raycasting — a surface's prop plant, which is not a piece to select. */
  noPick?: boolean;
}) {
  const ref = useInstanceTransforms(items, (i) => tones[items[i].tone % tones.length]);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[unitLeaf(), undefined, items.length]} castShadow receiveShadow {...(noPick ? { raycast: NOPICK } : {})}>
      <InstanceMaterial color="#ffffff" side={DoubleSide} envMapIntensity={0.5} surface={surface} />
    </instancedMesh>
  );
}

/** One draw call for a plant's trunk and stalks: a unit cylinder tapering to
 *  `PLANT_STEM_TAPER` at its top, wood-coloured for the trunk and green for the rest. */
export function StemInstances({ items, wood, green, noPick }: { items: readonly PlantStem[]; wood: string; green: string; noPick?: boolean }) {
  const ref = useInstanceTransforms(items, (i) => (items[i].wood ? wood : green));
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow {...(noPick ? { raycast: NOPICK } : {})}>
      <cylinderGeometry args={[PLANT_STEM_TAPER, 1, 1, 7]} />
      <InstanceMaterial color="#ffffff" roughness={0.8} envMapIntensity={0.5} />
    </instancedMesh>
  );
}

// ─── Cloth ───────────────────────────────────────────────────────────────────
//
// The meshes `lib/soft-goods.ts` builds — pillows, cushions, garments, shoes, a duvet, a
// curtain. Two components for two lifetimes. A UNIT mesh (a cushion, a garment, a shoe)
// is one constant shared by every piece in the room, so its geometry is built once and
// kept; `SoftInstances` places it per item, as `LeafInstances` places the unit leaf. A
// PER-PIECE mesh (a duvet, a curtain) is a new object at every size a resize passes
// through, so `SoftMesh` owns its geometry and disposes it when the mesh changes —
// sharing a cache there would keep the GPU buffers of every size a drag went by.

function geometryOf(mesh: SoftMeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([...mesh.positions], 3));
  g.setIndex([...mesh.index]);
  g.computeVertexNormals();
  return g;
}

const unitGeometry = new WeakMap<SoftMeshData, BufferGeometry>();
function sharedGeometry(mesh: SoftMeshData): BufferGeometry {
  let g = unitGeometry.get(mesh);
  if (!g) {
    g = geometryOf(mesh);
    unitGeometry.set(mesh, g);
  }
  return g;
}

/** One draw call for N copies of a unit cloth mesh, each scaled to the box it fills. */
export function SoftInstances({
  mesh,
  items,
  color,
  colorOf,
  surface,
  doubleSide,
}: {
  mesh: SoftMeshData;
  items: readonly SoftItem[];
  /** shared albedo; pass '#ffffff' with `colorOf` for a colour per item */
  color: string;
  colorOf?: (i: number) => string;
  surface?: InstancedProps['surface'];
  /** for cloth that is open somewhere — a garment's hem, a shoe's opening */
  doubleSide?: boolean;
}) {
  const ref = useInstanceTransforms(items as InstanceItem[], colorOf);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[sharedGeometry(mesh), undefined, items.length]} castShadow receiveShadow>
      <InstanceMaterial color={color} envMapIntensity={0.5} side={doubleSide ? DoubleSide : undefined} surface={surface} />
    </instancedMesh>
  );
}

/** One cloth mesh built for this piece at this size — a duvet, a curtain. */
export function SoftMesh({
  mesh,
  color,
  surface,
  position = [0, 0, 0],
  doubleSide,
}: {
  mesh: SoftMeshData;
  color: string;
  surface?: InstancedProps['surface'];
  position?: [number, number, number];
  doubleSide?: boolean;
}) {
  const geometry = useMemo(() => geometryOf(mesh), [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={position} castShadow receiveShadow>
      <InstanceMaterial color={color} envMapIntensity={0.5} side={doubleSide ? DoubleSide : undefined} surface={surface} />
    </mesh>
  );
}
