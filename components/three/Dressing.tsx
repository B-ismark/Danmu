'use client';

// Auto + user-managed set-dressing. Decorative props (books, vase, plant, bowl,
// candle) sit on a furniture surface. For decor-capable parts the items come
// from `part.decor` when the user has edited the collection, else from a seeded
// auto-suggestion. Sofas/beds get auto pillows (not collection-managed).
//
// Rendered as a SIBLING of the part (reads transform from the store) so props
// keep true size on group-scaled parts. All meshes opt out of raycasting.

import { useMemo, type ReactNode } from 'react';
import { usePartTransform } from '@/lib/room-scene';
import { supportsDecor, autoSurfaceDecor, type DecorItem, type DecorKind, type ScenePart } from '@/lib/scene-spec';
import { DECOR } from '@/lib/scene-palette';

const NOPICK = () => {};

function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seeded = (s: string) => mulberry32(xmur3(s)());

// The colours themselves live in lib/scene-palette, with the rest of what the 3D
// layer cannot read from a custom property. These are the whole body colour of
// the thing being drawn, picked per item from the set by the seeded RNG.
const { book: BOOK_C, pot: POT_C, vase: VASE_C, pillow: PILLOW_C } = DECOR;

// ─── ornament primitives (non-pickable) ──────────────────────────────────────
function BookStack({ rand }: { rand: () => number }) {
  const n = 2 + Math.floor(rand() * 2);
  let y = 0;
  const out: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const w = 0.16 + rand() * 0.06;
    const dd = 0.11 + rand() * 0.05;
    const hh = 0.03 + rand() * 0.02;
    out.push(
      <mesh key={i} position={[(rand() - 0.5) * 0.02, y + hh / 2, 0]} rotation={[0, rand() * 0.5, 0]} raycast={NOPICK} castShadow>
        <boxGeometry args={[w, hh, dd]} />
        <meshStandardMaterial color={BOOK_C[Math.floor(rand() * BOOK_C.length)]} roughness={0.9} />
      </mesh>,
    );
    y += hh;
  }
  return <>{out}</>;
}
function Vase({ rand }: { rand: () => number }) {
  const r = 0.04 + rand() * 0.025;
  const hh = 0.14 + rand() * 0.12;
  const stems = rand() > 0.4;
  return (
    <group>
      <mesh position={[0, hh / 2, 0]} raycast={NOPICK} castShadow>
        <cylinderGeometry args={[r * 0.8, r, hh, 14]} />
        <meshStandardMaterial color={VASE_C[Math.floor(rand() * VASE_C.length)]} roughness={0.4} />
      </mesh>
      {stems &&
        Array.from({ length: 3 }).map((_, i) => (
          <mesh key={i} position={[(i - 1) * 0.03, hh + 0.08, 0]} rotation={[0, 0, (i - 1) * 0.3]} raycast={NOPICK}>
            <cylinderGeometry args={[0.004, 0.004, 0.18, 5]} />
            <meshStandardMaterial color="#5E7C52" roughness={0.8} />
          </mesh>
        ))}
    </group>
  );
}
function PottedPlant({ rand }: { rand: () => number }) {
  const r = 0.05 + rand() * 0.03;
  return (
    <group>
      <mesh position={[0, r, 0]} raycast={NOPICK} castShadow>
        <cylinderGeometry args={[r, r * 0.8, r * 2, 12]} />
        <meshStandardMaterial color={POT_C[Math.floor(rand() * POT_C.length)]} roughness={0.7} />
      </mesh>
      <mesh position={[0, r * 2 + 0.06, 0]} raycast={NOPICK} castShadow>
        <sphereGeometry args={[r * 1.5, 10, 10]} />
        <meshStandardMaterial color="#4E7A4E" roughness={0.85} />
      </mesh>
    </group>
  );
}
function Bowl({ rand }: { rand: () => number }) {
  const r = 0.07 + rand() * 0.03;
  return (
    <mesh position={[0, 0.025, 0]} raycast={NOPICK} castShadow>
      <cylinderGeometry args={[r, r * 0.7, 0.05, 16]} />
      <meshStandardMaterial color={VASE_C[Math.floor(rand() * VASE_C.length)]} roughness={0.5} />
    </mesh>
  );
}
function Candle({ rand }: { rand: () => number }) {
  const hh = 0.08 + rand() * 0.08;
  return (
    <group>
      <mesh position={[0, hh / 2, 0]} raycast={NOPICK} castShadow>
        <cylinderGeometry args={[0.025, 0.025, hh, 14]} />
        <meshStandardMaterial color={PILLOW_C[Math.floor(rand() * PILLOW_C.length)]} roughness={0.6} />
      </mesh>
      <mesh position={[0, hh + 0.012, 0]} raycast={NOPICK}>
        <sphereGeometry args={[0.012, 8, 8]} />
        <meshStandardMaterial color="#FFD27A" emissive="#FF9A3C" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}
const KIND: Record<DecorKind, (p: { rand: () => number }) => ReactNode> = {
  books: BookStack,
  vase: Vase,
  plant: PottedPlant,
  bowl: Bowl,
  candle: Candle,
};

function SurfaceDecor({ items, topY }: { items: DecorItem[]; topY: number }) {
  return (
    <group position={[0, topY, 0]}>
      {items.map((it) => {
        const Cmp = KIND[it.kind];
        return (
          <group key={it.id} position={[it.x, 0, it.z]}>
            <Cmp rand={seeded(it.id)} />
          </group>
        );
      })}
    </group>
  );
}

export function Dressing({ part }: { part: ScenePart }) {
  // Narrow on purpose: decor renders as a SIBLING of its part, so it has to follow
  // that part's transform without re-rendering every time some other piece moves.
  // Still true through `useSettledY`, which subscribes to the whole override maps but
  // selects a NUMBER out of them — see its docblock. A `Dressing` per part times a
  // whole-room derivation per render is what that shape is guarding against.
  const { pos: p, rot: r, dimMM: dm } = usePartTransform(part);

  const content = useMemo<ReactNode | null>(() => {
    // Only SURFACE decor (tables, shelves, nightstands…). Sofas/beds already
    // model their own cushions + pillows in the geometry — adding more here was
    // the source of the duplicate-pillow artifacts.
    if (!supportsDecor(part.category, part.shape)) return null;
    const items = part.decor ?? autoSurfaceDecor(part.category, part.shape, dm, part.id);
    if (items.length === 0) return null;
    return <SurfaceDecor items={items} topY={dm[2] / 1000} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part.category, part.shape, part.id, part.decor, dm[0], dm[1], dm[2]]);

  if (!content) return null;
  return (
    <group position={p} rotation={[0, r, 0]}>
      {content}
    </group>
  );
}
