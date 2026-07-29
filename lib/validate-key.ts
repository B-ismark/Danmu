'use client';

// Lightweight Gemini key check — one tiny flash call. Used by Settings only.
// Lives standalone so Settings doesn't pull in any feature lib.

import { GoogleGenAI } from '@google/genai';

/** Why a code and not the exception text: every failure used to collapse into
 *  "invalid", so a good key on a flaky connection told the user to replace it —
 *  and the raw message was printed into the UI, which could echo the provider's
 *  request URL (model id included) onto a screen that must not carry AI model
 *  names. Settings maps these codes to authored copy. */
export type KeyFailure = 'empty' | 'bad-key' | 'offline' | 'rate-limited' | 'unknown';

export type KeyResult = { ok: true } | { ok: false; reason: KeyFailure };

function classify(e: unknown): KeyFailure {
  // Offline is knowable without guessing at the error text.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';

  const status = (e as { status?: number })?.status;
  if (status === 401 || status === 403 || status === 400) return 'bad-key';
  if (status === 429) return 'rate-limited';

  const msg = e instanceof Error ? e.message : String(e);
  if (/API key not valid|invalid.*api.?key|unauthenticated|permission denied/i.test(msg)) return 'bad-key';
  if (/quota|rate limit|429|too many requests|resource.?exhausted/i.test(msg)) return 'rate-limited';
  // A fetch that never reached the API reads as a transport problem, not a bad
  // key — the distinction is the whole point of this function.
  if (/failed to fetch|network|ENOTFOUND|ECONNREFUSED|timeout|aborted/i.test(msg)) return 'offline';
  return 'unknown';
}

export async function validateKey(apiKey: string): Promise<KeyResult> {
  if (!apiKey) return { ok: false, reason: 'empty' };
  try {
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'ping' });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: classify(e) };
  }
}
