'use client';

// Local, in-browser furniture detection — YOLOv8n trained on Open Images V7
// (600 classes, includes wardrobe / mirror / nightstand / curtain / ceiling
// fan and most other home categories), running through onnxruntime-web.
// No API key, no quota, no network after the first model download.
//
// The model file is NOT bundled with the app (≈13 MB). Run
// `python scripts/export-detector.py` once (requires `pip install ultralytics`)
// to export it into public/models/. When the file is absent this module
// reports unavailable and the detect page falls back to Gemini / manual boxes.
//
// Licence note: YOLOv8 weights are AGPL-3.0 — fine here because this project
// is open source.

import type { Detection } from './detection';
import type { CaptureSlot } from './storage';
import type { Category, Shape } from './scene-spec';

const MODEL_URL = '/models/yolov8n-oiv7.onnx';
const NAMES_URL = '/models/yolov8n-oiv7.names.json';
const INPUT = 640;
const CONF_THRESHOLD = 0.35;
const IOU_THRESHOLD = 0.45;
const MAX_PER_IMAGE = 12;

// Open Images class name (lowercase) → our category. Classes not listed are
// ignored — a 600-class detector sees a lot of irrelevant things.
const NAME_TO_CATEGORY: Record<string, Category> = {
  couch: 'sofa',
  'sofa bed': 'sofa',
  'studio couch': 'sofa',
  loveseat: 'sofa',
  television: 'tv',
  chair: 'chair',
  stool: 'chair',
  table: 'table',
  'coffee table': 'table',
  'kitchen & dining room table': 'table',
  desk: 'desk',
  bed: 'bed',
  nightstand: 'nightstand',
  wardrobe: 'wardrobe',
  cupboard: 'wardrobe',
  'chest of drawers': 'wardrobe',
  cabinetry: 'wardrobe',
  'filing cabinet': 'wardrobe',
  bookcase: 'shelf',
  shelf: 'shelf',
  mirror: 'mirror',
  curtain: 'curtain',
  'window blind': 'curtain',
  'picture frame': 'painting',
  lamp: 'lamp',
  'ceiling fan': 'fan',
  'mechanical fan': 'fan',
  refrigerator: 'fridge',
  houseplant: 'plant',
  flowerpot: 'plant',
  door: 'door',
  'computer monitor': 'monitor',
  window: 'other',
  laptop: 'other',
  'washing machine': 'other',
  'microwave oven': 'other',
};

// Classes whose best 3D representation is a specific shape (category alone
// would land on a generic box).
const NAME_TO_SHAPE: Partial<Record<string, Shape>> = {
  window: 'window',
  laptop: 'laptop',
  'washing machine': 'washing-machine',
  'microwave oven': 'microwave',
};

// onnxruntime-web is fetched at runtime from the CDN with webpackIgnore —
// bundling its prebuilt dists breaks Next's server pass, and this keeps the
// ~8 MB runtime out of the app bundle entirely. Version pinned to the
// package.json dependency (which remains installed for the types).
type OrtNS = typeof import('onnxruntime-web');
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';

type Loaded = {
  ort: OrtNS;
  session: import('onnxruntime-web').InferenceSession;
  names: Record<string, string>;
};

let loader: Promise<Loaded | null> | null = null;

/** HEAD-check whether the exported model is deployed. Cached per session. */
let availability: Promise<boolean> | null = null;
export function localDetectorAvailable(): Promise<boolean> {
  availability ??= fetch(MODEL_URL, { method: 'HEAD' })
    .then((r) => r.ok)
    .catch(() => false);
  return availability;
}

async function load(): Promise<Loaded | null> {
  loader ??= (async () => {
    try {
      if (!(await localDetectorAvailable())) return null;
      const ortUrl = `${ORT_BASE}ort.min.mjs`;
      const ort = (await import(/* webpackIgnore: true */ ortUrl)) as OrtNS;
      ort.env.wasm.wasmPaths = ORT_BASE;
      const names = (await (await fetch(NAMES_URL)).json()) as Record<string, string>;
      // WebGPU where present, WASM everywhere else.
      const providers: string[] = [];
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) providers.push('webgpu');
      providers.push('wasm');
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: providers as never,
      });
      return { ort, session, names };
    } catch {
      return null;
    }
  })();
  return loader;
}

/** Letterbox an image blob into a 640×640 RGB float tensor. Returns the
 *  transform needed to map detections back to normalized image coords. */
async function preprocess(blob: Blob): Promise<{
  data: Float32Array;
  scale: number;
  dw: number;
  dh: number;
  w: number;
  h: number;
} | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = INPUT / Math.max(w, h);
    const sw = Math.round(w * scale);
    const sh = Math.round(h * scale);
    const dw = Math.floor((INPUT - sw) / 2);
    const dh = Math.floor((INPUT - sh) / 2);
    const c = document.createElement('canvas');
    c.width = INPUT;
    c.height = INPUT;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#727272'; // letterbox grey
    ctx.fillRect(0, 0, INPUT, INPUT);
    ctx.drawImage(img, dw, dh, sw, sh);
    const px = ctx.getImageData(0, 0, INPUT, INPUT).data;
    const data = new Float32Array(3 * INPUT * INPUT);
    const area = INPUT * INPUT;
    for (let i = 0; i < area; i++) {
      data[i] = px[i * 4] / 255; // R plane
      data[area + i] = px[i * 4 + 1] / 255; // G plane
      data[2 * area + i] = px[i * 4 + 2] / 255; // B plane
    }
    return { data, scale, dw, dh, w, h };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

type RawBox = { x: number; y: number; w: number; h: number; conf: number; cls: number };

function iou(a: RawBox, b: RawBox): number {
  const x1 = Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const y1 = Math.max(a.y - a.h / 2, b.y - b.h / 2);
  const x2 = Math.min(a.x + a.w / 2, b.x + b.w / 2);
  const y2 = Math.min(a.y + a.h / 2, b.y + b.h / 2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-9);
}

function nms(boxes: RawBox[]): RawBox[] {
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf);
  const keep: RawBox[] = [];
  for (const b of sorted) {
    if (keep.every((k) => iou(k, b) < IOU_THRESHOLD)) keep.push(b);
    if (keep.length >= MAX_PER_IMAGE) break;
  }
  return keep;
}

/** Run the local detector over the 4 wall photos. Returns null when the model
 *  isn't deployed or fails to load — callers fall back to Gemini / manual. */
export async function detectLocalAcrossImages(
  images: Array<{ slot: CaptureSlot; blob: Blob }>,
): Promise<Detection[] | null> {
  const loaded = await load();
  if (!loaded) return null;
  const { ort, session, names } = loaded;

  const out: Detection[] = [];
  for (const img of images) {
    const pre = await preprocess(img.blob);
    if (!pre) continue;
    const input = new ort.Tensor('float32', pre.data, [1, 3, INPUT, INPUT]);
    const results = await session.run({ [session.inputNames[0]]: input });
    const output = results[session.outputNames[0]];
    // YOLOv8 head: [1, 4 + numClasses, anchors] — cx, cy, w, h, then scores.
    const [, channels, anchors] = output.dims;
    const nc = channels - 4;
    const d = output.data as Float32Array;
    const at = (ch: number, a: number) => d[ch * anchors + a];

    const raw: RawBox[] = [];
    for (let a = 0; a < anchors; a++) {
      let best = 0;
      let bestC = -1;
      for (let cidx = 0; cidx < nc; cidx++) {
        const s = at(4 + cidx, a);
        if (s > best) {
          best = s;
          bestC = cidx;
        }
      }
      if (best < CONF_THRESHOLD || bestC < 0) continue;
      const name = (names[String(bestC)] ?? '').toLowerCase();
      if (!(name in NAME_TO_CATEGORY)) continue;
      raw.push({ x: at(0, a), y: at(1, a), w: at(2, a), h: at(3, a), conf: best, cls: bestC });
    }

    for (const b of nms(raw)) {
      const name = (names[String(b.cls)] ?? '').toLowerCase();
      const category = NAME_TO_CATEGORY[name];
      // letterboxed 640-space → normalized original-image coords
      const nx = (b.x - b.w / 2 - pre.dw) / (pre.w * pre.scale);
      const ny = (b.y - b.h / 2 - pre.dh) / (pre.h * pre.scale);
      const nw = b.w / (pre.w * pre.scale);
      const nh = b.h / (pre.h * pre.scale);
      if (nw <= 0.01 || nh <= 0.01) continue;
      out.push({
        label: names[String(b.cls)] ?? name,
        conf: Math.min(1, b.conf),
        box: [
          Math.max(0, Math.min(1, nx)),
          Math.max(0, Math.min(1, ny)),
          Math.min(1, nw),
          Math.min(1, nh),
        ],
        category,
        slot: img.slot,
        shape: NAME_TO_SHAPE[name],
      });
    }
  }
  return out;
}
