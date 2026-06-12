'use client';

// Lightweight Gemini key check — one tiny flash call. Used by Settings only.
// Lives standalone so Settings doesn't pull in any feature lib.

import { GoogleGenAI } from '@google/genai';

export async function validateKey(apiKey: string): Promise<{ ok: boolean; reason?: string }> {
  if (!apiKey) return { ok: false, reason: 'empty' };
  try {
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'ping' });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'unknown' };
  }
}
