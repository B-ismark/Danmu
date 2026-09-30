'use client';

// Auto + user-managed set-dressing. Decorative props (books, vase, plant, bowl,
// candle) sit on a furniture surface. For decor-capable parts the items come
// from `part.decor` when the user has edited the collection, else from a seeded
// auto-suggestion. Sofas/beds get auto pillows (not collection-managed).
//
// What each prop is, and where on its surface it goes, are `lib/decor.ts`: this file
// draws the `DecorSpec` it is handed and places each prop where `arrangeDecor` put
// it, clear of the others and of whatever stands on the surface.
//
// Rendered as a SIBLING of the part (reads transform from the store) so props
// keep true size on group-scaled parts. All meshes opt out of raycasting.

import { useMemo, type ReactNode } from 'react';
import { useDecorBlockers, usePartTransform } from '@/lib/room-scene';
import { supportsDecor, autoSurfaceDecor, type ScenePart } from '@/lib/scene-spec';
import { arrangeDecor, decorSpec, type DecorSpec } from '@/lib/decor';
import { DECOR } from '@/lib/scene-palette';
import { PlantBody } from './DynamicPart';

const NOPICK = () => {};

// The colours themselves live in lib/scene-palette, with the rest of what the 3D
// layer cannot read from a custom property. These are the whole body colour of
// the thing being drawn, picked per item by the spec's seeded `tone`.
const { book: BOOK_C, pot: POT_C, vase: VASE_C, pillow: PILLOW_C } = DECOR;
const pick = <T,>(set: readonly T[], tone: number) => set[Math.floor(tone * set.length) % set.length];

// ─── ornament primitives (non-pickable) ──────────────────────────────────────
function Prop({ spec }: { spec: DecorSpec }) {
  switch (spec.kind) {
    case 'books': {
      let y = 0;
      return (
        <>
          {spec.books.map((b, i) => {
            const at = y;
            y += b.h;
            return (
              <mesh key={i} position={[b.dx, at + b.h / 2, 0]} rotation={[0, b.yaw, 0]} raycast={NOPICK} castShadow>
                <boxGeometry args={[b.w, b.h, b.d]} />
                <meshStandardMaterial color={pick(BOOK_C, b.tone)} roughness={0.9} />
              </mesh>
            );
          })}
        </>
      );
    }
    case 'vase':
      return (
        <group>
          <mesh position={[0, spec.h / 2, 0]} raycast={NOPICK} castShadow>
            <cylinderGeometry args={[spec.r * 0.8, spec.r, spec.h, 14]} />
            <meshStandardMaterial color={pick(VASE_C, spec.tone)} roughness={0.4} />
          </mesh>
          {spec.stems &&
            Array.from({ length: 3 }).map((_, i) => (
              <mesh key={i} position={[(i - 1) * 0.03, spec.h + 0.08, 0]} rotation={[0, 0, (i - 1) * 0.3]} raycast={NOPICK}>
                <cylinderGeometry args={[0.004, 0.004, 0.18, 5]} />
                <meshStandardMaterial color="#5E7C52" roughness={0.8} />
              </mesh>
            ))}
        </group>
      );
    case 'plant':
      // The same plant as the floor-standing one, at tabletop size — `plantForm` draws
      // it at the size it is given, so this is not a scaled-down copy.
      return <PlantBody dimMM={[spec.w * 1000, spec.w * 1000, spec.h * 1000]} pot={pick(POT_C, spec.tone)} noPick />;
    case 'bowl':
      return (
        <mesh position={[0, 0.025, 0]} raycast={NOPICK} castShadow>
          <cylinderGeometry args={[spec.r, spec.r * 0.7, 0.05, 16]} />
          <meshStandardMaterial color={pick(VASE_C, spec.tone)} roughness={0.5} />
        </mesh>
      );
    case 'candle':
      return (
        <group>
          <mesh position={[0, spec.h / 2, 0]} raycast={NOPICK} castShadow>
            <cylinderGeometry args={[spec.r, spec.r, spec.h, 14]} />
            <meshStandardMaterial color={pick(PILLOW_C, spec.tone)} roughness={0.6} />
          </mesh>
          <mesh position={[0, spec.h + 0.012, 0]} raycast={NOPICK}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <meshStandardMaterial color="#FFD27A" emissive="#FF9A3C" emissiveIntensity={0.6} />
          </mesh>
        </group>
      );
  }
}

export function Dressing({ part }: { part: ScenePart }) {
  // Narrow on purpose: decor renders as a SIBLING of its part, so it has to follow
  // that part's transform without re-rendering every time some other piece moves.
  // Still true through `useSettledY`, which subscribes to the whole override maps but
  // selects a NUMBER out of them — see its docblock. A `Dressing` per part times a
  // whole-room derivation per render is what that shape is guarding against, and
  // `useDecorBlockers` is built the same way for the same reason.
  const { pos: p, rot: r, dimMM: dm } = usePartTransform(part);
  const blockers = useDecorBlockers(part.id);

  const content = useMemo<ReactNode | null>(() => {
    // Only SURFACE decor (tables, shelves, nightstands…). Sofas/beds already
    // model their own cushions + pillows in the geometry — adding more here was
    // the source of the duplicate-pillow artifacts.
    if (!supportsDecor(part.category, part.shape)) return null;
    const items = part.decor ?? autoSurfaceDecor(part.category, part.shape, dm, part.id);
    const { placed } = arrangeDecor(items, part, dm[0] / 1000, dm[1] / 1000, blockers);
    if (placed.length === 0) return null;
    return (
      <group position={[0, dm[2] / 1000, 0]}>
        {placed.map((it) => (
          <group key={it.id} position={[it.x, 0, it.z]}>
            <Prop spec={decorSpec(it)} />
          </group>
        ))}
      </group>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part.category, part.shape, part.id, part.decor, dm[0], dm[1], dm[2], blockers]);

  if (!content) return null;
  return (
    <group position={p} rotation={[0, r, 0]}>
      {content}
    </group>
  );
}
