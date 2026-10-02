// Hard goods: the casework, appliances and joinery that `lib/soft-goods.ts` is the cloth
// half of. Each function returns a piece as a list of named parts — boxes, upright posts,
// front-facing discs and rings, ellipsoids — in the piece's own frame, metres, and the renderer
// (`components/three/DynamicPart.tsx`) does nothing but colour them. A strut — a rod at
// any angle, a splayed leg — is the one part three cannot place from its fields alone, so
// `strutPose` does that arithmetic here too.
//
// They were each a box with one or two details stuck on: a chest freezer was a body, a
// lid and a handle, a TV console two slabs and three uprights round open air, a door a
// slab with a sphere. What makes a piece read as the real object is mostly where it is
// NOT one block — a lid line, a plinth set back from the body, a door standing inside its
// frame, a panel thinner than the rails round it — and every one of those is a number,
// which is why they live here where a test can reach them (CLAUDE.md rule 2, and the
// `fanBlade` scar it names).
//
// Two rules hold every form, and both are measured in `tests/hard-goods.test.ts`:
//
//   · NOTHING LEAVES ITS BOX except where the real object does. Every part of every form
//     sits inside `dimMM` — floor pieces in [0, h], wall pieces centred on their origin —
//     with two named exceptions: a door's lever, which stands into the room the way a
//     lever does, and its hinge knuckles, which wrap the leaf's edge by a few millimetres.
//     A handle that stands proud on a real appliance is inside the declared depth here,
//     because the declared depth is the one every consumer reads.
//
//   · A NON-PARAMETRIC FORM IS PROPORTIONS ONLY. Those shapes are drawn at their authored
//     size and stretched by `Draggable`'s group scale, so an absolute chosen inside them
//     (a 20 mm handle) is stretched with the rest — § 36, which
//     `tests/parametric-caps.test.ts` guards in the renderer by regex and which a module
//     outside the renderer would otherwise slip past. So the test asks the property
//     itself: scale the declared size along one axis and every box moves and grows along
//     that axis alone, by exactly that factor. The parametric forms here
//     (`tvConsoleForm`, `doorForm`, `nightstandForm`, `stoolForm`) are drawn at the size
//     actually stored and are free to hold real joinery dimensions, which is the point of
//     their being parametric.
//
// Faces that would share a plane are kept apart by construction rather than by luck:
// where two parts' fronts face the same way, they are at different depths or meet only
// along an edge. `tests/coplanar-faces.test.tsx` sweeps the result at three sizes.

import { consoleSlabs, doorHandleY, drawerSlide, radiatorFins, stoolSeat } from './scene-spec';

type V3 = [number, number, number];

/** What a part is made of, as the renderer is told it. A role, not a colour: `body` is
 *  whatever the user has painted the piece, and the rest come from `DETAIL` in
 *  `lib/scene-palette.ts` or a shade of the body. */
export type HardTone =
  | 'body' // the piece's own colour
  | 'trim' // the body a shade darker — a recess, a door frame
  | 'panel' // the body a shade lighter — a fascia, a control strip
  | 'grille' // a speaker's cloth, a shade off the body and matte
  | 'dark' // near-black hardware: feet, gaskets, slots
  | 'steel'
  | 'brass'
  | 'wood' // dark walnut legs
  | 'glass' // an appliance's smoked window
  | 'display' // a dark readout with a faint glow
  | 'led' // a status light
  | 'water' // a dispenser's bottle
  | 'hot'
  | 'cold'
  | 'screen' // a television's panel, switched off
  | 'ceramic' // a glazed vessel — a table lamp's body
  | 'bulb'; // a lit lamp bulb

export type HardPart =
  | { kind: 'box'; key: string; tone: HardTone; size: V3; pos: V3 }
  /** An upright cylinder, `r` at the top and `rBottom` at the foot, centred on `pos`. */
  | { kind: 'post'; key: string; tone: HardTone; r: number; rBottom: number; h: number; pos: V3 }
  /** A cylinder lying on the piece's depth axis, its face turned to the front: a dial, a
   *  porthole's glass, a lever's neck. `t` is its depth. */
  | { kind: 'disc'; key: string; tone: HardTone; r: number; t: number; pos: V3 }
  /** A torus facing the front: a washing machine's door ring. */
  | { kind: 'ring'; key: string; tone: HardTone; r: number; tube: number; pos: V3 }
  /** A rod of radius `r` from end `a` to end `b`, at any angle: a splayed leg, a
   *  stretcher. `strutPose` says how the renderer stands a cylinder on it. */
  | { kind: 'strut'; key: string; tone: HardTone; r: number; a: V3; b: V3 }
  /** An ellipsoid, its three semi-axes in `radii` — a bulb, a vessel's belly. */
  | { kind: 'ball'; key: string; tone: HardTone; radii: V3; pos: V3 };

/** A box from its extents rather than its centre and size — every form here is reasoned
 *  about edge by edge (this face sits on that one), and writing centres would put the
 *  arithmetic of each edge into a half-size nobody reads. */
function slab(key: string, tone: HardTone, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): HardPart {
  return {
    kind: 'box',
    key,
    tone,
    size: [x1 - x0, y1 - y0, z1 - z0],
    pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  };
}

const m = (dimMM: readonly number[]): V3 => [dimMM[0] / 1000, dimMM[1] / 1000, dimMM[2] / 1000];

// ─── Non-parametric: proportions only ────────────────────────────────────────

/** A chest freezer: a cabinet on a recessed plinth, a dark gasket line under a lid, a
 *  handle along the lid's front edge, and the thermostat's badge with its light.
 *
 *  The handle stands proud of the cabinet, as a real one does, and so the cabinet stops
 *  short of the declared depth by the handle's projection rather than the handle
 *  standing outside it. Floor piece: `y` runs 0 → h. */
export function chestFreezerForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const plinth = h * 0.06;
  const lid = h * 0.1;
  const gasket = h * 0.012;
  const proud = d * 0.03;
  const front = d / 2 - proud;
  const yc = h - lid - gasket;
  return [
    slab('plinth', 'dark', -w / 2 + w * 0.015, w / 2 - w * 0.015, 0, plinth, -d / 2 + d * 0.03, front - d * 0.03),
    slab('cabinet', 'body', -w / 2, w / 2, plinth, yc, -d / 2, front),
    slab('gasket', 'dark', -w / 2 + w * 0.006, w / 2 - w * 0.006, yc, yc + gasket, -d / 2 + d * 0.012, front - d * 0.012),
    slab('lid', 'body', -w / 2, w / 2, h - lid, h, -d / 2, front),
    slab('handle', 'steel', -w * 0.17, w * 0.17, h - lid * 0.75, h - lid * 0.3, front - d * 0.004, d / 2),
    slab('badge', 'display', w / 2 - w * 0.14, w / 2 - w * 0.05, yc - h * 0.08, yc - h * 0.03, front - d * 0.002, front + d * 0.006),
    slab('light', 'led', w / 2 - w * 0.075, w / 2 - w * 0.062, yc - h * 0.062, yc - h * 0.048, front + d * 0.004, front + d * 0.009),
  ];
}

/** A wall-hung split air conditioner: a chassis, a lighter fascia over its upper front,
 *  the dark outlet slot below it with its louvre flap, and a small display with a light.
 *  Wall piece: centred on its origin, back on `-d/2`. */
export function acUnitForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const zc = -d / 2 + d * 0.78; // the chassis's front
  const y = (k: number) => -h / 2 + h * k; // a height as a share of the unit, from its underside
  return [
    slab('chassis', 'body', -w / 2, w / 2, -h / 2, h / 2, -d / 2, zc),
    slab('fascia', 'panel', -w / 2 + w * 0.008, w / 2 - w * 0.008, y(0.3), y(0.98), zc - d * 0.01, d / 2 - d * 0.02),
    slab('outlet', 'dark', -w * 0.44, w * 0.44, y(0.1), y(0.28), zc - d * 0.01, zc + d * 0.04),
    slab('flap', 'panel', -w * 0.43, w * 0.43, y(0.07), y(0.1), zc, zc + d * 0.16),
    slab('display', 'display', w * 0.3, w * 0.4, y(0.36), y(0.44), d / 2 - d * 0.03, d / 2 - d * 0.005),
    slab('light', 'led', w * 0.37, w * 0.385, y(0.39), y(0.41), d / 2 - d * 0.01, d / 2),
  ];
}

/** A soundbar: a body with end caps, a cloth grille across the front between them, on
 *  two low feet. Floor piece. */
export function soundbarForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const foot = h * 0.06;
  const cap = w * 0.035;
  return [
    slab('foot-l', 'dark', -w * 0.34, -w * 0.26, 0, foot, -d * 0.3, d * 0.3),
    slab('foot-r', 'dark', w * 0.26, w * 0.34, 0, foot, -d * 0.3, d * 0.3),
    slab('cap-l', 'body', -w / 2, -w / 2 + cap, foot, h, -d / 2, d / 2),
    slab('cap-r', 'body', w / 2 - cap, w / 2, foot, h, -d / 2, d / 2),
    slab('core', 'body', -w / 2 + cap, w / 2 - cap, foot, h, -d / 2, d / 2 - d * 0.06),
    slab('grille', 'grille', -w / 2 + cap, w / 2 - cap, foot + h * 0.08, h - h * 0.08, d / 2 - d * 0.07, d / 2),
  ];
}

/** A water dispenser: a cabinet on a plinth with a recessed alcove where the taps hang
 *  over a drip tray, and an inverted bottle on a collar — neck, shoulder, body and the
 *  dome of its base, all inside the declared height. The taps used to stand 47 mm
 *  in front of the cabinet and the bottle 20 mm above the piece; the alcove is where a
 *  real dispenser keeps them. Floor piece. */
export function waterDispenserForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const ya = h * 0.4; // alcove floor
  const yb = h * 0.6; // alcove ceiling
  const hb = h * 0.68; // cabinet top
  const wall = w * 0.08;
  const deep = d * 0.42; // alcove depth
  const tap = (key: string, tone: HardTone, cx: number) =>
    slab(key, tone, cx - w * 0.04, cx + w * 0.04, yb - h * 0.05, yb, d / 2 - deep * 0.7, d / 2 - deep * 0.7 + d * 0.08);
  const post = (key: string, tone: HardTone, r: number, rBottom: number, y0: number, y1: number): HardPart => ({
    kind: 'post', key, tone, r, rBottom, h: y1 - y0, pos: [0, (y0 + y1) / 2, 0],
  });
  return [
    slab('plinth', 'dark', -w / 2 + w * 0.03, w / 2 - w * 0.03, 0, h * 0.03, -d / 2 + d * 0.03, d / 2 - d * 0.03),
    slab('lower', 'body', -w / 2, w / 2, h * 0.03, ya, -d / 2, d / 2),
    slab('wall-l', 'body', -w / 2, -w / 2 + wall, ya, yb, -d / 2, d / 2),
    slab('wall-r', 'body', w / 2 - wall, w / 2, ya, yb, -d / 2, d / 2),
    slab('alcove', 'trim', -w / 2 + wall, w / 2 - wall, ya, yb, -d / 2, d / 2 - deep),
    slab('upper', 'body', -w / 2, w / 2, yb, hb, -d / 2, d / 2),
    tap('tap-cold', 'cold', -w * 0.14),
    tap('tap-hot', 'hot', w * 0.14),
    slab('tray', 'steel', -w / 2 + wall + w * 0.03, w / 2 - wall - w * 0.03, ya, ya + h * 0.015, d / 2 - deep, d / 2 - deep * 0.1),
    post('collar', 'trim', w * 0.2, w * 0.2, hb, h * 0.7),
    post('neck', 'water', w * 0.07, w * 0.07, h * 0.7, h * 0.73),
    post('shoulder', 'water', w * 0.3, w * 0.07, h * 0.73, h * 0.78),
    post('bottle', 'water', w * 0.3, w * 0.3, h * 0.78, h * 0.97),
    post('base', 'water', w * 0.24, w * 0.3, h * 0.97, h),
  ];
}

/** A front-loading washing machine: a cabinet on four feet, a control strip with its
 *  detergent drawer, programme dial and display, a steel door ring round a smoked
 *  porthole, the door's catch, and the filter hatch at the foot. Floor piece. */
export function washingMachineForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const foot = h * 0.015;
  const zf = d / 2 - d * 0.06; // the cabinet's front
  // The ring's radius reads off the smaller face dimension and its tube off the depth,
  // so the ring stops `d·0.01` short of the declared front whatever the proportions.
  const R = Math.min(w, h) * 0.28;
  const tube = d * 0.025;
  const yc = h * 0.45;
  const fx = w / 2 - w * 0.08;
  const fz = d / 2 - d * 0.1;
  const foot4 = ([sx, sz]: [number, number], i: number) =>
    slab(`foot-${i}`, 'dark', sx * fx - w * 0.03, sx * fx + w * 0.03, 0, foot, sz * fz - d * 0.03, sz * fz + d * 0.03);
  return [
    ...([[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>).map(foot4),
    slab('cabinet', 'body', -w / 2, w / 2, foot, h, -d / 2, zf),
    slab('controls', 'panel', -w / 2 + w * 0.01, w / 2 - w * 0.01, h * 0.86, h * 0.98, zf - d * 0.005, zf + d * 0.01),
    slab('drawer', 'body', -w / 2 + w * 0.04, -w / 2 + w * 0.36, h * 0.875, h * 0.965, zf + d * 0.005, zf + d * 0.022),
    slab('drawer-pull', 'dark', -w / 2 + w * 0.25, -w / 2 + w * 0.33, h * 0.88, h * 0.895, zf + d * 0.02, zf + d * 0.026),
    slab('display', 'display', w * 0.02, w * 0.17, h * 0.9, h * 0.94, zf + d * 0.008, zf + d * 0.016),
    { kind: 'disc', key: 'dial', tone: 'steel', r: h * 0.03, t: d * 0.02, pos: [w * 0.3, h * 0.92, zf + d * 0.018] },
    { kind: 'ring', key: 'door-ring', tone: 'steel', r: R, tube, pos: [0, yc, zf + tube] },
    { kind: 'disc', key: 'porthole', tone: 'glass', r: R * 0.85, t: d * 0.03, pos: [0, yc, zf + d * 0.015] },
    // The catch reads off the width alone, not the ring's radius: a box that moved with
    // the HEIGHT when the height was the smaller side would be the cross-axis coupling a
    // group scale cannot reproduce.
    slab('catch', 'dark', w * 0.26, w * 0.29, yc - h * 0.03, yc + h * 0.03, zf, zf + d * 0.04),
    slab('hatch', 'trim', w / 2 - w * 0.17, w / 2 - w * 0.04, h * 0.03, h * 0.09, zf - d * 0.002, zf + d * 0.006),
  ];
}

/** A countertop microwave: a body on four feet, a door framing a smoked window with its
 *  pull, and a control column with a display, a dial and a start button. Floor piece
 *  (it stands on whatever carries it). */
export function microwaveForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const foot = h * 0.03;
  const zf = d / 2 - d * 0.03;
  const dx0 = -w / 2 + w * 0.015;
  const dx1 = w / 2 - w * 0.26;
  const fx = w / 2 - w * 0.07;
  const fz = d / 2 - d * 0.1;
  const foot4 = ([sx, sz]: [number, number], i: number) =>
    slab(`foot-${i}`, 'dark', sx * fx - w * 0.025, sx * fx + w * 0.025, 0, foot, sz * fz - d * 0.03, sz * fz + d * 0.03);
  return [
    ...([[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>).map(foot4),
    slab('body', 'body', -w / 2, w / 2, foot, h, -d / 2, zf),
    slab('door', 'trim', dx0, dx1, h * 0.06, h * 0.97, zf - d * 0.002, zf + d * 0.015),
    slab('window', 'glass', dx0 + w * 0.05, dx1 - w * 0.1, h * 0.16, h * 0.87, zf + d * 0.012, zf + d * 0.02),
    slab('pull', 'steel', dx1 - w * 0.05, dx1 - w * 0.02, h * 0.2, h * 0.83, zf + d * 0.01, d / 2),
    slab('controls', 'panel', w / 2 - w * 0.245, w / 2 - w * 0.015, h * 0.06, h * 0.97, zf - d * 0.002, zf + d * 0.01),
    slab('display', 'display', w / 2 - w * 0.22, w / 2 - w * 0.04, h * 0.78, h * 0.9, zf + d * 0.008, zf + d * 0.016),
    { kind: 'disc', key: 'dial', tone: 'steel', r: w * 0.06, t: d * 0.02, pos: [w / 2 - w * 0.13, h * 0.5, zf + d * 0.018] },
    slab('start', 'dark', w / 2 - w * 0.17, w / 2 - w * 0.09, h * 0.2, h * 0.27, zf + d * 0.008, zf + d * 0.018),
  ];
}

/** A flat-panel television: a slim frame round a recessed screen, a deeper chin at the
 *  foot with its standby light, and the electronics housing stepped in behind the panel
 *  the way every real set's is. It was one box with a glowing plane laid on its face.
 *
 *  Wall piece, centred on its origin, back on `-d/2`. */
export function tvForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const zb = d / 2 - d * 0.4; // the panel's back; the housing fills the rest
  const side = w * 0.008;
  const top = h * 0.014;
  const chin = h * 0.035;
  const y0 = -h / 2 + chin;
  const y1 = h / 2 - top;
  return [
    slab('housing', 'trim', -w * 0.34, w * 0.34, -h * 0.34, h * 0.3, -d / 2, zb),
    slab('frame-l', 'body', -w / 2, -w / 2 + side, y0, y1, zb, d / 2),
    slab('frame-r', 'body', w / 2 - side, w / 2, y0, y1, zb, d / 2),
    slab('frame-top', 'body', -w / 2, w / 2, y1, h / 2, zb, d / 2),
    // The chin stops a hair behind the frame so the light can stand flush with the
    // frame's face without sharing a plane with the chin's.
    slab('chin', 'body', -w / 2, w / 2, -h / 2, y0, zb, d / 2 - d * 0.02),
    slab('screen', 'screen', -w / 2 + side, w / 2 - side, y0, y1, zb, d / 2 - d * 0.05),
    slab('standby', 'led', -w * 0.006, w * 0.006, -h / 2 + chin * 0.35, -h / 2 + chin * 0.6, d / 2 - d * 0.04, d / 2),
  ];
}

// ─── Parametric: real joinery dimensions ─────────────────────────────────────

/** How far a TV console's doors stand back inside their frame, how thick they are, and
 *  the reveal round each, metres. Joinery, not proportions — the shape is parametric. */
export const CONSOLE_DOOR = { recess: 0.018, thick: 0.018, reveal: 0.0025 } as const;
/** The narrowest a console bay is drawn before it is merged with its neighbour, metres:
 *  a 550 mm bay is a door you can open and a niche a set-top box fits in. */
export const CONSOLE_BAY = 0.55;

/** How many bays a TV console of this width is divided into: two at the least (a pair of
 *  doors), five at the most. A module count off an absolute — `windowPanes`' shape —
 *  which is fine here because `tv-console` is parametric and drawn at its stored size. */
export function consoleBays(widthMM: number): number {
  return Math.min(5, Math.max(2, Math.round(widthMM / 1000 / CONSOLE_BAY)));
}

/** A low TV console on four tapered legs: a carcass of top, bottom, sides, back and
 *  dividers, a door in each end bay standing back inside its frame with a brass pull
 *  on its inner edge, and an open niche with a shelf in each bay between.
 *
 *  It was two slabs and three uprights round open air, which read as a shelving frame
 *  with nothing in it. Floor piece. */
export function tvConsoleForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const { top: t, foot: legH } = consoleSlabs(dimMM[2]);
  const back = Math.min(0.008, t * 0.5);
  const n = consoleBays(dimMM[0]);
  const bayW = (w - 2 * t - (n - 1) * t) / n;
  const { recess, thick, reveal } = CONSOLE_DOOR;
  const out: HardPart[] = [];
  const lx = w / 2 - Math.min(0.07, w * 0.1);
  const lz = d / 2 - Math.min(0.06, d * 0.2);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    out.push({ kind: 'post', key: `leg-${sx}${sz}`, tone: 'wood', r: 0.018, rBottom: 0.011, h: legH, pos: [sx * lx, legH / 2, sz * lz] });
  }
  out.push(
    slab('top', 'body', -w / 2, w / 2, h - t, h, -d / 2, d / 2),
    slab('bottom', 'body', -w / 2 + t, w / 2 - t, legH, legH + t, -d / 2, d / 2),
    slab('side-l', 'body', -w / 2, -w / 2 + t, legH, h - t, -d / 2, d / 2),
    slab('side-r', 'body', w / 2 - t, w / 2, legH, h - t, -d / 2, d / 2),
    slab('back', 'trim', -w / 2 + t, w / 2 - t, legH + t, h - t, -d / 2, -d / 2 + back),
  );
  const y0 = legH + t;
  const y1 = h - t;
  const doorH = y1 - y0 - 2 * reveal;
  const pullH = Math.min(0.16, doorH * 0.45);
  const pullInset = Math.min(0.03, bayW * 0.1);
  for (let i = 0; i < n; i++) {
    const bx0 = -w / 2 + t + i * (bayW + t);
    const bx1 = bx0 + bayW;
    if (i > 0) out.push(slab(`divider-${i}`, 'body', bx0 - t, bx0, y0, y1, -d / 2 + back, d / 2));
    if (i === 0 || i === n - 1) {
      const zf = d / 2 - recess;
      out.push(slab(`door-${i}`, 'body', bx0 + reveal, bx1 - reveal, y0 + reveal, y1 - reveal, zf - thick, zf));
      // The pull on the edge nearer the middle, which is the edge a door opens from.
      const px = i === 0 ? bx1 - reveal - pullInset - 0.012 : bx0 + reveal + pullInset;
      const pm = (y0 + y1) / 2;
      out.push(slab(`pull-${i}`, 'brass', px, px + 0.012, pm - pullH / 2, pm + pullH / 2, zf - 0.001, d / 2 - 0.002));
    } else {
      const sm = (y0 + y1) / 2;
      out.push(slab(`shelf-${i}`, 'body', bx0, bx1, sm - t * 0.4, sm + t * 0.4, -d / 2 + back, d / 2 - 0.01));
    }
  }
  return out;
}

/** How far a door's lever stands into the room from the leaf's face, metres. 50 mm is
 *  what lets fingers round it. */
export const LEVER_PROUD = 0.05;

/** A frame-and-panel door: two stiles, top, lock and bottom rails and a centre muntin,
 *  four panels thinner than the frame so each sits in a real recess on both faces, a
 *  brass lever on a backplate with its keyhole at hand height, and three hinge knuckles
 *  on the hinge edge.
 *
 *  Wall piece, centred on its origin, front (+z) into the room. It was a slab and a
 *  sphere. */
export function doorForm(dimMM: readonly number[]): HardPart[] {
  const [w, d, h] = m(dimMM);
  const stile = Math.min(0.12, w * 0.14);
  const topRail = stile;
  const botRail = Math.min(0.22, h * 0.1);
  const lockRail = Math.min(0.18, h * 0.08);
  const muntin = stile * 0.8;
  const hy = -h / 2 + doorHandleY(dimMM[2]);
  const lo = hy - lockRail / 2;
  const hi = hy + lockRail / 2;
  const pt = d * 0.45;
  const out: HardPart[] = [
    slab('stile-hinge', 'body', -w / 2, -w / 2 + stile, -h / 2, h / 2, -d / 2, d / 2),
    slab('stile-latch', 'body', w / 2 - stile, w / 2, -h / 2, h / 2, -d / 2, d / 2),
    slab('rail-top', 'body', -w / 2 + stile, w / 2 - stile, h / 2 - topRail, h / 2, -d / 2, d / 2),
    slab('rail-lock', 'body', -w / 2 + stile, w / 2 - stile, lo, hi, -d / 2, d / 2),
    slab('rail-bottom', 'body', -w / 2 + stile, w / 2 - stile, -h / 2, -h / 2 + botRail, -d / 2, d / 2),
    slab('muntin-low', 'body', -muntin / 2, muntin / 2, -h / 2 + botRail, lo, -d / 2, d / 2),
    slab('muntin-high', 'body', -muntin / 2, muntin / 2, hi, h / 2 - topRail, -d / 2, d / 2),
  ];
  const cols: Array<[number, number]> = [[-w / 2 + stile, -muntin / 2], [muntin / 2, w / 2 - stile]];
  const rows: Array<[number, number, string]> = [[-h / 2 + botRail, lo, 'low'], [hi, h / 2 - topRail, 'high']];
  for (const [x0, x1] of cols) {
    for (const [y0, y1, row] of rows) {
      out.push(slab(`panel-${row}-${x0 < 0 ? 'l' : 'r'}`, 'body', x0, x1, y0, y1, -pt / 2, pt / 2));
    }
  }
  // Lever furniture, centred on the latch stile.
  const xh = w / 2 - stile / 2;
  const ly = hy + 0.035;
  const plateW = Math.min(0.045, stile * 0.7);
  out.push(
    slab('backplate', 'brass', xh - plateW / 2, xh + plateW / 2, hy - 0.09, hy + 0.09, d / 2 - 0.001, d / 2 + 0.008),
    slab('keyhole', 'dark', xh - 0.004, xh + 0.004, hy - 0.06, hy - 0.04, d / 2 + 0.006, d / 2 + 0.0095),
    { kind: 'disc', key: 'lever-neck', tone: 'brass', r: 0.009, t: 0.032, pos: [xh, ly, d / 2 + 0.006 + 0.016] },
    slab('lever', 'brass', xh - 0.115, xh + 0.012, ly - 0.009, ly + 0.009, d / 2 + LEVER_PROUD - 0.016, d / 2 + LEVER_PROUD),
  );
  const knuckles = [h / 2 - 0.2, -h / 2 + 0.25, (h / 2 - 0.2 + (-h / 2 + 0.25)) / 2];
  knuckles.forEach((ky, i) =>
    out.push({ kind: 'post', key: `hinge-${i}`, tone: 'brass', r: 0.007, rBottom: 0.007, h: 0.1, pos: [-w / 2 + 0.004, ky, d / 2 - 0.004] }),
  );
  return out;
}

/** A nightstand's joinery, metres: the top's overhang past the carcass, its thickness,
 *  the carcass sides, a drawer front's thickness and the reveal round each drawer. */
export const NIGHTSTAND = { overhang: 0.012, top: 0.022, side: 0.018, front: 0.018, reveal: 0.003 } as const;

/** A nightstand on four short tapered legs: a top overhanging a carcass of sides, bottom
 *  rail and back, and two drawers set inside the frame — each a front with a reveal round
 *  it and a brass knob, and, while it is open, the drawer box behind it. `slide` is how
 *  far the drawers stand open, metres (`drawerSlide` at most); closed, the drawer boxes
 *  are not drawn, because nothing could see them. It was a block with two faces glued
 *  on. Floor piece. */
export function nightstandForm(dimMM: readonly number[], slide = 0): HardPart[] {
  const [w, d, h] = m(dimMM);
  const o = Math.min(NIGHTSTAND.overhang, w * 0.03, d * 0.03);
  const t = Math.min(NIGHTSTAND.top, h * 0.05);
  const s = Math.min(NIGHTSTAND.side, w * 0.05);
  const ft = Math.min(NIGHTSTAND.front, d * 0.05);
  const rv = NIGHTSTAND.reveal;
  const legH = Math.min(0.1, h * 0.18);
  const x0 = -w / 2 + o;
  const x1 = w / 2 - o;
  const zBack = -d / 2 + o;
  const zFront = d / 2 - o; // the frame's face
  const yTop = h - t;
  const out: HardPart[] = [];
  const lx = x1 - Math.min(0.03, w * 0.08);
  const lz = zFront - Math.min(0.03, d * 0.08);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    out.push({ kind: 'post', key: `leg-${sx}${sz}`, tone: 'body', r: 0.016, rBottom: 0.01, h: legH, pos: [sx * lx, legH / 2, sz * lz] });
  }
  out.push(
    slab('top', 'body', -w / 2, w / 2, yTop, h, -d / 2, d / 2),
    slab('side-l', 'body', x0, x0 + s, legH, yTop, zBack, zFront),
    slab('side-r', 'body', x1 - s, x1, legH, yTop, zBack, zFront),
    slab('bottom', 'body', x0 + s, x1 - s, legH, legH + s, zBack, zFront),
    // The inside of the carcass, a shade darker, which is what the reveals show. It runs
    // forward to the drawer fronts' backs, which is what holds them: a front that stopped
    // short of it hung in its reveal on nothing, detached from the rest of the piece.
    slab('cavity', 'trim', x0 + s, x1 - s, legH + s, yTop, zBack, zFront - 0.001 - ft),
  );
  const fy0 = legH + s;
  const half = (yTop - fy0) / 2;
  const fx0 = x0 + s + rv;
  const fx1 = x1 - s - rv;
  const zf = zFront - 0.001; // a drawer front stands a millimetre back from the frame
  const knobR = Math.min(0.014, half * 0.12);
  for (let i = 0; i < 2; i++) {
    const y0 = fy0 + i * half + rv;
    const y1 = fy0 + (i + 1) * half - rv;
    const ym = (y0 + y1) / 2;
    out.push(slab(`front-${i}`, 'panel', fx0, fx1, y0, y1, zf - ft + slide, zf + slide));
    // Seated a millimetre into the front rather than on its face, and stopping a
    // millimetre inside the declared depth.
    out.push({ kind: 'disc', key: `knob-${i}`, tone: 'brass', r: knobR, t: d / 2 - zf, pos: [0, ym, (zf - 0.001 + d / 2 - 0.001) / 2 + slide] });
    if (slide > 0.002) {
      const bd = Math.min(d * 0.8, zf - ft - zBack);
      out.push(slab(`box-${i}`, 'trim', fx0 + 0.006, fx1 - 0.006, y0 + 0.004, y1 - half * 0.15, zf - ft - bd + slide, zf - ft + slide));
    }
  }
  return out;
}

/** How far a nightstand's drawers stand open when `openState` is 1. */
export function nightstandSlide(open: number, depthMM: number): number {
  return Math.max(0, Math.min(1, open)) * drawerSlide(depthMM);
}

/** A stool's legs and stretchers, metres: a leg's radius, a stretcher's, and how far in
 *  from the seat's rim a leg meets the seat as a share of its radius. */
export const STOOL = { leg: 0.016, rung: 0.01, splayIn: 0.55 } as const;

/** A round stool: a seat with its underside eased, three legs splayed out to a wider
 *  stance than the seat's meeting point, and a ring of stretchers a third of the way up.
 *  It was a disc on three plumb sticks.
 *
 *  Floor piece, ROUND: drawn on a circle of the declared width, and the renderer stretches
 *  the circle to the declared depth — so it reads the width alone. */
export function stoolForm(dimMM: readonly number[]): HardPart[] {
  const w = dimMM[0] / 1000;
  const h = dimMM[2] / 1000;
  const r = w / 2;
  const seat = stoolSeat(dimMM[2]);
  const ease = Math.min(0.008, r * 0.05);
  const yS = h - seat;
  const { leg, rung } = STOOL;
  const rTop = r * STOOL.splayIn;
  const rFoot = r - leg - 0.002;
  const out: HardPart[] = [
    { kind: 'post', key: 'seat', tone: 'body', r, rBottom: r, h: seat - ease, pos: [0, h - (seat - ease) / 2, 0] },
    { kind: 'post', key: 'seat-ease', tone: 'body', r, rBottom: r - ease, h: ease, pos: [0, yS + ease / 2, 0] },
  ];
  // A leg's end is cut square to its own axis, so a splayed one dips below its centre by
  // `leg · sin(splay)`; the foot is lifted by exactly that and stands ON the floor. The
  // splay itself depends on the lift, so the two are settled together. Each round shrinks
  // the error by under 2% (about `leg / seat height`), so ten is past a float's precision
  // at the band's widest, lowest corner — where four left the feet 0.8 nm under the floor.
  let yLift = 0;
  for (let i = 0; i < 10; i++) yLift = leg * Math.sin(Math.atan2(rFoot - rTop, yS - yLift));
  /** A point `k` of the way up a leg at bearing `a`: 0 at the foot, 1 under the seat. */
  const at = (a: number, k: number): V3 => {
    const rr = rFoot + (rTop - rFoot) * k;
    return [Math.cos(a) * rr, yLift + (yS - yLift) * k, Math.sin(a) * rr];
  };
  const angles = [0, 1, 2].map((i) => Math.PI / 2 + (i / 3) * Math.PI * 2);
  angles.forEach((a, i) => out.push({ kind: 'strut', key: `leg-${i}`, tone: 'body', r: leg, a: at(a, 0), b: at(a, 1) }));
  const kr = 0.32;
  angles.forEach((a, i) => {
    const b = angles[(i + 1) % 3];
    out.push({ kind: 'strut', key: `rung-${i}`, tone: 'body', r: rung, a: at(a, kr), b: at(b, kr) });
  });
  return out;
}

/** A pedestal side table: a square top with its underside eased, a collar under it, a
 *  turned column with a ring near each end, and a stepped round foot. It was a slab on a
 *  plain cylinder on a disc.
 *
 *  NON-PARAMETRIC and ROUND: drawn on a square of the width, which the renderer stretches
 *  to the declared depth, so a turned column stays a turned column on a deep table —
 *  drawn on the width and depth separately, a 250 × 800 table's foot would have been a
 *  circle of the width reaching 180 mm out of each side. So it reads the width and the
 *  height alone, every length a share of one of them. */
export function sideTableForm(dimMM: readonly number[]): HardPart[] {
  const w = dimMM[0] / 1000;
  const h = dimMM[2] / 1000;
  const col = (key: string, r: number, rBottom: number, y0: number, y1: number): HardPart =>
    ({ kind: 'post', key, tone: 'trim', r, rBottom, h: y1 - y0, pos: [0, (y0 + y1) / 2, 0] });
  return [
    slab('top', 'body', -w / 2, w / 2, h * 0.945, h, -w / 2, w / 2),
    // The ease under the top: a step in, so the top's edge reads thinner than it is.
    slab('top-ease', 'body', -w * 0.46, w * 0.46, h * 0.93, h * 0.945, -w * 0.46, w * 0.46),
    slab('collar', 'trim', -w * 0.1, w * 0.1, h * 0.87, h * 0.93, -w * 0.1, w * 0.1),
    col('column', w * 0.045, w * 0.07, h * 0.085, h * 0.87),
    col('ring-top', w * 0.062, w * 0.062, h * 0.813, h * 0.827),
    col('ring-foot', w * 0.085, w * 0.085, h * 0.113, h * 0.127),
    col('foot-step', w * 0.24, w * 0.27, h * 0.04, h * 0.085),
    col('foot', w * 0.36, w * 0.38, 0, h * 0.04),
  ];
}

/** A column radiator's pieces: `columns`, the enamelled tubes, their rounded ends and the
 *  joints between them, all in the radiator's own colour — hundreds of parts on a 2 m
 *  one, which the renderer draws as two instanced sets — and `fittings`, the feet
 *  and the valve, drawn one by one. */
export type RadiatorForm = { columns: HardPart[]; fittings: HardPart[] };

/** A radiator's fixed joinery, metres: the feet it stands on, the valve's share of the
 *  width at its right-hand end, and the tube pitch across the depth. */
export const RADIATOR = { foot: 0.04, valve: 0.05, row: 0.045 } as const;

/** A column radiator: `radiatorFins(width)` sections, each one to four round tubes deep,
 *  every tube capped round at both ends and joined across the depth at the top and the
 *  foot, the sections joined along the width by a header through those joints, standing
 *  on two feet, with a thermostatic valve and its pipe at the right-hand end. It was a row
 *  of flat fins between two bars a twentieth DEEPER than the radiator — the one detail in
 *  it that stood outside its own box.
 *
 *  PARAMETRIC: drawn at the stored size, so the feet and the valve are real fittings and
 *  the section count follows the width (`radiatorFins`). Every part is inside `dimMM`,
 *  the valve included: it takes the last `RADIATOR.valve` of the width, at most a tenth
 *  of it, and the sections share the rest. Floor piece: `y` runs 0 → h. */
export function radiatorForm(dimMM: readonly number[]): RadiatorForm {
  const [w, d, h] = m(dimMM);
  const n = radiatorFins(dimMM[0]);
  const vW = Math.min(RADIATOR.valve, w * 0.1);
  const pitch = (w - vW) / n;
  const rows = Math.max(1, Math.min(4, Math.round(d / RADIATOR.row)));
  const rowPitch = d / rows;
  const rt = Math.min(pitch * 0.38, rowPitch * 0.42, 0.014);
  const xs = Array.from({ length: n }, (_, i) => -w / 2 + (i + 0.5) * pitch);
  const zs = Array.from({ length: rows }, (_, j) => -d / 2 + (j + 0.5) * rowPitch);
  const yFoot = RADIATOR.foot;
  // A tube runs between the centres of its two round ends, which reach the feet and `h`.
  const y0 = yFoot + rt;
  const y1 = h - rt;
  const ball = (key: string, x: number, y: number, z: number): HardPart =>
    ({ kind: 'ball', key, tone: 'body', radii: [rt, rt, rt], pos: [x, y, z] });
  const columns: HardPart[] = [];
  xs.forEach((x, i) => {
    zs.forEach((z, j) => {
      columns.push(
        { kind: 'post', key: `tube-${i}-${j}`, tone: 'body', r: rt, rBottom: rt, h: y1 - y0, pos: [x, (y0 + y1) / 2, z] },
        ball(`cap-${i}-${j}`, x, y1, z),
        ball(`base-${i}-${j}`, x, y0, z),
      );
    });
    // A section's tubes are one casting: joined across the depth where they turn.
    if (rows > 1) {
      for (const [end, y] of [['top', y1], ['foot', y0]] as const) {
        columns.push({ kind: 'strut', key: `join-${end}-${i}`, tone: 'body', r: rt, a: [x, y, zs[0]], b: [x, y, zs[rows - 1]] });
      }
    }
  });
  // …and the sections to each other, through the joints, at the top and the foot.
  const rh = rt * 0.7;
  for (const [end, y] of [['top', y1], ['foot', y0]] as const) {
    columns.push({ kind: 'strut', key: `header-${end}`, tone: 'body', r: rh, a: [xs[0], y, 0], b: [xs[n - 1], y, 0] });
  }
  // Two feet under the second section from each end, the full depth so it stands square.
  const fittings: HardPart[] = [];
  const footW = Math.min(0.03, pitch);
  for (const [side, x] of [['l', xs[Math.min(1, n - 1)]], ['r', xs[Math.max(0, n - 2)]]] as const) {
    fittings.push(slab(`foot-${side}`, 'body', x - footW / 2, x + footW / 2, 0, yFoot + rt, -d / 2, d / 2));
  }
  // The valve, in the strip at the right-hand end: a chrome pipe up out of the floor, the
  // valve body on it fed from the last section's foot, and the white thermostatic head.
  const xv = w / 2 - vW / 2;
  const rp = Math.min(0.0075, vW * 0.2, d * 0.2);
  const rHead = Math.min(0.02, vW * 0.4, d * 0.45);
  const headH = Math.min(0.06, (h - y0) * 0.5);
  fittings.push(
    { kind: 'post', key: 'pipe', tone: 'steel', r: rp, rBottom: rp, h: y0, pos: [xv, y0 / 2, 0] },
    { kind: 'strut', key: 'tail', tone: 'steel', r: rp, a: [xs[n - 1], y0, 0], b: [xv, y0, 0] },
    { kind: 'post', key: 'valve', tone: 'steel', r: rp * 1.5, rBottom: rp * 1.5, h: rp * 3, pos: [xv, y0, 0] },
    { kind: 'post', key: 'head', tone: 'body', r: rHead * 0.85, rBottom: rHead, h: headH, pos: [xv, y0 + rp * 1.5 + headH / 2, 0] },
    { kind: 'post', key: 'head-grip', tone: 'trim', r: rHead * 0.93, rBottom: rHead * 0.96, h: headH * 0.25, pos: [xv, y0 + rp * 1.5 + headH * 0.55, 0] },
  );
  return { columns, fittings };
}

/** Every part's axis-aligned extent, as `[lo, hi]` on x, y and z. A disc lies on z and a
 *  ring is a torus facing +z, so their extents are what three draws, not what their
 *  fields name. Exported for the test, which asks every form where its parts are. */
export function partExtent(p: HardPart): { lo: V3; hi: V3 } {
  if (p.kind === 'strut') {
    // A cylinder's extent along an axis is its ends', widened by the radius of its end
    // discs as that axis sees them: `r · sqrt(1 − u²)` for the axis's share `u` of the
    // rod's direction.
    const { u } = strutAxis(p.a, p.b);
    const pad = (i: number) => p.r * Math.sqrt(Math.max(0, 1 - u[i] * u[i]));
    return {
      lo: [0, 1, 2].map((i) => Math.min(p.a[i], p.b[i]) - pad(i)) as V3,
      hi: [0, 1, 2].map((i) => Math.max(p.a[i], p.b[i]) + pad(i)) as V3,
    };
  }
  const [x, y, z] = p.pos;
  switch (p.kind) {
    case 'box':
      return {
        lo: [x - p.size[0] / 2, y - p.size[1] / 2, z - p.size[2] / 2],
        hi: [x + p.size[0] / 2, y + p.size[1] / 2, z + p.size[2] / 2],
      };
    case 'post': {
      const r = Math.max(p.r, p.rBottom);
      return { lo: [x - r, y - p.h / 2, z - r], hi: [x + r, y + p.h / 2, z + r] };
    }
    case 'disc':
      return { lo: [x - p.r, y - p.r, z - p.t / 2], hi: [x + p.r, y + p.r, z + p.t / 2] };
    case 'ring': {
      const o = p.r + p.tube;
      return { lo: [x - o, y - o, z - p.tube], hi: [x + o, y + o, z + p.tube] };
    }
    case 'ball': {
      const [a, b, c] = p.radii;
      return { lo: [x - a, y - b, z - c], hi: [x + a, y + b, z + c] };
    }
  }
}

function strutAxis(a: V3, b: V3): { len: number; u: V3 } {
  const v: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(v[0], v[1], v[2]);
  return { len, u: len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0] };
}

/** How the renderer stands an upright cylinder on a strut: its centre, its length, and the
 *  XYZ Euler rotation that turns +Y onto the strut's direction. With no turn about Y,
 *  `Rx(α)·Rz(γ)` takes +Y to `(−sin γ, cos γ cos α, cos γ sin α)`, which is read back off
 *  the direction directly. */
export function strutPose(p: Extract<HardPart, { kind: 'strut' }>): { pos: V3; len: number; rot: V3 } {
  const { len, u } = strutAxis(p.a, p.b);
  const pos: V3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
  return { pos, len, rot: [Math.atan2(u[2], u[1]), 0, -Math.asin(Math.max(-1, Math.min(1, u[0])))] };
}
