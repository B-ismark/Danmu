'use client';

// Batch upgrade — for parts whose shape landed as 'box' (catalog miss),
// send all their labels in ONE Gemini call → get back a shape map → apply to scene.
// Keeps quota cost predictable: 1 request regardless of how many generics.

import { GoogleGenAI } from '@google/genai';
import { useQuota } from './quota';
import type { Shape, ScenePart } from './scene-spec';

const SHAPES: Shape[] = [
  'sofa', 'tv', 'wardrobe', 'rug', 'plant',
  'chair-dining', 'chair-office', 'chair-armchair', 'ottoman',
  'bed-single', 'bed-double',
  'desk-standard', 'desk-l', 'coffee-table', 'side-table', 'nightstand',
  'lamp-floor', 'lamp-table', 'lamp-pendant',
  'mirror', 'painting', 'ac-unit',
  'monitor', 'fan', 'fridge', 'curtain',
  'bookshelf', 'door',
];

export type ImproveItem = {
  id: string;
  name: string;
  category: string;
  dimMM: [number, number, number];
};

export type ImproveResult = {
  id: string;
  shape: Shape;
  dimMM: [number, number, number];
};

export async function improveBatch(apiKey: string, items: ImproveItem[]): Promise<ImproveResult[]> {
  if (!apiKey) throw new Error('NO_KEY');
  if (items.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `For each item below, pick the closest matching 3D shape from our catalog and refine its dimensions in mm.

Catalog (pick ONE per item, never invent):
${SHAPES.join(', ')}

If nothing matches, use "box" (last resort).

Items:
${items.map((it, i) => `${i + 1}. id="${it.id}" name="${it.name}" category="${it.category}" currentDim=[${it.dimMM.join(',')}]`).join('\n')}

Respond with a JSON array, one entry per item, in the same order:
[ { "id": "...", "shape": "...", "dimMM": [W, D, H] }, ... ]

Output JSON ONLY. No prose. No markdown fences.`;

  useQuota.getState().bump('flash-lite');
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
  });
  const raw = res.text ?? '[]';
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  const text = arrMatch ? arrMatch[0] : raw;
  let parsed: ImproveResult[];
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned malformed JSON: ${raw.slice(0, 200)}`);
  }

  return parsed
    .map((r) => {
      const item = items.find((it) => it.id === r.id);
      if (!item) return null;
      const shape: Shape = SHAPES.includes(r.shape) ? r.shape : 'box';
      const dim =
        Array.isArray(r.dimMM) && r.dimMM.length === 3 && r.dimMM.every((n) => n >= 50 && n <= 5000)
          ? (r.dimMM as [number, number, number])
          : item.dimMM;
      return { id: r.id, shape, dimMM: dim };
    })
    .filter((x): x is ImproveResult => x !== null);
}

export function genericParts(parts: ScenePart[]): ScenePart[] {
  return parts.filter((p) => p.shape === 'box');
}
