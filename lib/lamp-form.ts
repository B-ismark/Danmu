// Floor and table lamps as the real objects, and where each one's bulb is.
//
// They were a cone on a stick on a disc: an open cone whose rim sat at the declared width,
// a 15 mm pole and a puck. What makes a lamp read as a lamp is mostly three things the
// cone could not say — a shade is a DRUM, near-upright, open at the bottom so you see the
// bulb from a chair; the base is WEIGHTED, a wide flat disc a lamp would not tip off; and
// a table lamp's body is a vessel, a glazed belly rather than a rod.
//
// The bulb is the half that is not cosmetic. Both lamps' light used to sit at a hand-typed
// constant (`LIGHT_ANCHORS`: 1.66 m and 0.40 m) while the geometry stretched to whatever
// size the piece was authored at — so a detected 1.2 m floor lamp emitted from 460 mm
// above its own shade, and a 300 mm table lamp from 100 mm above its top. `lightAnchor`
// reads `lampForm(...).bulb` now, the same call the renderer draws the bulb from, which
// is the pendant's § 34 fix applied to the two rows that had been flagged as "the same
// class of hazard waiting to happen".
//
// Both are NON-PARAMETRIC (proportions only, § 36): drawn at the authored size and
// stretched by `Draggable`'s group scale, the light riding the same scale. And both are
// ROUND, drawn on a circle of the declared width — the renderer stretches it to the depth,
// as it does the stool's.
//
// This module imports nothing at runtime, because `scene-spec.ts` imports it for
// `lightAnchor` and `hard-goods.ts` already imports `scene-spec.ts`.

import type { HardPart } from './hard-goods';

type V3 = [number, number, number];

/** A lamp's shade: an open drum, radii and height in metres, centred at `y`. */
export type LampShadeForm = { rTop: number; rBottom: number; h: number; y: number };

export type LampForm = {
  /** Everything but the shade, as hard-goods parts. */
  parts: HardPart[];
  shade: LampShadeForm;
  /** Where the light comes from: the bulb's centre, in the piece's frame. */
  bulb: V3;
};

function post(key: string, tone: HardPart['tone'], r: number, rBottom: number, y0: number, y1: number): HardPart {
  return { kind: 'post', key, tone, r, rBottom, h: y1 - y0, pos: [0, (y0 + y1) / 2, 0] };
}

/** A bulb's height inside its drum, as a share of the drum's height. Its width is a
 *  share of the lamp's width, so the two are separable (§ 36's test) and a squat lamp's
 *  shallow shade still holds its bulb — sizing it off the width alone hung it below the
 *  rim of a 450 × 250 lamp. */
const BULB_IN_SHADE = 0.22;

/** A floor lamp's proportions, as shares of its declared width (radial) and height. */
export const FLOOR_LAMP = {
  baseR: 0.45, baseH: 0.016, collarR: 0.11, collarH: 0.012, poleR: 0.04,
  shadeH: 0.19, shadeTop: 0.86, socketR: 0.06, socketH: 0.035, bulbR: 0.12,
} as const;

/** A floor lamp: a weighted disc with a turned collar, a slim pole, a socket and bulb
 *  standing up inside an open drum. Floor piece, ROUND, reads the width and height. */
export function floorLampForm(dimMM: readonly number[]): LampForm {
  const w = dimMM[0] / 1000;
  const h = dimMM[2] / 1000;
  const L = FLOOR_LAMP;
  const r = w / 2;
  const sH = h * L.shadeH;
  const ySh = h - sH; // the shade's open bottom
  const baseT = h * L.baseH;
  const collarT = baseT + h * L.collarH;
  // The bulb sits a little below the drum's middle, so the shade's lower half glows
  // and the bulb is seen from a seated eye; the socket stands it there.
  const bulbR = w * L.bulbR;
  const bulbRy = sH * BULB_IN_SHADE;
  const yBulb = ySh + sH * 0.42;
  const ySocket1 = yBulb - bulbRy * 0.8;
  const ySocket0 = ySocket1 - h * L.socketH;
  const parts: HardPart[] = [
    post('base', 'brass', w * L.baseR, w * (L.baseR + 0.02), 0, baseT), // its rim eased
    post('collar', 'brass', w * L.collarR * 0.5, w * L.collarR, baseT, collarT),
    post('pole', 'brass', w * L.poleR * 0.5, w * L.poleR * 0.5, collarT, ySocket0),
    post('socket', 'brass', w * L.socketR, w * L.socketR, ySocket0, ySocket1),
    { kind: 'ball', key: 'bulb', tone: 'bulb', radii: [bulbR, bulbRy, bulbR], pos: [0, yBulb, 0] },
  ];
  return {
    parts,
    shade: { rTop: r * L.shadeTop, rBottom: r, h: sH, y: ySh + sH / 2 },
    bulb: [0, yBulb, 0],
  };
}

/** A table lamp's proportions, as shares of its declared width (radial) and height. */
export const TABLE_LAMP = {
  footR: 0.2, footH: 0.03, bellyR: 0.32, bellyH: 0.4, neckR: 0.09, neckH: 0.06,
  stemR: 0.022, shadeH: 0.38, shadeTop: 0.82, socketR: 0.05, socketH: 0.04, bulbR: 0.1,
} as const;

/** A table lamp: a glazed ceramic vessel — a turned foot, a full belly and a neck —
 *  carrying a brass stem, socket and bulb up into an open drum. Floor piece (it stands
 *  on whatever carries it), ROUND, reads the width and height. */
export function tableLampForm(dimMM: readonly number[]): LampForm {
  const w = dimMM[0] / 1000;
  const h = dimMM[2] / 1000;
  const L = TABLE_LAMP;
  const r = w / 2;
  const yFoot = h * L.footH;
  const bellyRy = (h * L.bellyH) / 2;
  // The belly sinks a little into the foot and the neck into the belly, so the vessel
  // is one turned piece rather than three touching ones.
  const yBelly = yFoot + bellyRy * 0.96;
  const yNeck0 = yBelly + bellyRy * 0.9;
  const yNeck1 = yNeck0 + h * L.neckH;
  const sH = h * L.shadeH;
  const ySh = h - sH;
  const bulbR = w * L.bulbR;
  const bulbRy = sH * BULB_IN_SHADE;
  const yBulb = ySh + sH * 0.4;
  const ySocket1 = yBulb - bulbRy * 0.8;
  const ySocket0 = ySocket1 - h * L.socketH;
  const parts: HardPart[] = [
    post('foot', 'ceramic', w * L.footR * 0.9, w * L.footR, 0, yFoot),
    { kind: 'ball', key: 'belly', tone: 'ceramic', radii: [w * L.bellyR, bellyRy, w * L.bellyR], pos: [0, yBelly, 0] },
    post('neck', 'ceramic', w * L.neckR * 0.8, w * L.neckR, yNeck0, yNeck1),
    post('stem', 'brass', w * L.stemR, w * L.stemR, yNeck1, ySocket0),
    post('socket', 'brass', w * L.socketR, w * L.socketR, ySocket0, ySocket1),
    { kind: 'ball', key: 'bulb', tone: 'bulb', radii: [bulbR, bulbRy, bulbR], pos: [0, yBulb, 0] },
  ];
  return {
    parts,
    shade: { rTop: r * L.shadeTop, rBottom: r, h: sH, y: ySh + sH / 2 },
    bulb: [0, yBulb, 0],
  };
}

/** The lamp form for a shape, or null for one that is not a standing lamp. */
export function lampForm(shape: string, dimMM: readonly number[]): LampForm | null {
  if (shape === 'lamp-floor') return floorLampForm(dimMM);
  if (shape === 'lamp-table') return tableLampForm(dimMM);
  return null;
}
