'use client';

// Ask Gemini to map a free-text description (and optional reference image) into
// our known Shape catalog with refined dim + name. Routes user requests through
// the procedural primitive library — no random box outputs.

import { GoogleGenAI } from '@google/genai';
import { useQuota } from './quota';
import type { Shape, Category, ScenePart } from './scene-spec';

const ALL_SHAPES: Shape[] = [
  'sofa', 'tv', 'wardrobe', 'rug', 'plant',
  'chair-dining', 'chair-office', 'chair-armchair', 'ottoman',
  'bed-single', 'bed-double',
  'desk-standard', 'desk-l', 'coffee-table', 'side-table', 'nightstand',
  'lamp-floor', 'lamp-table', 'lamp-pendant',
  'mirror', 'mirror-oval', 'painting', 'ac-unit',
  'monitor', 'laptop', 'fan', 'fridge', 'curtain',
  'bookshelf', 'door',
  'soundbar', 'radiator', 'air-purifier', 'washing-machine', 'microwave', 'water-dispenser',
];

const ALL_CATEGORIES: Category[] = [
  'sofa', 'tv', 'chair', 'table', 'lamp', 'plant', 'shelf', 'rug',
  'bed', 'desk', 'monitor', 'fan', 'fridge', 'wardrobe', 'curtain',
  'mirror', 'painting', 'nightstand', 'ottoman', 'ac', 'door',
  'other',
];

export type RegenerateResult = {
  shape: Shape;
  category: Category;
  name: string;
  dimMM: [number, number, number];
};

/** Send label + user's freeform prompt + optional reference image to Gemini.
 *  Forces JSON-shaped output constrained to our known shapes. */
export async function regenerateShape(
  apiKey: string,
  current: ScenePart,
  userPrompt: string,
  referenceImage?: { mime: string; base64: string },
): Promise<RegenerateResult> {
  if (!apiKey) throw new Error('NO_KEY');

  const ai = new GoogleGenAI({ apiKey });

  const instruction = `Map the user's request to ONE shape from our catalog and refine its real-world dimensions in millimetres.

Current part: name="${current.name}", category="${current.category}", shape="${current.shape}", dim=[${current.dimMM.join(',')}] mm

User wants: "${userPrompt}"

Available shapes (pick exactly one):
${ALL_SHAPES.join(', ')}

Available categories:
${ALL_CATEGORIES.join(', ')}

Respond with JSON:
{
  "shape": one of available shapes,
  "category": one of available categories,
  "name": short noun phrase, no slot suffix,
  "dimMM": [W, D, H] in millimetres, sensible real-world size
}

Pick the closest matching shape — never invent new ones. If nothing fits, use "box" as a fallback (but try harder first). Output JSON only, no prose.`;

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: instruction },
  ];
  if (referenceImage) {
    parts.push({ text: '--- REFERENCE IMAGE ---' });
    parts.push({ inlineData: { mimeType: referenceImage.mime, data: referenceImage.base64 } });
  }

  // Cache key on (label + category + prompt). Reference image bypasses cache.
  const cacheKey = referenceImage
    ? null
    : `regen:${current.category}:${current.name.toLowerCase().trim()}:${userPrompt.toLowerCase().trim()}`;
  if (cacheKey) {
    const hit = readCache(cacheKey);
    if (hit) return hit;
  }

  useQuota.getState().bump('flash-lite');
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: [{ role: 'user', parts }],
  });

  const raw = res.text ?? '{}';
  // flash-lite sometimes wraps JSON in ```json fences. Extract the first {...} block.
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const text = jsonMatch ? jsonMatch[0] : raw;
  let parsed: RegenerateResult;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned malformed JSON: ${raw.slice(0, 200)}`);
  }

  // Validate
  if (!ALL_SHAPES.includes(parsed.shape)) parsed.shape = 'box';
  if (!ALL_CATEGORIES.includes(parsed.category)) parsed.category = 'other';
  if (
    !Array.isArray(parsed.dimMM) ||
    parsed.dimMM.length !== 3 ||
    parsed.dimMM.some((n) => typeof n !== 'number' || n < 50 || n > 5000)
  ) {
    parsed.dimMM = current.dimMM;
  }
  if (!parsed.name || typeof parsed.name !== 'string') parsed.name = current.name;

  if (cacheKey) writeCache(cacheKey, parsed);
  return parsed;
}

function readCache(key: string): RegenerateResult | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeCache(key: string, value: RegenerateResult) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota issues
  }
}

export async function blobToBase64Raw(blob: Blob): Promise<{ mime: string; base64: string }> {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const [head, body] = dataUrl.split(',');
      const mimeMatch = head.match(/data:([^;]+)/);
      resolve({ mime: mimeMatch?.[1] ?? 'image/jpeg', base64: body });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
