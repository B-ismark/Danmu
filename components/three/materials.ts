// Shared PBR surface presets for the hand-built primitives. Spreading one of
// these onto a <meshStandardMaterial> gives each surface type believable
// roughness/metalness instead of the old uniform flat Lambert look.
//
// NOTE: metals (metalness > 0) only look metallic when there's an environment
// to reflect — see the inline <Environment> in Room.tsx. Without it they go
// near-black. Keep that env mounted whenever these presets are used.
//
// wood, fabric and metal carry procedural maps via lazy getters — spreading the
// preset reads them (client-only, memoised), so each set builds once on first use
// and never during SSR. `map` is a GREY tone layer multiplied over `color`, so the
// user's recolour keeps its hue; see `lib/textures.ts` for why the relief alone
// changed nothing anyone could see.
//
// The maps are laid out in METRES, which only holds on geometry with metric UVs:
// `Box` rewrites its own (`lib/surface-uv.ts`) and cloth is built with them
// (`lib/soft-goods.ts`). A primitive with 0..1 UVs per face — a cylinder leg, an
// instanced shelf board — still shows the texture, just at its own scale.

import { Vector2, type Texture } from 'three';
import { woodMaps, fabricMaps, metalMaps } from '@/lib/textures';

const NORMAL_SCALE_WOOD = new Vector2(0.6, 0.6);
const NORMAL_SCALE_FABRIC = new Vector2(0.9, 0.9);
const NORMAL_SCALE_METAL = new Vector2(0.35, 0.35);

// Tuned-hybrid: matte-leaning. Metals are brushed (not mirror), gloss is gentle.
export const SURFACE = {
  /** Matte solid wood / MDF — most casework, tabletops, frames. */
  wood: {
    roughness: 0.7,
    metalness: 0.0,
    get map(): Texture { return woodMaps().map; },
    get normalMap(): Texture { return woodMaps().normalMap; },
    get roughnessMap(): Texture { return woodMaps().roughnessMap; },
    normalScale: NORMAL_SCALE_WOOD,
  },
  /** Oiled / satin wood — slightly glossier. */
  woodSatin: {
    roughness: 0.58,
    metalness: 0.0,
    get map(): Texture { return woodMaps().map; },
    get normalMap(): Texture { return woodMaps().normalMap; },
    get roughnessMap(): Texture { return woodMaps().roughnessMap; },
    normalScale: NORMAL_SCALE_WOOD,
  },
  /** Brushed metal — chair bases, table legs, lamp poles, hardware. */
  metal: {
    roughness: 0.52,
    metalness: 0.55,
    get map(): Texture { return metalMaps().map; },
    get normalMap(): Texture { return metalMaps().normalMap; },
    get roughnessMap(): Texture { return metalMaps().roughnessMap; },
    normalScale: NORMAL_SCALE_METAL,
  },
  /** Dark matte metal — feet, thin frames. */
  metalDark: {
    roughness: 0.6,
    metalness: 0.45,
    get map(): Texture { return metalMaps().map; },
    get normalMap(): Texture { return metalMaps().normalMap; },
    get roughnessMap(): Texture { return metalMaps().roughnessMap; },
    normalScale: NORMAL_SCALE_METAL,
  },
  /** Upholstery — sofas, cushions, ottomans, lamp shades.
   *
   *  `sheen` is the cloth term, and it is the difference between a sofa and a
   *  painted box. Real fabric scatters a pale rim of light at grazing angles as
   *  the fibres catch it; a plain rough dielectric has no such lobe, which is
   *  exactly why upholstery used to read as matte plastic. It is the
   *  most-looked-at surface in the app.
   *
   *  Requires `meshPhysicalMaterial` — meshStandardMaterial silently ignores
   *  these three. See SURFACE_PHYSICAL below. */
  fabric: {
    roughness: 0.97,
    metalness: 0.0,
    sheen: 1,
    sheenRoughness: 0.85,
    // Slightly warm rather than pure white, so the rim reads as fibre rather than
    // as a specular highlight sitting on top of the colour.
    sheenColor: '#fff4e6',
    get map(): Texture { return fabricMaps().map; },
    get normalMap(): Texture { return fabricMaps().normalMap; },
    get roughnessMap(): Texture { return fabricMaps().roughnessMap; },
    normalScale: NORMAL_SCALE_FABRIC,
  },
  /** Painted plastic / appliance shell. */
  plastic: { roughness: 0.55, metalness: 0.0 },
  /** Glazed ceramic / pot. */
  ceramic: { roughness: 0.45, metalness: 0.0 },
  /** Foliage — leaves. */
  foliage: { roughness: 0.85, metalness: 0.0 },
  /** Glass — table tops, panes (cheap: no transmission, just gloss). */
  glass: { roughness: 0.18, metalness: 0.0 },
};

export type SurfaceKey = keyof typeof SURFACE;

/** Surfaces whose preset uses a property only `meshPhysicalMaterial` implements.
 *
 *  A renderer spreading one of these onto a `<meshStandardMaterial>` does not
 *  fail — three drops the unknown properties silently, and the surface renders
 *  looking exactly as flat as it did before, which is the kind of change that
 *  gets written twice because the first time left no trace. Anything listed here
 *  must be spread onto `<meshPhysicalMaterial>`. */
export const PHYSICAL_SURFACES: readonly SurfaceKey[] = ['fabric'];
