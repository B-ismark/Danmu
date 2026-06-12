'use client';

import { GoogleGenAI } from '@google/genai';
import { useQuota } from './quota';
import { footprintForLayout, type LayoutId } from './footprint';
import type { CaptureSlot } from './storage';

export type PromptRoom = { width: number; depth: number; height: number; layoutId?: LayoutId };

// Detect furniture / fixtures across ALL 4 wall photos in a single Gemini call.
// Letting the model see all 4 simultaneously lets it reason about object continuity
// (e.g. "this curtain in N is the same one partially seen in W") and avoid mis-classifying
// partially-visible objects.

export type Detection = {
  label: string;
  conf: number;
  /** [x, y, w, h] normalized 0..1 within the image of `slot` */
  box: [number, number, number, number];
  category: 'sofa' | 'tv' | 'chair' | 'table' | 'lamp' | 'plant' | 'shelf' | 'rug' | 'bed' | 'desk' | 'curtain' | 'fan' | 'monitor' | 'fridge' | 'wardrobe' | 'mirror' | 'painting' | 'nightstand' | 'ottoman' | 'ac' | 'door' | 'other';
  slot: CaptureSlot;
  /** non-null if this is the same physical object detected in another wall too */
  alsoSeenIn?: CaptureSlot[];
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

function buildPrompt(room: PromptRoom): string {
  const w = room.width;
  const d = room.depth;
  const h = room.height;
  const hw = (w / 2).toFixed(2);
  const hd = (d / 2).toFixed(2);
  const layout = (room.layoutId ?? 'rect') as LayoutId;

  // For non-rectangular rooms, hand the model the actual footprint polygon so it
  // never places objects in the cut-out void of an L/T/U plan.
  let footprintClause = '';
  if (layout !== 'rect' && layout !== 'open' && layout !== 'custom') {
    const poly = footprintForLayout(layout, w, d)
      .map(([x, z]) => `(${x.toFixed(2)}, ${z.toFixed(2)})`)
      .join(', ');
    footprintClause = `\n\nROOM SHAPE: this is a ${layout.toUpperCase()}-shaped room, NOT a full rectangle. Its floor footprint is the polygon with (x, z) vertices in metres: ${poly}. Every object MUST lie INSIDE this polygon — the area outside it is not part of the room. Do not place anything in the missing corner/notch.`;
  }

  return `You will receive 4 photos of a single room, one per wall (NORTH, EAST, SOUTH, WEST). They are taken from the ROOM CENTER, camera at ~1.5 m height, rotating clockwise. Each shot frames one wall straight-on. Room is roughly ${w.toFixed(1)} m × ${d.toFixed(1)} m × ${h.toFixed(1)} m (W × D × H).

COORDINATE SYSTEM (very important):
- Origin = room center, on the floor.
- +X = right (East), -X = left (West).
- +Y = up.
- +Z = toward South wall, -Z = toward North wall.
- N wall lies at z = ${(-d / 2).toFixed(2)}, S wall at z = ${(+d / 2).toFixed(2)}, E wall at x = ${(+w / 2).toFixed(2)}, W wall at x = ${(-w / 2).toFixed(2)}, ceiling at y = ${h.toFixed(2)}.${footprintClause}

CAMERA PER SLOT:
- N slot photo: camera at (0, 1.5, 0) looking at -Z. Image LEFT = world -X. Image BOTTOM = floor closer to viewer (z near 0). Image TOP = ceiling. Image RIGHT = +X.
- S slot: camera looks at +Z. Image LEFT = world +X (mirrored). Image BOTTOM = z near 0.
- E slot: camera looks at +X. Image LEFT = world -Z (toward N). Image BOTTOM = x near 0.
- W slot: camera looks at -X. Image LEFT = world +Z (toward S). Image BOTTOM = x near 0.

DEPTH ESTIMATION:
- Item bbox bottom near image bottom (y ≈ 0.7-1.0) → object foot is CLOSE to camera (small |distance from center|).
- Item bbox bottom near vertical middle of image (y ≈ 0.4-0.6) → object foot is at FAR wall.
- Items higher up (top half of image with low bottom-y) and small in bbox → near far wall.
- Items LARGE in bbox + low in image → close to camera (mid-room).

Identify ALL distinct furniture / fixtures / appliances / textiles. Reason about the WHOLE room — if part of an object is seen in two photos (e.g. one bed corner in N and the rest in S), classify by the BEST view (largest bbox), and list the other slot in alsoSeenIn. Do NOT split one object into two detections.

For each unique object return JSON with these fields:
- label: short noun phrase (e.g. "single bed", "65 inch tv", "patterned curtain")
- conf: 0..1
- category: ONE of [sofa, tv, chair, table, lamp, plant, shelf, rug, bed, desk, curtain, fan, monitor, fridge, wardrobe, mirror, painting, nightstand, ottoman, ac, door, other]
- slot: the wall where the BEST view appears — one of "n", "e", "s", "w"
- box: [x, y, w, h] as fractions of THAT slot's image (0..1). Encompass the WHOLE visible part — generous, not tight.
- alsoSeenIn: array of other slot codes where the same object is partially visible (omit if none)
- dimMM: estimated real-world dimensions in millimetres [W, D, H].
- position: { x, y, z } in METRES, room-centered (see coordinate system + camera notes above).
  - For the OBJECT CENTER in 3D, infer FROM:
    1. bbox center horizontal → world axis perpendicular to camera direction.
    2. bbox bottom-y → distance along camera direction (lower = closer to camera).
    3. apparent size → confirm distance.
  - y for floor-standing = dimMM[2]/2000 (half height in m).
  - y for wall-mounted (TV, mirror, painting, AC, curtain rod, fan) = mounting height (TV ~1.2, fan ~ceiling-0.15, curtain rod ~ ceiling-0.05).
  - Items in MIDDLE of room (rugs, coffee tables, dining table) MUST have small |x| and |z| — do NOT snap to walls.
  - Items against walls have one of x/z near ±${hw}/±${hd} minus their depth/2.
- yaw: rotation in radians around vertical axis. 0 = facing +Z (south). π = facing -Z (north). -π/2 = +X (east). +π/2 = -X (west). Most furniture faces room interior.
- color: the object's DOMINANT colour as a #rrggbb hex (the main body/upholstery colour, ignoring small accents, highlights and shadows). Best-effort.
- shape: pick ONE from our 3D catalog so we render a visually-faithful primitive. Never invent new ones. Catalog:
  sofa, tv, wardrobe, rug, plant,
  chair-dining, chair-office, chair-armchair, ottoman,
  bed-single, bed-double,
  desk-standard, desk-l, coffee-table, side-table, nightstand,
  lamp-floor, lamp-table, lamp-pendant,
  mirror, mirror-oval, painting, ac-unit,
  monitor, laptop, fan, fridge, curtain,
  bookshelf, door,
  soundbar, radiator, air-purifier, washing-machine, microwave, water-dispenser,
  box (LAST RESORT only — use a real shape whenever possible).

CRITICAL RULES (REPEAT BEFORE OUTPUT):
1. Each PHYSICAL object → exactly ONE entry. Bed half in N + rest in S = ONE bed (slot=s, alsoSeenIn=[n]). Never duplicate.
2. Skip near-duplicate items (don't list every cushion separately).
3. If unsure between two shapes, pick the more specific one. Never invent shapes.
4. Mid-room items (rugs, coffee table, dining table) MUST have small |x|,|z| — do NOT snap to walls.

Output ONLY a JSON array. No prose. No markdown. Maximum 25 items, sorted by visual prominence (largest first).`;
}

export class DetectError extends Error {
  constructor(
    public code: 'NO_KEY' | 'INVALID_KEY' | 'DAILY_QUOTA' | 'RATE_LIMIT' | 'UNKNOWN',
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

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
  const prompt = buildPrompt(room);

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

  try {
    const parsed = JSON.parse(text) as Detection[];
    const valid = parsed.filter((d) => d.box && d.box.length === 4 && d.slot);
    return dedupe(valid);
  } catch {
    return [];
  }
}

/** Drop near-identical detections — same category + slot + bbox center within ~12% on each axis,
 *  OR same label across slots when alsoSeenIn is missing. Prevents the AI from listing
 *  the same physical object twice. */
function dedupe(items: Detection[]): Detection[] {
  const out: Detection[] = [];
  for (const d of items) {
    const cx = d.box[0] + d.box[2] / 2;
    const cy = d.box[1] + d.box[3] / 2;
    const isDup = out.some((o) => {
      // Same slot — bbox-centered overlap means same object
      if (o.slot === d.slot && o.category === d.category) {
        const ocx = o.box[0] + o.box[2] / 2;
        const ocy = o.box[1] + o.box[3] / 2;
        if (Math.abs(ocx - cx) < 0.12 && Math.abs(ocy - cy) < 0.12) return true;
      }
      // Same label string (case-insensitive) anywhere — likely double-counted across walls
      if (o.label.toLowerCase().trim() === d.label.toLowerCase().trim() && o.category === d.category) {
        return true;
      }
      return false;
    });
    if (!isDup) out.push(d);
  }
  return out;
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

// Backward-compat single-image fallback (kept for callers that still need it).
export async function detectInImage(apiKey: string, blob: Blob, slot: CaptureSlot = 'n'): Promise<Detection[]> {
  return detectAcrossImages(apiKey, [{ slot, blob }]);
}
