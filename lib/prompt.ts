// Compose the Imagen prompt from style + budget + locks. Pure function — UI shows live preview by calling this.

import type { Currency } from './parts-catalog';

export type StyleId = 'warm-min' | 'afro-mod' | 'coastal' | 'studio' | 'heritage';

export const STYLES: Record<StyleId, { label: string; tokens: string[] }> = {
  'warm-min': { label: 'Warm Minimal', tokens: ['warm neutral palette', 'linen + oak', 'clean lines', 'soft daylight'] },
  'afro-mod': { label: 'Afro-Modern', tokens: ['kente-inspired geometry', 'terracotta accents', 'woven textiles', 'bold pattern'] },
  coastal: { label: 'Coastal Neutral', tokens: ['bleached wood', 'rattan', 'sea-glass tones', 'humid ambient light'] },
  studio: { label: 'Studio Loft', tokens: ['exposed concrete', 'brushed steel', 'industrial pendant', 'monochrome'] },
  heritage: { label: 'Heritage Wood', tokens: ['mahogany joinery', 'deep lacquer', 'Akan craft motif', 'amber lighting'] },
};

export type BudgetTier = { label: string; tokens: string[]; max: number };
export const BUDGET_TIERS: BudgetTier[] = [
  { max: 25, label: 'Artisanal', tokens: ['local timber', 'handmade weave', 'simple joinery', 'DIY-friendly'] },
  { max: 60, label: 'Mid-market', tokens: ['hybrid finishes', 'semi-custom upholstery', 'mid-range stone', 'imported hardware'] },
  { max: 85, label: 'Premium', tokens: ['imported marble', 'bespoke cabinetry', 'velvet upholstery', 'designer fixtures'] },
  { max: 100, label: 'Showroom', tokens: ['luxury Italian stone', 'full-custom millwork', 'gallery lighting', 'museum-grade finish'] },
];

export function tierFor(budget: number): BudgetTier {
  return BUDGET_TIERS.find((t) => budget <= t.max) ?? BUDGET_TIERS[BUDGET_TIERS.length - 1];
}

export type ViewPreset = 'free' | 'front' | 'top' | 'iso';

export type ComposeInput = {
  styleId: StyleId;
  budget: number;
  lockedNames: string[];
  ghostNames: string[];
  movedNames?: string[];
  removedNames?: string[];
  viewPreset?: ViewPreset;
};

function cameraAngle(preset?: ViewPreset): string {
  switch (preset) {
    case 'front': return 'straight-on frontal interior view, camera at standing eye level (1.6 m) facing the back wall, symmetric perspective';
    case 'top':   return 'overhead top-down plan-view shot, camera directly above looking straight down at the floor plan';
    case 'iso':   return 'three-quarter corner perspective, camera elevated and angled diagonally into the room showing two walls and the floor';
    default:      return 'natural interior photography angle at standing eye level, comfortable room perspective';
  }
}

// Photographic-realism cues — push the model toward "a real photo someone took
// in this room" and away from the clean, plastic, video-game/Blender look that
// "3D render / architectural viz" language tends to produce.
const PHOTO_LOOK = [
  'natural window daylight with soft directional shadows and realistic global illumination',
  'true-to-life material textures — visible wood grain, woven fabric weave, brushed-metal microscratches, matte painted walls',
  'subtle real-world imperfections (faint dust, gentle wear, slightly uneven surfaces)',
  'shallow natural depth of field, faint lens vignetting, fine photographic film grain',
  'colour-graded like an Architectural Digest interior photograph, physically accurate reflections',
  'photorealistic, indistinguishable from a real photograph taken on a camera',
];

// Anti-CG clause. Free Gemini-image has no separate negative-prompt field, so
// this rides inline; the paid Imagen path also passes it as `negativePrompt`.
export const ANTI_CG_NEGATIVE =
  'NOT a 3D render, not CGI, not architectural visualization, no video-game or Blender/Unreal/Octane look, no plastic or waxy surfaces, no over-smooth synthetic geometry, no cartoon or cel shading, no flat ambient lighting';

export function composePrompt(c: ComposeInput): string {
  const style = STYLES[c.styleId];
  const tier = tierFor(c.budget);
  const parts = [
    `A real photograph of an interior room, shot on a full-frame DSLR with a 24–35mm lens — ${cameraAngle(c.viewPreset)}`,
    ...style.tokens,
    ...tier.tokens,
    'polished terrazzo floor, P.O.P. ceiling with recessed lighting, mahogany accents, tropical daylight',
    c.lockedNames.length ? `preserve ${c.lockedNames.join(' + ')}` : '',
    c.movedNames && c.movedNames.length ? `relocate ${c.movedNames.join(', ')}` : '',
    c.removedNames && c.removedNames.length ? `remove ${c.removedNames.join(', ')}` : '',
    c.ghostNames.length ? `place ${c.ghostNames.join(', ')}` : '',
    'contact shadows on floor plane, no floating objects',
    ...PHOTO_LOOK,
    ANTI_CG_NEGATIVE,
  ];
  return parts.filter(Boolean).join(', ');
}

// NOTE: "free" is a misnomer kept as the store key for back-compat — Gemini 2.5
// Flash Image ("Nano Banana") image OUTPUT is billed by Google (~$0.039/img,
// charged as output-image tokens). The free TIER allows 0 image requests, so any
// successful render bills. Priced here so the estimate is honest + the paid
// confirm gate (cost.isPaid) fires. Only detection/text (gemini-2.5-flash) is free.
const COST_PER_VARIANT_USD: Record<'free' | 'eco' | 'ultra' | 'hf' | 'exp', number> = {
  free: 0.039,
  eco: 0.04,
  ultra: 0.06,
  // HF FLUX: ~$0.003/img text-to-image, ~$0.03 img2img (Kontext). Representative
  // mid value; HF's ~$0.10/mo free credit covers the first renders. Non-zero so
  // the paid-confirm gate still fires once the credit runs out.
  hf: 0.01,
  // Gemini 2.0 Flash Exp — experimental native image generation; free while in
  // Google's preview period. Set to 0 so the paid-confirm gate stays silent.
  exp: 0,
};
const USD_TO_GHS = 12;

export function estimateRenderCost(
  variants: number,
  model: 'free' | 'eco' | 'ultra' | 'hf' | 'exp',
  currency: Currency = 'GHS',
): { display: string; amount: number; isPaid: boolean } {
  const usd = COST_PER_VARIANT_USD[model] * variants;
  const isPaid = usd > 0;
  if (!isPaid) return { display: 'FREE', amount: 0, isPaid: false };
  if (currency === 'USD') return { display: `$${usd.toFixed(2)}`, amount: usd, isPaid };
  if (currency === 'GHS') return { display: `₵${(usd * USD_TO_GHS).toFixed(2)}`, amount: usd * USD_TO_GHS, isPaid };
  if (currency === 'NGN') return { display: `₦${(usd * 1500).toFixed(0)}`, amount: usd * 1500, isPaid };
  return { display: `$${usd.toFixed(2)}`, amount: usd, isPaid };
}
