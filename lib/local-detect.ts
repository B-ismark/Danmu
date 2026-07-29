'use client';

// Local, in-browser furniture detection through onnxruntime-web. No API key,
// no quota, no network after the first model download.
//
// TWO models run as an ensemble, because they fail on disjoint classes:
//   • yolov8n-oiv7      (14 MB) — YOLOv8 nano on Open Images V7, 601 fixed
//                                 classes. Owns monitors and windows.
//   • yolov8s-worldv2   (50 MB) — open-vocabulary, with Danmu's furniture
//                                 prompts frozen into the graph at export.
//                                 Owns fridges, ceiling fans, wardrobes, lamps,
//                                 curtains — none of which the OIV7 model
//                                 detects at all, at any model size.
// Measured on a real 4-photo room: OIV7 7/19 objects, world 10/19, both 13/19.
//
// The model file is NOT bundled with the app (≈13 MB). `resolveBase()` probes
// public/models/ first — populate it with `python scripts/export-detector.py`
// — then the Hugging Face mirror. Only when neither answers does this module
// report unavailable and the detect page fall back to Gemini / manual boxes.
//
// Expect PARTIAL results — 13 of 19 on the room measured. Doors, wall art and
// some curtains are still missed. Treat this as a head start on manual boxes,
// not a substitute for the Gemini pass.
//
// Licence note: YOLOv8 weights are AGPL-3.0, this project is MIT. AGPL is
// copyleft, so "we're open source too" does not clear it. Exporting the model
// for your own machine is not distribution and is fine. REDISTRIBUTING the
// weights from this repo (release asset, committed binary, bundled build) is,
// and would put an AGPL artifact under an MIT project — don't, without either
// relicensing or hosting the weights separately under their own AGPL terms.

import type { Detection } from './detection';
import type { CaptureSlot } from './storage';
import type { Category, Shape } from './scene-spec';

const MODEL_FILE = 'yolov8n-oiv7.onnx';
const NAMES_FILE = 'yolov8n-oiv7.names.json';
// Second, open-vocabulary pass. Optional: when it is absent (e.g. an older
// local export) detection still runs on the OIV7 model alone.
const WORLD_FILE = 'yolov8s-worldv2-danmu.onnx';
// Served from public/ when the export script has been run locally.
const LOCAL_BASE = '/models/';
// Hugging Face mirror, tried only when the local export is absent — lets a
// fresh clone use the detector without a Python + torch toolchain. Static GETs
// of a public asset; no user data leaves the device.
//
// Hosted off-repo on purpose: the weights are AGPL-3.0 and this project is MIT,
// so they live in their own AGPL-licensed model repo and are fetched at runtime
// rather than redistributed from here. See the licence note above.
//
// Must be /resolve/ (the raw bytes), never /blob/ (an HTML viewer page, which
// would pass the HEAD probe and then hand ONNX Runtime a page of markup).
// GitHub release assets were tried first and are unusable: they redirect to a
// storage host that sends no access-control-allow-origin, so the browser blocks
// them even though curl sees a 200.
const REMOTE_BASE = 'https://huggingface.co/DearthAI/danmu-detector/resolve/main/';
const INPUT = 640;
const CONF_THRESHOLD = 0.35;
const IOU_THRESHOLD = 0.45;
// Drop a same-category box this far inside a higher-confidence one, even when
// IoU stays under the threshold.
const CONTAINED_THRESHOLD = 0.8;
const MAX_PER_IMAGE = 12;
// Fraction of the image each 2×2 tile extends past its quadrant, so an object
// sitting on a seam is still whole inside at least one tile.
const TILE_OVERLAP = 0.15;

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

// YOLO-World's vocabulary, in the exact order it was frozen into the graph by
// set_classes() at export time — index N of the model's class channels is
// WORLD_PROMPTS[N], so this array must not be reordered without re-exporting.
//
// These are natural noun phrases rather than dataset labels because that is
// what an open-vocabulary model responds to, and several phrases deliberately
// share one category: real rooms hold clothes rails and stacked fabric cubes,
// not the canonical `Wardrobe` that a fixed-label model was trained on.
const WORLD_PROMPTS = [
  'sofa', 'couch', 'armchair',
  'chair', 'office chair', 'stool',
  'table', 'coffee table', 'dining table',
  'desk',
  'bed', 'mattress',
  'nightstand',
  'wardrobe', 'closet', 'chest of drawers', 'storage cabinet',
  'shelf', 'bookshelf', 'shoe rack',
  'mirror',
  'curtain', 'window curtain', 'window blind',
  'picture frame', 'wall art', 'poster',
  'lamp', 'light bulb', 'ceiling light',
  'ceiling fan', 'electric fan',
  'refrigerator',
  'potted plant',
  'door', 'wooden door',
  'computer monitor',
  'television',
  'window',
  'laptop',
  'washing machine',
  'microwave oven',
  'clothes rack', 'hanging clothes',
] as const;

// `label` is user-facing — the detect page renders it, and the Gemini path's
// contract is "short noun phrase". A few prompts are phrased for the detector
// rather than for a person, so they get a display name instead.
const WORLD_LABEL: Record<string, string> = {
  'hanging clothes': 'clothes rail',
  'clothes rack': 'clothes rail',
  'storage cabinet': 'cabinet',
  'window curtain': 'curtain',
};

/** OIV7 names are sentence case ("Computer monitor"); the world prompts are
 *  lowercase. Without this the detection list mixes both. */
function displayLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const WORLD_TO_CATEGORY: Record<string, Category> = {
  sofa: 'sofa', couch: 'sofa', armchair: 'sofa',
  chair: 'chair', 'office chair': 'chair', stool: 'chair',
  table: 'table', 'coffee table': 'table', 'dining table': 'table',
  desk: 'desk',
  bed: 'bed', mattress: 'bed',
  nightstand: 'nightstand',
  wardrobe: 'wardrobe', closet: 'wardrobe', 'chest of drawers': 'wardrobe',
  'storage cabinet': 'wardrobe', 'clothes rack': 'wardrobe', 'hanging clothes': 'wardrobe',
  shelf: 'shelf', bookshelf: 'shelf', 'shoe rack': 'shelf',
  mirror: 'mirror',
  curtain: 'curtain', 'window curtain': 'curtain', 'window blind': 'curtain',
  'picture frame': 'painting', 'wall art': 'painting', poster: 'painting',
  lamp: 'lamp', 'light bulb': 'lamp', 'ceiling light': 'lamp',
  'ceiling fan': 'fan', 'electric fan': 'fan',
  refrigerator: 'fridge',
  'potted plant': 'plant',
  door: 'door', 'wooden door': 'door',
  'computer monitor': 'monitor',
  television: 'tv',
  // Shape-only entries: no dedicated category, but NAME_TO_SHAPE gives them a
  // better 3D form than a generic box.
  window: 'other', laptop: 'other',
  'washing machine': 'other', 'microwave oven': 'other',
};

// Classes whose best 3D representation is a specific shape (category alone
// would land on a generic box). Keyed by lowercase label, so it serves both
// the OIV7 names and the YOLO-World prompts.
const NAME_TO_SHAPE: Partial<Record<string, Shape>> = {
  window: 'window',
  laptop: 'laptop',
  'washing machine': 'washing-machine',
  'microwave oven': 'microwave',
};

// onnxruntime-web is loaded at runtime with webpackIgnore — bundling its
// prebuilt dists breaks Next's server pass, and this keeps the ~8 MB runtime out
// of the app bundle entirely. The package stays installed as a devDependency for
// its types only.
//
// SAME-ORIGIN FIRST. A dynamic import() cannot carry a subresource-integrity
// hash, so when this resolved to a CDN there was nothing verifying what came
// back — and whatever came back executes with full access to this origin, which
// holds the user's Google API key (localStorage) and every room they own
// (IndexedDB). `pnpm vendor:ort` copies the runtime into public/ort/, and the
// probe below prefers it. The CDN stays as a fallback so a fresh clone still
// works; the CSP in next.config.mjs allows exactly these two.
//
// ORT_VERSION must match that devDependency exactly, or the types compiled
// against will drift from the wasm actually executed. Both are pinned (no
// caret) so a lockfile refresh can't move one without the other.
type OrtNS = typeof import('onnxruntime-web');
const ORT_VERSION = '1.27.0';
const ORT_LOCAL_BASE = '/ort/';
const ORT_CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const ORT_ENTRY = 'ort.min.mjs';

// ─── Weights integrity ──────────────────────────────────────────────────────
//
// A HEAD 200 used to be the only validation on a 14 MB and a 50 MB graph fetched
// from a public mirror and handed straight to the wasm runtime.
//
// Each digest below was verified on BOTH sides before being pinned — the local
// export in public/models/ and the bytes the mirror actually serves over
// /resolve/main/ hash identically. That check is the whole point: a digest pinned
// from the local copy alone would fail closed and silently disable the detector
// for every fresh clone, which is worse than the gap it closes. `pnpm hash:models`
// prints the local side; its header documents the remote side.
//
// A mismatch here means the mirror changed. That is exactly when the detector
// SHOULD refuse: fetchVerifiedModel returns null, the app reports the detector as
// unavailable, and the Gemini / manual-box paths carry on. Re-verify and re-pin
// deliberately rather than deleting the entry to make it work again.
//
// Independent of the registry, every REMOTE file is format-checked: an ONNX file
// is a protobuf, and the realistic failure mode here is receiving something that
// is not one at all (an HTML error page, a redirect body, a truncated download).
// Local files are the user's own export and are trusted as-is.
const MODEL_DIGESTS: Record<string, string> = {
  'yolov8n-oiv7.names.json':
    'sha256-8126ccfbc3780e25825a1beae446edf7d663b69223b5ce796d8499ea8c3ce13d',
  'yolov8n-oiv7.onnx':
    'sha256-10833f3633b96c0e7554564d06be8449191ac3c36b3e9d4df7387b41b4187c33',
  'yolov8s-worldv2-danmu.onnx':
    'sha256-3a04741b738b1b6c756e00dfe5fe322765efba93699b331200e625f963d37f5b',
};

/** Plausible size window for a detector graph, so a 400-byte error page or a
 *  1 GB surprise is refused before it is parsed. */
const MIN_MODEL_BYTES = 1 * 1024 * 1024;
const MAX_MODEL_BYTES = 512 * 1024 * 1024;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True when `buf` looks like a serialised ONNX ModelProto. Field 1 (ir_version)
 *  is a varint, so a well-formed file starts with the tag byte 0x08. */
function looksLikeOnnx(buf: ArrayBuffer): boolean {
  if (buf.byteLength < MIN_MODEL_BYTES || buf.byteLength > MAX_MODEL_BYTES) return false;
  const head = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
  if (head[0] !== 0x08) return false;
  // The producer_name / domain strings appear early in every graph we ship.
  const text = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(4096, buf.byteLength)));
  return text.includes('onnx') || text.includes('pytorch') || text.includes('ai.onnx');
}

/** Fetch a remote file and refuse it unless its digest matches the pinned one.
 *  Returns null when it cannot be trusted — callers treat that exactly like "not
 *  deployed" and fall back to Gemini / manual boxes.
 *
 *  A file with no pinned digest passes: the registry is allowed to be partial so
 *  that adding a model file does not require a release to pin it first. */
async function fetchVerifiedBytes(base: string, file: string): Promise<ArrayBuffer | null> {
  const res = await fetch(base + file);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const expected = MODEL_DIGESTS[file];
  if (expected && `sha256-${await sha256Hex(buf)}` !== expected) return null;
  return buf;
}

/** …and for a graph, the format check as well. */
async function fetchVerifiedModel(base: string, file: string): Promise<Uint8Array | null> {
  const buf = await fetchVerifiedBytes(base, file);
  if (!buf || !looksLikeOnnx(buf)) return null;
  return new Uint8Array(buf);
}

/** The class-name table. It is not code, but it silently decides what every
 *  detection is CALLED, so a remote copy gets the same digest treatment as a
 *  graph — it used to be fetched with a bare `fetch().json()`, which meant a
 *  pinned digest for it would have been decoration. `looksLikeOnnx` cannot be
 *  applied here: this file is JSON and a few kB, so it fails both the magic byte
 *  and the size window by design. */
async function fetchNames(base: string, file: string): Promise<Record<string, string> | null> {
  if (base === LOCAL_BASE) {
    const res = await fetch(base + file);
    return res.ok ? ((await res.json()) as Record<string, string>) : null;
  }
  const buf = await fetchVerifiedBytes(base, file);
  if (!buf) return null;
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as Record<string, string>;
  } catch {
    return null;
  }
}

type Session = import('onnxruntime-web').InferenceSession;

type Loaded = {
  ort: OrtNS;
  session: Session;
  names: Record<string, string>;
  /** Open-vocabulary second pass. null when the file isn't deployed. */
  world: Session | null;
};

let loader: Promise<Loaded | null> | null = null;

/** Resolve which base URL serves one file — the local export first, the
 *  Hugging Face mirror second. Cached per file, per session. null = that file
 *  is unreachable.
 *
 *  PER FILE, not once for all of them: a clone that ran the pre-ensemble export
 *  script has only the OIV7 model in public/models/. Picking a single base off
 *  that one probe would pin everything to local and silently lose the world
 *  model — and with it half the recall — even though the mirror has it. */
const bases = new Map<string, Promise<string | null>>();
function resolveFile(file: string): Promise<string | null> {
  let hit = bases.get(file);
  if (!hit) {
    hit = (async () => {
      for (const candidate of [LOCAL_BASE, REMOTE_BASE]) {
        try {
          const r = await fetch(candidate + file, { method: 'HEAD' });
          if (r.ok) return candidate;
        } catch {
          // Network error / CORS rejection — try the next candidate.
        }
      }
      return null;
    })();
    bases.set(file, hit);
  }
  return hit;
}

/** Whether the detector can run at all — the OIV7 model is the floor, the
 *  open-vocabulary pass is a bonus on top. Cached per session. */
export async function localDetectorAvailable(): Promise<boolean> {
  return (await resolveFile(MODEL_FILE)) !== null;
}

/** Same local-then-remote probe as the weights, for the runtime itself. */
let ortBase: Promise<string> | null = null;
function resolveOrtBase(): Promise<string> {
  ortBase ??= (async () => {
    try {
      const r = await fetch(ORT_LOCAL_BASE + ORT_ENTRY, { method: 'HEAD' });
      if (r.ok) return ORT_LOCAL_BASE;
    } catch {
      // Not vendored — fall through to the CDN.
    }
    return ORT_CDN_BASE;
  })();
  return ortBase;
}

async function load(): Promise<Loaded | null> {
  loader ??= (async () => {
    try {
      const modelBase = await resolveFile(MODEL_FILE);
      if (!modelBase) return null;
      const base = await resolveOrtBase();
      const ort = (await import(/* webpackIgnore: true */ `${base}${ORT_ENTRY}`)) as OrtNS;
      ort.env.wasm.wasmPaths = base;
      const namesBase = (await resolveFile(NAMES_FILE)) ?? modelBase;
      const names = await fetchNames(namesBase, NAMES_FILE);
      // Without the class table every detection would be an index, so this is a
      // hard failure rather than a degraded mode. It used to be an unhandled
      // rejection inside the loader.
      if (!names) return null;
      // WebGPU where present, WASM everywhere else.
      const providers: string[] = [];
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) providers.push('webgpu');
      providers.push('wasm');

      // A locally-exported file is the user's own and is handed to the runtime by
      // URL. A remote one is fetched, format-checked and digest-checked first —
      // see fetchVerifiedModel.
      const open = async (fileBase: string, file: string): Promise<Session | null> => {
        if (fileBase === LOCAL_BASE) {
          return ort.InferenceSession.create(fileBase + file, {
            executionProviders: providers as never,
          });
        }
        const bytes = await fetchVerifiedModel(fileBase, file);
        if (!bytes) return null;
        return ort.InferenceSession.create(bytes, { executionProviders: providers as never });
      };

      const session = await open(modelBase, MODEL_FILE);
      if (!session) return null;
      // Optional, and resolved independently of the OIV7 model so a local
      // export missing this file still picks it up from the mirror. Only when
      // neither has it does detection run on the OIV7 model alone.
      let world: Session | null = null;
      const worldBase = await resolveFile(WORLD_FILE);
      if (worldBase) {
        try {
          world = await open(worldBase, WORLD_FILE);
        } catch {
          world = null;
        }
      }
      return { ort, session, names, world };
    } catch {
      return null;
    }
  })();
  return loader;
}

/** Decode a blob to a bitmap once — every tile pass reuses it. */
async function decode(blob: Blob): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A crop of the source image, in source pixels. */
type Crop = { ox: number; oy: number; cw: number; ch: number };

/** Whole frame plus 2×2 tiles with 15% overlap.
 *
 *  Letterboxing a 2000px-wide wall photo down to 640 shrinks mid-sized objects
 *  past what the nano model resolves. Re-running on tiles at closer to native
 *  scale nearly doubles recall (4/19 → 7/19 on a real 4-photo room) for zero
 *  extra download — the overlap keeps objects straddling a seam intact, and the
 *  final NMS runs in whole-image space so seam duplicates collapse.
 *
 *  Measured alternative: bigger OIV7 variants do NOT help. s (46 MB), m
 *  (105 MB) and x (275 MB) all land on the same 7/19 as tiled nano, so the
 *  input resolution is the binding constraint, not model capacity. */
function tilesFor(iw: number, ih: number): Crop[] {
  const ox = iw * TILE_OVERLAP;
  const oy = ih * TILE_OVERLAP;
  const crops: Crop[] = [{ ox: 0, oy: 0, cw: iw, ch: ih }];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const x0 = Math.max(0, (c * iw) / 2 - ox);
      const y0 = Math.max(0, (r * ih) / 2 - oy);
      const x1 = Math.min(iw, ((c + 1) * iw) / 2 + ox);
      const y1 = Math.min(ih, ((r + 1) * ih) / 2 + oy);
      crops.push({ ox: x0, oy: y0, cw: x1 - x0, ch: y1 - y0 });
    }
  }
  return crops;
}

/** Letterbox one crop into a 640×640 planar-RGB tensor, plus the transform
 *  mapping detections back to normalized whole-image coords. */
function toTensor(
  img: HTMLImageElement,
  crop: Crop,
): { data: Float32Array; scale: number; dw: number; dh: number } | null {
  const scale = INPUT / Math.max(crop.cw, crop.ch);
  const sw = Math.round(crop.cw * scale);
  const sh = Math.round(crop.ch * scale);
  const dw = Math.floor((INPUT - sw) / 2);
  const dh = Math.floor((INPUT - sh) / 2);
  const c = document.createElement('canvas');
  c.width = INPUT;
  c.height = INPUT;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#727272'; // letterbox grey
  ctx.fillRect(0, 0, INPUT, INPUT);
  ctx.drawImage(img, crop.ox, crop.oy, crop.cw, crop.ch, dw, dh, sw, sh);
  const px = ctx.getImageData(0, 0, INPUT, INPUT).data;
  const data = new Float32Array(3 * INPUT * INPUT);
  const area = INPUT * INPUT;
  for (let i = 0; i < area; i++) {
    data[i] = px[i * 4] / 255; // R plane
    data[area + i] = px[i * 4 + 1] / 255; // G plane
    data[2 * area + i] = px[i * 4 + 2] / 255; // B plane
  }
  return { data, scale, dw, dh };
}

/** A candidate in normalized whole-image space, with its class already
 *  resolved — the two models have different vocabularies, so they can only be
 *  merged after each has mapped its own class index to a label + category. */
export type RawBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
  label: string;
  category: Category;
  shape?: Shape;
};

function overlap(a: RawBox, b: RawBox): number {
  const x1 = Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const y1 = Math.max(a.y - a.h / 2, b.y - b.h / 2);
  const x2 = Math.min(a.x + a.w / 2, b.x + b.w / 2);
  const y2 = Math.min(a.y + a.h / 2, b.y + b.h / 2);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function iou(a: RawBox, b: RawBox): number {
  const inter = overlap(a, b);
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-9);
}

/** How much of `a` sits inside `b`. IoU alone leaves a small box nested in a
 *  much larger one untouched — a tall crop of a monitor inside the whole
 *  monitor scores well under the IoU threshold — which surfaces as duplicate
 *  boxes stacked on one object. */
function containedIn(a: RawBox, b: RawBox): number {
  return overlap(a, b) / (a.w * a.h + 1e-9);
}

/** Non-maximum suppression over candidates from BOTH models and every tile.
 *  Exported for tests — it is the step that decides how many boxes the user sees,
 *  and it has to collapse three different kinds of duplicate: two tiles finding
 *  the same object, both models finding it, and one model stacking boxes on it. */
export function nms(boxes: RawBox[]): RawBox[] {
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf);
  const keep: RawBox[] = [];
  for (const b of sorted) {
    const dup = keep.some(
      (k) =>
        iou(k, b) >= IOU_THRESHOLD ||
        // Mostly swallowed by an already-kept box of the same kind. Measured:
        // trims duplicate stacked boxes with no loss of recall.
        (k.category === b.category && containedIn(b, k) >= CONTAINED_THRESHOLD),
    );
    if (!dup) keep.push(b);
    if (keep.length >= MAX_PER_IMAGE) break;
  }
  return keep;
}

// An InferenceSession rejects overlapping run() calls with "Session already
// started", and load() hands every caller the same two sessions. Two concurrent
// detections therefore poison each other — which React StrictMode causes on
// every mount in dev, and a re-detect tap or a remount causes in production.
// The detect page catches the throw and falls through to Gemini, so the symptom
// is silent: local detection just appears not to work, and burns quota instead.
// Queue the passes so overlapping callers wait rather than collide.
let inflight: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = inflight.then(fn, fn);
  inflight = next.catch(() => undefined);
  return next;
}

/** Run the local detector over the 4 wall photos. Returns null when the model
 *  isn't deployed or fails to load — callers fall back to Gemini / manual.
 *  Concurrent calls are queued, not run in parallel. */
export function detectLocalAcrossImages(
  images: Array<{ slot: CaptureSlot; blob: Blob }>,
): Promise<Detection[] | null> {
  return serialized(() => runDetection(images));
}

async function runDetection(
  images: Array<{ slot: CaptureSlot; blob: Blob }>,
): Promise<Detection[] | null> {
  const loaded = await load();
  if (!loaded) return null;
  const { ort, session, names, world } = loaded;

  /** Map an OIV7 class index to a label + category, or null to drop it. */
  const oivClass = (i: number) => {
    const name = (names[String(i)] ?? '').toLowerCase();
    const category = NAME_TO_CATEGORY[name];
    if (!category) return null;
    return { label: displayLabel(name), category, shape: NAME_TO_SHAPE[name] };
  };

  /** Same for YOLO-World, whose class order is WORLD_PROMPTS. */
  const worldClass = (i: number) => {
    const prompt = WORLD_PROMPTS[i];
    if (!prompt) return null;
    const category = WORLD_TO_CATEGORY[prompt];
    if (!category) return null;
    // Look shape up by the prompt, but show the display name.
    return {
      label: displayLabel(WORLD_LABEL[prompt] ?? prompt),
      category,
      shape: NAME_TO_SHAPE[prompt],
    };
  };

  const out: Detection[] = [];
  for (const img of images) {
    const bitmap = await decode(img.blob);
    if (!bitmap) continue;
    const iw = bitmap.naturalWidth;
    const ih = bitmap.naturalHeight;

    // Both models, every tile, collected in NORMALIZED whole-image space, so a
    // single NMS at the end resolves per-tile duplicates, cross-tile seam
    // duplicates, AND the same object found by both models.
    const merged: RawBox[] = [];
    const passes: Array<[Session, (i: number) => ReturnType<typeof oivClass>]> = [
      [session, oivClass],
    ];
    if (world) passes.push([world, worldClass]);

    for (const crop of tilesFor(iw, ih)) {
      const pre = toTensor(bitmap, crop);
      if (!pre) continue;

      // letterboxed 640-space → crop pixels → normalized whole-image coords
      const toX = (v: number) => (crop.ox + (v - pre.dw) / pre.scale) / iw;
      const toY = (v: number) => (crop.oy + (v - pre.dh) / pre.scale) / ih;

      for (const [sess, classOf] of passes) {
        // A fresh tensor per run: onnxruntime may retain the backing buffer.
        const input = new ort.Tensor('float32', pre.data.slice(), [1, 3, INPUT, INPUT]);
        const results = await sess.run({ [sess.inputNames[0]]: input });
        const output = results[sess.outputNames[0]];
        // YOLOv8 head: [1, 4 + numClasses, anchors] — cx, cy, w, h, then scores.
        const [, channels, anchors] = output.dims;
        const nc = channels - 4;
        const d = output.data as Float32Array;
        const at = (ch: number, a: number) => d[ch * anchors + a];

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
          const cls = classOf(bestC);
          if (!cls) continue;
          merged.push({
            x: toX(at(0, a)),
            y: toY(at(1, a)),
            w: at(2, a) / pre.scale / iw,
            h: at(3, a) / pre.scale / ih,
            conf: best,
            ...cls,
          });
        }
      }
    }

    for (const b of nms(merged)) {
      const nx = b.x - b.w / 2;
      const ny = b.y - b.h / 2;
      if (b.w <= 0.01 || b.h <= 0.01) continue;
      out.push({
        label: b.label,
        conf: Math.min(1, b.conf),
        box: [
          Math.max(0, Math.min(1, nx)),
          Math.max(0, Math.min(1, ny)),
          Math.min(1, b.w),
          Math.min(1, b.h),
        ],
        category: b.category,
        slot: img.slot,
        shape: b.shape,
      });
    }
  }
  return out;
}
