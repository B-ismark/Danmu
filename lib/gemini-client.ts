// The one place the optional cloud detector's client is built.
//
// `@google/genai` 3 moved its default Gemini Developer API version from `v1beta`
// to `v1`. Every request this app has ever sent — JSON-mode detection and the
// Settings key check — was written and measured against `v1beta`, and some
// models and config fields exist only there. So the version is pinned here,
// rather than inherited from whichever SDK release is installed: an SDK bump
// should never quietly change what goes over the wire with the user's own key.
// Both callers (`detection.ts`, `validate-key.ts`) build through this, and
// `tests/gemini-client.test.ts` holds them to it.
import { GoogleGenAI } from '@google/genai';

export const GEMINI_API_VERSION = 'v1beta';

export function geminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey, apiVersion: GEMINI_API_VERSION });
}
