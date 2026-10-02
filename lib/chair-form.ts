// The dining chair, the office chair and the armchair as the real objects.
//
// All three were hard-coded metres stretched to the declared size by `FitToDim`: a slab
// on four square sticks with three bars across the back; a box on a box on a box with a
// star of flat plates under it; two upholstered blocks either side of two cushions on
// square posts. What makes each read as itself is joinery the stretch could not say — a
// dining chair's seat sits IN a frame of rails on legs braced by stretchers, its back a
// crest rail and slats between the uprights; an office chair rolls on five casters under
// a star, rises on a gas lift through a mechanism, and its back is a shell carrying a
// cushion; an armchair's arms are rolled, its legs turned and tapered.
//
// **Two numbers per seat are not cosmetic, and they are why the constants live here.**
// `tuckProfile` (`lib/layout-rules.ts`) reads how high the part of a seat that goes under
// a table reaches (`seatTop` / `armTop`) and how much of its depth, from the back, stands
// taller than that (`back`). They were literals in that file describing a renderer here,
// held together only by `tests/seat-fit.test.tsx` measuring the drawing. They are read
// from these objects now, so the rule and the drawing are one number — and the values
// are the ones the old drawings had, so a chair tucks exactly as far as it did.
//
// All three are NON-PARAMETRIC (proportions only, § 36): drawn at the authored size and
// stretched by `Draggable`'s group scale. Every length is a share of exactly one axis —
// x of the width, y of the height, z of the depth — so the stretch reproduces the form.
// The one exception is named where it is: the armchair's scatter cushion leans, which
// mixes two axes in its placement, as it did under `FitToDim`.
//
// The front is local +Z (`lib/geometry.ts`); a floor piece stands on y = 0.

import type { HardPart, HardTone } from './hard-goods';
import { leaningCushion, standUp, THROW_LEAN, type SoftItem } from './soft-goods';

type V3 = [number, number, number];

/** A box from its extents, as `hard-goods.ts` writes them. */
function slab(key: string, tone: HardTone, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): HardPart {
  return { kind: 'box', key, tone, size: [x1 - x0, y1 - y0, z1 - z0], pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] };
}

/** An upright cushion item from its extents: a box cushion's flat top and bottom faces
 *  are exactly its box's at the centre, which is where a seat's height is read. */
function pad(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): SoftItem {
  return { pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0] };
}

/** A cushion stood up facing forward (`standUp(0)`): its width on x, thickness on z and
 *  height on y, from its extents. */
function upright(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): SoftItem {
  return { pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, z1 - z0, y1 - y0], rot: standUp(0) };
}

const m = (dimMM: readonly number[]): V3 => [dimMM[0] / 1000, dimMM[1] / 1000, dimMM[2] / 1000];

// ─── Dining chair ────────────────────────────────────────────────────────────

/** A dining chair's proportions: x shares of the width, y of the height, z of the depth.
 *  `seatTop` and `back` are `tuckProfile`'s — the seat pad's top, and the share of the
 *  depth from the back that the uprights stand in. */
export const DINING_CHAIR = {
  seatTop: 490 / 1090,
  back: 55 / 420,
  leg: 0.075,
  frontLeg: 0.075,
  rearLeg: 0.095,
  pad: 0.05,
  apron: 0.08,
  railInset: 0.015,
  rail: 0.04,
  stretcherY: 0.13,
  stretcherH: 0.03,
  crest: 0.07,
  crestD: 0.075,
  slat: 0.07,
} as const;

export type DiningChairForm = { parts: HardPart[]; pad: SoftItem };

/** A dining chair: four square legs braced by a low H-stretcher, a seat frame of rails
 *  set in from the legs' faces, an upholstered pad on the frame, and a back of a crest
 *  rail and a lower rail between the rear uprights with three slats between them.
 *
 *  The rear legs run up into the crest rail, which is what carries a chair's back; the
 *  rails' ends are buried in the legs, never flush with a face; and where two rails meet
 *  inside a leg one stops at the other's face rather than sharing its top. */
export function diningChairForm(dimMM: readonly number[]): DiningChairForm {
  const [w, d, h] = m(dimMM);
  const C = DINING_CHAIR;
  const yS = h * C.seatTop;
  const yPad = yS - h * C.pad; // the pad's underside, which the legs carry
  const yRail1 = yPad - h * 0.004; // the rails stop a hair under it, clear of the legs' tops
  const yRail0 = yPad - h * C.apron;
  const xo = w / 2; // the legs' outer faces are the chair's width
  const xi = xo - w * C.leg;
  const xc = (xo + xi) / 2; // a leg's centreline
  const zF1 = d / 2;
  const zF0 = zF1 - d * C.frontLeg;
  const zB1 = -d / 2 + d * C.back; // the uprights' front face: the back's frontmost point
  const zB0 = zB1 - d * C.rearLeg;
  const zFc = (zF0 + zF1) / 2;
  const zBc = (zB0 + zB1) / 2;
  const ri = d * C.railInset;
  const rt = d * C.rail;
  const parts: HardPart[] = [];
  for (const s of [-1, 1] as const) {
    const [a, b] = s < 0 ? [-xo, -xi] : [xi, xo];
    parts.push(slab(`leg-f${s}`, 'body', a, b, 0, yPad, zF0, zF1));
    parts.push(slab(`leg-r${s}`, 'body', a, b, 0, h * 0.98, zB0, zB1));
  }
  // The seat frame: front and back rails between the legs, set back from their faces; the
  // side rails between those two, so no two rails share a top inside a leg.
  const zFr1 = zF1 - ri;
  const zBr0 = zB1 - ri - rt;
  parts.push(
    slab('rail-front', 'body', -xc, xc, yRail0, yRail1, zFr1 - rt, zFr1),
    slab('rail-back', 'body', -xc, xc, yRail0, yRail1, zBr0, zB1 - ri),
  );
  for (const s of [-1, 1] as const) {
    const x1 = xo - w * C.railInset;
    const x0 = x1 - w * C.rail;
    parts.push(slab(`rail-side${s}`, 'body', s < 0 ? -x1 : x0, s < 0 ? -x0 : x1, yRail0, yRail1, zB1 - ri, zFr1 - rt));
  }
  // An H-stretcher low down: a rail along each side, centred in the legs, and one across
  // between them at mid-depth, a little slimmer so its faces sit inside theirs.
  const ySt0 = h * C.stretcherY;
  const ySt1 = ySt0 + h * C.stretcherH;
  const sw = w * 0.0125;
  for (const s of [-1, 1] as const) {
    parts.push(slab(`stretcher${s}`, 'body', s * xc - sw, s * xc + sw, ySt0, ySt1, zBc, zFc));
  }
  const zMid = (zBc + zFc) / 2;
  parts.push(slab('stretcher-x', 'body', -xc, xc, ySt0 + h * 0.005, ySt1 - h * 0.005, zMid - d * 0.02, zMid + d * 0.02));
  // The back: a crest rail capping the uprights and set back behind their faces, a lower
  // rail above the seat, and three slats standing in both.
  const yCrest = h * (1 - C.crest);
  parts.push(slab('crest', 'body', -(xo - w * 0.01), xo - w * 0.01, yCrest, h, -d / 2, -d / 2 + d * C.crestD));
  const yLow0 = yS + h * 0.07;
  const yLow1 = yS + h * 0.115;
  parts.push(slab('rail-low', 'body', -xc, xc, yLow0, yLow1, -d / 2 + d * 0.045, -d / 2 + d * 0.085));
  for (const [i, x] of [-0.2, 0, 0.2].entries()) {
    const half = (w * C.slat) / 2;
    parts.push(slab(`slat-${i}`, 'body', w * x - half, w * x + half, yLow1 - h * 0.015, yCrest + h * 0.01, -d / 2 + d * 0.05, -d / 2 + d * 0.07));
  }
  // The pad covers the frame and runs back between the uprights; its top is the seat.
  return { parts, pad: pad(-(xo - w * 0.01), xo - w * 0.01, yPad, yS, zB1 - d * 0.03, zF1 - d * 0.01) };
}

// ─── Office chair ────────────────────────────────────────────────────────────

/** An office chair's proportions: x shares of the width, y of the height, z of the
 *  depth. `armTop` and `back` are `tuckProfile`'s — the armrests' top, which is what goes
 *  under a desk first, and the share of the depth from the back that the backrest's
 *  cushion stands in front of. */
export const OFFICE_CHAIR = {
  armTop: 640 / 1150,
  back: 70 / 480,
  seatTop: 0.47,
  caster: 0.45,
  spoke: 0.022,
  backTh: 0.1,
  backY: 0.6,
} as const;

export type OfficeChairForm = { parts: HardPart[]; seat: SoftItem; back: SoftItem };

/** An office chair: five casters under a star of spokes, a hub, a gas lift in its dust
 *  cover rising into the seat mechanism, a seat cushion on a pan, T-arms on brackets out
 *  from the mechanism, and a back cushion on a shell carried by a spine from under the
 *  seat. */
export function officeChairForm(dimMM: readonly number[]): OfficeChairForm {
  const [w, d, h] = m(dimMM);
  const C = OFFICE_CHAIR;
  const yArm = h * C.armTop;
  const parts: HardPart[] = [
    { kind: 'post', key: 'hub', tone: 'steel', r: w * 0.055, rBottom: w * 0.065, h: h * 0.045, pos: [0, h * 0.0825, 0] },
    { kind: 'post', key: 'cover', tone: 'dark', r: w * 0.038, rBottom: w * 0.045, h: h * 0.17, pos: [0, h * 0.185, 0] },
    { kind: 'post', key: 'lift', tone: 'steel', r: w * 0.022, rBottom: w * 0.022, h: h * 0.105, pos: [0, h * 0.3225, 0] },
  ];
  // One spoke points straight ahead, as a real star's does, so the chair rolls under a desk
  // on a caster rather than between two.
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const c = Math.cos(a);
    const s = Math.sin(a);
    parts.push({ kind: 'strut', key: `spoke-${i}`, tone: 'steel', r: w * C.spoke, a: [c * w * 0.03, h * 0.085, s * d * 0.03], b: [c * w * 0.42, h * 0.065, s * d * 0.42] });
    parts.push({ kind: 'post', key: `stem-${i}`, tone: 'dark', r: w * 0.012, rBottom: w * 0.012, h: h * 0.035, pos: [c * w * 0.43, h * 0.0525, s * d * 0.43] });
    // A caster trails its stem, as a swivel caster does.
    parts.push({ kind: 'ball', key: `caster-${i}`, tone: 'dark', radii: [w * 0.045, h * 0.025, d * 0.045], pos: [c * w * C.caster, h * 0.025, s * d * C.caster] });
  }
  parts.push(
    slab('mechanism', 'dark', -w * 0.15, w * 0.15, h * 0.37, h * 0.405, -d * 0.16, d * 0.12),
    slab('pan', 'dark', -w * 0.4, w * 0.4, h * 0.405, h * 0.418, -d * 0.4, d * 0.44),
  );
  for (const s of [-1, 1] as const) {
    const xs = (a: number, b: number): [number, number] => (s < 0 ? [-b, -a] : [a, b]);
    parts.push(slab(`bracket${s}`, 'dark', ...xs(w * 0.1, w * 0.485), h * 0.38, h * 0.398, -d * 0.13, -d * 0.05));
    parts.push(slab(`arm-post${s}`, 'dark', ...xs(w * 0.435, w * 0.475), h * 0.385, yArm - h * 0.012, -d * 0.12, -d * 0.06));
    parts.push(slab(`arm${s}`, 'dark', ...xs(w * 0.42, w * 0.49), yArm - h * 0.028, yArm, -d * 0.28, d * 0.2));
  }
  // The back: a spine from under the seat up the back, a shell on it, and the cushion.
  const zBack = -d / 2 + d * C.back; // the cushion's front, the back's frontmost point
  parts.push(
    slab('spine-foot', 'dark', -w * 0.035, w * 0.035, h * 0.375, h * 0.4, -d * 0.47, -d * 0.15),
    slab('spine', 'dark', -w * 0.04, w * 0.04, h * 0.38, h * 0.8, -d * 0.495, -d * 0.455),
    slab('shell', 'dark', -w * 0.4, w * 0.4, h * 0.62, h * 0.98, -d * 0.465, -d * 0.43),
  );
  return {
    parts,
    seat: pad(-w * 0.41, w * 0.41, h * 0.414, h * C.seatTop, -d * 0.39, d * 0.46),
    back: upright(-w * 0.42, w * 0.42, h * C.backY, h, zBack - d * C.backTh, zBack),
  };
}

// ─── Armchair ────────────────────────────────────────────────────────────────

/** An armchair's proportions: x shares of the width, y of the height, z of the depth. */
export const ARMCHAIR = {
  legH: 0.17,
  legR: 0.032,
  arm: 0.13,
  armTop: 0.64,
  roll: 0.07,
  seatTop: 0.49,
} as const;

export type ArmchairForm = { parts: HardPart[]; seat: SoftItem; back: SoftItem; scatter: SoftItem };

/** An armchair: four turned, tapered legs under an upholstered base, two rolled arms the
 *  depth of the chair, a back panel between them, a seat cushion and a back cushion, and
 *  one scatter cushion leaning on the back.
 *
 *  The scatter cushion is the one part that is not proportions only: it leans, so where
 *  it rests is a function of two axes at once, and it is placed by its own surface with
 *  `leaningCushion`'s fixed sink. It is what `FitToDim` drew as well. */
export function armchairForm(dimMM: readonly number[]): ArmchairForm {
  const [w, d, h] = m(dimMM);
  const C = ARMCHAIR;
  const yLeg = h * C.legH;
  const xa1 = w / 2 - w * 0.005;
  const xa0 = xa1 - w * C.arm;
  const xr = (xa0 + xa1) / 2; // the roll's axis
  const yArm = h * C.armTop;
  const parts: HardPart[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    parts.push({ kind: 'post', key: `leg-${sx}${sz}`, tone: 'wood', r: w * C.legR, rBottom: w * 0.02, h: yLeg, pos: [sx * w * 0.43, yLeg / 2, sz * d * 0.43] });
  }
  for (const s of [-1, 1] as const) {
    parts.push(slab(`arm${s}`, 'body', s < 0 ? -xa1 : xa0, s < 0 ? -xa0 : xa1, yLeg, yArm, -d * 0.49, d * 0.49));
    // A rolled arm: a bolster along the arm's top, a little proud of its faces at each end.
    parts.push({ kind: 'disc', key: `roll${s}`, tone: 'body', r: w * C.roll, t: d, pos: [s * xr, yArm, 0] });
  }
  parts.push(
    slab('base', 'body', -w * 0.4, w * 0.4, h * 0.19, h * 0.37, -d * 0.46, d * 0.47),
    slab('back-panel', 'body', -w * 0.42, w * 0.42, h * 0.2, h * 0.97, -d * 0.5, -d * 0.36),
  );
  const seat = pad(-w * 0.355, w * 0.355, h * 0.365, h * C.seatTop, -d * 0.3, d * 0.48);
  const back = upright(-w * 0.35, w * 0.35, h * 0.45, h, -d * 0.38, -d * 0.23);
  const scatter = leaningCushion(0, w * 0.486, d * 0.143, h * 0.333, THROW_LEAN, h * C.seatTop, -d * 0.23);
  return { parts, seat, back, scatter };
}

// ─── Ottoman ─────────────────────────────────────────────────────────────────

/** An ottoman's proportions: `legH` and `base` are shares of the height — where the legs
 *  meet the upholstered base, and where the base meets the top cushion — and `button` the
 *  tufting buttons' height, which is the share of the height the cushion stops below the
 *  top: the buttons are what reach `dimMM[2]`, so a tray set on one sits on its buttons. */
export const OTTOMAN = { legH: 0.16, base: 0.74, button: 0.008 } as const;

export type OttomanForm = { parts: HardPart[]; top: SoftItem };

/** An upholstered ottoman: four turned, tapered legs in brass ferrules, a base a little
 *  inside the outline with a piped welt round its top edge, and a box cushion the full
 *  outline buttoned twice each way. It was a block on four square sticks with a band of
 *  darker block round its top.
 *
 *  NON-PARAMETRIC (proportions only, § 36). The legs' radii are shares of the width, so a
 *  deep ottoman's legs are stretched to ovals by the group scale, as the armchair's are —
 *  and a long, shallow one's must still stand under its base. A leg at 0.39 of the depth
 *  has 0.08 of it to the base's face; the band's longest, shallowest corner (1200 × 350)
 *  fits a radius of 0.02 of the width inside that, where 0.03 at 0.4 of the depth stood a
 *  leg 1 mm outside the box and 0.025 still stood one 5.5 mm outside the base. */
export function ottomanForm(dimMM: readonly number[]): OttomanForm {
  const [w, d, h] = m(dimMM);
  const C = OTTOMAN;
  const yLeg = h * C.legH;
  const yBase = h * C.base;
  const by = h * C.button;
  const yFerrule = h * 0.03;
  const parts: HardPart[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x = sx * w * 0.4;
    const z = sz * d * 0.39;
    // The leg stands in its ferrule and runs a little up into the base.
    const y0 = h * 0.02;
    const y1 = yLeg + h * 0.01;
    parts.push(
      { kind: 'post', key: `leg-${sx}${sz}`, tone: 'wood', r: w * 0.02, rBottom: w * 0.014, h: y1 - y0, pos: [x, (y0 + y1) / 2, z] },
      { kind: 'post', key: `ferrule-${sx}${sz}`, tone: 'brass', r: w * 0.016, rBottom: w * 0.016, h: yFerrule, pos: [x, yFerrule / 2, z] },
    );
  }
  parts.push(
    slab('base', 'body', -w * 0.47, w * 0.47, yLeg, yBase, -d * 0.47, d * 0.47),
    slab('welt', 'trim', -w * 0.48, w * 0.48, yBase - h * 0.03, yBase + h * 0.004, -d * 0.48, d * 0.48),
  );
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      parts.push({ kind: 'ball', key: `button-${sx}${sz}`, tone: 'trim', radii: [w * 0.012, by, d * 0.016], pos: [sx * w * 0.22, h - by, sz * d * 0.22] });
    }
  }
  const top = pad(-w / 2, w / 2, yBase - h * 0.01, h - by, -d / 2, d / 2);
  return { parts, top };
}
