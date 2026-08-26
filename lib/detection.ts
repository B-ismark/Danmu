'use client';

import { GoogleGenAI } from '@google/genai';
import { useQuota } from './quota';
import { buildDetectPrompt, type PromptRoom } from './detect-prompt';
import type { DetectSource } from './detect-confidence';
import type { CaptureSlot } from './storage';

// Re-exported because callers name the room, not the prompt. The builder itself
// lives in lib/detect-prompt.ts, where it can be tested without the Gemini SDK.
export type { PromptRoom };

// Detect furniture / fixtures across ALL 4 wall photos in a single Gemini call.
// Letting the model see all 4 simultaneously lets it reason about object continuity
// (e.g. "this curtain in N is the same one partially seen in W") and avoid mis-classifying
// partially-visible objects.

export type Detection = {
  /** Stable key for this detection, minted on the detect screen and persisted as
   *  `detectedObjects[].uid`. It becomes the ScenePart id, so a user's transforms
   *  survive a re-detect. Absent until the detection is first saved. */
  uid?: string;
  label: string;
  /** Confidence, on a scale that depends entirely on `source` — a class score, an
   *  LLM's opinion of itself, or a literal 1 meaning "the user drew this". Never
   *  compare it against a bare number; `shouldAutoConfirm` knows which scale it is
   *  on. See lib/detect-confidence.ts. */
  conf: number;
  /** Who produced this detection. Absent on rooms saved before the field existed,
   *  which were all the cloud path — see `sourceOf`. */
  source?: DetectSource;
  /** [x, y, w, h] normalized 0..1 within the image of `slot` */
  box: [number, number, number, number];
  category: 'sofa' | 'tv' | 'chair' | 'table' | 'lamp' | 'plant' | 'shelf' | 'rug' | 'bed' | 'desk' | 'curtain' | 'fan' | 'monitor' | 'fridge' | 'wardrobe' | 'mirror' | 'painting' | 'nightstand' | 'ottoman' | 'ac' | 'door' | 'other';
  slot: CaptureSlot;
  /** AI-estimated real-world dimensions in mm [W, D, H]. Optional — falls back to category default. */
  dimMM?: [number, number, number];
  /** AI-estimated 3D placement in the room. All in METERS, room-centered.
   *  Origin is room center floor; +X right, +Y up, +Z toward viewer when standing in N.
   *  Optional — when missing, scene-spec snaps to the wall implied by `slot`. */
  position?: { x: number; y: number; z: number };
  /** AI-estimated yaw rotation in radians around vertical axis. */
  yaw?: number;
  /** AI-picked shape from our catalog. If missing or unknown, we fall back to refineShape() heuristic. */
  shape?: string;
  /** Dominant colour as a #rrggbb hex. Used as a fallback when client-side pixel
   *  sampling of the photo fails (occluded / tiny region). See lib/color-sample.ts. */
  color?: string;
  /** Stable perceptual-hash key into the local mesh cache (lib/mesh-cache.ts).
   *  When set, 3D scene loads the cached GLB instead of the primitive shape. */
  meshHash?: string;
};


export class DetectError extends Error {
  constructor(
    public code:
      | 'NO_KEY'
      | 'INVALID_KEY'
      | 'DAILY_QUOTA'
      | 'RATE_LIMIT'
      | 'PHOTOS_TOO_BIG'
      | 'BAD_RESPONSE'
      | 'UNKNOWN',
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

/** Ceiling on the inline request body. The endpoint refuses somewhere around
 *  20 MB of total inline data; we stop short of it so the failure is ours and
 *  nameable rather than an opaque transport error. Photos are downscaled on
 *  ingest (lib/capture.ts), so hitting this means something unusual — a very
 *  wide panorama, or captures saved before downscaling shipped. */
const MAX_INLINE_BYTES = 16 * 1024 * 1024;

function classifyDetect(e: unknown): DetectError {
  if (e instanceof DetectError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/API_KEY_INVALID|invalid api key/i.test(msg))
    return new DetectError('INVALID_KEY', 'Google rejected your key.', e);
  if (/per day|RPD|requests per day|exceeded your current quota|daily limit|generate_content_free_tier_requests/i.test(msg))
    return new DetectError(
      'DAILY_QUOTA',
      'Free-tier daily detection quota exhausted. Resets at Pacific midnight, or enable Cloud billing.',
      e,
    );
  if (/quota|RESOURCE_EXHAUSTED|429|rate/i.test(msg))
    return new DetectError('RATE_LIMIT', 'Hit per-minute detection rate limit.', e);
  return new DetectError('UNKNOWN', msg, e);
}

const PRIMARY_MODEL = 'gemini-2.5-flash';
// flash-lite shares its own daily quota with regenerate / improve-batch.
// Auto-falling back to it when flash exhausts double-burns. Surface the error instead.

const DEFAULT_PROMPT_ROOM: PromptRoom = { width: 5.6, depth: 4.2, height: 2.8, layoutId: 'rect' };

export async function detectAcrossImages(
  apiKey: string,
  images: { slot: CaptureSlot; blob: Blob }[],
  room: PromptRoom = DEFAULT_PROMPT_ROOM,
): Promise<Detection[]> {
  if (!apiKey) throw new DetectError('NO_KEY', 'Add your Google API key in Settings.');
  if (images.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildDetectPrompt(room, images.map((i) => i.slot));

  // Base64 inflates by 4/3, so check the encoded size — the raw byte total was
  // never the limit that mattered. Four untouched 12 MP phone photos are 12-20 MB
  // raw and 16-27 MB encoded, which used to sail past this point and come back as
  // a transport error the classifier could only call UNKNOWN. The detect screen
  // then told the user "trying again often works", which it never did.
  const rawBytes = images.reduce((n, img) => n + img.blob.size, 0);
  if (Math.ceil((rawBytes / 3) * 4) > MAX_INLINE_BYTES) {
    throw new DetectError(
      'PHOTOS_TOO_BIG',
      'These photos are too large to send in one request.',
      { rawBytes },
    );
  }

  const labeled = await Promise.all(
    images.map(async (img) => {
      const data = await blobToBase64(img.blob);
      return { slot: img.slot, mime: img.blob.type || 'image/jpeg', data };
    }),
  );

  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: prompt }];
  for (const img of labeled) {
    parts.push({ text: `--- ${img.slot.toUpperCase()} WALL ---` });
    parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
  }

  async function call(model: string) {
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: { responseMimeType: 'application/json' },
    });
    return res.text ?? '[]';
  }

  let text: string;
  try {
    useQuota.getState().bump('flash');
    text = await call(PRIMARY_MODEL);
  } catch (e) {
    throw classifyDetect(e);
  }

  // A body we cannot parse is NOT an empty room. Returning [] here made the
  // detect screen show its "All clear — nothing stood out in your photos, which
  // is exactly right for an empty room" notice after a malformed response, having
  // already spent the quota. Throw so the error path (which offers Retry) owns it.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new DetectError('BAD_RESPONSE', 'The detection service replied with something unreadable.', e);
  }
  if (!Array.isArray(parsed)) {
    throw new DetectError('BAD_RESPONSE', 'The detection service replied in an unexpected shape.', parsed);
  }
  // NOT deduped here. Merging two detections is a decision about what EXISTS,
  // and it used to be taken on the model's own guessed `position` — the exact
  // numbers the geometry pass then overwrote. It now runs in lib/detect-refine.ts
  // AFTER refinement, which also means the on-device path gets it too.
  return (parsed as Detection[])
    .filter((d) => d.box && d.box.length === 4 && d.slot)
    // Stamped here rather than at the call site, so the one function that talks to
    // Gemini is the one function that can claim its output came from Gemini.
    .map((d) => ({ ...d, source: 'cloud' as const }));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const r = reader.result as string;
      resolve(r.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

