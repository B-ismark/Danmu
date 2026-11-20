// @vitest-environment jsdom
//
// `@google/genai` 3 changed its default API version from `v1beta` to `v1`. Both
// requests this app sends with the user's key were built against `v1beta`, so
// the version is pinned in `lib/gemini-client.ts`. This holds BOTH callers to
// it by recording what the SDK is actually constructed with — not by reading
// the source — so a caller that goes back to `new GoogleGenAI({ apiKey })`
// fails here rather than silently moving to another API version on the next
// SDK release.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const built: Array<Record<string, unknown>> = [];
const sent: Array<Record<string, unknown>> = [];

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (req: Record<string, unknown>) => {
        sent.push(req);
        return { text: '[]' };
      },
    };
    constructor(opts: Record<string, unknown>) {
      built.push(opts);
    }
  },
}));

import { GEMINI_API_VERSION } from '@/lib/gemini-client';
import { validateKey } from '@/lib/validate-key';
import { detectAcrossImages } from '@/lib/detection';

beforeEach(() => {
  built.length = 0;
  sent.length = 0;
});

describe('Gemini client', () => {
  it('is pinned to v1beta, the version every request here was written for', () => {
    expect(GEMINI_API_VERSION).toBe('v1beta');
  });

  it('the Settings key check builds its client on the pinned version', async () => {
    expect(await validateKey('test-key')).toEqual({ ok: true });
    expect(built).toEqual([{ apiKey: 'test-key', apiVersion: 'v1beta' }]);
  });

  it('photo detection builds its client on the pinned version and still asks for JSON', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    const out = await detectAcrossImages('test-key', [{ slot: 'n', blob }]);
    expect(out.rows).toEqual([]);
    expect(built).toEqual([{ apiKey: 'test-key', apiVersion: 'v1beta' }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].config).toEqual({ responseMimeType: 'application/json' });
  });
});
