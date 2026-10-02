'use client';

// Render a ScenePart by dispatching on its shape. Sub-shape variants give visual
// variety based on Gemini's label keywords (office vs dining chair, single vs
// double bed, etc).

import { Color } from 'three';
import { Box, BoxInstances, LeafInstances, SoftInstances, SoftMesh, StemInstances, type InstanceItem } from './Box';
import { PartLight } from './PartLight';
import { SURFACE } from './materials';
import { Spin, Sway } from './Motion';
import {
  clothesRail,
  fanBlade,
  fanColumn,
  fridgeDoors,
  pendantDrop,
  plantForm,
  isParametric,
  lightFor,
  radiatorFins,
  shoeRow,
  SHOE_TIER_TILT,
  windowPanes,
  moduleCount,
  moduleRangeFor,
  type ModuleRange,
  type ScenePart,
} from '@/lib/scene-spec';
import { useStudio } from '@/lib/store';
import { roleOf, bedPillows } from '@/lib/layout-rules';
import { DECOR, DETAIL, SCENE, defaultBodyColor } from '@/lib/scene-palette';
import { hexFromKelvin, shadeGlow } from '@/lib/light-units';
import { DINING_LEG, ELL_ARM_DEPTH, ELL_RETURN_WIDTH, surfacePostsLocal } from '@/lib/foot-cells';
import {
  bedForm,
  curtainCloth,
  CUSHION_MESH,
  HEADBOARD_T,
  GARMENT_KINDS,
  GARMENT_MESH,
  leaningCushion,
  SHOE_KINDS,
  SHOE_LINING_MESH,
  SHOE_SOLE_MESH,
  SHOE_UPPER_MESH,
  softHash,
  sofaForm,
  SOFA_BACK_LEAN,
  standUp,
  THROW_LEAN,
  type SoftItem,
} from '@/lib/soft-goods';
import {
  acUnitForm,
  chestFreezerForm,
  doorForm,
  microwaveForm,
  nightstandForm,
  nightstandSlide,
  soundbarForm,
  stoolForm,
  strutPose,
  tvConsoleForm,
  tvForm,
  washingMachineForm,
  waterDispenserForm,
  type HardPart,
  type HardTone,
} from '@/lib/hard-goods';
import type { SurfaceKey } from './materials';

/** The module ranges the TILING parametric shapes are divided by, resolved once at module
 *  scope so a renderer reads a value rather than doing a table lookup per frame.
 *
 *  `lib/` owns the numbers and the arithmetic (`moduleCount`, `MODULE_RANGE`); this
 *  file owns colour and geometry. That is the split `fanBlade` established, and the
 *  reason for it is that a blade drawn `1.6r` long from inside a renderer swept 40%
 *  wider than the piece said for months, because no test could reach the expression.
 *
 *  `ONE` never fires for these five — each has a `MODULE_RANGE` row. It exists so that
 *  a shape reaching one of these lookups without a range draws as a single module
 *  rather than spreading `undefined` into NaN and rendering nothing at all.
 *
 *  Being parametric and TILING are two different things since § 36: eight of the
 *  fourteen members are there because their geometry holds an absolute, not because
 *  they are divided into modules, and none of those eight reaches these five lookups. */
const ONE: ModuleRange = { min: 1e-6, nominal: Infinity, max: Infinity };
const BAY = moduleRangeFor('wardrobe') ?? ONE;
const SEAT = moduleRangeFor('sofa') ?? ONE;
const SHELF = moduleRangeFor('bookshelf') ?? ONE;
const TIER = moduleRangeFor('shoe-rack') ?? ONE;
const PLEAT = moduleRangeFor('curtain') ?? ONE;

/** How far a panel stands back from a face it would otherwise share, metres.
 *
 *  Two surfaces drawn on one plane and facing the same way cannot be ordered by the
 *  depth buffer, so it picks between them per pixel by rounding — a sawtooth or a dashed
 *  seam along the edge, changing with the camera. The user's report on 2026-10-01 read it
 *  as "the shadow issue is across the platform": a wardrobe built from five full-size
 *  slabs whose ends shared every outer face, a bed whose duvet ended on the plane of the
 *  mattress's front, a sofa whose plinth and backrest shared the arms' outside faces. The
 *  shadow map was innocent — switching it off left every seam where it was.
 *
 *  2 mm is under `model-integrity`'s 3 mm touch, so a part set back by it still reads as
 *  joined, and at three metres it is a hundredth of a degree. `tests/coplanar-faces.test.tsx`
 *  sweeps every shape for the defect, which is the only place it can be seen below a
 *  browser. */
const SEAM = 0.002;

// Body albedo for a part's main surfaces. An explicit colour (photo-sampled on
// detection, or chosen in the Inspector) ALWAYS wins — otherwise recolouring a
// locked item did nothing, since most detections auto-lock. Falls back to the
// "from your photo" tint for locked items with no colour, else the shape default.
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
 *  always shown their own colour rather than the "from your photo" tint; keeping that
 *  behaviour is deliberate, so this is a narrower helper rather than a call with
 *  `locked: false` hard-coded. */
function tint(part: ScenePart): string {
  return part.color ?? defaultBodyColor(part.category, part.shape);
}

export function PartGeometry({ part, locked }: { part: ScenePart; locked: boolean }) {
  // Parametric parts rebuild from the CURRENT (overridden) dim, so both the mesh AND
  // the light have to be handed the effective part. `PartLight` rides alongside the
  // shape — a lamp emits because it is a lamp, not because of which mesh happens to
  // represent it — and it renders nothing for the overwhelming majority of parts.
  //
  // ── Why this resolution is HERE and not one component down ──────────────────
  //
  // It used to live inside `ShapeDispatch`, "so the effective-dim hook sits in a
  // component of its own rather than in one that also renders the light". That split
  // is exactly what broke: the light was the thing excluded from it.
  //
  // `lightAnchor('lamp-pendant', dimMM)` returns `pendantDrop(dimMM[0], dimMM[2]).bulbY`
  // — the same function the renderer draws the shade from — and while both read the
  // AUTHORED dim and both were group-scaled by the same factor, they were coincident by
  // construction. Making the shape parametric pinned the mesh at scale 1 and left the
  // light at the authored anchor: a catalogue pendant dragged to 900 mm put its emitter
  // 222 mm from its own bulb and 128 mm above the shade's top rim, on the bare cord,
  // with the shade underneath it as an occluder. That is § 34's defect exactly — 190 mm
  // above the rim, measured and fixed there — re-entered by a different route one
  // commit later.
  //
  // `tests/ceiling-fixtures.test.ts` asserts that property and stayed GREEN, because it
  // hands ONE dim to both `lightAnchor` and `pendantDrop`. Production was handing them
  // two. A fixture that cannot express its defect, which is why the gate for this is
  // `tests/parametric-caps.test.ts`'s "one dim reaches both" clause instead.
  const p = useEffectivePart(part);
  return (
    <>
      <ShapeDispatch part={p} locked={locked} />
      <PartLight part={p} />
    </>
  );
}

/** The part as the user has resized it, for a shape whose geometry owns its size.
 *
 *  Non-parametric shapes come back untouched: their mesh is authored-size and wears
 *  the resize as a group scale, so handing them a stored dim would apply it twice. */
function useEffectivePart(part: ScenePart): ScenePart {
  const storedDim = useStudio((s) => s.dims[part.id]);
  return storedDim && isParametric(part.shape) ? { ...part, dimMM: storedDim } : part;
}

function ShapeDispatch({ part, locked }: { part: ScenePart; locked: boolean }) {
  // `part` is ALREADY the effective one — see `PartGeometry`. It used to be resolved
  // here into a second binding `p`, and every case arm then had to remember to pass
  // `p` rather than `part`; four of the twelve parametric shapes were added in one
  // commit and each needed that edit by hand. An arm that forgot is the worst outcome
  // available: `Draggable` stops group-scaling the shape while its geometry keeps
  // drawing the authored size, so the piece silently stops growing at all. There is
  // one binding now and nothing to forget.
  switch (part.shape) {
    case 'sofa':
      return <SofaGeo part={part} locked={locked} />;
    case 'tv':
      return <TVGeo part={part} locked={locked} />;
    case 'closet':
    case 'wardrobe':
      return <WardrobeGeo part={part} locked={locked} />;
    case 'bookshelf':
      return <BookshelfGeo part={part} locked={locked} />;
    case 'shoe-rack':
      return <ShoeRackGeo part={part} locked={locked} />;
    case 'clothes-rack':
      return <ClothesRackGeo part={part} locked={locked} />;
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
    case 'bed-double':
      // Pillows by width, not by shape: one Library bed is resized from a single to a
      // king, and a 900-wide `bed-double` is a single bed.
      return <BedGeo part={part} locked={locked} />;
    case 'desk-standard':
      // One shape, two pieces of furniture: the catalogue and the seeder both use
      // `desk-standard` for a dining table, and a detected "table" lands on it too.
      // `roleOf` is where the app already decides which one a piece is (by category
      // and size), so the drawing asks it rather than keeping a second opinion — a
      // dining table drawn as a desk, side panel and cable rail included, is what a
      // scanned table used to look like.
      return roleOf(part) === 'dining-table' ? (
        <DiningTableGeo part={part} locked={locked} />
      ) : (
        <DeskGeo part={part} locked={locked} lShape={false} />
      );
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
      return <CurtainGeo part={part} />;
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
    case 'fan-standing':
      return <StandingFanGeo part={part} />;
    case 'chest-freezer':
      return <ChestFreezerGeo part={part} locked={locked} />;
    case 'tv-console':
      return <TvConsoleGeo part={part} locked={locked} />;
    case 'stool':
      return <StoolGeo part={part} locked={locked} />;
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
  const form = sofaForm(part);
  const { w, d, h, arm, legH, seatTop, innerW, backTh } = form;
  const main = body(part, locked);
  const cushion = shade(main, 14);
  const seats = moduleCount(innerW, SEAT);
  const seatW = innerW / seats;
  // Seat and back cushions are boxed cushions — a flat face, a rounded seam — in the boxes
  // the sofa always drew them in; the back ones lean into the backrest a little.
  const seatItems: SoftItem[] = [];
  const backItems: SoftItem[] = [];
  for (let i = 0; i < seats; i++) {
    const x = -innerW / 2 + (i + 0.5) * seatW;
    seatItems.push({ pos: [x, form.seatY, d * 0.04], size: [seatW * 0.94, form.seatH, form.seatD] });
    backItems.push({ pos: [x, form.backY, form.backZ], size: [seatW * 0.92, form.backT, form.backH], rot: standUp(SOFA_BACK_LEAN) });
  }
  const throwTone = (i: number) => (locked ? shade(SCENE.lockedTint, 14) : DECOR.pillow[(form.throws[i].tone ?? 0) % DECOR.pillow.length]);
  const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * (w / 2 - 0.08), sz * (d / 2 - 0.08)] as [number, number]));
  return (
    <>
      {/* plinth — upholstered, so it takes the cloth surface (weave + sheen).
          The frame keeps its tauter 0.75 roughness against the loose cushions. */}
      {/* The arms are the sofa's outside faces; plinth and backrest stand `SEAM` inside
          them, and the arms' undersides stand `SEAM` above the plinth's, so no two panels
          share a face. */}
      <Box size={[w - 2 * SEAM, seatTop - legH, d - 2 * SEAM]} position={[0, (seatTop + legH) / 2, 0]} color={main} surface="fabric" roughness={0.75} />
      {/* backrest */}
      <Box size={[w - 2 * SEAM, h - seatTop, backTh - SEAM]} position={[0, (h + seatTop) / 2, -d / 2 + SEAM + (backTh - SEAM) / 2]} color={main} surface="fabric" roughness={0.75} />
      {/* arms */}
      <Box size={[arm, h * 0.62 - legH - SEAM, d]} position={[-w / 2 + arm / 2, (h * 0.62 + legH + SEAM) / 2, 0]} color={main} surface="fabric" roughness={0.75} />
      <Box size={[arm, h * 0.62 - legH - SEAM, d]} position={[w / 2 - arm / 2, (h * 0.62 + legH + SEAM) / 2, 0]} color={main} surface="fabric" roughness={0.75} />
      {/* per-seat cushions (tiled), and a scatter cushion in each end seat */}
      <SoftInstances mesh={CUSHION_MESH.box} items={seatItems} color={cushion} surface={SURFACE.fabric} />
      <SoftInstances mesh={CUSHION_MESH.box} items={backItems} color={cushion} surface={SURFACE.fabric} />
      <SoftInstances mesh={CUSHION_MESH.scatter} items={form.throws} color="#ffffff" colorOf={throwTone} surface={SURFACE.fabric} />
      {legs.map(([x, z], i) => (
        <Box surface="wood" key={i} size={[0.06, legH, 0.06]} position={[x, legH / 2, z]} color={DETAIL.darkWood} roughness={0.7} />
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
  return <HardParts parts={tvForm(part.dimMM)} bodyC={body(part, locked)} look={{ roughness: 0.5 }} />;
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

/** How a `HardTone` is drawn: its colour and finish. `body` is the piece's own colour and
 *  `look` its finish, so a recolour reaches every surface the user would call the piece;
 *  the hardware keeps its own colour from `DETAIL`, as a real appliance's does. */
type HardLook = { surface?: SurfaceKey; roughness?: number; metalness?: number };
type ToneMaterial = HardLook & {
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
};
function toneMaterial(tone: HardTone, bodyC: string, look: HardLook): ToneMaterial {
  switch (tone) {
    case 'body': return { ...look, color: bodyC };
    case 'trim': return { ...look, color: shade(bodyC, -10) };
    case 'panel': return { ...look, color: shade(bodyC, 8) };
    case 'grille': return { color: shade(bodyC, 6), roughness: 0.96 };
    case 'dark': return { color: DETAIL.hardware, roughness: 0.7 };
    case 'steel': return { color: DETAIL.steel, roughness: 0.35, metalness: 0.6 };
    case 'brass': return { color: DETAIL.brass, roughness: 0.35, metalness: 0.7 };
    case 'wood': return { color: DETAIL.darkWood, surface: 'wood' };
    case 'glass': return { color: DETAIL.glass, roughness: 0.15, metalness: 0.3 };
    case 'display': return { color: DETAIL.display, roughness: 0.3, emissive: DETAIL.led, emissiveIntensity: 0.12 };
    case 'led': return { color: DETAIL.led, roughness: 0.3, emissive: DETAIL.led, emissiveIntensity: 0.9 };
    case 'water': return { color: DETAIL.water, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45 };
    case 'hot': return { color: DETAIL.tapHot, roughness: 0.4 };
    case 'cold': return { color: DETAIL.tapCold, roughness: 0.4 };
    case 'screen': return { color: DETAIL.screen, roughness: 0.18, metalness: 0.2, emissive: DETAIL.screenGlow, emissiveIntensity: 0.35 };
  }
}

/** Draws a `lib/hard-goods.ts` form. Every number is the form's; this colours it. */
function HardParts({ parts, bodyC, look }: { parts: HardPart[]; bodyC: string; look: HardLook }) {
  return (
    <>
      {parts.map((p) => {
        const mat = toneMaterial(p.tone, bodyC, look);
        if (p.kind === 'box') {
          return (
            <Box
              key={p.key}
              size={p.size}
              position={p.pos}
              color={mat.color}
              surface={mat.surface}
              roughness={mat.roughness}
              metalness={mat.metalness}
              emissive={mat.emissive}
              emissiveIntensity={mat.emissiveIntensity}
            />
          );
        }
        const { surface, ...plain } = mat;
        const material = <meshStandardMaterial {...(surface ? SURFACE[surface] : undefined)} {...plain} />;
        if (p.kind === 'post') {
          return (
            <mesh key={p.key} position={p.pos} castShadow receiveShadow>
              {/* A seat's rim shows its facets where a leg's does not. */}
              <cylinderGeometry args={[p.r, p.rBottom, p.h, Math.max(p.r, p.rBottom) > 0.08 ? 48 : 20]} />
              {material}
            </mesh>
          );
        }
        if (p.kind === 'disc') {
          // A cylinder's axis is Y; turned a quarter about X it lies on the depth axis,
          // its face to the front.
          return (
            <mesh key={p.key} position={p.pos} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[p.r, p.r, p.t, 28]} />
              {material}
            </mesh>
          );
        }
        if (p.kind === 'strut') {
          const pose = strutPose(p);
          return (
            <mesh key={p.key} position={pose.pos} rotation={pose.rot} castShadow receiveShadow>
              <cylinderGeometry args={[p.r, p.r, pose.len, 12]} />
              {material}
            </mesh>
          );
        }
        return (
          <mesh key={p.key} position={p.pos} castShadow receiveShadow>
            <torusGeometry args={[p.r, p.tube, 12, 32]} />
            {material}
          </mesh>
        );
      })}
    </>
  );
}

/** Scales a renderer whose geometry is hard-coded metres to the size the piece DECLARES.
 *
 *  CLAUDE.md rule 2's corollary, and six renderers were breaking it: geometry must be
 *  authored at `part.dimMM`, because `Draggable` scales by `storedDim / part.dimMM` — so a
 *  renderer drawing one fixed size draws the WRONG size at scale 1, and the 2D plan (which
 *  reads `dimMM` directly through `footFromPart`) and the 3D tab then show the same piece at
 *  two sizes. `PlantGeo` declared 400 × 400 × 1600 and drew 880 × 700 × 1940: the plan
 *  outlined a 400 mm pot around a 1.9 m plant, and every clearance, collision and picking
 *  answer used the outline.
 *
 *  **It fixes the size and not the shape, and the plant is why that matters.** The scale
 *  is per axis, so it is only honest for geometry that reads as right when stretched —
 *  boxes and cylinders do. A sphere does not: the plant's leaf balls came out as tall
 *  ovals at ×0.45 wide and ×0.82 tall, and "the plant looks squeezed" was this function
 *  working exactly as written. The plant is drawn by `plantForm` now and does not use it.
 *  The office chair's 30 mm casters are the only spheres left under it — too small to
 *  read as squashed. A round thing big enough to see does not belong here.
 *
 *  `natural` is the extent the children actually occupy, in metres, as **[x, y, z]** —
 *  MEASURED by `tests/footprint-fidelity.test.tsx` rather than added up from the literals.
 *  That distinction is not pedantry: the literals here are sphere centres and radii, and the
 *  hand-computed figure for the plant was 920 mm against a measured 880. The gate re-measures
 *  every shape, so a `natural` that drifts from its geometry fails there instead of silently
 *  rescaling the piece.
 *
 *  Scaling is about the origin, so anything standing on the floor at y = 0 stays there.
 */
function FitToDim({
  natural,
  part,
  children,
}: {
  natural: [number, number, number];
  part: ScenePart;
  children: React.ReactNode;
}) {
  const [w, d, h] = part.dimMM;
  return (
    <group scale={[w / 1000 / natural[0], h / 1000 / natural[1], d / 1000 / natural[2]]}>
      {children}
    </group>
  );
}

// ─── Chairs ──────────────────────────────────────────────────────────────
function DiningChairGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const wood = body(part, locked);
  const seat = shade(wood, 14);
  return (
    <FitToDim natural={[0.42, 1.09, 0.42]} part={part}>
        <Box size={[0.42, 0.06, 0.42]} position={[0, 0.46, 0]} color={seat} roughness={0.97} />
        {/* back slats — thin bars spanning the rear legs, their ends buried mid-leg.
            Flush with the legs' outer faces, each slat's end shared a plane with its leg
            and the seam flickered. They were 420 mm wide against legs 400 mm apart outside, and the rear legs
            stopped at the seat, so the whole back — three slats and the top rail —
            hung 39–78 mm in the air with nothing under it. A chair's back is carried
            by its back legs running up into the top rail. */}
        <Box surface="wood" size={[0.38, 0.04, 0.04]} position={[0, 0.68, -0.19]} color={wood} roughness={0.7} />
        <Box surface="wood" size={[0.38, 0.04, 0.04]} position={[0, 0.82, -0.19]} color={wood} roughness={0.7} />
        <Box surface="wood" size={[0.38, 0.04, 0.04]} position={[0, 0.96, -0.19]} color={wood} roughness={0.7} />
        {/* top rail — a crest rail, a touch wider than the legs it caps */}
        <Box surface="wood" size={[0.42, 0.06, 0.05]} position={[0, 1.06, -0.18]} color={wood} roughness={0.7} />
        {/* front legs to the seat; rear legs on up into the top rail */}
        {[
          [-0.18, -0.18, 1.06],
          [0.18, -0.18, 1.06],
          [-0.18, 0.18, 0.45],
          [0.18, 0.18, 0.45],
        ].map(([x, z, h], i) => (
          <Box surface="wood" key={i} size={[0.04, h, 0.04]} position={[x, h / 2, z]} color={wood} roughness={0.7} />
        ))}
    </FitToDim>
  );
}

function OfficeChairGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const cushion = body(part, locked);
  const metal = '#5A5A5A';
  return (
    <FitToDim natural={[0.58, 1.15, 0.48]} part={part}>
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
              <Box surface="metal" size={[0.32, 0.025, 0.05]} position={[x / 2, 0.045, z / 2]} rotation={[0, -a, 0]} color={metal} />
              <mesh position={[x, 0.03, z]}>
                <sphereGeometry args={[0.03, 8, 8]} />
                <meshStandardMaterial color={DETAIL.hardware} />
              </mesh>
            </group>
          );
        })}
        {/* gas piston */}
        {/* from inside the hub up into the seat — it started 5 mm above the hub */}
        <mesh position={[0, 0.275, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.43, 12]} />
          <meshStandardMaterial color={metal} {...SURFACE.metal} />
        </mesh>
        {/* seat */}
        <Box surface="fabric" size={[0.5, 0.08, 0.48]} position={[0, 0.5, 0]} color={cushion} roughness={0.97} />
        {/* backrest */}
        <Box surface="fabric" size={[0.48, 0.6, 0.06]} position={[0, 0.85, -0.21]} color={cushion} roughness={0.97} />
        {/* lumbar curve hint — slightly protruding box gives depth */}
        <Box surface="fabric" size={[0.44, 0.18, 0.04]} position={[0, 0.7, -0.19]} color={shade(cushion, -8)} roughness={0.97} />
        {/* backrest spine — the backrest stopped 10 mm above the seat with nothing
            behind it, so the back floated; this bar runs from the seat into it */}
        <Box surface="metal" size={[0.06, 0.3, 0.03]} position={[0, 0.55, -0.255]} color={metal} roughness={0.55} />
        {/* armrest posts — the pads hung 60 mm above the seat on nothing */}
        {[-0.26, 0.26].map((x) => (
          <Box key={x} surface="metal" size={[0.03, 0.09, 0.03]} position={[x, 0.585, -0.05]} color={DETAIL.hardware} roughness={0.55} metalness={0.3} />
        ))}
        {/* armrests */}
        <Box surface="metal" size={[0.04, 0.04, 0.32]} position={[-0.27, 0.62, -0.05]} color={DETAIL.hardware} roughness={0.55} metalness={0.3} />
        <Box surface="metal" size={[0.04, 0.04, 0.32]} position={[0.27, 0.62, -0.05]} color={DETAIL.hardware} roughness={0.55} metalness={0.3} />
    </FitToDim>
  );
}

function ArmchairGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const seat = body(part, locked);
  const leg = body(part, locked, '#4A3526');
  // One scatter cushion leaning on the back, on the seat cushion's crown — read off the two
  // cushions it touches, so moving either one carries it.
  const seatCushion: SoftItem = { pos: [0, 0.43, SEAM / 2], size: [0.5, 0.12, 0.7 - SEAM] };
  const backCushion: SoftItem = { pos: [0, 0.73, -0.29], size: [0.68, 0.12, 0.58], rot: standUp(0) };
  const scatter = [
    leaningCushion(0, 0.34, 0.1, 0.34, THROW_LEAN, seatCushion.pos[1] + seatCushion.size[1] / 2, backCushion.pos[2] + backCushion.size[1] / 2),
  ];
  const scatterTone = locked ? shade(SCENE.lockedTint, 14) : DECOR.pillow[Math.floor(softHash(part.id, 'throw') * 64) % DECOR.pillow.length];
  return (
    <FitToDim natural={[0.7, 1.02, 0.7]} part={part}>
        {/* seat cushion — between the arms, not under them: full width, its sides and
            underside lay on the arms' own planes and fought them */}
        <SoftInstances mesh={CUSHION_MESH.box} items={[seatCushion]} color={seat} surface={SURFACE.fabric} />
        {/* back cushion, stood up in the box the back always filled: its thickness, unit +Y,
            turned to face forward */}
        <SoftInstances mesh={CUSHION_MESH.box} items={[backCushion]} color={seat} surface={SURFACE.fabric} />
        <SoftInstances mesh={CUSHION_MESH.scatter} items={scatter} color={scatterTone} surface={SURFACE.fabric} />
        {/* armrests */}
        <Box size={[0.1, 0.38, 0.68]} position={[-0.3, 0.56, 0]} color={seat} surface="fabric" roughness={0.95} />
        <Box size={[0.1, 0.38, 0.68]} position={[0.3, 0.56, 0]} color={seat} surface="fabric" roughness={0.95} />
        {/* wooden legs, up to the underside of the seat and arms (0.37). They stopped
            at 0.32, so the whole upholstered body hovered 44 mm above its own legs. */}
        {[
          [-0.3, -0.3],
          [0.3, -0.3],
          [-0.3, 0.3],
          [0.3, 0.3],
        ].map(([x, z], i) => (
          <Box surface="wood" key={i} size={[0.05, 0.37, 0.05]} position={[x, 0.185, z]} color={leg} roughness={0.7} />
        ))}
    </FitToDim>
  );
}

// ─── Plant ──────────────────────────────────────────────────────────────
/** The greens a plant's leaves cycle through, in no order. One per `PLANT_LEAF_TONES`,
 *  which is where `plantForm` takes its `tone % …` from. */
const LEAF_TONES = ['#5D8A5D', '#6E9A66', '#4F7C4F', '#6FA06A', '#4A7048'] as const;

/** Drawn at its own size by `plantForm`, which picks a fig, an arching bush or a blend
 *  of the two from the plant's proportions. No `FitToDim`: a per-axis stretch is what
 *  squashed the old plant, and a leaf keeps its shape only if it is drawn at its size. */
function PlantGeo({ part }: { part: ScenePart }) {
  return <PlantBody dimMM={part.dimMM} pot={tint(part)} />;
}

const NOPICK = () => {};

/** The plant itself, at a size and in a pot colour — shared with the tabletop plant a
 *  surface's props can carry (`Dressing`), which used to be a cylinder and a ball
 *  while the floor plant beside it had leaves. `noPick` takes it out of raycasting,
 *  as every prop is: a prop is dressing on its surface, not a piece to select. */
export function PlantBody({ dimMM, pot, noPick }: { dimMM: [number, number, number]; pot: string; noPick?: boolean }) {
  const g = plantForm(dimMM);
  const pick = noPick ? { raycast: NOPICK } : {};
  return (
    <group>
      {/* tapered pot */}
      <mesh position={[0, g.pot.h / 2, 0]} scale={[g.pot.stretch[0], 1, g.pot.stretch[1]]} {...pick}>
        <cylinderGeometry args={[g.pot.top, g.pot.bottom, g.pot.h, 20]} />
        <meshStandardMaterial color={pot} {...SURFACE.ceramic} />
      </mesh>
      {/* soil, standing a little proud of the rim — flush with it, the two tops
          z-fight and the soil flickers through the pot's lid */}
      <mesh position={[0, g.pot.h, 0]} scale={[g.pot.stretch[0], 1, g.pot.stretch[1]]} {...pick}>
        <cylinderGeometry args={[g.soil.r, g.soil.r, g.soil.t, 20]} />
        <meshStandardMaterial color="#3a2c20" roughness={1} />
      </mesh>
      {/* trunk, stalks and leaves sway gently from the soil line */}
      <group position={[0, g.pot.h, 0]}>
        <Sway amp={0.03} speed={0.9}>
          <group position={[0, -g.pot.h, 0]}>
            <StemInstances items={g.stems} wood="#4A3526" green="#5B7A45" noPick={noPick} />
            <LeafInstances items={g.leaves} tones={LEAF_TONES} surface={SURFACE.foliage} noPick={noPick} />
          </group>
        </Sway>
      </group>
    </group>
  );
}

// ─── Lamps ──────────────────────────────────────────────────────────────
/** The fabric shade of a table or floor lamp, glowing with the light inside it:
 *  the shade's own colour filtered by the bulb's, at a strength set by the flux
 *  (`shadeGlow`). A lamp whose light is removed still has a shade, unlit. */
function LampShade({ part, color }: { part: ScenePart; color: string }) {
  const spec = lightFor(part);
  const glow = spec ? shadeGlow(spec.lumens) : 0;
  // No hook: the footprint tests walk these renderers as plain functions, with
  // no React dispatcher, and two Color multiplies are not worth memoising.
  const emissive = spec ? new Color(color).multiply(new Color(hexFromKelvin(spec.kelvin))).getStyle() : '#000000';
  return <meshPhysicalMaterial color={color} side={2} {...SURFACE.fabric} emissive={emissive} emissiveIntensity={glow} />;
}

function FloorLampGeo({ part }: { part: ScenePart }) {
  const metal = '#9A7848';
  const shade = tint(part);
  return (
    <FitToDim natural={[0.36, 1.85, 0.36]} part={part}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.15, 0.18, 0.04, 16]} />
          <meshStandardMaterial color={metal} {...SURFACE.metal} />
        </mesh>
        {/* pole from inside the base (it started 10 mm above it) up into the shade */}
        <mesh position={[0, 0.84, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 1.62, 8]} />
          <meshStandardMaterial color={metal} {...SURFACE.metal} />
        </mesh>
        <mesh position={[0, 1.7, 0]}>
          <coneGeometry args={[0.18, 0.3, 16, 1, true]} />
          <LampShade part={part} color={shade} />
        </mesh>
    </FitToDim>
  );
}

function TableLampGeo({ part }: { part: ScenePart }) {
  const metal = '#9A7848';
  const shade = tint(part);
  return (
    <FitToDim natural={[0.28, 0.52, 0.28]} part={part}>
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
          <LampShade part={part} color={shade} />
        </mesh>
    </FitToDim>
  );
}

function PendantLampGeo({ part }: { part: ScenePart }) {
  const dome = tint(part);
  // Every number here was a literal, on both axes: a 600 mm cord and a 200 mm shade
  // for a declared 400 mm, 300 mm wide for a declared 350. See `pendantDrop`.
  const g = pendantDrop(part.dimMM[0], part.dimMM[2]);
  // …and the ellipse again. `lamp-pendant` is ROUND, so a shade on a piece whose depth
  // has been edited away from its width is an oval from above, which is what the plan
  // and `collidesAt` are both already using.
  const oval = part.dimMM[1] / part.dimMM[0];
  // Swing from the ceiling mount — the pivot is the top of the drop, which is the
  // part's own top rather than a number that happened to match one catalogue size.
  return (
    <group position={[0, g.top, 0]} scale={[1, 1, oval]}>
      <Sway amp={0.05} speed={0.7} axis="x">
        <group position={[0, -g.top, 0]}>
          {/* cord */}
          <Box surface="metal" size={[0.01, g.cordH, 0.01]} position={[0, g.cordY, 0]} color={DETAIL.hardware} edgeOpacity={0.2} />
          {/* Shade, mouth DOWN. There was a `rotation={[Math.PI, 0, 0]}` here, and it
              was upside down: `ConeGeometry(r, h)` is `CylinderGeometry(0, r, h)`, so
              the apex is already at +Y and the wide mouth at -Y — a lampshade before
              anything rotates it. `FloorLampGeo` and `TableLampGeo` use the same cone
              with no rotation, and this was the one lamp in the catalogue whose shade
              faced the slab. Deriving `domeR` from the declared width made it louder
              rather than causing it: at the band's top it is an 800 mm funnel aimed at
              the ceiling instead of a fixed 300 mm one. The Y extent is unchanged
              either way, which is why no size assertion could see it. */}
          <mesh position={[0, g.domeY, 0]}>
            <coneGeometry args={[g.domeR, g.domeH, 16, 1, true]} />
            <meshStandardMaterial color={dome} side={2} {...SURFACE.ceramic} />
          </mesh>
          {/* bulb */}
          <mesh position={[0, g.bulbY, 0]}>
            <sphereGeometry args={[g.bulbR, 12, 12]} />
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
  const bays = moduleCount(w, BAY);
  const bayW = w / bays;
  // Double-click swings the doors open (hinged on each bay's outer edge).
  const open = useStudio((s) => s.openState[part.id] ?? 0);
  const swing = open * 1.15;
  // A carcass is built like one: sides full height, top and bottom BETWEEN them, the back
  // between all four, and the whole box stopping `SEAM` behind the doors. It was five
  // full-size slabs, so every outer face of the wardrobe was drawn twice — side and top
  // both at the top, side and back both at the back, side and door both at the front —
  // and each pair fought along its edge. That was the "shadow" on the wardrobe's edges.
  const T = 0.018;
  const door = 0.018;
  const carcD = d - door - SEAM;
  const carcZ = -d / 2 + carcD / 2;
  return (
    <>
      <Box surface="wood" size={[T, h, carcD]} position={[-w / 2 + T / 2, h / 2, carcZ]} color={side} roughness={0.7} />
      <Box surface="wood" size={[T, h, carcD]} position={[w / 2 - T / 2, h / 2, carcZ]} color={side} roughness={0.7} />
      <Box surface="wood" size={[w - 2 * T, T, carcD]} position={[0, h - T / 2, carcZ]} color={top} roughness={0.7} />
      <Box surface="wood" size={[w - 2 * T, T, carcD]} position={[0, T / 2, carcZ]} color={top} roughness={0.7} />
      <Box surface="wood" size={[w - 2 * T, h - 2 * T, 0.012]} position={[0, h / 2, -d / 2 + 0.006]} color={wood} roughness={0.7} />
      {/* internal dividers between bays, from the back panel to the carcass front */}
      {Array.from({ length: bays - 1 }).map((_, i) => (
        <Box surface="wood" key={`dv-${i}`} size={[0.014, h - 0.04, carcD - 0.012]} position={[-w / 2 + (i + 1) * bayW, h / 2, carcZ + 0.006]} color={side} roughness={0.72} />
      ))}
      {/* per-bay door — hinged on the outer edge; swings open on double-click */}
      {Array.from({ length: bays }).map((_, i) => {
        const cx = -w / 2 + (i + 0.5) * bayW;
        // Alternate hinge side so adjacent doors open outward like real wardrobes.
        const leftHinged = i % 2 === 0;
        const hinge = leftHinged ? cx - bayW / 2 + 0.01 : cx + bayW / 2 - 0.01;
        const dir = leftHinged ? 1 : -1; // door extends toward bay centre from hinge
        // NEGATED, and the sign is the whole of it. A rotation about +Y carries local +x
        // toward -z, so a door extending along +x from a hinge on the FRONT face swung
        // into the carcass — through the back panel, the dividers and whatever was on the
        // shelves. It was invisible to every gate because nothing measured a footprint
        // with the doors open: `tests/footprint-fidelity.test.tsx` took the wardrobe as a
        // ramp at open = 0 / 0.25 / 0.5 / 0.75 / 1 and read 12 / 0 / 0 / 0 / 0 mm outside
        // `dimMM`, i.e. at any open above zero its bounds were EXACTLY its declared box.
        // An outward-swinging door cannot do that. The ramp is monotone now and the far
        // edge reaches 524 mm proud of the face at the library size.
        const dw = bayW - 0.02;
        return (
          <group key={`bay-${i}`} position={[hinge, h * 0.5, d / 2 - door / 2]} rotation={[0, -dir * swing, 0]}>
            <Box surface="wood" size={[dw, h * 0.94, door]} position={[dir * dw / 2, 0, 0]} color={wood} roughness={0.7} />
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
const BOOK_COLORS = DECOR.book;
function BookshelfGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const wood = body(part, locked);
  const back = shade(wood, -18);
  const bays = moduleCount(h, SHELF); // vertical compartments
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
      <Box surface="wood" size={[0.018, h, d]} position={[-w / 2, h / 2, 0]} color={wood} roughness={0.7} />
      <Box surface="wood" size={[0.018, h, d]} position={[w / 2, h / 2, 0]} color={wood} roughness={0.7} />
      {/* back and shelves fit BETWEEN the sides and the back stops under the top shelf.
          Running to the sides' centre lines, every one shared a face with a side at the
          top and the back, and the seam flickered. */}
      <Box surface="wood" size={[w - 0.018, h - 0.018, 0.012]} position={[0, (h - 0.018) / 2, -d / 2 + 0.006]} color={back} roughness={0.72} />
      {/* shelves: one per compartment boundary (incl. top + bottom) */}
      {Array.from({ length: bays + 1 }).map((_, i) => (
        <Box surface="wood" key={i} size={[w - 0.018, 0.018, d - 0.01]} position={[0, Math.min(h - 0.009, i * gap + 0.009), 0]} color={wood} roughness={0.65} />
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
// width-filling slatted shelf tilted back so shoes lean. Widening adds slats — and
// pairs of shoes, which `shoeRow` seeds per rack so the rack is never shown empty.
function ShoeRackGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const wood = body(part, locked);
  const tiers = moduleCount(h, TIER);
  const gap = h / tiers;
  const posts = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * (w / 2 - 0.02), sz * (d / 2 - 0.02)] as [number, number]));
  const shoes = shoeRow(part);
  const shoeTone = (b: (typeof shoes)[number]) => (locked ? shade(SCENE.lockedTint, b.sole ? -10 : 10) : (b.sole ? DECOR.sole : DECOR.shoe)[b.tone % DECOR.shoe.length]);
  const lining = locked ? shade(SCENE.lockedTint, -30) : DETAIL.lining;
  return (
    <>
      {posts.map(([x, z], i) => (
        <Box surface="wood" key={i} size={[0.025, h, 0.025]} position={[x, h / 2, z]} color={wood} roughness={0.7} />
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
        const tier = shoes.filter((b) => b.tier === i);
        const soles = tier.filter((b) => b.sole);
        return (
          <group key={i} position={[0, (i + 0.5) * gap, 0]} rotation={[-SHOE_TIER_TILT, 0, 0]}>
            <BoxInstances items={slats} color={wood} surface={{ roughness: 0.7 }} />
            {/* side rails the slats rest on, running front post to back post. Without
                them every slat was a board floating 40 mm from the next, held by
                nothing — a rack drawn as a stack of loose sticks. */}
            {[-1, 1].map((sx) => (
              <Box key={sx} surface="wood" size={[0.02, 0.025, d - 0.02]} position={[sx * (w / 2 - 0.03), -0.01, 0]} color={wood} roughness={0.7} />
            ))}
            {/* Each shoe is a sole and an upper of its kind standing on it, with the dark
                lining showing at the floor of its opening. */}
            <SoftInstances mesh={SHOE_SOLE_MESH} items={soles} color="#ffffff" colorOf={(k) => shoeTone(soles[k])} surface={{ roughness: 0.85 }} />
            {SHOE_KINDS.map((kind) => {
              const uppers = tier.filter((b) => !b.sole && b.kind === kind);
              return (
                <group key={kind}>
                  <SoftInstances mesh={SHOE_UPPER_MESH[kind]} items={uppers} color="#ffffff" colorOf={(k) => shoeTone(uppers[k])} surface={{ roughness: 0.7 }} doubleSide />
                  <SoftInstances mesh={SHOE_LINING_MESH[kind]} items={uppers} color={lining} surface={{ roughness: 0.95 }} doubleSide />
                </group>
              );
            })}
          </group>
        );
      })}
    </>
  );
}

// Parametric: an open pipe clothes rail — two uprights on flanged T-feet, a top bar the
// hangers ride and a lower bar, all from `clothesRail`, with the clothes on it seeded per
// rail. The pipe is the recolourable body; the clothes keep their own colours, as the
// books on a shelf do.
function ClothesRackGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const rail = clothesRail(part);
  const { pipe, flange, postX, footY, topY, lowY } = rail;
  const iron = body(part, locked);
  const joint = shade(iron, 12);
  const span = 2 * postX;
  const footLen = d - 2 * flange;
  const hangerWood = locked ? shade(SCENE.lockedTint, 20) : DETAIL.lightWood;
  const hangers: InstanceItem[] = [];
  for (const g of rail.garments) {
    // the hook, from the bar's underside down to the hanger, and the hanger's neck the
    // garment's shoulders fold over — its arms are inside the cloth
    hangers.push({ pos: [g.x, topY - pipe - 0.03, 0], size: [0.004, 0.06, 0.004] });
    hangers.push({ pos: [g.x, g.top, 0], size: [0.012, 0.016, 0.03] });
  }
  // One instanced set per kind of garment, each hung in the box `clothesRail` gives it.
  const byKind = GARMENT_KINDS.map((kind) => {
    const hung = rail.garments.filter((g) => g.kind === kind);
    const items: SoftItem[] = hung.map((g) => ({ pos: [g.x, g.top - g.length / 2, 0], size: [g.thick, g.length, g.width] }));
    const tone = (k: number) => (locked ? shade(SCENE.lockedTint, 10) : DECOR.garment[hung[k].tone % DECOR.garment.length]);
    return { kind, items, tone };
  });
  return (
    <>
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * postX, 0, 0]}>
          {/* floor flanges, a short stub up from each, and the foot pipe between them */}
          {[-1, 1].map((sz) => (
            <group key={sz} position={[0, 0, sz * (d / 2 - flange)]}>
              <mesh position={[0, 0.004, 0]}>
                <cylinderGeometry args={[flange, flange, 0.008, 20]} />
                <meshStandardMaterial color={iron} {...SURFACE.metal} />
              </mesh>
              <mesh position={[0, (footY + 0.008) / 2, 0]}>
                <cylinderGeometry args={[pipe, pipe, footY - 0.008, 12]} />
                <meshStandardMaterial color={iron} {...SURFACE.metal} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, footY, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[pipe, pipe, footLen, 12]} />
            <meshStandardMaterial color={iron} {...SURFACE.metal} />
          </mesh>
          {/* the upright, from the foot's tee to the elbow under the top bar */}
          <mesh position={[0, (footY + topY) / 2, 0]}>
            <cylinderGeometry args={[pipe, pipe, topY - footY, 12]} />
            <meshStandardMaterial color={iron} {...SURFACE.metal} />
          </mesh>
          {/* tee, lower-bar tee and elbow: fittings a little fatter than the pipe. The
              elbow sits down by its own extra girth so its crown is the rail's height. */}
          {[footY, lowY, Math.min(topY, h - pipe * 1.45)].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <sphereGeometry args={[pipe * 1.45, 12, 10]} />
              <meshStandardMaterial color={joint} {...SURFACE.metal} />
            </mesh>
          ))}
        </group>
      ))}
      {[topY, lowY].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[pipe, pipe, span, 12]} />
          <meshStandardMaterial color={iron} {...SURFACE.metal} />
        </mesh>
      ))}
      {hangers.length > 0 && <BoxInstances items={hangers} color={hangerWood} surface={{ roughness: 0.6 }} />}
      {byKind.map(({ kind, items, tone }) => (
        <SoftInstances key={kind} mesh={GARMENT_MESH[kind]} items={items} color="#ffffff" colorOf={tone} surface={SURFACE.fabric} doubleSide />
      ))}
    </>
  );
}

// ─── Beds ───────────────────────────────────────────────────────────────
function BedGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const form = bedForm(part, bedPillows(part.dimMM[0]));
  const { w, d, h } = form;
  const frame = body(part, locked);
  const mattress = body(part, locked, DETAIL.mattress);
  // Linen always neutral — real beds have white/cream pillows regardless of frame color.
  const linen = locked ? shade(SCENE.lockedTint, 20) : DETAIL.linen;
  const scatterTone = (i: number) => (locked ? shade(SCENE.lockedTint, 10) : DECOR.pillow[(form.scatter[i].tone ?? 0) % DECOR.pillow.length]);
  return (
    <>
      {/* The headboard is the bed's full width, so the frame stands `SEAM` inside it —
          the two shared both side faces at the head and fought there. */}
      <Box surface="wood" size={[w - 2 * SEAM, h * 0.4, d]} position={[0, h * 0.2, 0]} color={frame} roughness={0.7} />
      {/* Inset 40 mm a side, not 2%. At 2% a single bed's mattress side rose 18 mm in
          from the frame's edge — inside the frame's 30 mm rounded edge, so the line where
          one met the other ran along a curve and came out ragged. */}
      <Box surface="fabric" size={form.mattress.size} position={[0, form.mattress.y, 0]} color={mattress} roughness={0.96} />
      {/* The duvet is cloth laid over the mattress from the pillows to the foot, rolling
          over the edges and hanging to a level hem above the frame; the sheet is turned
          back over it at the head. */}
      <SoftMesh mesh={form.duvet} color={shade(mattress, -8)} surface={SURFACE.fabric} doubleSide />
      <SoftInstances mesh={CUSHION_MESH.box} items={[form.fold]} color={linen} surface={SURFACE.fabric} />
      <Box surface="wood" size={[w, h * 1.4, HEADBOARD_T]} position={[0, h * 0.7, -d / 2]} color={frame} roughness={0.7} />
      {/* pillows propped against the headboard, a scatter cushion in front of each */}
      <SoftInstances mesh={CUSHION_MESH.pillow} items={form.pillows} color={linen} surface={SURFACE.fabric} />
      <SoftInstances mesh={CUSHION_MESH.scatter} items={form.scatter} color="#ffffff" colorOf={scatterTone} surface={SURFACE.fabric} />
      {[
        [-w / 2 + 0.04, -d / 2 + 0.04],
        [w / 2 - 0.04, -d / 2 + 0.04],
        [-w / 2 + 0.04, d / 2 - 0.04],
        [w / 2 - 0.04, d / 2 - 0.04],
      ].map(([x, z], i) => (
        <Box surface="wood" key={i} size={[0.04, h * 0.2, 0.04]} position={[x, h * 0.1, z]} color={DETAIL.darkWood} roughness={0.7} edgeOpacity={0.5} />
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

  // THE L IS BUILT INSIDE `dimMM`, and it used to be built outside it.
  //
  // The return arm was `size={[d * 0.9, …]}` at `position={[w / 2 + (d * 0.9) / 2, …]}`,
  // which starts at the box's right edge and runs a further `d * 0.9` beyond it — while
  // the main tabletop was already the full `w x d`, so there was no room inside the
  // declared footprint for an L in the first place. At the library size that drew
  // 2860 mm of desk against a `dimMM` of 1600: `tests/footprint-fidelity.test.tsx`
  // measured `overX` 1260 mm, and the ratio held at every size (0.75 / 0.79 / 0.76), so
  // it was never a rounding artefact at one end of the range.
  //
  // It is not cosmetic, and the plan is the half that shows it: `footFromPart` gives one
  // box per piece, so `PlanView` drew 1600 mm while the 3D tab drew 2860. Everything
  // reading that box — `plan-hit` picking, `footOverlap`, `outsideShare`, every clearance
  // and collision answer, and the solver's own cost — reserved 1600 mm of floor for a
  // piece occupying 2860. Suggest could park something in the other 1260 and score it
  // clean. That is CLAUDE.md rule 2's corollary exactly: a renderer with its own idea of
  // how big the piece is, in a TSX file where no test could reach the arithmetic.
  //
  // So the long arm now takes `armD` of the depth and the return takes the rest, both
  // within `w x d`. `desk-standard` is untouched by construction: at `lShape === false`
  // `armD === d` and `armZ === 0`, which is the tabletop this function always drew.
  //
  // The proportions live in `lib/foot-cells.ts` now, where the plan's outline and every
  // containment and collision test read them too — so the notch the room lets a wall
  // corner into is the notch this draws.
  const armD = lShape ? d * ELL_ARM_DEPTH : d;
  const armZ = -d / 2 + armD / 2;
  const armW = w * ELL_RETURN_WIDTH;

  return (
    <>
      {/* tabletop with a subtle lip edge — the long arm, against the back edge */}
      <Box surface="wood" size={[w, 0.045, armD]} position={[0, h - 0.022, armZ]} color={top} roughness={0.65} />
      {lShape && (
        /* the return, filling the depth the long arm leaves at the right-hand end */
        <Box surface="wood"
          size={[armW, 0.045, d - armD]}
          position={[w / 2 - armW / 2, h - 0.022, -d / 2 + armD + (d - armD) / 2]}
          color={top}
          roughness={0.65}
        />
      )}
      {/* The side panel on the left, then the right rear and right front legs (the
          front one under the return in L form) — `surfacePostsLocal`'s rectangles, the
          ones a tucked chair is kept out of. The panel carries that end of the top, so
          it runs floor to underside: at 0.82h it stopped 90 mm short and the desktop's
          left end sat on air; the legs stop 5 mm higher, under the top's lip. */}
      {surfacePostsLocal(lShape ? 'desk-l' : 'desk-standard', false, w, d).map((r, i) => {
        const tall = i === 0 ? h - 0.045 : h - 0.04;
        return (
          <Box key={i} surface="wood" size={[r.x1 - r.x0, tall, r.z1 - r.z0]} position={[(r.x0 + r.x1) / 2, tall / 2, (r.z0 + r.z1) / 2]} color={leg} roughness={i === 0 ? 0.68 : 0.7} />
        );
      })}
      {/* cable management rail under back edge */}
      <Box surface="wood" size={[w * 0.75, 0.03, 0.04]} position={[0, h - 0.06, -d / 2 + 0.05]} color={shade(leg, 8)} roughness={0.6} />
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
      {/* neck from the base plate up into the screen's back — it started h·0.06 up,
          which cleared the 24 mm plate on the tall sizes */}
      <Box size={[0.05, h * 0.38 - 0.02, 0.028]} position={[0, (h * 0.38 + 0.02) / 2, -0.005]} color={shade(shell, 6)} roughness={0.5} metalness={0.3} />
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
  // The blade's span is `fanBlade`'s, not this file's. It was `size: [r * 1.6]` at
  // `position: [r * 0.6]` here — a tip at 1.4r, so a 1000 mm fan swept 1.40 m while
  // the plan drew the 1.00 m circle its `dimMM` asks for. See `fanBlade`.
  const { hub, length, centre, thickness, chord } = fanBlade(part.dimMM[0]);
  // …and the OTHER axis is `fanColumn`'s, for the same reason: the hub and downrod
  // were `0.08` at y = 0 and `0.18` at y = 0.13, an extent of [-0.04, +0.22] for a
  // declared 200 mm, off-centre, and identical for every fan in a 150–450 mm band.
  const col = fanColumn(part.dimMM[2]);
  // Blades follow the part's colour; the motor housing stays metal. The blades
  // were a literal, so recolouring a ceiling fan did nothing.
  const blade = tint(part);
  // An ELLIPSE, not a circle of radius W/2. `fan` is a `ROUND_SHAPES` member, so
  // `footFromPart` models the inscribed ellipse and `PlanView` draws it — W and D are
  // separately editable and a stretched fan has to be the shape the collision maths is
  // using. The group scale used to supply this for free; a parametric shape sits at
  // scale 1, so the depth axis is the renderer's job now.
  const oval = part.dimMM[1] / part.dimMM[0];
  return (
    <group scale={[1, 1, oval]}>
      <mesh position={[0, col.hubY, 0]}>
        <cylinderGeometry args={[hub, hub, col.hubH, 16]} />
        <meshStandardMaterial color="#888" />
      </mesh>
      <Box surface="metal" size={[0.025, col.rodH, 0.025]} position={[0, col.rodY, 0]} color="#666" />
      {/* The blades ride the hub, so they follow it when a taller fan lengthens the
          downrod instead of staying at the origin the hub has left. */}
      <Spin speed={2.4}>
        {[0, 1, 2].map((i) => {
          const angle = (i * 2 * Math.PI) / 3;
          return (
            <group key={i} rotation={[0, angle, 0]} position={[0, col.hubY, 0]}>
              <Box
                size={[length, thickness, chord]}
                position={[centre, 0, 0]}
                color={blade}
               
              />
            </group>
          );
        })}
      </Spin>
    </group>
  );
}

function FridgeGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const shell = body(part, locked);
  const french = fridgeDoors(part.dimMM[0]) === 2;
  const steel = DETAIL.steel;
  return (
    <>
      <Box size={[w, h, d]} position={[0, h / 2, 0]} color={shell} roughness={0.5} metalness={0.08} />
      {/* fridge/freezer split line */}
      <Box size={[w - 2 * SEAM, 0.01, 0.006]} position={[0, h * 0.36, d / 2 + 0.002]} color={shade(shell, -30)} />
      {/* brushed-steel handles */}
      {/* handles against the doors — both stood 8 mm off them on nothing */}
      {french ? (
        <>
          {/* French door: two doors meeting in the middle over a pull-out freezer
              drawer, handles either side of the meeting line and one across the drawer */}
          {/* 5 mm, not the split line's 6: the two meet, and one front face shared
              between them flickers where they do (coplanar-faces) */}
          <Box size={[0.008, h * 0.64 - SEAM, 0.005]} position={[0, h * 0.68, d / 2 + 0.0015]} color={shade(shell, -30)} />
          {[-1, 1].map((s) => (
            <Box key={s} size={[0.025, h * 0.34, 0.04]} position={[s * 0.05, h * 0.72, d / 2 + 0.02]} color={steel} roughness={0.35} metalness={0.6} />
          ))}
          <Box size={[w * 0.5, 0.025, 0.04]} position={[0, h * 0.32, d / 2 + 0.02]} color={steel} roughness={0.35} metalness={0.6} />
        </>
      ) : (
        <>
          <Box size={[0.025, h * 0.34, 0.04]} position={[w / 2 - 0.07, h * 0.72, d / 2 + 0.02]} color={steel} roughness={0.35} metalness={0.6} />
          <Box size={[0.025, h * 0.18, 0.04]} position={[w / 2 - 0.07, h * 0.2, d / 2 + 0.02]} color={steel} roughness={0.35} metalness={0.6} />
        </>
      )}
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
  // One cloth hanging in soft waves from the rod, a wave per two pleats — gathered at the
  // header, deeper toward the hem, no two quite alike.
  const drape = curtainCloth(part.dimMM, moduleCount(w, PLEAT));
  return (
    <>
      {/* horizontal rod */}
      <mesh position={[0, h / 2 - 0.015, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.018, 0.018, w * 1.05, 12]} />
        <meshStandardMaterial color={DETAIL.brass} {...SURFACE.metal} />
      </mesh>
      {/* finials */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 + 0.025), h / 2 - 0.015, 0]}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshStandardMaterial color={DETAIL.brass} {...SURFACE.metal} />
        </mesh>
      ))}
      <SoftMesh mesh={drape} color={cloth} surface={SURFACE.fabric} doubleSide />
    </>
  );
}

// ─── Tables ─────────────────────────────────────────────────────────────
/** Four legs, four aprons and a top — a table you walk all the way round. Leg and
 *  apron sizes are fixed rather than proportional, like the desk's, because this
 *  shape is scaled per axis rather than as a group. */
function DiningTableGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const top = body(part, locked);
  const frame = shade(top, -20);
  const topT = 0.035;
  const apron = 0.08;
  // Leg centres, inset so a leg's outer faces sit 40 mm inside the top's edge. The legs
  // themselves are `surfacePostsLocal`'s, the rectangles a tucked chair is kept out of.
  const lx = w / 2 - DINING_LEG.inset - DINING_LEG.size / 2;
  const lz = d / 2 - DINING_LEG.inset - DINING_LEG.size / 2;
  return (
    <>
      <Box surface="wood" size={[w, topT, d]} position={[0, h - topT / 2, 0]} color={top} roughness={0.65} />
      {/* aprons on the legs' centre lines, so each rail's ends run into a leg */}
      {[-1, 1].map((s) => (
        <Box key={`ax${s}`} surface="wood" size={[2 * lx, apron, 0.022]} position={[0, h - topT - apron / 2, s * lz]} color={frame} roughness={0.7} />
      ))}
      {[-1, 1].map((s) => (
        <Box key={`az${s}`} surface="wood" size={[0.022, apron, 2 * lz]} position={[s * lx, h - topT - apron / 2, 0]} color={frame} roughness={0.7} />
      ))}
      {surfacePostsLocal('desk-standard', true, w, d).map((r, i) => (
        <Box key={i} surface="wood" size={[r.x1 - r.x0, h - topT, r.z1 - r.z0]} position={[(r.x0 + r.x1) / 2, (h - topT) / 2, (r.z0 + r.z1) / 2]} color={frame} roughness={0.7} />
      ))}
    </>
  );
}

function CoffeeTableGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const top = body(part, locked);
  const frame = shade(top, -20);
  const topT = h * 0.15;
  // Proportional, not capped: this shape is group-scaled on a resize (§ 36).
  const apron = h * 0.14;
  return (
    <>
      {/* top surface */}
      <Box surface="wood" size={[w, topT, d]} position={[0, h - topT / 2, 0]} color={top} roughness={0.65} />
      {/* aprons — the rails under the top that tie the legs together. Without them
          the top read as a slab resting on four sticks. Drawn on the legs' centre
          lines, so each rail's ends run into a leg. */}
      {[-1, 1].map((s) => (
        <Box key={`ax${s}`} surface="wood" size={[w - 0.06, apron, 0.02]} position={[0, h - topT - apron / 2, s * (d / 2 - 0.03)]} color={frame} roughness={0.7} />
      ))}
      {[-1, 1].map((s) => (
        <Box key={`az${s}`} surface="wood" size={[0.02, apron, d - 0.06]} position={[s * (w / 2 - 0.03), h - topT - apron / 2, 0]} color={frame} roughness={0.7} />
      ))}
      {/* lower shelf, corner to corner between the leg centres so its corners sit
          INSIDE the legs. At 0.88w it stopped 13 mm short of them (55 mm at the
          largest size) and hung in mid-air. */}
      <Box surface="wood" size={[w - 0.06, h * 0.06, d - 0.06]} position={[0, h * 0.28, 0]} color={frame} roughness={0.7} />
      {/* four legs, floor to the underside of the top — they stopped at 0.82h, 13 mm
          below it, so the top floated */}
      {[
        [-w / 2 + 0.03, -d / 2 + 0.03],
        [w / 2 - 0.03, -d / 2 + 0.03],
        [-w / 2 + 0.03, d / 2 - 0.03],
        [w / 2 - 0.03, d / 2 - 0.03],
      ].map(([x, z], i) => (
        <Box key={i} surface="wood" size={[0.045, h - topT, 0.045]} position={[x, (h - topT) / 2, z]} color={frame} roughness={0.7} />
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
      <Box surface="wood" size={[w, 0.035, d]} position={[0, h - 0.017, 0]} color={top} roughness={0.65} />
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
  // Double-click toggles the drawers open; the form slides them out along +z.
  const open = useStudio((s) => s.openState[part.id] ?? 0);
  return (
    <HardParts
      parts={nightstandForm(part.dimMM, nightstandSlide(open, part.dimMM[1]))}
      bodyC={body(part, locked)}
      look={{ surface: 'wood', roughness: 0.65 }}
    />
  );
}

function OttomanGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const fabric = body(part, locked);
  const dark = shade(fabric, -14);
  const leg = shade(fabric, -35);
  // The welt's top is the piece's height. It stopped at 0.9 h, so a tray set on a
  // 420 mm ottoman stood 42 mm above the cushion: everything else reads `dimMM[2]` as
  // the top (`verticalExtent`), and only the drawing disagreed.
  return (
    <>
      {/* main upholstered body — raised on legs */}
      <Box surface="fabric" size={[w, h * 0.87, d]} position={[0, h * 0.545, 0]} color={fabric} roughness={0.97} />
      {/* piping welt around top edge */}
      <Box surface="fabric" size={[w * 1.02, h * 0.04, d * 1.02]} position={[0, h * 0.98, 0]} color={dark} roughness={0.97} />
      {/* four short turned legs */}
      {[
        [-w / 2 + 0.06, -d / 2 + 0.06],
        [w / 2 - 0.06, -d / 2 + 0.06],
        [-w / 2 + 0.06, d / 2 - 0.06],
        [w / 2 - 0.06, d / 2 - 0.06],
      ].map(([x, z], i) => (
        <Box surface="wood" key={i} size={[0.05, h * 0.15, 0.05]} position={[x, h * 0.075, z]} color={leg} roughness={0.7} />
      ))}
    </>
  );
}

// ─── Wall-hung ──────────────────────────────────────────────────────────
function MirrorGeo({ part, oval }: { part: ScenePart; oval: boolean }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  // The frame is the recolourable surface (the glass is not). It was a literal in
  // both branches, so recolouring a mirror did nothing.
  const frame = tint(part);
  if (oval) {
    // Ellipse from a unit circle scaled to W × H. Frame is a slightly larger
    // ellipse behind the reflective face.
    return (
      <>
        {/* A frame with a real depth (the piece's own `dimMM[1]`), glass on its face.
            It was a paper-thin disc with the glass floating 25 mm in front of it. The
            cylinder's axis is Y, turned to Z; `scale` is applied before the turn, so
            its Y entry is the depth. */}
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[w / 2 + 0.03, d, h / 2 + 0.03]}>
          <cylinderGeometry args={[1, 1, 1, 56]} />
          <meshStandardMaterial color={frame} {...SURFACE.wood} />
        </mesh>
        <mesh position={[0, 0, d / 2 + 0.001]} scale={[w / 2, h / 2, 1]}>
          <circleGeometry args={[1, 56]} />
          <meshStandardMaterial color="#cdd7df" metalness={0.5} roughness={0.24} />
        </mesh>
      </>
    );
  }
  return (
    <>
      {/* frame at the piece's declared depth (it was a flat 40 mm whatever the Inspector
          said), glass 1 mm proud of its face rather than 5 mm in front of it */}
      <Box surface="wood" size={[w + 0.03, h + 0.03, d]} position={[0, 0, 0]} color={frame} />
      <mesh position={[0, 0, d / 2 + 0.001]}>
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
  // One pane per ~0.7m of width, separated by slim mullions. `windowPanes` rather than
  // the expression, because a count off an absolute pitch is § 36's class and the
  // arithmetic has to sit where a test can reach it.
  const panes = windowPanes(part.dimMM[0]);
  const paneW = w / panes;
  return (
    <>
      {/* outer frame */}
      {/* head and foot rails run BETWEEN the stiles; overlapping them, each corner drew
          the frame's front, back and top faces twice */}
      <Box size={[w, 0.05, 0.06]} position={[0, h / 2 + 0.025, 0]} color={frame} roughness={0.7} />
      <Box size={[w, 0.05, 0.06]} position={[0, -h / 2 - 0.025, 0]} color={frame} roughness={0.7} />
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
      <Box size={[w - 2 * SEAM, 0.022, d * 0.7]} position={[0, 0.011, -d * 0.12]} color={shell} roughness={0.45} metalness={0.4} />
      {/* recessed keyboard well */}
      <Box size={[w * 0.9, 0.006, d * 0.5]} position={[0, 0.016, -d * 0.1]} color="#202327" roughness={0.6} />
      {/* key rows — a few thin ridges hint at keys without thousands of meshes */}
      {[0, 1, 2, 3].map((r) => (
        // 1 mm proud of the deck: flush, every key's top was the deck's own plane
        <Box key={r} size={[w * 0.84, 0.004, d * 0.07]} position={[0, 0.021, -d * 0.26 + r * d * 0.11]} color="#34383d" roughness={0.7} />
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
      <Box surface="wood" size={[w + 0.04, h + 0.04, 0.025]} position={[0, 0, 0]} color={DETAIL.darkWood} />
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
  return <HardParts parts={acUnitForm(part.dimMM)} bodyC={body(part, locked)} look={{ roughness: 0.4 }} />;
}

function DoorGeo({ part }: { part: ScenePart }) {
  // A door anchors 'wall-floor' (physics.ts): CENTRED on the group origin like
  // every other wall-mounted part, with `groundY` putting that origin at h/2 so
  // the leaf still reaches the floor. Bottom-anchoring it here is what made a
  // seeded door hang a metre up the wall — `wallApertures` cut the hole from the
  // mesh centre while this drew upwards from it, and the two disagreed by h/2.
  //
  // Every part is drawn at the DECLARED depth (`doorForm`). A flat 0.04 once stood
  // here, which parametric's scale-1 pin froze at 40 mm while the Inspector's depth
  // field edited a number nothing drew.
  return <HardParts parts={doorForm(part.dimMM)} bodyC={tint(part)} look={{ surface: 'wood' }} />;
}

// ─── Appliances ───────────────────────────────────────────────────────────
function SoundbarGeo({ part }: { part: ScenePart }) {
  return <HardParts parts={soundbarForm(part.dimMM)} bodyC={tint(part)} look={{ roughness: 0.55 }} />;
}

function RadiatorGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;
  const h = part.dimMM[2] / 1000;
  const bodyC = tint(part);
  const fins = radiatorFins(part.dimMM[0]);
  const fw = w / fins;
  // 33 fins on a 2 m radiator, all the same colour — a textbook instanced set. That
  // number is `radiatorFins(2000)` and is now true of a RESIZED radiator too; before
  // § 36 a stretched one kept the count it was authored with and drew 13.
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
        // A torus lies in XY with its axis on Z; the body's axis is Y. Unturned, the
        // rings stood as vertical hoops through the body and 22–42 mm into the floor.
        <mesh key={i} position={[0, h * y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          {/* The body tapers from r at the top to 0.96r at the floor, so each ring is
              sized to the body at its own height — a top-radius ring stood ~4 mm off it. */}
          <torusGeometry args={[r * (0.96 + 0.04 * y) + 0.002, 0.006, 8, 28]} />
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
  return <HardParts parts={washingMachineForm(part.dimMM)} bodyC={tint(part)} look={{ roughness: 0.45, metalness: 0.05 }} />;
}

function MicrowaveGeo({ part }: { part: ScenePart }) {
  return <HardParts parts={microwaveForm(part.dimMM)} bodyC={tint(part)} look={{ roughness: 0.5, metalness: 0.1 }} />;
}

function WaterDispenserGeo({ part }: { part: ScenePart }) {
  return <HardParts parts={waterDispenserForm(part.dimMM)} bodyC={tint(part)} look={{ roughness: 0.45 }} />;
}

/** Pedestal fan: a weighted base, a telescoping column, a tilt bracket, and a head of
 *  motor, blades and a domed wire guard.
 *
 *  Authored inside the footprint the plan draws, which for this shape is the ELLIPSE
 *  `dimMM[0]` × `dimMM[1]` (`circle`), not the box around it. So the guard's rim, the
 *  widest thing in it, stands directly over the base at z = 0, where the ellipse is as
 *  wide as the piece: a rim pushed forward of that pokes out of the outline at both
 *  ends, which `tests/footprint-outcomes.test.tsx` measures as positions a drag refuses
 *  that the plan says are clear. The guard is two shallow cones meeting at that rim, and
 *  the motor sits behind the back one, every depth a share of `dimMM[1]`: a straight
 *  line between two points inside an ellipse stays inside it, so straight spokes from
 *  a centre inside the outline to a rim on it cannot leave it. That is also how a real
 *  guard is built. Width is `dimMM[0]` exactly, height `dimMM[2]`, and the base sets the
 *  depth, as § 39 decided. The `fanBlade` lesson, applied on the way in.
 *
 *  The blades do not spin: `Spin` turns about the piece's vertical axis, which is the
 *  ceiling fan's, and a pedestal fan's blades turn about the horizontal one. */
function StandingFanGeo({ part }: { part: ScenePart }) {
  const w = part.dimMM[0] / 1000;
  const dd = part.dimMM[1] / 2000;
  const h = part.dimMM[2] / 1000;
  const r = w / 2;
  const bodyC = tint(part);
  const wire = shade(bodyC, -18);
  const metal = '#c4c8cc';
  const headY = h - r;

  // The guard: a rim at z = 0, a front cone to `front`, a flatter back cone to `-back`.
  const tube = r * 0.028;
  const rimT = tube * 1.2;
  // The rim's outer edge sits ON the ellipse at its own thickness, not past it.
  const rim = r * Math.sqrt(1 - (rimT / dd) ** 2) * 0.999 - rimT;
  const front = Math.min(0.42 * dd, 0.3 * r);
  const back = front * 0.5;
  // A point on a cone, `rho` out from the axis.
  const onFront = (rho: number) => front * (1 - rho / rim);
  const onBack = (rho: number) => -back * (1 - rho / rim);

  // The motor, behind the back cone's centre: a barrel, then a dome.
  const motorR = r * 0.3;
  const motorFace = onBack(motorR);
  const motorL = Math.min(0.9 * dd + motorFace, 0.45 * r);
  const barrelL = motorL * 0.6;
  const barrelZ = motorFace - barrelL / 2;
  const domeZ = motorFace - barrelL;

  // The base and the column. The base is round and no wider than the depth it declares.
  const baseR = Math.min(0.7 * r, 0.95 * dd); // its flared foot is 4% wider still
  const baseH = h * 0.028;
  // The column stops below the rim and a bracket leans back from it to the motor.
  const poleTop = headY - r * 1.12;
  const jointY = baseH + (poleTop - baseH) * 0.55;
  const mount: [number, number] = [headY - motorR * 0.85, barrelZ];
  const armL = Math.hypot(mount[0] - poleTop, mount[1]);
  const armTilt = Math.atan2(-mount[1], mount[0] - poleTop);

  const ring = (radius: number, z: number, t: number, key: string) => (
    <mesh key={key} position={[0, headY, z]}>
      <torusGeometry args={[radius, t, 8, 40]} />
      <meshStandardMaterial color={wire} metalness={0.35} roughness={0.4} />
    </mesh>
  );
  // Straight wires from `from` out to the rim, each lying on its cone.
  const spokes = (n: number, from: number, cone: (rho: number) => number, keyPrefix: string) => {
    const z0 = cone(from);
    const len = Math.hypot(rim - from, z0);
    const tilt = Math.atan2(z0, rim - from);
    return Array.from({ length: n }, (_, i) => (
      <group key={`${keyPrefix}${i}`} position={[0, headY, 0]} rotation={[0, 0, (i / n) * Math.PI * 2]}>
        <mesh position={[(from + rim) / 2, 0, z0 / 2]} rotation={[0, tilt, -Math.PI / 2]}>
          <cylinderGeometry args={[tube * 0.35, tube * 0.35, len, 4]} />
          <meshStandardMaterial color={wire} metalness={0.35} roughness={0.4} />
        </mesh>
      </group>
    ));
  };

  return (
    <>
      {/* weighted base: a low plinth with a dome on it, and the switch row on its front */}
      <mesh position={[0, baseH / 2, 0]}>
        <cylinderGeometry args={[baseR, baseR * 1.04, baseH, 32]} />
        <meshStandardMaterial color={bodyC} roughness={0.55} />
      </mesh>
      <mesh position={[0, baseH, 0]} scale={[1, 0.22, 1]}>
        <sphereGeometry args={[baseR * 0.82, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={shade(bodyC, 4)} roughness={0.5} />
      </mesh>
      {[-1, 0, 1].map((k) => (
        <mesh key={k} position={[k * baseR * 0.16, baseH + baseR * 0.06, baseR * 0.62]}>
          <cylinderGeometry args={[baseR * 0.05, baseR * 0.05, baseR * 0.05, 12]} />
          <meshStandardMaterial color={shade(bodyC, -30)} roughness={0.4} />
        </mesh>
      ))}

      {/* telescoping column: a thicker lower tube, a locking collar, a slimmer upper tube */}
      <mesh position={[0, (baseH + jointY) / 2, 0]}>
        <cylinderGeometry args={[0.019, 0.023, jointY - baseH, 14]} />
        <meshStandardMaterial color={metal} metalness={0.3} roughness={0.35} />
      </mesh>
      <mesh position={[0, jointY, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.035, 16]} />
        <meshStandardMaterial color={bodyC} roughness={0.5} />
      </mesh>
      <mesh position={[0.03, jointY, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.009, 0.009, 0.02, 10]} />
        <meshStandardMaterial color={shade(bodyC, -30)} roughness={0.4} />
      </mesh>
      <mesh position={[0, (jointY + poleTop) / 2, 0]}>
        <cylinderGeometry args={[0.013, 0.013, poleTop - jointY, 12]} />
        <meshStandardMaterial color={metal} metalness={0.35} roughness={0.3} />
      </mesh>
      {/* the tilt bracket: a knuckle on the column, an arm leaning back to the motor */}
      <mesh position={[0, poleTop, 0]}>
        <sphereGeometry args={[0.018, 14, 10]} />
        <meshStandardMaterial color={bodyC} roughness={0.5} />
      </mesh>
      <mesh position={[0, (poleTop + mount[0]) / 2, mount[1] / 2]} rotation={[-armTilt, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.014, armL, 12]} />
        <meshStandardMaterial color={bodyC} roughness={0.5} />
      </mesh>

      {/* motor housing behind the guard, rounded at the back, with the oscillation knob on top */}
      <mesh position={[0, headY, barrelZ]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[motorR, motorR * 0.86, barrelL, 28]} />
        <meshStandardMaterial color={bodyC} roughness={0.45} />
      </mesh>
      <mesh position={[0, headY, domeZ]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, (motorL - barrelL) / (motorR * 0.86), 1]}>
        <sphereGeometry args={[motorR * 0.86, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={bodyC} roughness={0.45} />
      </mesh>
      <mesh position={[0, headY + motorR + 0.012, barrelZ]}>
        <cylinderGeometry args={[0.01, 0.012, 0.024, 12]} />
        <meshStandardMaterial color={shade(bodyC, -30)} roughness={0.4} />
      </mesh>

      {/* blades: three broad, pitched, translucent leaves on a hub, between the cones */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        const len = rim * 0.78;
        return (
          <group key={i} position={[0, headY, front * 0.15]} rotation={[0, 0, a]}>
            <mesh position={[len * 0.55, 0, 0]} rotation={[0.35, 0, 0]} scale={[len / 2, rim * 0.26, 0.004]}>
              <sphereGeometry args={[1, 20, 10]} />
              <meshStandardMaterial color={shade(bodyC, -6)} roughness={0.35} transparent opacity={0.72} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, headY, (front * 0.5 - back * 0.5) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r * 0.12, r * 0.12, (front + back) * 0.5, 20]} />
        <meshStandardMaterial color={shade(bodyC, -10)} roughness={0.4} />
      </mesh>

      {/* the guard: one rim, a front cone of rings and spokes with a badge at its point,
          and a back cone of spokes and a ring running into the motor's face */}
      {ring(rim, 0, rimT, 'rim')}
      {ring(rim * 0.66, onFront(rim * 0.66), tube * 0.45, 'f66')}
      {ring(rim * 0.33, onFront(rim * 0.33), tube * 0.45, 'f33')}
      {ring(rim * 0.55, onBack(rim * 0.55), tube * 0.45, 'b55')}
      {spokes(12, r * 0.1, onFront, 'fs')}
      {spokes(8, motorR, onBack, 'bs')}
      <mesh position={[0, headY, front]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r * 0.1, r * 0.1, tube * 1.2, 20]} />
        <meshStandardMaterial color={bodyC} roughness={0.35} metalness={0.15} />
      </mesh>
    </>
  );
}

/** Chest freezer — a lid-on-top box, which is what distinguishes it from `fridge`. */
function ChestFreezerGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  return <HardParts parts={chestFreezerForm(part.dimMM)} bodyC={body(part, locked)} look={{ roughness: 0.35 }} />;
}

/** Low TV console on legs: doors in the end bays, open niches between (`tvConsoleForm`). */
function TvConsoleGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  return <HardParts parts={tvConsoleForm(part.dimMM)} bodyC={body(part, locked)} look={{ surface: 'wood', roughness: 0.45 }} />;
}

/** Round wooden stool. `stoolForm` draws it on a circle of the declared width; the
 *  ellipse is for the same reason as `FanGeo` — `stool` is a ROUND shape whose W and D
 *  are separately editable, and the plan draws what `footFromPart` models. */
function StoolGeo({ part, locked }: { part: ScenePart; locked: boolean }) {
  return (
    <group scale={[1, 1, part.dimMM[1] / part.dimMM[0]]}>
      <HardParts parts={stoolForm(part.dimMM)} bodyC={body(part, locked)} look={{ surface: 'wood', roughness: 0.55 }} />
    </group>
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
