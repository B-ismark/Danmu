// Shared PBR surface presets for the hand-built primitives. Spreading one of
// these onto a <meshStandardMaterial> gives each surface type believable
// roughness/metalness instead of the old uniform flat Lambert look.
//
// NOTE: metals (metalness > 0) only look metallic when there's an environment
// to reflect — see the inline <Environment> in Room.tsx. Without it they go
// near-black. Keep that env mounted whenever these presets are used.
//
// wood + fabric carry a procedural NORMAL map via a lazy getter — spreading the
// preset reads it (client-only, memoised), so the texture builds once on first
// use and never during SSR. Colour stays driven by `color`/themes; the normal
// map only adds microrelief (grain / weave).

import { Vector2, type Texture } from 'three';
import { woodNormal, fabricNormal } from '@/lib/textures';

const NORMAL_SCALE_WOOD = new Vector2(0.35, 0.35);
const NORMAL_SCALE_FABRIC = new Vector2(0.5, 0.5);

// Tuned-hybrid: matte-leaning. Metals are brushed (not mirror), gloss is gentle.
export const SURFACE = {
  /** Matte solid wood / MDF — most casework, tabletops, frames. */
  wood: {
    roughness: 0.7,
    metalness: 0.0,
    get normalMap(): Texture { return woodNormal(); },
    normalScale: NORMAL_SCALE_WOOD,
  },
  /** Oiled / satin wood — slightly glossier. */
  woodSatin: {
    roughness: 0.58,
    metalness: 0.0,
    get normalMap(): Texture { return woodNormal(); },
    normalScale: NORMAL_SCALE_WOOD,
  },
  /** Brushed metal — chair bases, table legs, lamp poles, hardware. */
  metal: { roughness: 0.52, metalness: 0.55 },
  /** Dark matte metal — feet, thin frames. */
  metalDark: { roughness: 0.6, metalness: 0.45 },
  /** Upholstery — sofas, cushions, ottomans, lamp shades. */
  fabric: {
    roughness: 0.97,
    metalness: 0.0,
    get normalMap(): Texture { return fabricNormal(); },
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
