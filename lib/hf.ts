'use client';

// Hugging Face FLUX render path. Browser-direct via the HF Inference Providers
// router (CORS-enabled). BYO HF token (Inference Providers permission). Two modes:
//   • base image present → image-to-image (FLUX.1-Kontext-dev) — preserves the
//     arranged layout, ~$0.03/img.
//   • no base → text-to-image (FLUX.1-schnell) — ~$0.003/img, generic layout.
// HF gives ~$0.10/month free Inference-Provider credit, so the first renders are
// effectively free; after that it bills (still far cheaper than Imagen for t2i).

import { InferenceClient } from '@huggingface/inference';
import { ImagenError, type RenderRequest, type RenderResult } from './imagen';

const I2I_MODEL = 'black-forest-labs/FLUX.1-Kontext-dev';
const T2I_MODEL = 'black-forest-labs/FLUX.1-schnell';

const HF_TIMEOUT_MS = 42_000;

function hfTimeout(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(
      () => reject(new ImagenError('UNKNOWN', `The image service didn't respond in ${HF_TIMEOUT_MS / 1000}s — it may be busy. Try again in a moment.`)),
      HF_TIMEOUT_MS,
    ),
  );
}

export async function renderHF(token: string, req: RenderRequest): Promise<RenderResult> {
  if (!token)
    throw new ImagenError('UNKNOWN', 'Add your Hugging Face token in Settings to use the HF FLUX model.');
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    throw new ImagenError('OFFLINE', 'No internet connection. Reconnect and try again.');

  const client = new InferenceClient(token);
  const n = req.numberOfImages ?? 1;
  const hasBase = !!req.basePngBase64;
  const variants: RenderResult['variants'] = [];

  try {
    for (let i = 0; i < n; i++) {
      if (i > 0) await sleep(1200);
      const call: Promise<Blob | string> = hasBase
        ? client.imageToImage({
            provider: 'auto',
            model: I2I_MODEL,
            inputs: b64ToBlob(req.basePngBase64!, req.baseMime ?? 'image/jpeg'),
            parameters: { prompt: req.prompt, num_inference_steps: 20 },
          })
        : client.textToImage({ provider: 'auto', model: T2I_MODEL, inputs: req.prompt });
      const out = await Promise.race([call, hfTimeout()]);
      const blob: Blob =
        out instanceof Blob ? out : b64ToBlob(out.includes(',') ? out.split(',')[1] : out, 'image/png');
      variants.push({ pngBase64: await blobToB64(blob), mimeType: blob.type || 'image/png' });
    }
  } catch (e) {
    throw classifyHF(e);
  }

  if (variants.length === 0)
    throw new ImagenError('UNKNOWN', 'Hugging Face returned no image. Try again.');
  return {
    variants,
    costPerVariantUsd: hasBase ? 0.03 : 0.003,
    modelUsed: hasBase ? I2I_MODEL : T2I_MODEL,
  };
}

function classifyHF(e: unknown): ImagenError {
  if (e instanceof ImagenError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|err_internet|err_network|fetch failed/i.test(msg) ||
      (typeof navigator !== 'undefined' && !navigator.onLine))
    return new ImagenError('OFFLINE', 'No internet connection. Reconnect and try again.', e);
  if (/401|unauthor|invalid.*token|invalid credentials/i.test(msg))
    return new ImagenError('UNKNOWN', 'Hugging Face rejected your token. Check it in Settings (needs “Inference Providers” permission).', e);
  if (/402|payment|insufficient|credit|exceeded your monthly/i.test(msg))
    return new ImagenError('UNKNOWN', 'Your Hugging Face free credit (~$0.10/mo) is used up. Add credits at huggingface.co/settings/billing, or switch render model.', e);
  if (/429|rate limit|too many/i.test(msg))
    return new ImagenError('RATE_LIMIT', 'Hugging Face is rate-limiting. Wait a moment and retry.', e);
  if (/503|loading|currently loading|cold/i.test(msg))
    return new ImagenError('UNKNOWN', 'The FLUX model is warming up on Hugging Face. Wait ~20s and retry.', e);
  return new ImagenError('UNKNOWN', `Hugging Face render failed: ${msg}`, e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const s = String(reader.result);
      resolve(s.includes(',') ? s.split(',')[1] : s); // strip data: prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
