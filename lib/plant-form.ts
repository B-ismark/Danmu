// A potted plant drawn AT its `dimMM`, in metres, standing on y = 0.
//
// "The plant model looks squeezed" was answered first with round leaf balls: a head of
// spheres, each one round at any size. It stopped the squashing and still read as a
// stylised prop: a topiary of green marbles. What makes a plant read as a plant is its
// silhouette, not its surface detail. That means leaf-shaped leaves on stalks, joined to
// a trunk or rising from the soil, angled the way leaves grow, and with some light
// between them.
//
// **The box picks the plant.** A plant's proportions say which kind of plant it is, so
// they choose its habit instead of stretching one drawing:
//
//  · Tall for its spread: a fig. A bare trunk, then broad paddle leaves spiralling up
//    the top of it on short stalks, the lower ones drooping and the young ones at the
//    top rising.
//  · Short for its spread: an arching bush. No trunk, but stems fanning out of the soil,
//    each ending in one slim leaf, the outer ones low and the middle ones upright.
//  · In between, a blend of the two (`habit` runs 0 → 1): a short trunk that branches.
//
// Nothing is scaled per axis. Every leaf is the same unit leaf (`LEAF_MESH`) scaled
// uniformly across its face, so a leaf keeps its shape at any plant size, and a resize
// redraws the plant instead of stretching it. The plan draws a plant as the w × d
// ELLIPSE (`plant` is a round shape), so every leaf is solved to stay inside that ellipse
// and under the top of the box. The outermost leaves touch it, which is what makes the
// 3D plant fill the outline the plan draws.
//
// One unit leaf, instanced, is also why this is cheaper than the balls were. Sixty
// spheres were sixty draw calls; a leaf set and a stem set are one each.

type V3 = [number, number, number];

// A big floor pot: 420 mm tall, 420 mm across the rim. A 2.6 m plant does not stand
// in a 520 mm pot, so these are caps rather than proportions.
export const PLANT_POT_H = 0.42;
export const PLANT_POT_R = 0.21;
/** How many shades of green `PlantGeo` gives a plant's leaves. `tone` is an index into
 *  that palette, so the count lives beside the arithmetic that takes it. */
export const PLANT_LEAF_TONES = 5;
/** The fewest and the most leaves a plant draws. The legal range reaches the cap only
 *  at its biggest sizes; it is the function's own bound, so a size that slipped past the
 *  clamp (a corrupt saved dim) draws a sparse plant instead of an unbounded one. */
export const PLANT_MIN_LEAVES = 10;
export const PLANT_MAX_LEAVES = 120;
/** Foliage height ÷ spread at which a plant is wholly a bush (at or below) or wholly a
 *  fig (at or above). The catalogue's 400 × 400 × 1600 is 3.2, a fig. */
export const PLANT_BUSH_TAU = 0.9;
export const PLANT_TREE_TAU = 2.6;
/** Leaf width ÷ length: slim arching leaves on the bush, broad paddles on the fig. */
export const PLANT_LEAF_ASPECT: readonly [bush: number, fig: number] = [0.36, 0.6];
/** The smallest share of its own length a leaf may be trimmed to so it fits the outline.
 *  Below it the leaf is not drawn: a leaf that cannot fit is not there. */
export const PLANT_MIN_LEAF_SCALE = 0.3;
/** How much longer than deep a plant may be before it becomes a planter: a row of
 *  plants in a trough, each about as long as it is deep. */
export const PLANT_CLUMP_ASPECT = 2;
export const PLANT_MAX_CLUMPS = 6;
/** A stem segment's top radius ÷ its bottom radius. The trunk is a stack of segments,
 *  each starting at the radius the last one ended on, so it tapers without a step. */
export const PLANT_STEM_TAPER = 0.75;
/** How high up a short trunk a stem may start and still fan out across the soil. Above
 *  it a stem starts on the trunk's axis, inside the wood. */
export const PLANT_FAN_LIFT = 0.03;

// ─── The unit leaf ─────────────────────────────────────────────────────────────
//
// Length 1 along local +Z (stalk at z = 0, tip at z = 1), width 1 across X, and +Y is
// the leaf's upper face. The two halves fold up from the midrib, and the blade droops
// towards its tip. A leaf is drawn by scaling this by [width, width, length], so fold and
// droop scale with the leaf's width.

const LEAF_ROWS = 9;
const LEAF_ACROSS = [-1, -0.5, 0, 0.5, 1] as const;
const LEAF_FOLD = 0.35;
const LEAF_DROOP = 0.28;

/** Half the unit leaf's width at `u` along it: pointed at both ends, widest a little
 *  below the middle. */
export function leafHalfWidth(u: number): number {
  const s = Math.sin(Math.PI * Math.pow(Math.min(Math.max(u, 0), 1), 0.9));
  return 0.5 * Math.pow(Math.max(s, 0), 0.75);
}

function buildLeafMesh(): { positions: number[]; index: number[] } {
  const positions: number[] = [];
  for (let k = 0; k < LEAF_ROWS; k++) {
    const u = k / (LEAF_ROWS - 1);
    const hw = leafHalfWidth(u);
    for (const a of LEAF_ACROSS) {
      const x = a * hw;
      positions.push(x, LEAF_FOLD * Math.abs(x) - LEAF_DROOP * u * u, u);
    }
  }
  const index: number[] = [];
  const cols = LEAF_ACROSS.length;
  for (let k = 0; k < LEAF_ROWS - 1; k++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = k * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  return { positions, index };
}

/** The one leaf every plant is drawn from: flat xyz positions and triangle indices.
 *  `PlantGeo` builds its geometry from this, and the tests measure the same points. */
export const LEAF_MESH: { readonly positions: readonly number[]; readonly index: readonly number[] } = buildLeafMesh();

const LEAF_POINTS: V3[] = (() => {
  const out: V3[] = [];
  for (let i = 0; i < LEAF_MESH.positions.length; i += 3) {
    out.push([LEAF_MESH.positions[i], LEAF_MESH.positions[i + 1], LEAF_MESH.positions[i + 2]]);
  }
  return out;
})();

/** The unit leaf's area, for counting how many leaves it takes to clothe a plant. */
const LEAF_AREA = (() => {
  let a = 0;
  const N = 200;
  for (let i = 0; i < N; i++) a += (2 * leafHalfWidth((i + 0.5) / N)) / N;
  return a;
})();

// ─── Frames ────────────────────────────────────────────────────────────────────

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A rotation given by its three columns (where local X, Y and Z point), as the Euler
 *  angles three.js composes in its default 'XYZ' order, which is what an instance's
 *  `rot` is read as. The same conversion as `Euler.setFromRotationMatrix`. */
function eulerXYZ(cx: V3, cy: V3, cz: V3): V3 {
  const m02 = cz[0];
  const y = Math.asin(Math.min(Math.max(m02, -1), 1));
  if (Math.abs(m02) < 0.9999999) return [Math.atan2(-cz[1], cz[2]), y, Math.atan2(-cy[0], cx[0])];
  return [Math.atan2(cy[2], cy[1]), y, 0];
}

// ─── The plant ─────────────────────────────────────────────────────────────────

/** One leaf, placed: the unit leaf scaled by `size` ([width, width, length]), turned by
 *  `rot` and set with its stalk end at `pos`. `axes` are the same rotation as columns,
 *  for measuring it without three.js. */
export type PlantLeaf = { pos: V3; size: V3; rot: V3; axes: [V3, V3, V3]; tone: number };

/** One stem segment: a cylinder of height 1 and radius 1 (its top `PLANT_STEM_TAPER` of
 *  that), centred on `pos`, scaled by `size` ([r, length, r]) and turned by `rot`. `from`
 *  and `to` are its two ends. `wood` is the trunk; the rest are green stalks. */
export type PlantStem = { pos: V3; size: V3; rot: V3; from: V3; to: V3; wood: boolean };

export type PlantForm = {
  /** `top` and `bottom` are radii across the plant's short side; `stretch` scales them
   *  on [x, z], so a planter's trough is long. [1, 1] for one plant: a round pot. */
  pot: { top: number; bottom: number; h: number; stretch: [number, number] };
  soil: { r: number; t: number };
  /** 0 an arching bush, 1 a fig, in between a blend. */
  habit: number;
  /** How many plants stand in the pot: 1, or a row of them in a long planter. */
  clumps: number;
  stems: PlantStem[];
  leaves: PlantLeaf[];
};

/** Where a leaf's unit-mesh points land in the plant's own frame, metres. */
export function plantLeafPoints(l: PlantLeaf): V3[] {
  const [cx, cy, cz] = l.axes;
  return LEAF_POINTS.map(([x, y, z]) => {
    const sx = x * l.size[0];
    const sy = y * l.size[1];
    const sz = z * l.size[2];
    return [
      l.pos[0] + cx[0] * sx + cy[0] * sy + cz[0] * sz,
      l.pos[1] + cx[1] * sx + cy[1] * sy + cz[1] * sz,
      l.pos[2] + cx[2] * sx + cy[2] * sy + cz[2] * sz,
    ];
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
/** A repeatable 0–1 value per leaf, so a plant draws the same way every time. */
const hash = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

function stemBetween(from: V3, to: V3, r: number, wood: boolean): PlantStem {
  const axis = sub(to, from);
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  const cy = norm(axis);
  const helper: V3 = Math.abs(cy[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cx = norm(cross(cy, helper));
  const cz = cross(cx, cy);
  return {
    pos: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    size: [r, Math.max(len, 1e-6), r],
    rot: eulerXYZ(cx, cy, cz),
    from,
    to,
    wood,
  };
}

const MEMO = new Map<string, PlantForm>();
const MEMO_SIZE = 32;

/** The plant for a size. Pure, and memoised on the size: a drag re-renders the plant
 *  every frame and the leaf solve is the most arithmetic any piece does. Do not mutate
 *  what it returns. */
export function plantForm(dimMM: [number, number, number]): PlantForm {
  const key = `${dimMM[0]},${dimMM[1]},${dimMM[2]}`;
  const hit = MEMO.get(key);
  if (hit) return hit;
  const out = buildPlant(dimMM);
  if (MEMO.size >= MEMO_SIZE) MEMO.delete(MEMO.keys().next().value as string);
  MEMO.set(key, out);
  return out;
}

function buildPlant(dimMM: [number, number, number]): PlantForm {
  // Every legal size is well above 10 mm, but a scene file or a stale override can hand
  // in a zero or a NaN before the clamp sees it. A zero side divides the ellipse test by
  // zero, so such a side draws as 10 mm: a speck of plant rather than NaN geometry.
  const side = (mm: number) => (Number.isFinite(mm) ? Math.max(mm, 10) : 10) / 1000;
  const w = side(dimMM[0]);
  const d = side(dimMM[1]);
  const h = side(dimMM[2]);
  const A = w / 2;
  const E = d / 2;
  const long = Math.max(A, E);
  const short = Math.min(A, E);
  const alongX = A >= E;
  // A plant much longer than it is deep is a planter: a row of `m` plants in a trough,
  // each about as long as it is deep. One plant stretched along it would leave most of
  // the outline empty, and one plant's leaves cannot reach 600 mm along a 100 mm slab.
  const ratio = long / short;
  const m = ratio > PLANT_CLUMP_ASPECT ? clamp(Math.round(ratio / 1.6), 1, PLANT_MAX_CLUMPS) : 1;

  const top = Math.min(PLANT_POT_R, short * 0.72);
  const bottom = top * 0.76;
  const topLong = m > 1 ? Math.min(PLANT_POT_R * m, long * 0.72) : top;
  const stretch: [number, number] = alongX ? [topLong / top, 1] : [1, topLong / top];
  const potH = Math.min(PLANT_POT_H, h * 0.2, top * 2.4);
  const soilT = potH * 0.08;
  const ySoil = potH;
  const above = h - potH;

  // One clump's half-axes, and the habit from how tall its foliage is for its spread.
  const cA = alongX ? long / m : A;
  const cE = alongX ? E : long / m;
  const cR = Math.min(cA, cE);
  const D = 2 * Math.sqrt(cA * cE);
  const habit = smooth((above / D - PLANT_BUSH_TAU) / (PLANT_TREE_TAU - PLANT_BUSH_TAU));
  const asp = lerp(PLANT_LEAF_ASPECT[0], PLANT_LEAF_ASPECT[1], habit);
  // A leaf's nominal length: bigger on a bigger plant, never more than 420 mm (a large
  // monstera or fig leaf). A fig's leaves rise, so they are never most of its height; a
  // low bush's lie out over the pot, so they may be longer than it is tall.
  const L0 = Math.min(clamp(lerp(0.55, 0.8, habit) * D + 0.04, 0.02, 0.42), lerp(1.5, 0.6, habit) * above);
  // The band the leaves grow in. A fig's leaves start 40% of the way up; a bush's almost
  // at the soil.
  const yLo = ySoil + above * lerp(0.1, 0.4, habit);
  const yHi = Math.max(yLo, h - lerp(0.85, 0.5, habit) * L0);

  // Enough leaves to clothe a clump's outside and its top: about one layer on a bush, a
  // fuller one on a fig, whose leaves are seen edge-on more often.
  const clothe = Math.PI * D * (h - yLo) + Math.PI * cA * cE;
  const n = clamp(
    Math.round((lerp(1, 1.6, habit) * clothe) / (LEAF_AREA * asp * L0 * L0)),
    PLANT_MIN_LEAVES,
    Math.floor(PLANT_MAX_LEAVES / m),
  );

  // Is a leaf point where a leaf may be: inside the plan's ellipse (scaled by `f`, so the
  // silhouette is not a clipped hedge), between the floor and the top of the box, and not
  // inside the pot?
  const fits = (p: V3, f: number) => {
    if (p[1] > h || p[1] < 0.005) return false;
    const e = (p[0] / A) ** 2 + (p[2] / E) ** 2;
    if (e > f * f) return false;
    if (p[1] < potH) {
      const rPot = bottom + ((top - bottom) * Math.max(p[1], 0)) / potH + 0.003;
      if ((p[0] / (rPot * stretch[0])) ** 2 + (p[2] / (rPot * stretch[1])) ** 2 < 1) return false;
    }
    return true;
  };

  const leaves: PlantLeaf[] = [];
  const stems: PlantStem[] = [];
  const trunk: PlantStem[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const stalkR = clamp(0.0015 + 0.008 * L0, 0.0015, 0.006);
  const along = (v: number): V3 => (alongX ? [v, 0, 0] : [0, 0, v]);

  for (let c = 0; c < m; c++) {
    // The clump's own middle, and where it roots in the trough: evenly along the pot's
    // length, so the outer clumps lean out over its ends.
    const mid = along(-long + (long / m) * (2 * c + 1));
    const root = along(m === 1 ? 0 : (-(m - 1) / 2 + c) * ((2 * topLong * 0.8) / m));
    // A clump's centre line, from its root at the soil to its middle at the top of its
    // leaves. A fig's trunk runs up it.
    const centreAt = (y: number): V3 => {
      const u = clamp((y - ySoil) / Math.max(yHi - ySoil, 1e-6), 0, 1);
      return [lerp(root[0], mid[0], u), y, lerp(root[2], mid[2], u)];
    };
    let trunkTop = ySoil;

    for (let q = 0; q < n; q++) {
      const i = q + 97 * c;
      const crown = q === n - 1;
      const t = n === 1 ? 1 : q / (n - 1);
      const j1 = hash(i, 1);
      const j2 = hash(i, 2);
      const j3 = hash(i, 3);
      const j4 = hash(i, 4);
      const theta = i * golden;
      // Out along the clump's ellipse, so a narrow planter grows along its length.
      const dir = Math.atan2(cE * Math.sin(theta), cA * Math.cos(theta));

      // Where the leaf's stalk ends. A bush's lower leaves stand well out from the middle;
      // a fig's sit a short stalk off its trunk.
      // On a low, wide bush the leaves are short for its spread, so the outer ones stand
      // out far enough that their tips still reach the rim.
      const reachR = Math.hypot(cA * Math.cos(theta), cE * Math.sin(theta));
      const kBush = lerp(Math.max(0.5, 1 - (0.9 * L0) / reachR), 0.08, t);
      const kFig = Math.min(0.35, (0.02 + 0.2 * L0) / cR);
      const k = (crown ? 0.02 : lerp(kBush, kFig, habit)) * (0.85 + 0.3 * j1);
      const yB = crown ? yHi : yLo + (yHi - yLo) * Math.pow(t, 0.8);
      const base: V3 = [mid[0] + k * cA * Math.cos(theta), yB, mid[2] + k * cE * Math.sin(theta)];

      // Where its stem starts: at the soil for a bush, on the trunk just below the leaf for
      // a fig, and part way up between them for a blend.
      // A stem that leaves the soil fans out across it; one that leaves the trunk starts
      // on its axis. In between, low on a short trunk, it starts fanned out and part way
      // up, and a short upright piece of the same stalk carries it down into the soil,
      // so no stalk starts in mid-air beside the trunk.
      const oy = clamp(ySoil + habit * (yB - ySoil - 0.25 * k * cR), ySoil, yB);
      const lift = oy - ySoil;
      const fan = 0.25 * top * (1 - habit) * (1 - smooth(lift / PLANT_FAN_LIFT));
      const on = centreAt(oy);
      const origin: V3 = [on[0] + fan * Math.cos(theta), oy, on[2] + fan * Math.sin(theta)];

      // How the blade points: lower leaves reach out, young leaves at the top rise, and
      // the crown leaf stands almost upright.
      const pitch = crown
        ? 1.35
        : lerp(lerp(0.15, 0.3, habit), lerp(1.25, 1.2, habit), t) + 0.36 * (j2 - 0.5);
      const roll = 0.5 * (j3 - 0.5);
      const L = L0 * (crown ? 1.1 : (0.8 + 0.35 * j4) * (1 - 0.3 * habit * t));
      const W = L * asp * (0.9 + 0.2 * j1);
      // Every third leaf may reach the ellipse itself; the rest stop a little short of
      // it, so the plant fills its outline without its tips tracing it.
      const f = q % 3 === 0 || crown ? 1 : 0.84 + 0.16 * j2;

      const cz: V3 = [Math.cos(pitch) * Math.cos(dir), Math.sin(pitch), Math.cos(pitch) * Math.sin(dir)];
      let cx = norm(cross([0, 1, 0], cz));
      let cy = cross(cz, cx);
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      [cx, cy] = [
        [cx[0] * cr + cy[0] * sr, cx[1] * cr + cy[1] * sr, cx[2] * cr + cy[2] * sr],
        [cy[0] * cr - cx[0] * sr, cy[1] * cr - cx[1] * sr, cy[2] * cr - cx[2] * sr],
      ];
      const axes: [V3, V3, V3] = [cx, cy, cz];
      const rot = eulerXYZ(cx, cy, cz);
      const tone = (i * 3 + Math.floor(j1 * PLANT_LEAF_TONES)) % PLANT_LEAF_TONES;
      const at = (s: number): PlantLeaf => ({ pos: base, size: [W * s, W * s, L * s], rot, axes, tone });
      const ok = (s: number) => plantLeafPoints(at(s)).every((p) => fits(p, f));
      // Full size if it fits, otherwise the largest that does: the outermost leaves end
      // exactly on the outline.
      let s = 1;
      if (!ok(1)) {
        let lo = 0;
        let hi = 1;
        for (let it = 0; it < 22; it++) {
          const half = (lo + hi) / 2;
          if (ok(half)) lo = half;
          else hi = half;
        }
        s = lo;
      }
      // A leaf with no room to grow is left off, stalk and all, rather than drawn as a
      // speck on the end of a bare stick.
      if (s < PLANT_MIN_LEAF_SCALE) continue;
      leaves.push(at(s));
      if (habit > 0) trunkTop = Math.max(trunkTop, oy);

      // The stem: two segments, the first rising more steeply than the second, so a
      // bush's stems arch out of the soil. The bend never rises above the leaf it carries.
      const run = Math.hypot(base[0] - origin[0], base[1] - origin[1], base[2] - origin[2]);
      const bend: V3 = [
        (origin[0] + base[0]) / 2,
        Math.min(base[1], (origin[1] + base[1]) / 2 + run * (0.05 + 0.22 * (1 - habit))),
        (origin[2] + base[2]) / 2,
      ];
      if (run > 1e-4) {
        if (fan > 1e-6 && lift > 1e-6) stems.push(stemBetween([origin[0], ySoil, origin[2]], origin, stalkR, false));
        stems.push(stemBetween(origin, bend, stalkR, false));
        stems.push(stemBetween(bend, base, stalkR * PLANT_STEM_TAPER, false));
      }
    }

    // The trunk, from inside the soil to the highest stem it carries, in tapering
    // segments along the clump's centre line.
    if (trunkTop - ySoil > 0.02) {
      const rT = clamp(0.004 + 0.02 * D, 0.004, 0.035) * lerp(0.4, 1, habit);
      const SEGS = 3;
      const y0 = ySoil - soilT;
      for (let k = 0; k < SEGS; k++) {
        const a = centreAt(y0 + ((trunkTop - y0) * k) / SEGS);
        const b = centreAt(y0 + ((trunkTop - y0) * (k + 1)) / SEGS);
        trunk.push(stemBetween(a, b, rT * Math.pow(PLANT_STEM_TAPER, k), true));
      }
    }
  }

  return {
    pot: { top, bottom, h: potH, stretch },
    soil: { r: top * 0.92, t: soilT },
    habit,
    clumps: m,
    stems: [...trunk, ...stems],
    leaves,
  };
}
