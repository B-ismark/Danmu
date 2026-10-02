// Hard goods: the casework, appliances and joinery that `lib/soft-goods.ts` is the cloth
// half of. Each function returns a piece as a list of named parts — boxes, upright posts,
// front-facing discs and rings — in the piece's own frame, metres, and the renderer
// (`components/three/DynamicPart.tsx`) does nothing but colour them.
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
//     that axis alone, by exactly that factor. The two parametric forms here
//     (`tvConsoleForm`, `doorForm`) are drawn at the size actually stored and are free to
//     hold real joinery dimensions, which is the point of their being parametric.
//
// Faces that would share a plane are kept apart by construction rather than by luck:
// where two parts' fronts face the same way, they are at different depths or meet only
// along an edge. `tests/coplanar-faces.test.tsx` sweeps the result at three sizes.

import { consoleSlabs, doorHandleY } from './scene-spec';

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
  | 'cold';

export type HardPart =
  | { kind: 'box'; key: string; tone: HardTone; size: V3; pos: V3 }
  /** An upright cylinder, `r` at the top and `rBottom` at the foot, centred on `pos`. */
  | { kind: 'post'; key: string; tone: HardTone; r: number; rBottom: number; h: number; pos: V3 }
  /** A cylinder lying on the piece's depth axis, its face turned to the front: a dial, a
   *  porthole's glass, a lever's neck. `t` is its depth. */
  | { kind: 'disc'; key: string; tone: HardTone; r: number; t: number; pos: V3 }
  /** A torus facing the front: a washing machine's door ring. */
  | { kind: 'ring'; key: string; tone: HardTone; r: number; tube: number; pos: V3 };

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

/** Every part's axis-aligned extent, as `[lo, hi]` on x, y and z. A disc lies on z and a
 *  ring is a torus facing +z, so their extents are what three draws, not what their
 *  fields name. Exported for the test, which asks every form where its parts are. */
export function partExtent(p: HardPart): { lo: V3; hi: V3 } {
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
  }
}
