// A "made piece" — something the user built out of blocks and saved — placed in a
// room as ONE part.
//
// Why one part rather than a group of block parts: a group (`groupId`) translates as
// a set but does not turn as one (`drag-convoy.ts` returns early on a turn), loses its
// group on a duplicate, and lets its own members collide with each other. A made
// piece needs none of that machinery because it IS one piece — one id, one transform,
// one footprint — and its blocks are drawing instructions in its own frame. Editing
// it explodes it back into ordinary block parts (`explodeMade`) and Done packs them
// again (`packMade`); those two are each other's inverse, which is what the tests pin.
//
// Rule 2 holds here the same way it holds for a Library piece: every size comes from
// the blocks' own `dimMM`, and the piece's size is DERIVED from their bounds rather
// than typed. Resizing never stretches a block's look — a modular piece repeats its
// unit along its width (`tileCount`), and the other axes scale the blocks' own
// dimensions, which every block renderer draws at, rather than scaling a mesh.

import { CATEGORIES, SHAPES, type Category, type ScenePart, type Shape } from './scene-spec';
import { localToWorld, worldToLocal } from './geometry';
import { verticalExtent } from './physics';
import { clampDims } from './dimension-ranges';

/** One block inside a made piece, in the piece's own frame: metres from the piece's
 *  origin (footprint centre, at its lowest point), yaw relative to the piece. `pos.y`
 *  keeps the block's OWN vertical convention — whatever its renderer expects of its
 *  origin — so exploding a block hands back a part exactly as it was packed. */
export type MadeBlock = {
  shape: Shape;
  category: Category;
  pos: [number, number, number];
  rot: number;
  dimMM: [number, number, number];
  color?: string;
  /** The block's style switches, carried opaquely so this module does not have to
   *  know the vocabulary. Validated where bytes come in (`lib/scene-file.ts`). */
  blockStyle?: BlockStyleLike;
};

/** A block's style switches as this module sees them: opaque. Narrowed to the real
 *  `BlockStyle` once the block shapes land. */
export type BlockStyleLike = Record<string, unknown>;

/** What makes a part a made piece. `sizeMM` is the size the blocks were packed at;
 *  the part's own `dimMM` may differ after a resize, and `layoutMade` reconciles the
 *  two. `modular` means a width change repeats the whole build rather than stretching
 *  it — a two-seat bench becomes a four-seat one, not a two-seat one with long desks. */
export type MadeSpec = {
  blocks: MadeBlock[];
  sizeMM: [number, number, number];
  modular?: boolean;
};

/** The most copies a modular piece repeats to. A room is at most `ROOM_SIDE_M` across
 *  and a block is at least a few hundred mm, so this is generous; it exists so a
 *  hand-edited file cannot ask the renderer for ten thousand desks. */
export const MAX_MODULES = 12;

const MM = 1000;

/** How many units a modular piece repeats to at width `widthMM`. Rounds to the
 *  nearest whole module, never below one. */
export function tileCount(unitWidthMM: number, widthMM: number): number {
  if (!(unitWidthMM > 0) || !Number.isFinite(widthMM)) return 1;
  return Math.min(MAX_MODULES, Math.max(1, Math.round(widthMM / unitWidthMM)));
}

/** The size a made piece is actually drawn at when asked for `dimMM`. A modular
 *  piece's width snaps to whole modules — the size shown is the size drawn, never a
 *  number beside a different-sized object. */
export function fitMadeDims(spec: MadeSpec, dimMM: readonly [number, number, number]): [number, number, number] {
  const [w, d, h] = dimMM;
  if (!spec.modular) return [w, d, h];
  return [tileCount(spec.sizeMM[0], w) * spec.sizeMM[0], d, h];
}

/** The blocks of a made piece as drawn at `dimMM`, in the piece's frame. Width either
 *  tiles (modular) or scales; depth and height scale. Scaling moves each block's
 *  position and its own `dimMM`, so a block's detailing (handles, slats, a plinth)
 *  is drawn at its true size and never squashed. */
export function layoutMade(spec: MadeSpec, dimMM: readonly [number, number, number]): MadeBlock[] {
  const [uw, ud, uh] = spec.sizeMM;
  const [w, d, h] = fitMadeDims(spec, dimMM);
  const count = spec.modular ? tileCount(uw, w) : 1;
  const sx = spec.modular ? 1 : safeRatio(w, uw);
  const sz = safeRatio(d, ud);
  const sy = safeRatio(h, uh);
  const out: MadeBlock[] = [];
  for (let i = 0; i < count; i++) {
    // Module i's centre, the whole row centred on the piece's origin.
    const offset = ((i - (count - 1) / 2) * uw) / MM;
    for (const b of spec.blocks) {
      out.push({
        ...b,
        pos: [b.pos[0] * sx + offset, b.pos[1] * sy, b.pos[2] * sz],
        dimMM: scaledDims(b, sx, sz, sy),
      });
    }
  }
  return out;
}

function safeRatio(a: number, b: number): number {
  return b > 0 && Number.isFinite(a) && a > 0 ? a / b : 1;
}

/** A block's own dimensions under a piece-axis scale. A block turned a quarter
 *  presents its depth along the piece's width, so the piece's x scale lands on the
 *  block's depth — otherwise a sideways pedestal would grow along the wrong axis. */
function scaledDims(b: MadeBlock, sx: number, sz: number, sy: number): [number, number, number] {
  const quarter = Math.abs(Math.round(b.rot / (Math.PI / 2))) % 2 === 1;
  const [bw, bd, bh] = b.dimMM;
  return quarter
    ? [Math.round(bw * sz), Math.round(bd * sx), Math.round(bh * sy)]
    : [Math.round(bw * sx), Math.round(bd * sz), Math.round(bh * sy)];
}

/** The parts to pack: what `packMade` needs of each block part. */
export type PackInput = Pick<ScenePart, 'shape' | 'category' | 'pos' | 'rot' | 'dimMM' | 'color'> & { blockStyle?: BlockStyleLike };

/** Pack block parts (world transforms) into a made piece. The piece's yaw is the
 *  largest block's, so a build assembled at an angle packs tight rather than inside
 *  its axis-aligned box; its origin is the footprint centre at the lowest block's
 *  bottom. Returns the spec plus where the piece stands in the world. `frameRot`
 *  forces the frame instead — 0 re-centres blocks already in a piece's frame. */
export function packMade(parts: readonly PackInput[], modular = false, frameRot?: number): {
  spec: MadeSpec;
  pos: [number, number, number];
  rot: number;
} | null {
  if (parts.length === 0) return null;
  const lead = parts.reduce((a, b) => (b.dimMM[0] * b.dimMM[1] > a.dimMM[0] * a.dimMM[1] ? b : a));
  const rot = frameRot ?? lead.rot;

  // Bounds in the piece's frame, about an arbitrary reference (the lead's centre).
  const ref = lead.pos;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of parts) {
    const [lx, lz] = worldToLocal(rot, p.pos[0] - ref[0], p.pos[2] - ref[2]);
    const [hx, hz] = halfExtents(p.dimMM, p.rot - rot);
    minX = Math.min(minX, lx - hx); maxX = Math.max(maxX, lx + hx);
    minZ = Math.min(minZ, lz - hz); maxZ = Math.max(maxZ, lz + hz);
    const [y0, y1] = verticalExtent(p.category, p.shape, p.dimMM, p.pos[1]);
    minY = Math.min(minY, y0); maxY = Math.max(maxY, y1);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const [ox, oz] = localToWorld(rot, cx, cz);
  const pos: [number, number, number] = [ref[0] + ox, minY, ref[2] + oz];

  const blocks: MadeBlock[] = parts.map((p) => {
    const [lx, lz] = worldToLocal(rot, p.pos[0] - pos[0], p.pos[2] - pos[2]);
    const b: MadeBlock = {
      shape: p.shape,
      category: p.category,
      pos: [round4(lx), round4(p.pos[1] - minY), round4(lz)],
      rot: normAngle(p.rot - rot),
      dimMM: [...p.dimMM],
    };
    if (p.color) b.color = p.color;
    if (p.blockStyle) b.blockStyle = p.blockStyle;
    return b;
  });
  const sizeMM: [number, number, number] = [
    Math.round((maxX - minX) * MM),
    Math.round((maxZ - minZ) * MM),
    Math.round((maxY - minY) * MM),
  ];
  return { spec: { blocks, sizeMM, ...(modular ? { modular: true } : {}) }, pos, rot };
}

/** Half the footprint of a `dimMM` box turned by `rot`, along the piece's axes. */
function halfExtents(dimMM: readonly [number, number, number], rot: number): [number, number] {
  const w = dimMM[0] / MM / 2;
  const d = dimMM[1] / MM / 2;
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return [w * c + d * s, w * s + d * c];
}

/** A made piece's blocks as ordinary world parts, for editing. Ids are derived from
 *  the piece's so a re-explode of the same piece hands back the same ids. */
export function explodeMade(
  part: Pick<ScenePart, 'id' | 'name' | 'pos' | 'rot' | 'dimMM'>,
  spec: MadeSpec,
): (ScenePart & { blockStyle?: BlockStyleLike })[] {
  return layoutMade(spec, part.dimMM).map((b, i) => {
    const [dx, dz] = localToWorld(part.rot, b.pos[0], b.pos[2]);
    const out: ScenePart & { blockStyle?: BlockStyleLike } = {
      id: `${part.id}~${i}`,
      category: b.category,
      name: `${part.name} · block ${i + 1}`,
      shape: b.shape,
      pos: [part.pos[0] + dx, part.pos[1] + b.pos[1], part.pos[2] + dz],
      rot: normAngle(part.rot + b.rot),
      dimMM: [...b.dimMM],
      locked: false,
    };
    if (b.color) out.color = b.color;
    if (b.blockStyle) out.blockStyle = b.blockStyle;
    return out;
  });
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

function normAngle(a: number): number {
  const t = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(t) < 1e-9 ? 0 : t;
}

/** The most blocks one piece may hold. A four-seat bench with screens and pedestals
 *  is about twenty; this bounds a hand-edited or corrupt record, not a real build. */
export const MAX_BLOCKS = 64;

const HEX = /^#[0-9a-fA-F]{6}$/;
const SHAPE_SET: ReadonlySet<string> = new Set(SHAPES);
const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

function finite3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Read a made piece from bytes this app did not just produce — a saved shelf entry
 *  or a room file. Same boundary as every other imported part: shape and category are
 *  checked against the runtime vocabularies, every block size goes through
 *  `clampDims`, and positions must be finite and inside a room's reach. Lossy on
 *  purpose and never silent: `dropped` counts the blocks left behind. `readStyle` is
 *  the block-style validator, passed in so this module does not own that vocabulary.
 *  A piece is not a made `made` block — nesting is refused rather than recursed. */
export function readMadeSpec(
  raw: unknown,
  readStyle: (v: unknown) => BlockStyleLike | undefined = () => undefined,
): { spec: MadeSpec; dropped: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.blocks)) return null;
  let dropped = 0;
  const blocks: MadeBlock[] = [];
  for (const item of r.blocks.slice(0, MAX_BLOCKS)) {
    const b = (item ?? {}) as Record<string, unknown>;
    if (
      typeof b.shape !== 'string' || !SHAPE_SET.has(b.shape) ||
      typeof b.category !== 'string' || !CATEGORY_SET.has(b.category) ||
      !finite3(b.pos) || !finite3(b.dimMM) || b.dimMM.some((n) => n <= 0) ||
      b.pos.some((n) => Math.abs(n) > 20) ||
      typeof b.rot !== 'number' || !Number.isFinite(b.rot)
    ) {
      dropped++;
      continue;
    }
    const shape = b.shape as Shape;
    const category = b.category as Category;
    const block: MadeBlock = {
      shape,
      category,
      pos: [...b.pos],
      rot: normAngle(b.rot),
      dimMM: clampDims(category, shape, [...b.dimMM]),
    };
    if (typeof b.color === 'string' && HEX.test(b.color)) block.color = b.color.toLowerCase();
    const style = b.blockStyle === undefined ? undefined : readStyle(b.blockStyle);
    if (style) block.blockStyle = style;
    blocks.push(block);
  }
  dropped += Math.max(0, r.blocks.length - MAX_BLOCKS);
  if (blocks.length === 0) return null;
  // The size is DERIVED, so a stored one is only trusted as far as the blocks agree
  // with it: re-pack in place (the blocks are already in the piece's frame) and take
  // the bounds. A record whose sizeMM was edited by hand cannot make the piece draw at
  // one size and report another.
  const { spec } = packMade(blocks, r.modular === true, 0)!;
  return { spec, dropped };
}

/** The longest name a saved piece keeps — long enough for "Four-seat bench, oak",
 *  short enough that a Library row ellipsises rather than wraps to three lines. */
export const MAX_PIECE_NAME = 40;
