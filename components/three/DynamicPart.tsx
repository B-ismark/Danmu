'use client';

// Render a ScenePart by dispatching on its shape. Sub-shape variants give visual
// variety based on Gemini's label keywords (office vs dining chair, single vs
// double bed, etc).

import { Box, BoxInstances, PlaneInstances, type InstanceItem } from './Box';
import { CachedMesh } from './CachedMesh';
import { PartLight } from './PartLight';
import { SURFACE } from './materials';
import { Spin, Sway } from './Motion';
import { isParametric, type ScenePart } from '@/lib/scene-spec';
import { useStudio } from '@/lib/store';
import { SCENE, defaultBodyColor } from '@/lib/scene-palette';

// Body albedo for a part's main surfaces. An explicit colour (photo-sampled on
// detection, or chosen in the Inspector) ALWAYS wins — otherwise recolouring a
// locked item did nothing, since most detections auto-lock. Falls back to the
// "kept as-is" tint for locked items with no colour, else the shape default.
// (Locked status still reads from the PartTree dot, Inspector badge + plan view.)
//
// Both the tint and the shape default come from lib/scene-palette. The tint used
// to be three different hard-coded blues in this file alone, so "locked"
// rendered differently depending on which shape you selected; the shape defaults
// used to be a literal per renderer, which is why the Inspector's "Default for
// this piece" swatch showed a colour the furniture was not.
//
// `locked` is deliberately the LAST word before the default, not before an
// explicit colour.
//
// `fallback` is for a SECONDARY surface that should still follow the user's
// recolour but has its own default when they haven't picked one — an armchair's
// legs against its seat, a bed's mattress against its frame. The main body of a
// shape must never pass it: that is what put a per-renderer literal out of step
// with the swatch in the first place.
function body(part: ScenePart, locked: boolean, fallback?: string): string {
  if (part.color) return part.color;
  if (locked) return SCENE.lockedTint;
  return fallback ?? defaultBodyColor(part.category, part.shape);
}

/** `body()` for the shapes whose renderer takes no `locked` flag. These have
 *  always shown their own colour rather than the "kept as-is" tint; keeping that
 *  behaviour is deliberate, so this is a narrower helper rather than a call with
 *  `locked: false` hard-coded. */
function tint(part: ScenePart): string {
  return part.color ?? defaultBodyColor(part.category, part.shape);
}

export function PartGeometry({ part, locked }: { part: ScenePart; locked: boolean }) {
  // A cached GLB always wins over the primitive shape. The CachedMesh component
  // renders nothing until the blob resolves, so we also render the primitive as
  // a placeholder underneath via a fragment — it disappears visually when the
  // GLB overlays it (CachedMesh re-anchors to the same world origin).
  //
  // PartLight rides along either way: a lamp emits because it is a lamp, not
  // because of which mesh happens to represent it. It renders nothing for the
  // overwhelming majority of parts, which are not fixtures.
  return (
    <>
      {part.meshHash ? <CachedMesh part={part} /> : <ShapeDispatch part={part} locked={locked} />}
      <PartLight part={part} />
    </>
  );
}

// Split from PartGeometry so we can use a hook (effective-dim lookup) without
// it running on the meshHash early-return path above.
function ShapeDispatch({ part, locked }: { part: ScenePart; locked: boolean }) {
  // Parametric parts rebuild from the CURRENT (overridden) dim. Feed them an
  // effective part whose dimMM reflects the user's resize, so module counts
  // (pleats / shelves / bays / seats) recompute instead of the mesh stretching.
  const storedDim = useStudio((s) => s.dims[part.id]);
  const p = storedDim && isParametric(part.shape) ? { ...part, dimMM: storedDim } : part;
  switch (part.shape) {
    case 'sofa':
      return <SofaGeo part={p} locked={locked} />;
    case 'tv':
      return <TVGeo part={part} locked={locked} />;
    case 'closet':
    case 'wardrobe':
      return <WardrobeGeo part={p} locked={locked} />;
    case 'bookshelf':
      return <BookshelfGeo part={p} locked={locked} />;
    case 'shoe-rack':
      return <ShoeRackGeo part={p} locked={locked} />;
    case 'chair-dining':
      return <DiningChairGeo part={part} locked={locked} />;
    case 'chair-office':
      return <OfficeChairGeo part={part} locked={locked} />;
    case 'chair-armchair':
      return <ArmchairGeo part={part} locked={locked} />;
    case 'rug':
      return <RugGeo part={part} />;
    case 'plant':
      return <PlantGeo part={part} />;
    case 'lamp-floor':
      return <FloorLampGeo part={part} />;
    case 'lamp-table':
      return <TableLampGeo part={part} />;
    case 'lamp-pendant':
      return <PendantLampGeo part={part} />;
    case 'bed-single':
      return <BedGeo part={part} locked={locked} double={false} />;
    case 'bed-double':
      return <BedGeo part={part} locked={locked} double={true} />;
    case 'desk-standard':
      return <DeskGeo part={part} locked={locked} lShape={false} />;
    case 'desk-l':
      return <DeskGeo part={part} locked={locked} lShape={true} />;
    case 'coffee-table':
      return <CoffeeTableGeo part={part} locked={locked} />;
    case 'side-table':
      return <SideTableGeo part={part} locked={locked} />;
    case 'nightstand':
      return <NightstandGeo part={part} locked={locked} />;
    case 'ottoman':
      return <OttomanGeo part={part} locked={locked} />;
    case 'mirror':
      return <MirrorGeo part={part} oval={false} />;
    case 'mirror-oval':
      return <MirrorGeo part={part} oval />;
    case 'window':
      return <WindowGeo part={part} />;
    case 'laptop':
      return <LaptopGeo part={part} />;
    case 'painting':
      return <PaintingGeo part={part} />;
    case 'ac-unit':
      return <ACUnitGeo part={part} locked={locked} />;
    case 'door':
      return <DoorGeo part={part} />;
    case 'monitor':
      return <MonitorGeo part={part} />;
    case 'fan':
      return <FanGeo part={part} />;
    case 'fridge':
      return <FridgeGeo part={part} locked={locked} />;
    case 'curtain':
      return <CurtainGeo part={p} />;
    case 'soundbar':
      return <SoundbarGeo part={part} />;
    case 'radiator':
      return <RadiatorGeo part={part} />;
    case 'air-purifier':
      return <AirPurifierGeo part={part} />;
    case 'washing-machine':
      return <WashingMachineGeo part={part} />;
    case 'microwave':
      return <MicrowaveGeo part={part} />;
    case 'water-dispenser':
      return <WaterDispenserGeo part={part} />;
    case 'box':
      return <BoxGeo part={part} locked={locked} />;
    case 'cylinder':
      return <CylinderGeo part={part} locked={locked} />;
    case 'plane':
      return <PlaneGeo part={part} locked={locked} />;
  }
}

// ─── Sofas / TVs / Rugs ──────────────────────────────────────────────────
// Parametric: seat + back cushions tile across the width (loveseat → 4-seater)
// instead of one stretched slab. Module count derives from the effective width.
function SofaGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const main = body(part, locked);
  const cushion = shade(main, 14);
  const arm = Math.min(0.18, w * 0.12);
  const legH = 0.1;
  const seatTop = Math.min(0.46, Math.max(0.34, h * 0.5));
  const innerW = Math.max(0.4, w - arm * 2);
  const seats = Math.max(1, Math.round(innerW / 0.9));
  const seatW = innerW / seats;
  const backTh = Math.min(0.2, d * 0.2);
  const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * (w / 2 - 0.08), sz * (d / 2 - 0.08)] as [number, number]));
  return (
    <>
      {/* plinth — upholstered, so it takes the cloth surface (weave + sheen).
          The frame keeps its tauter 0.75 roughness against the loose cushions. */}
      <Box size={[w, seatTop - legH, d]} position={[0, (seatTop + legH) / 2, 0]} color={main} surface="fabric" roughness={0.75} />
      {/* backrest */}
      <Box size={[w, h - seatTop, backTh]} position={[0, (h + seatTop) / 2, -d / 2 + backTh / 2]} color={main} surface="fabric" roughness={0.75} />
      {/* arms */}
      <Box size={[arm, h * 0.62 - legH, d]} position={[-w / 2 + arm / 2, (h * 0.62 + legH) / 2, 0]} color={main} surface="fabric" roughness={0.75} />
      <Box size={[arm, h * 0.62 - legH, d]} position={[w / 2 - arm / 2, (h * 0.62 + legH) / 2, 0]} color={main} surface="fabric" roughness={0.75} />
      {/* per-seat cushions (tiled) */}
      {Array.from({ length: seats }).map((_, i) => {
        const x = -innerW / 2 + (i + 0.5) * seatW;
        return (
          <group key={i}>
            <Box size={[seatW * 0.94, 0.2, d * 0.72]} position={[x, seatTop + 0.06, d * 0.04]} color={cushion} surface="fabric" />
            <Box size={[seatW * 0.94, (h - seatTop) * 0.82, 0.16]} position={[x, seatTop + (h - seatTop) * 0.45, -d * 0.3]} color={cushion} surface="fabric" />
          </group>
        );
      })}
      {legs.map(([x, z], i) => (
        <Box key={i} size={[0.06, legH, 0.06]} position={[x, legH / 2, z]} color="#3A2818" roughness={0.7} />
      ))}
    </>
  );
}

// Chassis size comes from dimMM like every other shape. It used to be a fixed
// 1.45 × 0.82 m regardless of the part's dimensions — and because Draggable
// scales the group by `storedDim / part.dimMM`, a 2 m TV with no user resize
// rendered at 1.45 m while the inspector, the plan view and the furniture list
// all said 2 m. On a product whose promise is real dimensions, the one shape
// that ignored its own was the TV.
//
// It also took no `part` at all, so recolouring a TV in the Inspector silently
// did nothing.
function TVGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  const d = Math.max(0.03, part.dimMM[1] / 1000);
  const bezel = body(part, locked);
  return (
    <>
      <Box size={[w, h, d]} position={[0, 0, 0]} color={bezel} roughness={0.5} />
      {/* recessed glowing screen */}
      <mesh position={[0, 0, d / 2 + 0.002]}>
        <planeGeometry args={[w * 0.95, h * 0.9]} />
        <meshStandardMaterial color="#10141c" emissive="#1c2e48" emissiveIntensity={0.35} roughness={0.18} metalness={0.2} />
      </mesh>
    </>
  );
}

function RugGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const base = tint(part);
  // A thin soft slab (not a zero-thickness plane) gives an edge + pile, and a
  // slightly darker inset border reads as a woven rug rather than painted floor.
  return (
    <group position={[0, 0.009, 0]}>
      <Box size={[w, 0.018, d]} color={base} roughness={0.98} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <planeGeometry args={[w * 0.88, d * 0.82]} />
        <meshStandardMaterial color={shade(base, -18)} roughness={0.98} />
      </mesh>
    </group>
  );
}

/** Lighten (+) / darken (-) a #rrggbb hex by a percent amount. */
function shade(hex: string, pct: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * 255)));
  const r = adj((n >> 16) & 255);
  const g = adj((n >> 8) & 255);
  const b = adj(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ─── Chairs ──────────────────────────────────────────────────────────────
function DiningChairGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const wood = body(part, locked);
  const seat = shade(wood, 14);
  return (
    <>
      <Box size={[0.42, 0.06, 0.42]} position={[0, 0.46, 0]} color={seat} roughness={0.97} />
      {/* back slats — two thin bars instead of a solid slab */}
      <Box size={[0.42, 0.04, 0.04]} position={[0, 0.68, -0.19]} color={wood} roughness={0.7} />
      <Box size={[0.42, 0.04, 0.04]} position={[0, 0.82, -0.19]} color={wood} roughness={0.7} />
      <Box size={[0.42, 0.04, 0.04]} position={[0, 0.96, -0.19]} color={wood} roughness={0.7} />
      {/* top rail */}
      <Box size={[0.42, 0.06, 0.05]} position={[0, 1.06, -0.18]} color={wood} roughness={0.7} />
      {[
        [-0.18, -0.18],
        [0.18, -0.18],
        [-0.18, 0.18],
        [0.18, 0.18],
      ].map(([x, z], i) => (
        <Box key={i} size={[0.04, 0.45, 0.04]} position={[x, 0.225, z]} color={wood} roughness={0.7} edgeOpacity={0.4} />
      ))}
    </>
  );
}

function OfficeChairGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const cushion = body(part, locked);
  const metal = '#5A5A5A';
  return (
    <>
      {/* 5-spoke wheeled base */}
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.05, 8]} />
        <meshStandardMaterial color={metal} {...SURFACE.metal} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i * 2 * Math.PI) / 5;
        const x = Math.cos(a) * 0.16;
        const z = Math.sin(a) * 0.16;
        return (
          <group key={i}>
            <Box size={[0.32, 0.025, 0.05]} position={[x / 2, 0.045, z / 2]} rotation={[0, -a, 0]} color={metal} edgeOpacity={0.4} />
            <mesh position={[x, 0.03, z]}>
              <sphereGeometry args={[0.03, 8, 8]} />
              <meshStandardMaterial color="#222" />
            </mesh>
          </group>
        );
      })}
      {/* gas piston */}
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.42, 12]} />
        <meshStandardMaterial color={metal} {...SURFACE.metal} />
      </mesh>
      {/* seat */}
      <Box size={[0.5, 0.08, 0.48]} position={[0, 0.5, 0]} color={cushion} roughness={0.97} />
      {/* backrest */}
      <Box size={[0.48, 0.6, 0.06]} position={[0, 0.85, -0.21]} color={cushion} roughness={0.97} />
      {/* lumbar curve hint — slightly protruding box gives depth */}
      <Box size={[0.44, 0.18, 0.04]} position={[0, 0.7, -0.19]} color={shade(cushion, -8)} roughness={0.97} />
      {/* armrests */}
      <Box size={[0.04, 0.04, 0.32]} position={[-0.27, 0.62, -0.05]} color="#222" roughness={0.55} metalness={0.3} edgeOpacity={0.4} />
      <Box size={[0.04, 0.04, 0.32]} position={[0.27, 0.62, -0.05]} color="#222" roughness={0.55} metalness={0.3} edgeOpacity={0.4} />
    </>
  );
}

function ArmchairGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const seat = body(part, locked);
  const leg = body(part, locked, '#4A3526');
  const cushionDark = shade(seat, -10);
  return (
    <>
      {/* seat cushion */}
      <Box size={[0.7, 0.12, 0.7]} position={[0, 0.43, 0]} color={seat} surface="fabric" />
      {/* back cushion */}
      <Box size={[0.68, 0.58, 0.12]} position={[0, 0.73, -0.29]} color={seat} surface="fabric" />
      {/* back cushion crease line */}
      <Box size={[0.62, 0.005, 0.1]} position={[0, 0.68, -0.24]} color={cushionDark} surface="fabric" roughness={0.98} />
      {/* armrests */}
      <Box size={[0.1, 0.38, 0.68]} position={[-0.3, 0.56, 0]} color={seat} surface="fabric" roughness={0.95} />
      <Box size={[0.1, 0.38, 0.68]} position={[0.3, 0.56, 0]} color={seat} surface="fabric" roughness={0.95} />
      {/* wooden legs */}
      {[
        [-0.3, -0.3],
        [0.3, -0.3],
        [-0.3, 0.3],
        [0.3, 0.3],
      ].map(([x, z], i) => (
        <Box key={i} size={[0.05, 0.32, 0.05]} position={[x, 0.16, z]} color={leg} roughness={0.7} edgeOpacity={0.4} />
      ))}
    </>
  );
}

// ─── Plant ──────────────────────────────────────────────────────────────
function PlantGeo({ part }: { part: ScenePart }) {
  const pot = tint(part);
  // Tapered pot + soil + a clustered canopy of varied-green blobs (was a single
  // ball that read as a lollipop).
  const blobs: Array<{ p: [number, number, number]; r: number; c: string }> = [
    { p: [0, 1.55, 0], r: 0.34, c: '#5D8A5D' },
    { p: [0.22, 1.42, 0.08], r: 0.24, c: '#6E9A66' },
    { p: [-0.2, 1.48, -0.06], r: 0.22, c: '#4F7C4F' },
    { p: [0.04, 1.74, -0.1], r: 0.2, c: '#6FA06A' },
    { p: [-0.06, 1.3, 0.18], r: 0.18, c: '#4A7048' },
  ];
  return (
    <>
      {/* tapered pot */}
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.21, 0.16, 0.36, 20]} />
        <meshStandardMaterial color={pot} {...SURFACE.ceramic} />
      </mesh>
      {/* soil */}
      <mesh position={[0, 0.355, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.03, 20]} />
        <meshStandardMaterial color="#3a2c20" roughness={1} />
      </mesh>
      {/* stem + canopy sway gently from the soil line */}
      <group position={[0, 0.37, 0]}>
        <Sway amp={0.03} speed={0.9}>
          <group position={[0, -0.37, 0]}>
            <mesh position={[0, 0.95, 0]}>
              <cylinderGeometry args={[0.02, 0.025, 1.2, 8]} />
              <meshStandardMaterial color="#4A3526" />
            </mesh>
            {blobs.map((b, i) => (
              <mesh key={i} position={b.p}>
                <sphereGeometry args={[b.r, 14, 12]} />
                <meshStandardMaterial color={b.c} {...SURFACE.foliage} />
              </mesh>
            ))}
          </group>
        </Sway>
      </group>
    </>
  );
}

// ─── Lamps ──────────────────────────────────────────────────────────────
function FloorLampGeo({ part }: { part: ScenePart }) {
  const metal = '#9A7848';
  const shade = tint(part);
  return (
    <>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.15, 0.18, 0.04, 16]} />
        <meshStandardMaterial color={metal} {...SURFACE.metal} />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 1.6, 8]} />
        <meshStandardMaterial color={metal} {...SURFACE.metal} />
      </mesh>
      <mesh position={[0, 1.7, 0]}>
        <coneGeometry args={[0.18, 0.3, 16, 1, true]} />
        <meshStandardMaterial color={shade} side={2} {...SURFACE.fabric} />
      </mesh>
    </>
  );
}

function TableLampGeo({ part }: { part: ScenePart }) {
  const metal = '#9A7848';
  const shade = tint(part);
  return (
    <>
      {/* base */}
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 0.06, 16]} />
        <meshStandardMaterial color={metal} {...SURFACE.metal} />
      </mesh>
      {/* short stem */}
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.28, 8]} />
        <meshStandardMaterial color={metal} {...SURFACE.metal} />
      </mesh>
      {/* shade */}
      <mesh position={[0, 0.42, 0]}>
        <coneGeometry args={[0.14, 0.2, 16, 1, true]} />
        <meshStandardMaterial color={shade} side={2} {...SURFACE.fabric} />
      </mesh>
    </>
  );
}

function PendantLampGeo({ part }: { part: ScenePart }) {
  const dome = tint(part);
  // Swing from the ceiling mount (top of the cord at y≈0.6).
  return (
    <group position={[0, 0.6, 0]}>
      <Sway amp={0.05} speed={0.7} axis="x">
        <group position={[0, -0.6, 0]}>
          {/* cord */}
          <Box size={[0.01, 0.6, 0.01]} position={[0, 0.3, 0]} color="#222" edgeOpacity={0.2} />
          {/* dome */}
          <mesh position={[0, -0.1, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.15, 0.2, 16, 1, true]} />
            <meshStandardMaterial color={dome} side={2} {...SURFACE.ceramic} />
          </mesh>
          {/* bulb */}
          <mesh position={[0, -0.05, 0]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial color="#FFE4A0" emissive="#FFD060" emissiveIntensity={0.4} />
          </mesh>
        </group>
      </Sway>
    </group>
  );
}

// ─── Wardrobe / Bookshelf ────────────────────────────────────────────────
// Parametric: door bays tile across the width — a wider wardrobe gains bays +
// dividers + handles instead of two stretched doors.
function WardrobeGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const wood = body(part, locked);
  const side = shade(wood, -8);
  const top = shade(wood, -15);
  const bays = Math.max(1, Math.round(w / 0.6));
  const bayW = w / bays;
  // Double-click swings the doors open (hinged on each bay's outer edge).
  const open = useStudio((s) => s.openState[part.id] ?? 0);
  const swing = open * 1.15;
  return (
    <>
      <Box size={[0.018, h, d]} position={[-w / 2 + 0.009, h / 2, 0]} color={side} roughness={0.7} />
      <Box size={[0.018, h, d]} position={[w / 2 - 0.009, h / 2, 0]} color={side} roughness={0.7} />
      <Box size={[w, 0.018, d]} position={[0, h - 0.009, 0]} color={top} roughness={0.7} />
      <Box size={[w, 0.018, d]} position={[0, 0.009, 0]} color={top} roughness={0.7} />
      <Box size={[w, h, 0.012]} position={[0, h / 2, -d / 2 + 0.006]} color={wood} roughness={0.7} />
      {/* internal dividers between bays */}
      {Array.from({ length: bays - 1 }).map((_, i) => (
        <Box key={`dv-${i}`} size={[0.014, h - 0.04, d - 0.02]} position={[-w / 2 + (i + 1) * bayW, h / 2, 0]} color={side} roughness={0.72} />
      ))}
      {/* per-bay door — hinged on the outer edge; swings open on double-click */}
      {Array.from({ length: bays }).map((_, i) => {
        const cx = -w / 2 + (i + 0.5) * bayW;
        // Alternate hinge side so adjacent doors open outward like real wardrobes.
        const leftHinged = i % 2 === 0;
        const hinge = leftHinged ? cx - bayW / 2 + 0.01 : cx + bayW / 2 - 0.01;
        const dir = leftHinged ? 1 : -1; // door extends toward bay centre from hinge
        const dw = bayW - 0.02;
        return (
          <group key={`bay-${i}`} position={[hinge, h * 0.5, d / 2 - 0.009]} rotation={[0, dir * swing, 0]}>
            <Box size={[dw, h * 0.94, 0.018]} position={[dir * dw / 2, 0, 0]} color={wood} roughness={0.7} />
            {/* handle near the door's free (opening) edge */}
            <mesh position={[dir * (dw - 0.05), 0, 0.014]}>
              <boxGeometry args={[0.014, 0.12, 0.014]} />
              <meshStandardMaterial color="#2A2620" {...SURFACE.metal} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

// Parametric: shelf count derives from height, books fill the width — so a
// taller shelf gains rows and a wider one gains books, never a stretched slab.
const BOOK_COLORS = ['#7A2A2A', '#2A4A7A', '#5D3820', '#A88A4A', '#3A5A3A', '#6A3A6A', '#8A6A2A', '#3A6A6A'];
function BookshelfGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const wood = body(part, locked);
  const back = shade(wood, -18);
  const bays = Math.max(2, Math.round(h / 0.35)); // vertical compartments
  const gap = h / bays;
  const booksPerRow = Math.max(4, Math.floor((w - 0.08) / 0.055));
  const usableW = w - 0.08;
  const bookW = usableW / booksPerRow;
  const books: InstanceItem[] = [];
  for (let row = 0; row < bays; row++) {
    for (let j = 0; j < booksPerRow; j++) {
      const seed = (row * 7 + j * 13) % BOOK_COLORS.length;
      const bh = Math.min(gap * 0.82, 0.16 + (seed % 3) * 0.03);
      books.push({
        pos: [-usableW / 2 + (j + 0.5) * bookW, row * gap + 0.018 + bh / 2, 0],
        size: [bookW * 0.82, bh, d * 0.68],
        color: BOOK_COLORS[seed],
      });
    }
  }
  return (
    <>
      <Box size={[0.018, h, d]} position={[-w / 2, h / 2, 0]} color={wood} roughness={0.7} />
      <Box size={[0.018, h, d]} position={[w / 2, h / 2, 0]} color={wood} roughness={0.7} />
      <Box size={[w, h, 0.012]} position={[0, h / 2, -d / 2 + 0.006]} color={back} roughness={0.72} />
      {/* shelves: one per compartment boundary (incl. top + bottom) */}
      {Array.from({ length: bays + 1 }).map((_, i) => (
        <Box key={i} size={[w, 0.018, d - 0.01]} position={[0, Math.min(h - 0.009, i * gap + 0.009), 0]} color={wood} roughness={0.65} />
      ))}
      {/* Books — a filled row resting on each compartment floor. At the clamp
          ceiling that is 7 bays × 42 spines = 294 of them, which as individual
          meshes made ONE bookshelf the heaviest object in the room (294
          geometries + 294 materials, doubled in the shadow pass). One
          InstancedMesh, one material, per-instance colour for the spines.
          The old 0.25 edge outline is gone with them: a 5cm spine's outline was
          a hairline at any real zoom, and outlines were the "flat CAD" tell. */}
      <BoxInstances items={books} color="#ffffff" surface={{ roughness: 0.88 }} />
    </>
  );
}

// Parametric: open shoe rack. Tier count derives from height; each tier is a
// width-filling slatted shelf tilted back so shoes lean. Widening adds slats.
function ShoeRackGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const wood = body(part, locked);
  const tiers = Math.max(2, Math.round(h / 0.2));
  const gap = h / tiers;
  const posts = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * (w / 2 - 0.02), sz * (d / 2 - 0.02)] as [number, number]));
  return (
    <>
      {posts.map(([x, z], i) => (
        <Box key={i} size={[0.025, h, 0.025]} position={[x, h / 2, z]} color={wood} roughness={0.7} />
      ))}
      {/* Tiers × slats multiplies fast (a tall wide rack is 40+ boards), so each
          tier's slats are one instanced set. The tier group keeps the back-tilt,
          which means the instances stay in simple local space. */}
      {Array.from({ length: tiers }).map((_, i) => {
        const slatCount = Math.max(3, Math.round(d / 0.06));
        const slats: InstanceItem[] = Array.from({ length: slatCount }, (_, j) => ({
          pos: [0, 0, -d / 2 + (j + 0.5) * (d / slatCount)] as [number, number, number],
          size: [w - 0.06, 0.012, 0.018] as [number, number, number],
        }));
        return (
          <group key={i} position={[0, (i + 0.5) * gap, 0]} rotation={[-0.12, 0, 0]}>
            <BoxInstances items={slats} color={wood} surface={{ roughness: 0.7 }} />
          </group>
        );
      })}
    </>
  );
}

// ─── Beds ───────────────────────────────────────────────────────────────
function BedGeo({ part, locked, double }: { part: ScenePart; locked: boolean; double: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const frame = body(part, locked);
  const mattress = body(part, locked, '#E8D5B0');
  // Pillows always neutral — real beds have white/cream pillows regardless of frame color.
  const pillow = locked ? shade(SCENE.lockedTint, 20) : '#F0ECE3';
  return (
    <>
      <Box size={[w, h * 0.4, d]} position={[0, h * 0.2, 0]} color={frame} roughness={0.7} />
      <Box size={[w * 0.96, h * 0.35, d * 0.96]} position={[0, h * 0.5, 0]} color={mattress} roughness={0.96} />
      {/* duvet draped over the lower two-thirds — adds soft bulk */}
      <Box size={[w * 0.99, h * 0.2, d * 0.66]} position={[0, h * 0.62, d * 0.15]} color={shade(mattress, -8)} roughness={0.97} />
      <Box size={[w, h * 1.4, 0.05]} position={[0, h * 0.7, -d / 2]} color={frame} roughness={0.7} />
      {double ? (
        <>
          <Box size={[w * 0.42, h * 0.15, d * 0.25]} position={[-w * 0.22, h * 0.75, -d * 0.3]} color={pillow} roughness={0.93} />
          <Box size={[w * 0.42, h * 0.15, d * 0.25]} position={[w * 0.22, h * 0.75, -d * 0.3]} color={pillow} roughness={0.93} />
        </>
      ) : (
        <Box size={[w * 0.5, h * 0.15, d * 0.25]} position={[0, h * 0.75, -d * 0.3]} color={pillow} roughness={0.93} />
      )}
      {[
        [-w / 2 + 0.04, -d / 2 + 0.04],
        [w / 2 - 0.04, -d / 2 + 0.04],
        [-w / 2 + 0.04, d / 2 - 0.04],
        [w / 2 - 0.04, d / 2 - 0.04],
      ].map(([x, z], i) => (
        <Box key={i} size={[0.04, h * 0.2, 0.04]} position={[x, h * 0.1, z]} color="#3A2818" roughness={0.7} edgeOpacity={0.5} />
      ))}
    </>
  );
}

// ─── Desks ──────────────────────────────────────────────────────────────
function DeskGeo({ part, locked, lShape }: { part: ScenePart; locked: boolean; lShape: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const top = body(part, locked);
  const leg = shade(top, -25);
  return (
    <>
      {/* tabletop with a subtle lip edge */}
      <Box size={[w, 0.045, d]} position={[0, h - 0.022, 0]} color={top} roughness={0.65} />
      {lShape && (
        <Box size={[d * 0.9, 0.045, w * 0.55]} position={[w / 2 + (d * 0.9) / 2, h - 0.022, -w * 0.05]} color={top} roughness={0.65} />
      )}
      {/* side modesty panel on left — encloses the leg space */}
      <Box size={[0.018, h * 0.82, d * 0.88]} position={[-w / 2 + 0.009, h * 0.41, 0]} color={leg} roughness={0.68} />
      {/* right rear leg */}
      <Box size={[0.05, h - 0.04, 0.05]} position={[w / 2 - 0.04, (h - 0.04) / 2, -d / 2 + 0.04]} color={leg} roughness={0.7} edgeOpacity={0.4} />
      {/* right front leg */}
      <Box size={[0.05, h - 0.04, 0.05]} position={[w / 2 - 0.04, (h - 0.04) / 2, d / 2 - 0.04]} color={leg} roughness={0.7} edgeOpacity={0.4} />
      {/* cable management rail under back edge */}
      <Box size={[w * 0.75, 0.03, 0.04]} position={[0, h - 0.065, -d / 2 + 0.05]} color={shade(leg, 8)} roughness={0.6} />
    </>
  );
}

// ─── Tech / Appliances ──────────────────────────────────────────────────
function MonitorGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  const screenH = h * 0.6;
  const screenY = h * 0.66;
  // The bezel, housing, neck and base follow the part's colour. They were four
  // literals, so the Inspector's colour picker did nothing to a monitor.
  const shell = tint(part);
  return (
    <>
      {/* weighted base disc */}
      <mesh position={[0, 0.012, 0.01]}>
        <cylinderGeometry args={[0.12, 0.15, 0.024, 28]} />
        <meshStandardMaterial color={shell} roughness={0.5} metalness={0.35} />
      </mesh>
      {/* angled neck */}
      <Box size={[0.05, h * 0.32, 0.028]} position={[0, h * 0.22, -0.005]} color={shade(shell, 6)} roughness={0.5} metalness={0.3} />
      {/* housing / back bulge (gives the panel real depth) */}
      <Box size={[w * 0.98, screenH, 0.05]} position={[0, screenY, -0.022]} color={shade(shell, -8)} roughness={0.55} />
      {/* bezel frame */}
      <Box size={[w, screenH + 0.02, 0.02]} position={[0, screenY, 0.006]} color={shell} roughness={0.6} />
      {/* lit screen, inset into the bezel */}
      <mesh position={[0, screenY + 0.008, 0.017]}>
        <planeGeometry args={[w * 0.93, screenH * 0.84]} />
        <meshStandardMaterial color="#2b3a55" emissive="#3a5a8a" emissiveIntensity={0.5} roughness={0.16} metalness={0.1} />
      </mesh>
      {/* chin brand dot */}
      <mesh position={[0, screenY - screenH * 0.46, 0.018]}>
        <circleGeometry args={[0.006, 12]} />
        <meshStandardMaterial color="#666" metalness={0.4} roughness={0.4} />
      </mesh>
    </>
  );
}

function FanGeo({ part }: { part: ScenePart }) {
  const r = part.dimMM[0] / 2 / 1000;
  // Blades follow the part's colour; the motor housing stays metal. The blades
  // were a literal, so recolouring a ceiling fan did nothing.
  const blade = tint(part);
  return (
    <>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.08, 16]} />
        <meshStandardMaterial color="#888" />
      </mesh>
      <Box size={[0.025, 0.18, 0.025]} position={[0, 0.13, 0]} color="#666" />
      <Spin speed={2.4}>
        {[0, 1, 2].map((i) => {
          const angle = (i * 2 * Math.PI) / 3;
          return (
            <group key={i} rotation={[0, angle, 0]}>
              <Box
                size={[r * 1.6, 0.012, 0.16]}
                position={[r * 0.6, 0, 0]}
                color={blade}
                edgeOpacity={0.4}
              />
            </group>
          );
        })}
      </Spin>
    </>
  );
}

function FridgeGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const shell = body(part, locked);
  return (
    <>
      <Box size={[w, h, d]} position={[0, h / 2, 0]} color={shell} roughness={0.5} metalness={0.08} />
      {/* fridge/freezer split line */}
      <Box size={[w, 0.01, 0.006]} position={[0, h * 0.36, d / 2 + 0.002]} color={shade(shell, -30)} />
      {/* brushed-steel handles */}
      <Box size={[0.025, h * 0.34, 0.04]} position={[w / 2 - 0.07, h * 0.72, d / 2 + 0.028]} color="#b9bcc0" roughness={0.35} metalness={0.6} />
      <Box size={[0.025, h * 0.18, 0.04]} position={[w / 2 - 0.07, h * 0.2, d / 2 + 0.028]} color="#b9bcc0" roughness={0.35} metalness={0.6} />
      {/* feet */}
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.05, 0.04, 0.05]} position={[s * (w / 2 - 0.06), 0.02, d / 2 - 0.06]} color="#2b2b2e" />
      ))}
    </>
  );
}

function CurtainGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  const cloth = tint(part);
  // Accordion pleats: vertical strips with alternating Y-rotation read as folds
  // and catch light per-face — far less flat than two billboard planes.
  const pleats = Math.max(8, Math.round(w / 0.11));
  const stripW = w / pleats;
  // 45 planes on a 5m curtain — one instanced set instead of 45 meshes.
  const folds: InstanceItem[] = Array.from({ length: pleats }, (_, i) => ({
    pos: [-w / 2 + (i + 0.5) * stripW, -0.02, 0] as [number, number, number],
    size: [stripW * 1.45, h - 0.04, 1] as [number, number, number],
    rot: [0, (i % 2 === 0 ? 1 : -1) * 0.55, 0] as [number, number, number],
  }));
  return (
    <>
      {/* horizontal rod */}
      <mesh position={[0, h / 2 - 0.015, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.018, 0.018, w * 1.05, 12]} />
        <meshStandardMaterial color="#8A6D44" {...SURFACE.metal} />
      </mesh>
      {/* finials */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 + 0.025), h / 2 - 0.015, 0]}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshStandardMaterial color="#8A6D44" {...SURFACE.metal} />
        </mesh>
      ))}
      <PlaneInstances items={folds} color={cloth} surface={SURFACE.fabric} />
    </>
  );
}

// ─── Tables ─────────────────────────────────────────────────────────────
function CoffeeTableGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const top = body(part, locked);
  const frame = shade(top, -20);
  return (
    <>
      {/* top surface */}
      <Box size={[w, h * 0.15, d]} position={[0, h - h * 0.075, 0]} color={top} roughness={0.65} />
      {/* lower shelf */}
      <Box size={[w * 0.88, h * 0.06, d * 0.86]} position={[0, h * 0.28, 0]} color={frame} roughness={0.7} />
      {/* four tapered legs */}
      {[
        [-w / 2 + 0.03, -d / 2 + 0.03],
        [w / 2 - 0.03, -d / 2 + 0.03],
        [-w / 2 + 0.03, d / 2 - 0.03],
        [w / 2 - 0.03, d / 2 - 0.03],
      ].map(([x, z], i) => (
        <Box key={i} size={[0.045, h * 0.82, 0.045]} position={[x, h * 0.41, z]} color={frame} roughness={0.7} edgeOpacity={0.4} />
      ))}
    </>
  );
}

function SideTableGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const top = body(part, locked);
  const dark = shade(top, -28);
  const r = Math.min(w, d) * 0.38;
  return (
    <>
      {/* tabletop */}
      <Box size={[w, 0.035, d]} position={[0, h - 0.017, 0]} color={top} roughness={0.65} />
      {/* tapered pedestal */}
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.038, 0.058, h - 0.03, 14]} />
        <meshStandardMaterial color={dark} roughness={0.7} />
      </mesh>
      {/* disc base */}
      <mesh position={[0, 0.022, 0]}>
        <cylinderGeometry args={[r, r * 1.08, 0.045, 20]} />
        <meshStandardMaterial color={dark} roughness={0.68} />
      </mesh>
    </>
  );
}

function NightstandGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const wood = body(part, locked);
  const dark = shade(wood, -20);
  const face = shade(wood, 8);
  // Double-click toggles drawers open; slide the faces (+ pulls + a shallow
  // drawer box) forward along +z.
  const open = useStudio((s) => s.openState[part.id] ?? 0);
  const slide = open * Math.min(0.18, d * 0.6);
  return (
    <>
      {/* carcass */}
      <Box size={[w, h, d]} position={[0, h / 2, 0]} color={wood} roughness={0.7} />
      {/* routed groove between drawers (stays on the carcass) */}
      <Box size={[w * 0.9, 0.008, 0.01]} position={[0, h * 0.5, d / 2 + 0.003]} color={dark} roughness={0.8} />
      {/* two drawers — face + side box + pull, slid forward by `slide` */}
      {[h * 0.71, h * 0.26].map((y, i) => (
        <group key={i} position={[0, y, slide]}>
          {open > 0.02 && (
            <Box size={[w * 0.9, h * 0.38, d * 0.85]} position={[0, 0, d / 2 - d * 0.45]} color={dark} roughness={0.85} />
          )}
          <Box size={[w * 0.94, h * 0.4, 0.014]} position={[0, 0, d / 2 - 0.004]} color={face} roughness={0.65} />
          <mesh position={[0, 0, d / 2 + 0.014]}>
            <boxGeometry args={[0.055, 0.013, 0.013]} />
            <meshStandardMaterial color="#9A9088" roughness={0.35} metalness={0.55} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function OttomanGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const fabric = body(part, locked);
  const dark = shade(fabric, -14);
  const leg = shade(fabric, -35);
  return (
    <>
      {/* main upholstered body — raised on legs */}
      <Box size={[w, h * 0.78, d]} position={[0, h * 0.49, 0]} color={fabric} roughness={0.97} />
      {/* piping welt around top edge */}
      <Box size={[w * 1.02, h * 0.04, d * 1.02]} position={[0, h * 0.88, 0]} color={dark} roughness={0.97} />
      {/* four short turned legs */}
      {[
        [-w / 2 + 0.06, -d / 2 + 0.06],
        [w / 2 - 0.06, -d / 2 + 0.06],
        [-w / 2 + 0.06, d / 2 - 0.06],
        [w / 2 - 0.06, d / 2 - 0.06],
      ].map(([x, z], i) => (
        <Box key={i} size={[0.05, h * 0.14, 0.05]} position={[x, h * 0.07, z]} color={leg} roughness={0.7} />
      ))}
    </>
  );
}

// ─── Wall-hung ──────────────────────────────────────────────────────────
function MirrorGeo({ part, oval }: { part: ScenePart; oval: boolean }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  // The frame is the recolourable surface (the glass is not). It was a literal in
  // both branches, so recolouring a mirror did nothing.
  const frame = tint(part);
  if (oval) {
    // Ellipse from a unit circle scaled to W × H. Frame is a slightly larger
    // ellipse behind the reflective face.
    return (
      <>
        <mesh position={[0, 0, 0]} scale={[w / 2 + 0.03, h / 2 + 0.03, 1]}>
          <circleGeometry args={[1, 56]} />
          <meshStandardMaterial color={frame} {...SURFACE.wood} />
        </mesh>
        <mesh position={[0, 0, 0.025]} scale={[w / 2, h / 2, 1]}>
          <circleGeometry args={[1, 56]} />
          <meshStandardMaterial color="#cdd7df" metalness={0.5} roughness={0.24} />
        </mesh>
      </>
    );
  }
  return (
    <>
      <Box size={[w + 0.03, h + 0.03, 0.04]} position={[0, 0, 0]} color={frame} />
      <mesh position={[0, 0, 0.025]}>
        <planeGeometry args={[w, h]} />
        {/* Soft reflective mirror — gentle gloss, not a chrome plate. */}
        <meshStandardMaterial color="#cdd7df" metalness={0.5} roughness={0.24} />
      </mesh>
    </>
  );
}

// Window — frame + translucent glass + cross mullions. Wall-mounted (centre-
// anchored like mirror/painting); a wider window gains vertical mullions.
function WindowGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  const frame = tint(part);
  // One pane per ~0.7m of width, separated by slim mullions.
  const panes = Math.max(1, Math.round(w / 0.7));
  const paneW = w / panes;
  return (
    <>
      {/* outer frame */}
      <Box size={[w + 0.06, 0.05, 0.06]} position={[0, h / 2 + 0.025, 0]} color={frame} roughness={0.7} />
      <Box size={[w + 0.06, 0.05, 0.06]} position={[0, -h / 2 - 0.025, 0]} color={frame} roughness={0.7} />
      <Box size={[0.05, h + 0.1, 0.06]} position={[-w / 2 - 0.025, 0, 0]} color={frame} roughness={0.7} />
      <Box size={[0.05, h + 0.1, 0.06]} position={[w / 2 + 0.025, 0, 0]} color={frame} roughness={0.7} />
      {/* sill */}
      <Box size={[w + 0.12, 0.03, 0.12]} position={[0, -h / 2 - 0.065, 0.03]} color={frame} roughness={0.6} />
      {/* mullions between panes */}
      {Array.from({ length: panes - 1 }).map((_, i) => (
        <Box key={i} size={[0.03, h, 0.04]} position={[-w / 2 + (i + 1) * paneW, 0, 0]} color={frame} roughness={0.7} />
      ))}
      {/* glass — sky-tinted, translucent both sides */}
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#BFD9EC" transparent opacity={0.32} roughness={0.1} metalness={0.1} side={2} />
      </mesh>
    </>
  );
}

// Open clamshell laptop — rests on a desk/surface (floor-anchored, tabletop-prone).
function LaptopGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000; // open height (lid raised)
  // Was a local `const body`, which shadowed the body() helper above and pinned
  // the chassis to one literal — so a laptop could not be recoloured either.
  const shell = tint(part);
  const deck = shade(shell, -10);
  return (
    <>
      {/* chassis — tapered: thin front lip, thicker back (reads as a real base) */}
      <Box size={[w, 0.012, d]} position={[0, 0.006, d * 0.12]} color={shell} roughness={0.45} metalness={0.4} />
      <Box size={[w, 0.022, d * 0.7]} position={[0, 0.011, -d * 0.12]} color={shell} roughness={0.45} metalness={0.4} />
      {/* recessed keyboard well */}
      <Box size={[w * 0.9, 0.006, d * 0.5]} position={[0, 0.016, -d * 0.1]} color="#202327" roughness={0.6} />
      {/* key rows — a few thin ridges hint at keys without thousands of meshes */}
      {[0, 1, 2, 3].map((r) => (
        <Box key={r} size={[w * 0.84, 0.004, d * 0.07]} position={[0, 0.02, -d * 0.26 + r * d * 0.11]} color="#34383d" roughness={0.7} />
      ))}
      {/* trackpad */}
      <mesh position={[0, 0.019, d * 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w * 0.32, d * 0.24]} />
        <meshStandardMaterial color="#2b2e33" roughness={0.35} metalness={0.2} />
      </mesh>
      {/* hinge barrel across the back */}
      <mesh position={[0, 0.02, -d / 2 + 0.01]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.01, 0.01, w * 0.94, 12]} />
        <meshStandardMaterial color="#202327" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* hinged lid */}
      <group position={[0, 0.02, -d / 2 + 0.01]} rotation={[-0.34, 0, 0]}>
        <Box size={[w, h, 0.01]} position={[0, h / 2, 0]} color={deck} roughness={0.4} metalness={0.45} />
        {/* bezel + lit screen */}
        <Box size={[w * 0.97, h * 0.94, 0.004]} position={[0, h / 2, 0.006]} color="#0E0E10" roughness={0.6} />
        <mesh position={[0, h / 2 + 0.004, 0.009]}>
          <planeGeometry args={[w * 0.9, h * 0.82]} />
          <meshStandardMaterial color="#1b2740" emissive="#34507e" emissiveIntensity={0.45} roughness={0.18} metalness={0.1} />
        </mesh>
        {/* camera dot */}
        <mesh position={[0, h * 0.95, 0.009]}>
          <circleGeometry args={[0.003, 10]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      </group>
    </>
  );
}

function PaintingGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  return (
    <>
      <Box size={[w + 0.04, h + 0.04, 0.025]} position={[0, 0, 0]} color="#3A2818" />
      <mesh position={[0, 0, 0.014]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={tint(part)} roughness={0.85} />
      </mesh>
      {/* abstract bands */}
      <mesh position={[0, h * 0.15, 0.015]}>
        <planeGeometry args={[w * 0.88, h * 0.18]} />
        <meshStandardMaterial color="#E2613A" />
      </mesh>
      <mesh position={[0, -h * 0.2, 0.015]}>
        <planeGeometry args={[w * 0.88, h * 0.12]} />
        <meshStandardMaterial color="#5C8DC2" />
      </mesh>
    </>
  );
}

function ACUnitGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const shell = body(part, locked);
  return (
    <>
      <Box size={[w, h, d]} position={[0, 0, 0]} color={shell} />
      {/* louvered front grille */}
      {[-0.12, -0.04, 0.04, 0.12].map((y, i) => (
        <Box key={i} size={[w * 0.92, 0.02, 0.01]} position={[0, y * h, d / 2 + 0.005]} color="#888" edgeOpacity={0.3} />
      ))}
    </>
  );
}

function DoorGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  // A door is floor-anchored (anchorFor → 'floor', groundY → 0), so the group
  // origin sits ON the floor. The panel must therefore be bottom-anchored
  // (center at h/2) — authoring it centered at y=0 sank half the door through
  // the floor, and snap-to-floor / surface couldn't fix it because y=0 was
  // already "correct" for a bottom-anchored mesh.
  return (
    <>
      <Box size={[w, h, 0.04]} position={[0, h / 2, 0]} color={tint(part)} />
      {/* handle at ~1 m from the floor */}
      <mesh position={[w / 2 - 0.06, Math.min(1.0, h * 0.45), 0.025]}>
        <sphereGeometry args={[0.025, 12, 12]} />
        <meshStandardMaterial color="#B89060" />
      </mesh>
    </>
  );
}

// ─── Appliances ───────────────────────────────────────────────────────────
function SoundbarGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const bodyC = tint(part);
  return (
    <>
      <Box size={[w, h, d]} position={[0, h / 2, 0]} color={bodyC} roughness={0.55} />
      {/* fabric grille front */}
      <mesh position={[0, h / 2, d / 2 + 0.003]}>
        <planeGeometry args={[w * 0.96, h * 0.78]} />
        <meshStandardMaterial color={shade(bodyC, 6)} roughness={0.96} />
      </mesh>
    </>
  );
}

function RadiatorGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const bodyC = tint(part);
  const fins = Math.max(6, Math.round(w / 0.06));
  const fw = w / fins;
  // 33 fins on a 2m radiator, all the same colour — a textbook instanced set.
  const finItems: InstanceItem[] = Array.from({ length: fins }, (_, i) => ({
    pos: [-w / 2 + (i + 0.5) * fw, h / 2, 0] as [number, number, number],
    size: [fw * 0.6, h * 0.9, d] as [number, number, number],
  }));
  return (
    <>
      <BoxInstances items={finItems} color={bodyC} surface={{ roughness: 0.5, metalness: 0.1 }} />
      <Box size={[w, h * 0.06, d * 1.05]} position={[0, h - h * 0.03, 0]} color={bodyC} />
      <Box size={[w, h * 0.06, d * 1.05]} position={[0, h * 0.03, 0]} color={bodyC} />
    </>
  );
}

function AirPurifierGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  const r = w / 2;
  const bodyC = tint(part);
  return (
    <>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 0.96, h, 28]} />
        <meshStandardMaterial color={bodyC} roughness={0.5} />
      </mesh>
      {/* intake slats */}
      {[0.22, 0.34, 0.46].map((y, i) => (
        <mesh key={i} position={[0, h * y, 0]}>
          <torusGeometry args={[r + 0.002, 0.006, 8, 28]} />
          <meshStandardMaterial color={shade(bodyC, -22)} roughness={0.8} />
        </mesh>
      ))}
      {/* top control disc */}
      <mesh position={[0, h + 0.004, 0]}>
        <cylinderGeometry args={[r * 0.36, r * 0.36, 0.02, 24]} />
        <meshStandardMaterial color="#26262a" emissive="#3a6aa0" emissiveIntensity={0.25} roughness={0.3} />
      </mesh>
    </>
  );
}

function WashingMachineGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const bodyC = tint(part);
  const doorR = Math.min(w, h) * 0.3;
  return (
    <>
      <Box size={[w, h, d]} position={[0, h / 2, 0]} color={bodyC} roughness={0.45} metalness={0.05} />
      {/* door ring + glass */}
      <mesh position={[0, h * 0.44, d / 2 + 0.01]}>
        <torusGeometry args={[doorR, 0.03, 12, 28]} />
        <meshStandardMaterial color="#bfc3c6" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, h * 0.44, d / 2 + 0.011]}>
        <circleGeometry args={[doorR * 0.82, 28]} />
        <meshStandardMaterial color="#22303a" metalness={0.4} roughness={0.15} />
      </mesh>
      {/* control panel */}
      <Box size={[w * 0.92, h * 0.13, 0.012]} position={[0, h * 0.86, d / 2]} color={shade(bodyC, -6)} />
    </>
  );
}

function MicrowaveGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const bodyC = tint(part);
  return (
    <>
      <Box size={[w, h, d]} position={[0, h / 2, 0]} color={bodyC} roughness={0.5} metalness={0.1} />
      {/* door window */}
      <mesh position={[-w * 0.12, h / 2, d / 2 + 0.003]}>
        <planeGeometry args={[w * 0.58, h * 0.72]} />
        <meshStandardMaterial color="#15181c" roughness={0.2} metalness={0.2} />
      </mesh>
      {/* control strip */}
      <mesh position={[w * 0.34, h / 2, d / 2 + 0.003]}>
        <planeGeometry args={[w * 0.22, h * 0.82]} />
        <meshStandardMaterial color={shade(bodyC, 12)} roughness={0.6} />
      </mesh>
      {/* handle */}
      <Box size={[0.02, h * 0.6, 0.03]} position={[w * 0.17, h / 2, d / 2 + 0.02]} color="#cfcfcf" roughness={0.4} metalness={0.5} />
    </>
  );
}

function WaterDispenserGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const bodyC = tint(part);
  return (
    <>
      <Box size={[w, h * 0.7, d]} position={[0, h * 0.35, 0]} color={bodyC} roughness={0.45} />
      {/* taps (hot/cold) */}
      {[-0.05, 0.05].map((x, i) => (
        <Box key={i} size={[0.03, 0.06, 0.05]} position={[x, h * 0.52, d / 2 + 0.02]} color={i ? '#c0392b' : '#2b6fd4'} />
      ))}
      {/* drip tray */}
      <Box size={[w * 0.6, 0.018, d * 0.5]} position={[0, h * 0.44, d / 2 - 0.04]} color="#9aa0a6" metalness={0.3} roughness={0.5} />
      {/* inverted bottle */}
      <mesh position={[0, h * 0.86, 0]}>
        <cylinderGeometry args={[w * 0.3, w * 0.33, h * 0.32, 20]} />
        <meshStandardMaterial color="#bcd6e6" transparent opacity={0.5} roughness={0.1} metalness={0.1} />
      </mesh>
    </>
  );
}

// ─── Generic fallbacks ──────────────────────────────────────────────────
// Category defaults come from lib/scene-palette (categoryColor) — the same
// source the Inspector's swatch fallback reads, so an un-recoloured part looks
// the same in the studio as it does in the panel that edits it.
function BoxGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const color = body(part, locked);
  return <Box size={[w, h, d]} position={[0, h / 2, 0]} color={color} />;
}

function CylinderGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const h = part.dimMM[2] / 1000;
  const color = body(part, locked);
  return (
    <mesh position={[0, h / 2, 0]}>
      <cylinderGeometry args={[w / 2, w / 2, h, 24]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function PlaneGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const color = body(part, locked);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}
