'use client';

import { GoogleGenAI } from '@google/genai';
import { useQuota } from './quota';

// Two render paths:
//   PAID  — Imagen 4 via generateImages (requires Google Cloud billing on the user's project)
//   FREE  — Gemini 2.5 Flash Image (Nano Banana) via generateContent (works on free tier)
// Both go browser → Google directly. We auto-fall-back to FREE when Imagen returns a paid-plan error.

export type ImagenModel =
  | 'imagen-4.0-generate-001'
  | 'imagen-4.0-ultra-generate-001'
  | 'imagen-3.0-generate-002'
  | 'gemini-2.5-flash-image'
  | 'gemini-2.0-flash-exp';

export type ObjectRef = {
  /** human label, fed to the prompt enumeration */
  label: string;
  /** cropped object PNG, raw base64 (no data: prefix) */
  pngBase64: string;
  mime?: string;
  /** original normalized bbox in the base image */
  srcBox: [number, number, number, number];
  /** target normalized bbox if moved. Undefined → user didn't move; keep in srcBox. */
  dstBox?: [number, number, number, number];
  /** user flagged for removal — don't place anywhere, just inpaint srcBox. */
  removed?: boolean;
  /** user wants this preserved as-is. */
  locked?: boolean;
};

export type RenderRequest = {
  prompt: string;
  model: ImagenModel;
  aspectRatio?: '1:1' | '16:9' | '4:3' | '3:4' | '9:16';
  numberOfImages?: number;
  /** base capture as raw base64 (no data: prefix) — model uses as reference for geometry + locks */
  basePngBase64?: string;
  /** mask PNG raw base64 — see lib/mask.ts buildEditMask for semantics */
  maskPngBase64?: string;
  baseMime?: string;
  /** Per-object reference crops + actions. Enables identity preservation across moves. */
  objectRefs?: ObjectRef[];
  seed?: number;
};

export type RenderResult = {
  variants: Array<{ pngBase64: string; mimeType: string }>;
  costPerVariantUsd: number;
  /** which model actually produced these (after any auto-fallback). String, not
   *  ImagenModel, so non-Google providers (e.g. HF FLUX) can report their id. */
  modelUsed: string;
};

const COST_PER_VARIANT_USD: Record<ImagenModel, number> = {
  'imagen-4.0-generate-001': 0.04,
  'imagen-4.0-ultra-generate-001': 0.06,
  'imagen-3.0-generate-002': 0.04,
  'gemini-2.5-flash-image': 0.039, // Nano Banana image output is billed (~$0.039/img); free tier = 0 quota
  'gemini-2.0-flash-exp': 0, // experimental — free while in Google preview; may start billing
};

function client(apiKey: string) {
  if (!apiKey) throw new ImagenError('NO_KEY', 'Add your Google API key in Settings.');
  return new GoogleGenAI({ apiKey });
}

export class ImagenError extends Error {
  constructor(
    public code:
      | 'NO_KEY'
      | 'INVALID_KEY'
      | 'SAFETY'
      | 'RATE_LIMIT'
      | 'DAILY_QUOTA'
      | 'PAID_PLAN_REQUIRED'
      | 'IMAGE_QUOTA_ZERO'
      | 'OFFLINE'
      | 'UNKNOWN',
    message: string,
    public detail?: unknown,
    /** Seconds Google told us to wait (parsed from the 429 retryDelay), if any. */
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

// Google's 429 body carries the exact cooldown, e.g. {"retryDelay":"43s"}.
// Honoring it beats our blind fixed backoff — a per-minute cap won't clear in
// less than the window, so guessing short just burns more quota.
function parseRetryDelaySec(msg: string): number | undefined {
  const m = msg.match(/retryDelay["':\s]+(\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.ceil(Number(m[1])) : undefined;
}

function classifyError(e: unknown): ImagenError {
  if (e instanceof ImagenError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  // Offline / network-down: a dropped connection throws "Failed to fetch" with
  // no useful body. If the browser also reports offline, say so plainly.
  if (
    (typeof navigator !== 'undefined' && !navigator.onLine) ||
    /failed to fetch|networkerror|err_internet|err_network| enotfound|fetch failed/i.test(msg)
  )
    return new ImagenError('OFFLINE', 'No internet connection. Reconnect and try again.', e);
  if (/paid plan|billing|upgrade your account/i.test(msg))
    return new ImagenError('PAID_PLAN_REQUIRED', 'Imagen requires Google Cloud billing.', e);
  if (/API_KEY_INVALID|invalid api key/i.test(msg))
    return new ImagenError('INVALID_KEY', 'Google rejected your key.', e);
  // Daily-quota messages mention RPD or a "...PerDay" quota metric id.
  if (/per[\s_]?day|RPD|requests per day|daily limit/i.test(msg))
    return new ImagenError('DAILY_QUOTA', 'Free-tier daily quota (100 calls) exhausted. Resets at Pacific midnight.', e);
  if (/abort/i.test(msg))
    return new ImagenError('UNKNOWN', 'Render was cancelled after stalling for 90s — the model never responded. Try again, or check that image generation is enabled on your API key.', e);
  // Free tier returns `limit: 0` for image generation — it's simply not included
  // for this model on a no-billing key. Retrying never helps; needs Cloud billing.
  if (/limit:\s*0/i.test(msg))
    return new ImagenError('IMAGE_QUOTA_ZERO', 'Image generation is not in your key’s free tier (quota = 0). Enable billing on your Google Cloud project.', e);
  if (/quota|RESOURCE_EXHAUSTED|429|rate/i.test(msg))
    return new ImagenError('RATE_LIMIT', 'Hit per-minute ceiling (~10 RPM on free).', e, parseRetryDelaySec(msg));
  if (/SAFETY|blocked/i.test(msg))
    return new ImagenError('SAFETY', 'Imagen safety filter blocked the prompt.', e);
  return new ImagenError('UNKNOWN', msg, e);
}

// ─── PAID path: Imagen 4 ──────────────────────────────────────────────────
async function renderImagen(apiKey: string, req: RenderRequest): Promise<RenderResult> {
  const ai = client(apiKey);
  const res = await withTimeout(
    withConnectivity(
      ai.models.generateImages({
        model: req.model,
        prompt: req.prompt,
        config: {
          numberOfImages: req.numberOfImages ?? 3,
          aspectRatio: req.aspectRatio ?? '4:3',
          // Steer Imagen away from the CGI/3D-render look toward a real photo.
          negativePrompt:
            '3D render, CGI, architectural visualization, Blender, Unreal Engine, Octane render, video-game graphics, plastic surfaces, waxy materials, over-smooth geometry, cartoon, cel shading, flat lighting, low detail',
        },
      }),
    ),
    50_000,
  );
  const variants =
    res.generatedImages?.map((g) => ({
      pngBase64: g.image?.imageBytes ?? '',
      mimeType: g.image?.mimeType ?? 'image/png',
    })) ?? [];
  if (variants.length === 0) {
    throw new ImagenError('SAFETY', 'No images returned. Likely safety filter.', res);
  }
  return { variants, costPerVariantUsd: COST_PER_VARIANT_USD[req.model], modelUsed: req.model };
}

// ─── FREE path: Gemini 2.5 Flash Image ────────────────────────────────────
// Free tier ~10 RPM. We throttle 1.5s between variant calls and auto-retry 429
// with exponential backoff up to 3 attempts. When a base image + mask are present,
// the model receives them as reference inputs and is instructed to preserve the
// masked regions — closest free-tier equivalent of Imagen Edit.
async function renderFree(apiKey: string, req: RenderRequest): Promise<RenderResult> {
  const ai = client(apiKey);
  const variants: RenderResult['variants'] = [];
  const n = req.numberOfImages ?? 1;
  const hasReference = !!(req.basePngBase64 && req.maskPngBase64);
  const refs = req.objectRefs ?? [];

  const moved = refs.filter((r) => r.dstBox && !r.removed);
  const removed = refs.filter((r) => r.removed);
  const locked = refs.filter((r) => r.locked && !r.dstBox && !r.removed);

  // Hardened preservation language. WHITE = preserve, MID-GRAY = place here,
  // BLACK = inpaint / free. We enumerate moves so the model can reason about
  // identity-preserving relocation. fmtBox emits "(x=12%, y=58%, w=20%, h=35%)"
  // — keeps coordinates explicit so the model knows where to put things.
  const fmtBox = (b: [number, number, number, number]) =>
    `(x=${(b[0] * 100).toFixed(0)}%, y=${(b[1] * 100).toFixed(0)}%, w=${(b[2] * 100).toFixed(0)}%, h=${(b[3] * 100).toFixed(0)}%)`;

  const editClauses: string[] = [];
  if (locked.length)
    editClauses.push(
      `KEEP UNCHANGED — do NOT alter, restyle, recolor, reposition, or reshape these objects in any way; reproduce them pixel-faithfully: ${locked.map((r) => `${r.label} ${fmtBox(r.srcBox)}`).join('; ')}.`,
    );
  if (moved.length)
    editClauses.push(
      `RELOCATE — for each item, REMOVE it from its source box and re-place the SAME OBJECT at the target box, preserving its identity (shape, color, material, scale) but adapting perspective and lighting to the new location. A cropped reference photo is included for each one: ${moved
        .map((r) => `${r.label}: from ${fmtBox(r.srcBox)} → to ${fmtBox(r.dstBox!)}`)
        .join('; ')}.`,
    );
  if (removed.length)
    editClauses.push(
      `REMOVE entirely and inpaint the underlying wall / floor / background as if these objects never existed: ${removed.map((r) => `${r.label} ${fmtBox(r.srcBox)}`).join('; ')}.`,
    );

  const fullPrompt = hasReference
    ? `${req.prompt}

REFERENCE IMAGES PROVIDED:
1. Original room photo (the scene to edit)
2. Edit mask:
   - WHITE pixels MUST appear pixel-faithful in the output (do not change).
   - MID-GRAY pixels mark where a named object should be placed (use the per-object reference crops below).
   - BLACK pixels are free to regenerate (inpaint background, restyle as the prompt asks).
${refs.length ? `3. Per-object reference crops (one image each) — these define the IDENTITY of moved/preserved objects.\n` : ''}
${editClauses.join('\n\n')}

Finally, render the rest of the room according to the style/budget tokens in the prompt above, while honoring every constraint here. Output a single photorealistic image.`
    : req.prompt;

  for (let i = 0; i < n; i++) {
    if (i > 0) await sleep(1500);
    useQuota.getState().bump('flash-image');
    const got = await callFreeWithRetry(ai, fullPrompt, req);
    variants.push(...got);
  }

  if (variants.length === 0) {
    throw new ImagenError('SAFETY', 'Gemini returned no image. Likely safety filter or prompt issue.');
  }
  return {
    variants,
    costPerVariantUsd: COST_PER_VARIANT_USD[req.model] ?? 0,
    modelUsed: req.model,
  };
}

type GeminiContentPart = {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
};

// ─── Client-side pacing ───────────────────────────────────────────────────
// Free tier is ~10 RPM on Gemini Flash Image. Serialize every image call
// (across variants, retries, and back-to-back render requests in this tab) and
// hold >=6.5s between them so we self-throttle under the cap instead of
// bursting into a 429. Module-level singleton — one queue per browser tab.
const MIN_CALL_GAP_MS = 6500;
let lastCallAt = 0;
let pacingChain: Promise<unknown> = Promise.resolve();
function paced<T>(fn: () => Promise<T>): Promise<T> {
  // Enforce minimum gap between call STARTS (not ends). pacingChain resolves as
  // soon as the gap is satisfied — it does NOT include fn()'s completion time.
  // Old design tracked fn() itself: a hung fn() (network stall, model hang)
  // blocked pacingChain forever, so every retry after a timeout also timed out
  // while stuck in the queue rather than making a real API call.
  const gapDone = pacingChain.then(async () => {
    const wait = lastCallAt + MIN_CALL_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  });
  pacingChain = gapDone.then(() => undefined, () => undefined);
  return gapDone.then(() => fn());
}

async function callFreeWithRetry(
  ai: GoogleGenAI,
  prompt: string,
  req: RenderRequest,
  attempt = 0,
): Promise<RenderResult['variants']> {
  try {
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: prompt }];
    // Base image attaches whenever present (photo edit OR 3D-blockout reimagine).
    // Mask is optional — only the photo-edit path provides one.
    if (req.basePngBase64) {
      parts.push({ inlineData: { mimeType: req.baseMime ?? 'image/jpeg', data: req.basePngBase64 } });
      if (req.maskPngBase64) {
        parts.push({ inlineData: { mimeType: 'image/png', data: req.maskPngBase64 } });
      }
    }
    // Per-object reference crops — one inlineData each. Labels are already in the prompt.
    for (const ref of req.objectRefs ?? []) {
      parts.push({ inlineData: { mimeType: ref.mime ?? 'image/png', data: ref.pngBase64 } });
    }
    const res = await withTimeout(
      withConnectivity(
        paced(() =>
          ai.models.generateContent({
            model: req.model,
            contents: [{ role: 'user', parts }],
            // REQUIRED for image output: without responseModalities the call
            // comes back text-only. imageConfig sets output aspect ratio
            // (@google/genai >= 2.x).
            config: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: req.aspectRatio ?? '4:3' },
            },
          }),
        ),
      ),
      50_000,
    );
    const out: RenderResult['variants'] = [];
    const cands = res.candidates ?? [];
    for (const c of cands) {
      const parts = (c.content?.parts ?? []) as GeminiContentPart[];
      for (const p of parts) {
        const inline = p.inlineData;
        if (inline?.data) {
          out.push({ pngBase64: inline.data, mimeType: inline.mimeType ?? 'image/png' });
        }
      }
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const is429 = /quota|RESOURCE_EXHAUSTED|429|rate/i.test(msg);
    const isDaily = /per[\s_]?day|RPD|requests per day|daily limit/i.test(msg);
    const isZeroQuota = /limit:\s*0/i.test(msg);
    // Daily quota or a hard 0-limit — retrying is pointless, surface immediately.
    if (isDaily || isZeroQuota) throw e;
    if (is429) {
      // A per-minute cap won't clear in less than its window. If Google's
      // retryDelay says we'd have to wait longer than we're willing to block
      // inline (or it's the last attempt), stop — auto-retrying just burns more
      // quota and delays the accurate "wait Ns" message to the user.
      const wait = parseRetryDelaySec(msg);
      if (attempt < 2 && (wait === undefined || wait <= 20)) {
        await sleep((wait ?? 6 * Math.pow(2, attempt)) * 1000);
        return callFreeWithRetry(ai, prompt, req, attempt + 1);
      }
    }
    throw e;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Guard against a hung request spinning the loader forever. The SDK call won't
// truly cancel, but rejecting surfaces a readable error instead of an infinite
// "Generating…". 120s comfortably covers a slow image-edit generation.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new ImagenError('UNKNOWN', `Gemini didn't respond within ${Math.round(ms / 1000)}s — timed out. The model may be slow or overloaded. Try again.`)),
        ms,
      ),
    ),
  ]);
}

// Connectivity guard: fail fast on a dropped connection instead of waiting out
// the 120s timeout. Pre-checks navigator.onLine, then races the request against
// the browser's `offline` event so a mid-render disconnect rejects immediately.
function withConnectivity<T>(p: Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.reject(new ImagenError('OFFLINE', 'No internet connection. Reconnect and try again.'));
  }
  if (typeof window === 'undefined') return p;
  return new Promise<T>((resolve, reject) => {
    const onOffline = () =>
      reject(new ImagenError('OFFLINE', 'Lost your internet connection mid-render. Reconnect and try again.'));
    window.addEventListener('offline', onOffline);
    p.then(resolve, reject).finally(() => window.removeEventListener('offline', onOffline));
  });
}

// ─── Public entry — auto-fallback when paid plan unavailable ──────────────
export async function renderRoom(apiKey: string, req: RenderRequest): Promise<RenderResult> {
  const isFreeModel = req.model === 'gemini-2.5-flash-image' || req.model === 'gemini-2.0-flash-exp';
  if (isFreeModel) {
    try {
      return await renderFree(apiKey, req);
    } catch (e) {
      throw classifyError(e);
    }
  }
  // try paid first
  try {
    return await renderImagen(apiKey, req);
  } catch (e) {
    const classified = classifyError(e);
    if (classified.code === 'PAID_PLAN_REQUIRED') {
      // auto-fall-back to free
      try {
        const r = await renderFree(apiKey, { ...req, model: 'gemini-2.5-flash-image' });
        return r;
      } catch (e2) {
        throw classifyError(e2);
      }
    }
    throw classified;
  }
}

export async function validateKey(apiKey: string): Promise<{ ok: boolean; reason?: string }> {
  if (!apiKey) return { ok: false, reason: 'empty' };
  try {
    const ai = client(apiKey);
    await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'ping' });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function compositePreserve(
  generatedPngBase64: string,
  basePngBase64: string,
  maskPngBase64: string,
): Promise<Blob> {
  const [gen, base, mask] = await Promise.all([
    base64ToImage(generatedPngBase64),
    base64ToImage(basePngBase64),
    base64ToImage(maskPngBase64),
  ]);
  const w = gen.naturalWidth || gen.width;
  const h = gen.naturalHeight || gen.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(gen, 0, 0, w, h);
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d')!;
  tctx.drawImage(base, 0, 0, w, h);
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(mask, 0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);
  return new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}

function base64ToImage(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  });
}
