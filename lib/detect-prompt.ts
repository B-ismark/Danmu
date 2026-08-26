// The detection prompt, as a pure function of the room and the photos we have.
//
// Lifted out of `lib/detection.ts` for the reason Phase 1 lifted `geoRefine` out
// of the detect screen: it was the one part of that module nothing could test,
// because importing `lib/detection.ts` drags in the Gemini SDK and the quota
// store. Nothing here talks to the network.
//
// WHAT IT GOT WRONG BEFORE, and it was a lie the model was asked to act on: the
// first line read "You will receive 4 photos of a single room, one per wall
// (NORTH, EAST, SOUTH, WEST)" no matter how many were actually attached, and the
// camera notes described all four walls regardless. The capture screen has always
// allowed continuing with fewer — one photo is enough to start — so the ordinary
// single-wall run told the model to expect three photographs that did not exist,
// and then described their geometry to it. Telling a language model about walls
// nobody photographed is an invitation to furnish them.

import { footprintForLayout, type LayoutId } from './footprint';
import { CATALOG_SHAPES_ORDERED } from './scene-spec';
import type { CaptureSlot } from './storage';

export type PromptRoom = { width: number; depth: number; height: number; layoutId?: LayoutId };

const SLOT_NAME: Record<CaptureSlot, string> = { n: 'NORTH', e: 'EAST', s: 'SOUTH', w: 'WEST' };

/** Where the lens points and which way the image runs, per wall. The camera
 *  POSITION is stated once in the opening line instead of hiding in the `n`
 *  entry, which is where it used to live — a set without a north photo never
 *  learned where the camera stood. */
const SLOT_CAMERA: Record<CaptureSlot, string> = {
  n: '- N slot: camera looks at -Z. Image LEFT = world -X, Image RIGHT = +X. Image BOTTOM = floor closer to viewer (z near 0). Image TOP = ceiling.',
  e: '- E slot: camera looks at +X. Image LEFT = world -Z (toward N). Image BOTTOM = x near 0.',
  s: '- S slot: camera looks at +Z. Image LEFT = world +X (mirrored). Image BOTTOM = z near 0.',
  w: '- W slot: camera looks at -X. Image LEFT = world +Z (toward S). Image BOTTOM = x near 0.',
};

/** n, e, s, w — the same clockwise order the walls were shot in, whichever of
 *  them turned up. */
const inOrder = (slots: readonly CaptureSlot[]): CaptureSlot[] =>
  (['n', 'e', 's', 'w'] as const).filter((s) => slots.includes(s));

/** "A", "A and B", "A, B and C". A bare comma list reads as a fragment in the
 *  middle of an instruction, and this prompt is prose the model has to follow. */
const andList = (parts: string[]): string =>
  parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** Duplicate slots collapse (`inOrder` filters the canonical four), and the
 *  caller is expected to have at least one — `detectAcrossImages` returns early
 *  on an empty set, before this is reached. Handed none, this would compose a
 *  perfectly grammatical prompt for zero photographs; there is no sensible thing
 *  for it to say instead, so the guard stays where the decision is. */
export function buildDetectPrompt(room: PromptRoom, slots: readonly CaptureSlot[]): string {
  const w = room.width;
  const d = room.depth;
  const h = room.height;
  const hw = (w / 2).toFixed(2);
  const hd = (d / 2).toFixed(2);
  const layout = (room.layoutId ?? 'rect') as LayoutId;

  const present = inOrder(slots);
  const n = present.length;
  const named = present.map((s) => SLOT_NAME[s]).join(', ');
  const codes = present.map((s) => `"${s}"`).join(', ');

  // For non-rectangular rooms, hand the model the actual footprint polygon so it
  // never places objects in the cut-out void of an L/T/U plan.
  let footprintClause = '';
  if (layout !== 'rect' && layout !== 'open' && layout !== 'custom') {
    const poly = footprintForLayout(layout, w, d)
      .map(([x, z]) => `(${x.toFixed(2)}, ${z.toFixed(2)})`)
      .join(', ');
    footprintClause = `\n\nROOM SHAPE: this is a ${layout.toUpperCase()}-shaped room, NOT a full rectangle. Its floor footprint is the polygon with (x, z) vertices in metres: ${poly}. Every object MUST lie INSIDE this polygon — the area outside it is not part of the room. Do not place anything in the missing corner/notch.`;
  }

  // The missing walls are named as missing. Left implicit, "one per wall" plus a
  // coordinate system describing all four reads as an instruction to account for
  // all four.
  const missing = (['n', 'e', 's', 'w'] as const).filter((s) => !present.includes(s));
  const missingClause = missing.length
    ? `\n\nONLY ${n} of the four walls ${n === 1 ? 'was' : 'were'} photographed. The ${andList(
        missing.map((s) => SLOT_NAME[s]),
      )} wall${missing.length > 1 ? 's' : ''} ${missing.length > 1 ? 'were' : 'was'} NOT. Report only what you can see in the ${n === 1 ? 'photo' : 'photos'} attached; do not infer furniture for a wall you were not shown, and never return any slot other than ${codes}.`
    : '';

  return `You will receive ${n === 1 ? `1 photo of a single room, showing the ${named} wall` : `${n} photos of a single room, one per wall (${named})`}. ${n === 1 ? 'It is' : 'They are'} taken from the ROOM CENTER at (0, 1.5, 0) — chest height${n > 1 ? ', rotating clockwise' : ''}. ${n === 1 ? 'The shot frames that wall' : 'Each shot frames one wall'} straight-on. Room is roughly ${w.toFixed(1)} m × ${d.toFixed(1)} m × ${h.toFixed(1)} m (W × D × H).

COORDINATE SYSTEM (very important):
- Origin = room center, on the floor.
- +X = right (East), -X = left (West).
- +Y = up.
- +Z = toward South wall, -Z = toward North wall.
- N wall lies at z = ${(-d / 2).toFixed(2)}, S wall at z = ${(+d / 2).toFixed(2)}, E wall at x = ${(+w / 2).toFixed(2)}, W wall at x = ${(-w / 2).toFixed(2)}, ceiling at y = ${h.toFixed(2)}.${footprintClause}${missingClause}

CAMERA PER SLOT:
${present.map((s) => SLOT_CAMERA[s]).join('\n')}

DEPTH ESTIMATION:
- Item bbox bottom near image bottom (y ≈ 0.7-1.0) → object foot is CLOSE to camera (small |distance from center|).
- Item bbox bottom near vertical middle of image (y ≈ 0.4-0.6) → object foot is at FAR wall.
- Items higher up (top half of image with low bottom-y) and small in bbox → near far wall.
- Items LARGE in bbox + low in image → close to camera (mid-room).

Identify ALL distinct furniture / fixtures / appliances / textiles. Reason about the WHOLE room${n > 1 ? ' — if part of an object is seen in two photos, classify by the BEST view (largest bbox). Do NOT split one object into two detections' : ''}.

For each unique object return JSON with these fields:
- label: short noun phrase (e.g. "single bed", "65 inch tv", "patterned curtain")
- conf: 0..1
- category: ONE of [sofa, tv, chair, table, lamp, plant, shelf, rug, bed, desk, curtain, fan, monitor, fridge, wardrobe, mirror, painting, nightstand, ottoman, ac, door, other]
- slot: the wall where the BEST view appears — one of ${codes}
- box: [x, y, w, h] as fractions of THAT slot's image (0..1). Encompass the WHOLE visible part — generous, not tight.
- dimMM: estimated real-world dimensions in millimetres [W, D, H].
- position: { x, y, z } in METRES, room-centered (see coordinate system + camera notes above).
  - For the OBJECT CENTER in 3D, infer FROM:
    1. bbox center horizontal → world axis perpendicular to camera direction.
    2. bbox bottom-y → distance along camera direction (lower = closer to camera).
    3. apparent size → confirm distance.
  - y: send 0 and do not estimate it. Standing and mounting heights are computed from the room and the object's own size, so whatever you put here is discarded. Only x and z are read.
  - Items in MIDDLE of room (rugs, coffee tables, dining table) MUST have small |x| and |z| — do NOT snap to walls.
  - Items against walls have one of x/z near ±${hw}/±${hd} minus their depth/2.
- yaw: rotation in radians around vertical axis. 0 = facing +Z (south). π = facing -Z (north). -π/2 = +X (east). +π/2 = -X (west). Most furniture faces room interior.
- color: the object's DOMINANT colour as a #rrggbb hex (the main body/upholstery colour, ignoring small accents, highlights and shadows). Best-effort.
- shape: pick ONE from our 3D catalog so we render a visually-faithful primitive. Never invent new ones. Catalog:
  ${CATALOG_SHAPES_ORDERED.join(', ')},
  box (LAST RESORT only — use a real shape whenever possible).

CRITICAL RULES (REPEAT BEFORE OUTPUT):
1. Each PHYSICAL object → exactly ONE entry${n > 1 ? ', even when it appears in two of the photos: pick the wall with the largest bbox' : ''}. Never duplicate.
2. Skip near-duplicate items (don't list every cushion separately).
3. If unsure between two shapes, pick the more specific one. Never invent shapes.
4. Mid-room items (rugs, coffee table, dining table) MUST have small |x|,|z| — do NOT snap to walls.
5. Every slot you return MUST be one of ${codes}.

Output ONLY a JSON array. No prose. No markdown. Maximum 25 items, sorted by visual prominence (largest first).`;
}
