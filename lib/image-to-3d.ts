'use client';

// Adapter for cloud image-to-3D providers. BYO key per provider, mirroring the
// pattern we use for Gemini. Two providers wired by default:
//
//   Meshy  — https://docs.meshy.ai/api/image-to-3d  (best texture quality)
//   Tripo  — https://platform.tripo3d.ai/docs       (cheaper, fast)
//
// Both are async: kick off a task, poll for completion, download GLB.
// Returns a Blob + provider-reported metadata. The caller is responsible for
// caching via lib/mesh-cache.ts.

export type Mesh3dProviderId = 'meshy' | 'tripo';

export type Mesh3dResult = {
  provider: Mesh3dProviderId;
  glb: Blob;
  remoteUrl?: string;
  taskId: string;
};

export class Mesh3dError extends Error {
  constructor(
    public code: 'NO_KEY' | 'AUTH' | 'QUOTA' | 'TIMEOUT' | 'FAILED' | 'UNKNOWN',
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

export type Mesh3dOptions = {
  /** Prompt hint for the provider (e.g. "wooden 4-bay wardrobe"). Helps both. */
  label?: string;
  /** Abort signal so the host can cancel a stuck poll. */
  signal?: AbortSignal;
  /** Override total wait. Default 4 min — these jobs are slow. */
  maxWaitMs?: number;
};

export async function generateMesh(
  provider: Mesh3dProviderId,
  apiKey: string,
  imageBlob: Blob,
  opts: Mesh3dOptions = {},
): Promise<Mesh3dResult> {
  if (!apiKey) throw new Mesh3dError('NO_KEY', `Add a ${provider} API key in Settings.`);
  if (provider === 'meshy') return generateMeshy(apiKey, imageBlob, opts);
  if (provider === 'tripo') return generateTripo(apiKey, imageBlob, opts);
  throw new Mesh3dError('UNKNOWN', `Unknown provider ${provider}`);
}

// ─── Meshy ────────────────────────────────────────────────────────────────
// docs: https://docs.meshy.ai/api-image-to-3d-create-task
async function generateMeshy(
  apiKey: string,
  imageBlob: Blob,
  opts: Mesh3dOptions,
): Promise<Mesh3dResult> {
  const dataUrl = await blobToDataUrl(imageBlob);
  const createRes = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_url: dataUrl,
      ai_model: 'meshy-4',
      topology: 'triangle',
      target_polycount: 30000,
      should_remesh: true,
      enable_pbr: true,
      ...(opts.label ? { texture_prompt: opts.label } : {}),
    }),
    signal: opts.signal,
  });
  if (!createRes.ok) throw await mapHttp(createRes, 'meshy create');
  const { result: taskId } = (await createRes.json()) as { result: string };

  const finalUrl = await pollMeshy(apiKey, taskId, opts);
  const glb = await downloadGlb(finalUrl, opts.signal);
  return { provider: 'meshy', glb, remoteUrl: finalUrl, taskId };
}

async function pollMeshy(apiKey: string, taskId: string, opts: Mesh3dOptions): Promise<string> {
  const start = Date.now();
  const max = opts.maxWaitMs ?? 4 * 60 * 1000;
  while (Date.now() - start < max) {
    if (opts.signal?.aborted) throw new Mesh3dError('TIMEOUT', 'Cancelled');
    const r = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: opts.signal,
    });
    if (!r.ok) throw await mapHttp(r, 'meshy poll');
    const j = (await r.json()) as {
      status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'EXPIRED';
      model_urls?: { glb?: string };
      task_error?: { message?: string };
    };
    if (j.status === 'SUCCEEDED' && j.model_urls?.glb) return j.model_urls.glb;
    if (j.status === 'FAILED' || j.status === 'CANCELED' || j.status === 'EXPIRED') {
      throw new Mesh3dError('FAILED', j.task_error?.message ?? `meshy: ${j.status}`);
    }
    await sleep(4000);
  }
  throw new Mesh3dError('TIMEOUT', 'Meshy did not finish in time.');
}

// ─── Tripo3D ──────────────────────────────────────────────────────────────
// docs: https://platform.tripo3d.ai/docs/quick-start
async function generateTripo(
  apiKey: string,
  imageBlob: Blob,
  opts: Mesh3dOptions,
): Promise<Mesh3dResult> {
  // Step 1: upload the image, get image_token. Use the direct upload endpoint
  // (NOT /sts — that returns STS credentials for client-side S3 uploads which
  // require additional plumbing).
  const fd = new FormData();
  fd.append('file', imageBlob, 'crop.png');
  const upRes = await fetch('https://api.tripo3d.ai/v2/openapi/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
    signal: opts.signal,
  });
  if (!upRes.ok) throw await mapHttp(upRes, 'tripo upload');
  const upJson = (await upRes.json()) as { data?: { image_token?: string } };
  const imageToken = upJson.data?.image_token;
  if (!imageToken) throw new Mesh3dError('FAILED', 'tripo: no image_token returned');

  // Step 2: create task.
  const taskRes = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'image_to_model',
      file: { type: 'png', file_token: imageToken },
      model_version: 'v2.5-20250123',
      texture: true,
      pbr: true,
      ...(opts.label ? { prompt: opts.label } : {}),
    }),
    signal: opts.signal,
  });
  if (!taskRes.ok) throw await mapHttp(taskRes, 'tripo create task');
  const taskJson = (await taskRes.json()) as { data?: { task_id?: string } };
  const taskId = taskJson.data?.task_id;
  if (!taskId) throw new Mesh3dError('FAILED', 'tripo: no task_id returned');

  // Step 3: poll.
  const start = Date.now();
  const max = opts.maxWaitMs ?? 4 * 60 * 1000;
  while (Date.now() - start < max) {
    if (opts.signal?.aborted) throw new Mesh3dError('TIMEOUT', 'Cancelled');
    const r = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: opts.signal,
    });
    if (!r.ok) throw await mapHttp(r, 'tripo poll');
    const j = (await r.json()) as {
      data?: {
        status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'banned';
        output?: { pbr_model?: string; model?: string; model_url?: string };
        error?: string;
      };
    };
    const d = j.data;
    if (d?.status === 'success') {
      const url = d.output?.pbr_model ?? d.output?.model_url ?? d.output?.model;
      if (!url) throw new Mesh3dError('FAILED', 'tripo: success without model url');
      const glb = await downloadGlb(url, opts.signal);
      return { provider: 'tripo', glb, remoteUrl: url, taskId };
    }
    if (d?.status === 'failed' || d?.status === 'cancelled' || d?.status === 'banned') {
      throw new Mesh3dError('FAILED', d.error ?? `tripo: ${d.status}`);
    }
    await sleep(4000);
  }
  throw new Mesh3dError('TIMEOUT', 'Tripo did not finish in time.');
}

// ─── helpers ──────────────────────────────────────────────────────────────
async function downloadGlb(url: string, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Mesh3dError('FAILED', `GLB download HTTP ${r.status}`);
  const b = await r.blob();
  return new Blob([b], { type: 'model/gltf-binary' });
}

async function mapHttp(r: Response, ctx: string): Promise<Mesh3dError> {
  const txt = await r.text().catch(() => '');
  if (r.status === 401 || r.status === 403)
    return new Mesh3dError('AUTH', `${ctx}: auth failed (${r.status})`, txt);
  if (r.status === 429) return new Mesh3dError('QUOTA', `${ctx}: rate limited`, txt);
  return new Mesh3dError('UNKNOWN', `${ctx}: HTTP ${r.status} ${txt.slice(0, 200)}`);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
