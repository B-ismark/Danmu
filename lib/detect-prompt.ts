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
import { boxInPhoto } from './photo-geometry';
import type { CaptureSlot } from './storage';
import type { Detection } from './detection';

export type PromptRoom = { width: number; depth: number; height: number; layoutId?: LayoutId };

const SLOT_NAME: Record<CaptureSlot, string> = { n: 'NORTH', e: 'EAST', s: 'SOUTH', w: 'WEST' };

/** A wall as a reply may name it. The prompt asks for `"n"`, but it also calls the
 *  walls NORTH, EAST, SOUTH and WEST, and heads each photo `--- N WALL ---`, so a
 *  reply in any of those forms — `N WALL` and `north wall` included — is the
 *  prompt's own words read back, not a guess about which wall was meant. A Map
 *  rather than an object, so `"constructor"` is not a wall. */
const SLOT_OF = new Map<string, CaptureSlot>(
  (Object.entries(SLOT_NAME) as [CaptureSlot, string][]).flatMap(([code, name]) => [
    [code, code],
    [name.toLowerCase(), code],
  ]),
);

/** The wall code a reply's `slot` names, or undefined when it names none. */
export function slotOf(v: unknown): CaptureSlot | undefined {
  return typeof v === 'string' ? SLOT_OF.get(v.trim().toLowerCase().replace(/\s+wall$/, '')) : undefined;
}

/** The wall a reply's row is filed under, among the walls `sent`, or undefined.
 *  With ONE photo sent the row's own `slot` decides nothing: the prompt asks for a
 *  box in fractions of that slot's image, and there is no other image for it to be
 *  on, so a row naming another wall is misfiled rather than off the photos. Dropping
 *  it would refuse furniture boxed on the only picture there is — and the one-photo
 *  scan is the ordinary one. With two or more, a row naming a wall nobody
 *  photographed could be on either, and nothing says which. */
function wallOf(d: { slot?: unknown }, sent: readonly CaptureSlot[]): CaptureSlot | undefined {
  if (sent.length === 1) return sent[0];
  const slot = slotOf(d.slot);
  return slot && sent.includes(slot) ? slot : undefined;
}

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

/** The rows of the reply this prompt asked for, as the geometry can use them. Here
 *  rather than beside the call for the reason the prompt is (the top of this file):
 *  its test should not have to load the Gemini SDK and the quota store.
 *
 *  NOT deduped here. Merging two detections is a decision about what EXISTS, and it
 *  used to be taken on the model's own guessed `position` — the exact numbers the
 *  geometry pass then overwrote. It now runs in lib/detect-refine.ts AFTER
 *  refinement, which also means the on-device path gets it too.
 *
 *  Each box is cut to its photo (`boxInPhoto`): the prompt asks for fractions of the
 *  image, and a box that runs past the edge describes rows and columns nobody saw —
 *  a cut box's top row is the frame's edge, which the ceiling solve stands on. A row
 *  with no box in frame is dropped, as a row with no box always was, and so is a
 *  sliver, by the rule the on-device rows are dropped by.
 *
 *  So is a row naming a wall that was not photographed (§ 49.17), read through
 *  `wallOf`. It had no camera to be measured by, so it kept the model's own size and
 *  place and was built as though it were read off a photo. `sent` is required rather
 *  than defaulted to all four walls, because the default is the check switched off. */
export function cloudRows(parsed: readonly unknown[], sent: readonly CaptureSlot[]): Detection[] {
  return (parsed as Detection[]).flatMap((d) => {
    const slot = filedUnder(d, sent);
    if (!slot || !Array.isArray(d.box)) return [];
    const box = boxInPhoto(d.box);
    // Stamped here, and called only by `readCloudReply`, which only
    // `detectAcrossImages` calls, so nothing but the reply to a Gemini call can
    // claim its output came from Gemini. The slot is written back as its code:
    // the saved record carries it as a `__slot:x` suffix that reads back only
    // `[nesw]`, and `cals[d.slot]` is keyed the same way.
    return box ? [{ ...d, slot, box, source: 'cloud' as const }] : [];
  });
}

/** The first thing `cloudRows` asks of a row: which photographed wall it is filed
 *  under. Its own function so `readCloudReply` can say which question a refused
 *  reply failed. */
function filedUnder(d: unknown, sent: readonly CaptureSlot[]): CaptureSlot | undefined {
  return d ? wallOf(d as { slot?: unknown }, sent) : undefined;
}

/** A reply's rows, or why it holds nothing the screen may act on. */
export type CloudReply = { rows: Detection[] } | { unreadable: string; cause: unknown };

/** What a Gemini reply says, about the walls in `sent`. Three kinds of body are not
 *  an answer, and each was once read as an empty room — the detect screen's "nothing
 *  stood out in your photos, which is exactly right for an empty room", with the
 *  quota already spent: a body that is not JSON, JSON that is not a list, and a list
 *  none of whose rows `cloudRows` keeps. The third is the cut's (§ 49.15): a reply in
 *  some unit other than the fractions the prompt asks for can put every box past the
 *  frame, and dropping them row by row left no sign that anything had gone wrong.
 *  A reply filing every row under walls nobody photographed is the same case
 *  (§ 49.17). So it is unreadable, and the screen offers Retry. An EMPTY list is the
 *  one empty reply that is an answer, and stays one. */
export function readCloudReply(text: string, sent: readonly CaptureSlot[]): CloudReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { unreadable: 'The detection service replied with something unreadable.', cause: e };
  }
  if (!Array.isArray(parsed)) {
    return { unreadable: 'The detection service replied in an unexpected shape.', cause: parsed };
  }
  const rows = cloudRows(parsed, sent);
  if (parsed.length > 0 && rows.length === 0) {
    // Two failures, told apart because the fixes differ: a reply in the wrong unit
    // needs the boxes read differently, one filed under the wrong walls needs the
    // walls. It used to say "no box" for both.
    const unreadable = parsed.some((d) => filedUnder(d, sent))
      ? 'The detection service replied with no box inside the photos.'
      : 'The detection service filed no piece under a wall that was photographed.';
    return { unreadable, cause: parsed };
  }
  return { rows };
}
