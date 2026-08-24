// The scene file — a room you can take with you.
//
// Danmu has no account and no backend, so a room lives in one browser's IndexedDB
// and nowhere else. That is the privacy promise working as intended, and it is also
// the reason two of the four success cases in PRODUCT.md had nothing to stand on:
// you could not show a layout to a partner or a landlord, and you could not survive
// the browser evicting your storage. A file is the whole answer to both, and it
// needs no server to exist.
//
// ─── What travels, and what deliberately does not ───────────────────────────
//
// **The room and its furniture.** Name, footprint, wall paint, site, and every
// piece with its size, position, rotation, colour, finish, decor and light.
//
// **Not the photographs.** `Capture` blobs stay behind. This is the one decision in
// here worth defending: a file exists to be sent to someone, and the photos are of
// the inside of the user's home. Everything else in a room describes furniture; the
// captures describe a place. Shipping them would mean the first time anyone shared a
// layout they would also, invisibly, share pictures of their living room. (They are
// also large, and nothing downstream of the studio reads them — the geometry has
// already been extracted into the parts.)
//
// **Not `detectedObjects`.** Same reason once removed: they are the photo pipeline's
// intermediate representation, they carry bounding boxes into images the file does
// not contain, and the parts ARE their resolved output.
//
// ─── A file is untrusted input ───────────────────────────────────────────────
//
// This is the first thing in the app that parses bytes a stranger produced. The
// trust boundary CLAUDE.md draws around AI applies here with the same force and for
// the same reason: a number arriving from outside the geometry engine is a HINT.
// So every size goes through `clampDims`, every shape and category is checked
// against the runtime vocabularies in `scene-spec.ts`, every colour must match
// `#rrggbb` before it reaches a Three.js material or a style attribute, and
// everything is bounded — file length, part count, polygon vertices, string
// lengths — because "the user picked this file" is not a promise about its contents.
//
// The parse is **lossy on purpose and never silent**. A part with an unknown shape
// is dropped rather than guessed at, a colour that is not a hex is forgotten rather
// than passed through, and both are reported back so the UI can say what happened.
// Refusing the whole file for one bad field would make a version skew unrecoverable;
// pretending nothing was lost would be the other failure.

import {
  CATEGORIES,
  DECOR_KINDS,
  FINISHES,
  SHAPES,
  type Category,
  type DecorItem,
  type Finish,
  type PartLight,
  type ScenePart,
  type Shape,
} from './scene-spec';
import { clampDims, ROOM_SIDE_M } from './dimension-ranges';
import { resolveParts } from './transforms';
import { fileSlug } from './exports';
import { wouldCreateCycle } from './rigid-parent';
import { LAYOUT_IDS, type LayoutId, type RoomData, type Site, type Transforms } from './storage';

/** Marks the JSON as ours. Checked exactly — a file that does not say this is not
 *  refused for being invalid, it is refused for being something else entirely, and
 *  the message the user gets should differ. */
export const SCENE_FILE_FORMAT = 'danmu.scene';

/** Bumped only for a change a previous reader could not survive. Additive fields
 *  need no bump: unknown keys are ignored on read and absent ones fall back, the
 *  same contract `RoomData` already lives under. */
export const SCENE_FILE_VERSION = 1;

/** Double extension so the OS opens it as JSON and a human can read it in a text
 *  editor, while the middle word still says which app it belongs to. */
export const SCENE_FILE_EXT = '.danmu.json';

// ─── Bounds ─────────────────────────────────────────────────────────────────
//
// Every limit here exists to stop a malformed or hostile file from becoming a hung
// tab. They are generous — far above anything a real room reaches — because a bound
// that a legitimate file can hit is a bug, not a safeguard.

/** Longest file we will even try to parse. A real room is a few hundred KB. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Most pieces of furniture. The starter scenes place nine. */
const MAX_PARTS = 500;
/** Most footprint vertices. The presets use four to eight. */
const MAX_POLY_POINTS = 256;
/** Most decor props on one surface. The generator suggests up to four. */
const MAX_DECOR = 32;
/** Longest a name or id may be. Long enough for any real label, short enough that
 *  500 of them cannot bloat the store. */
const MAX_STR = 200;
/** Furthest from the origin a part may sit, in metres. `ROOM_SIDE_M.max` is the
 *  longest a room can be, so twice it is past any legitimate position and still
 *  finite — the point is to reject 1e308, not to second-guess a placement. */
const MAX_COORD = ROOM_SIDE_M.max * 2;

const HEX = /^#[0-9a-fA-F]{6}$/;

// ─── The file shape ─────────────────────────────────────────────────────────

/** The room, without the fields that identify one install's copy of it. `id` and
 *  `createdAt` are deliberately absent: they belong to a record in somebody's
 *  IndexedDB, not to the room as a thing, and an import mints its own. */
export type SceneFileRoom = {
  name: string;
  layoutId: LayoutId;
  width: number;
  depth: number;
  height: number;
  wallColors?: Record<number, string>;
  footprint?: Array<[number, number]>;
  site?: Site;
};

/** A part with its transform already resolved, plus the one per-part flag that
 *  lives outside `ScenePart` in the running app.
 *
 *  `hidden` is per-room state in `Transforms`, not a property of the piece, but a
 *  file with a side-table of overrides would reproduce inside the format the exact
 *  split that makes the live app confusing. One truth per piece.
 *
 *  `parentId` follows the same pattern — rigid-parenting relationships live in
 *  `Transforms.parentIds` in the running app (an override map, not authored
 *  geometry), but a file has no side-table to keep them in, so each part
 *  carries its own on the way out and it's split back into a map on the way
 *  back in (`sceneFileToRoom`). */
export type SceneFilePart = ScenePart & { hidden?: boolean; parentId?: string };

export type SceneFile = {
  format: typeof SCENE_FILE_FORMAT;
  version: number;
  /** When it was written, for the reader's benefit only — nothing branches on it. */
  exportedAt: number;
  room: SceneFileRoom;
  parts: SceneFilePart[];
};

// ─── Export ─────────────────────────────────────────────────────────────────

/** Collapse a room, its parts and the studio's transform overrides into one file.
 *
 *  The overrides are BAKED, through the same `resolveParts` the renderer uses. The
 *  running app keeps a piece's authored transform and the user's edit to it in two
 *  layers on purpose (see `lib/transforms.ts`), and a file is one of the places that
 *  distinction stops mattering: whoever opens it has made no edits, so the two would
 *  collapse on the next save anyway. Whatever the user is looking at is what gets
 *  written. */
export function buildSceneFile(
  room: RoomData,
  parts: ScenePart[],
  transforms: Transforms,
  exportedAt: number,
): SceneFile {
  const { positions, rotations, dims, hidden, parentIds } = transforms;
  return {
    format: SCENE_FILE_FORMAT,
    version: SCENE_FILE_VERSION,
    exportedAt,
    room: {
      name: room.name,
      layoutId: room.layoutId,
      width: room.width,
      depth: room.depth,
      height: room.height,
      ...(room.wallColors ? { wallColors: room.wallColors } : {}),
      ...(room.footprint ? { footprint: room.footprint } : {}),
      ...(room.site ? { site: room.site } : {}),
    },
    parts: resolveParts(parts, { positions, rotations, dims }).map((resolved) => {
      // fromDetection is dropped on the way out, not just refused on the way in: it
      // points at a bounding box in a photo the file does not carry, so keeping it
      // would be a reference into nothing.
      const { fromDetection: _drop, ...part } = resolved;
      if (hidden?.[part.id]) (part as SceneFilePart).hidden = true;
      if (parentIds?.[part.id]) (part as SceneFilePart).parentId = parentIds[part.id];
      return part as SceneFilePart;
    }),
  };
}

/** Serialise for download. Indented — the file is small, and being readable in a
 *  text editor is most of what makes a local-first format trustworthy. */
export function sceneFileJson(file: SceneFile): string {
  return JSON.stringify(file, null, 2);
}

/** `Front Room` → `front-room.danmu.json`, so a folder of exports from three rooms
 *  is still readable a week later. The slug itself is `exports.ts`' — this file's own
 *  copy was byte-identical to it, and four downloads naming the same room three
 *  different ways is a difference nobody chose. */
export function sceneFileName(roomName: string): string {
  return fileSlug(roomName) + SCENE_FILE_EXT;
}

// ─── Import ─────────────────────────────────────────────────────────────────

export type SceneFileParse =
  | { ok: true; file: SceneFile; dropped: string[] }
  | { ok: false; error: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite number in range. Rejects NaN and both infinities, which is the whole
 *  point — `JSON.parse` cannot produce them, but `1e400` parses to `Infinity`, and
 *  one of those in a position turns every downstream comparison false and every
 *  matrix into `NaN` without throwing anywhere. */
function num(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_STR) : null;
}

function hex(v: unknown): string | null {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function triple(v: unknown, lo: number, hi: number): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const a = num(v[0], lo, hi);
  const b = num(v[1], lo, hi);
  const c = num(v[2], lo, hi);
  return a === null || b === null || c === null ? null : [a, b, c];
}

/** Read a whole file. Never throws: a caller holding a user-chosen file wants a
 *  reason it can show, not an exception to translate. */
export function parseSceneFile(text: string): SceneFileParse {
  // Characters, not bytes — and deliberately compared against the byte cap anyway.
  // UTF-8 never encodes a character in less than a byte, so this can only be
  // conservative, and the caller has already checked the real `File.size`.
  if (text.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'That file is too large to be a Danmu room.' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't readable as a Danmu room — it may be damaged." };
  }
  if (!isObj(raw)) return { ok: false, error: "That file isn't a Danmu room." };

  if (raw.format !== SCENE_FILE_FORMAT) {
    return { ok: false, error: "That file isn't a Danmu room file." };
  }
  const version = num(raw.version, 0, Number.MAX_SAFE_INTEGER);
  if (version === null) return { ok: false, error: 'That room file has no version and cannot be read.' };
  if (version > SCENE_FILE_VERSION) {
    // Forward-incompatible: say which side is behind, because the fix is on this
    // one and the user cannot guess that from "invalid file".
    return {
      ok: false,
      error: 'That room was saved by a newer version of Danmu. Update this one, then open it again.',
    };
  }

  const dropped: string[] = [];
  const room = readRoom(raw.room, dropped);
  if (!room) return { ok: false, error: "That room file is missing its room, so there's nothing to open." };

  const partsIn = Array.isArray(raw.parts) ? raw.parts : [];
  if (partsIn.length > MAX_PARTS) {
    dropped.push(`only the first ${MAX_PARTS} pieces were read (the file listed ${partsIn.length})`);
  }

  const parts: SceneFilePart[] = [];
  const seen = new Set<string>();
  const originalToFinal = new Map<string, string>();
  let unreadable = 0;
  for (const candidate of partsIn.slice(0, MAX_PARTS)) {
    const read = readPart(candidate, seen);
    if (read) {
      parts.push(read.part);
      // First writer wins. On a duplicate id the FIRST piece keeps it and every
      // later one is reminted, so overwriting here would point `parentId: "desk-1"`
      // at `imported-3-desk` — the piece that lost the name — instead of the one
      // still answering to it.
      if (read.originalId && !originalToFinal.has(read.originalId)) {
        originalToFinal.set(read.originalId, read.part.id);
      }
    } else {
      unreadable++;
    }
  }
  if (unreadable > 0) {
    dropped.push(`${unreadable} ${unreadable === 1 ? 'piece' : 'pieces'} could not be read and were left out`);
  }

  // Resolve `parentId` now that every part's (possibly reminted) final id is
  // known, and refuse anything that would create a cycle — a hand-edited file
  // can encode a loop directly, and nothing upstream of this checks for one.
  // Accepted incrementally against what this same pass has already accepted,
  // so an in-file A -> B -> C -> A cycle is broken at exactly one edge rather
  // than refusing the whole chain.
  const acceptedParents: Record<string, string> = {};
  let droppedRelationships = 0;
  for (const part of parts) {
    if (!part.parentId) continue;
    const resolved = originalToFinal.get(part.parentId);
    if (!resolved || wouldCreateCycle(part.id, resolved, acceptedParents)) {
      delete part.parentId;
      droppedRelationships++;
      continue;
    }
    part.parentId = resolved;
    acceptedParents[part.id] = resolved;
  }
  if (droppedRelationships > 0) {
    dropped.push(
      `${droppedRelationships} surface ${droppedRelationships === 1 ? 'relationship' : 'relationships'} pointed at a missing or looping piece and ${droppedRelationships === 1 ? 'was' : 'were'} dropped`,
    );
  }

  return {
    ok: true,
    file: {
      format: SCENE_FILE_FORMAT,
      version: SCENE_FILE_VERSION,
      exportedAt: num(raw.exportedAt, 0, Number.MAX_SAFE_INTEGER) ?? 0,
      room,
      parts,
    },
    dropped,
  };
}

function readRoom(v: unknown, dropped: string[]): SceneFileRoom | null {
  if (!isObj(v)) return null;
  const width = num(v.width, ROOM_SIDE_M.min, ROOM_SIDE_M.max);
  const depth = num(v.depth, ROOM_SIDE_M.min, ROOM_SIDE_M.max);
  const height = num(v.height, ROOM_SIDE_M.min, ROOM_SIDE_M.max);
  // No room means no floor to stand furniture on, so this one is fatal rather than
  // droppable — everything else about a room has a working default.
  if (width === null || depth === null || height === null) return null;

  const room: SceneFileRoom = {
    name: str(v.name) ?? 'Imported room',
    layoutId: oneOf(v.layoutId, LAYOUT_IDS) ?? 'custom',
    width,
    depth,
    height,
  };

  const footprint = readFootprint(v.footprint);
  if (footprint) room.footprint = footprint;
  else if (v.footprint !== undefined) {
    // The layout preset still describes a shape, so this degrades rather than fails.
    dropped.push("the room's custom outline was unreadable — its preset shape was used instead");
  }

  const wallColors = readWallColors(v.wallColors);
  if (wallColors && Object.keys(wallColors).length > 0) room.wallColors = wallColors;

  const site = readSite(v.site);
  if (site) room.site = site;
  else if (v.site !== undefined) dropped.push("the room's location was unreadable and was left off");

  return room;
}

function readFootprint(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v)) return null;
  // Fewer than three points is not a polygon. More than the cap is refused whole
  // rather than truncated: half an outline is a different room, not a partial one.
  if (v.length < 3 || v.length > MAX_POLY_POINTS) return null;
  const out: Array<[number, number]> = [];
  for (const pt of v) {
    if (!Array.isArray(pt) || pt.length !== 2) return null;
    const x = num(pt[0], -MAX_COORD, MAX_COORD);
    const z = num(pt[1], -MAX_COORD, MAX_COORD);
    if (x === null || z === null) return null;
    out.push([x, z]);
  }
  return out;
}

function readWallColors(v: unknown): Record<number, string> | null {
  if (!isObj(v)) return null;
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(v)) {
    // Keys are footprint-edge indices that survived a JSON round trip as strings.
    const idx = /^\d+$/.test(key) ? Number(key) : NaN;
    const colour = hex(value);
    if (Number.isInteger(idx) && idx < MAX_POLY_POINTS && colour) out[idx] = colour;
  }
  return out;
}

function readSite(v: unknown): Site | null {
  if (!isObj(v)) return null;
  const lat = num(v.lat, -90, 90);
  const lon = num(v.lon, -180, 180);
  const bearingDeg = num(v.bearingDeg, -360, 360);
  return lat === null || lon === null || bearingDeg === null ? null : { lat, lon, bearingDeg };
}

/** One part, or null if it cannot be rendered at all.
 *
 *  The line between "drop the part" and "drop the field" is whether the renderer
 *  could do anything sensible without it. An unknown `shape` has no geometry, so the
 *  piece goes; an unreadable `color` just means the shape's default, so the field
 *  goes and the piece stays. */
function readPart(v: unknown, seen: Set<string>): { part: SceneFilePart; originalId: string } | null {
  if (!isObj(v)) return null;

  const shape = oneOf<Shape>(v.shape, SHAPES);
  const category = oneOf<Category>(v.category, CATEGORIES);
  if (!shape || !category) return null;

  const pos = triple(v.pos, -MAX_COORD, MAX_COORD);
  const rot = num(v.rot, -Math.PI * 4, Math.PI * 4);
  const rawDim = triple(v.dimMM, 0, Number.MAX_SAFE_INTEGER);
  if (!pos || rot === null || !rawDim) return null;

  // The trust boundary, in one line: a size from a file is a hint, exactly like a
  // size from a model. Anything out of range is clamped rather than believed, and
  // nothing else in the app has to know the part came from outside.
  const dimMM = clampDims(category, shape, rawDim);

  // Ids key React lists, the transform maps and the group relation. A duplicate
  // would make two pieces move as one; an absent one would collide with the next
  // absent one. Either way we mint a fresh id rather than refuse the piece.
  // `originalId` is kept separately (returned below) — a `parentId` elsewhere
  // in the file references THIS string, not whatever id the piece ends up
  // with, so `parseSceneFile` needs both to resolve it once every part is read.
  const originalId = str(v.id) ?? '';
  let id = originalId;
  if (!id || seen.has(id)) id = `imported-${seen.size}-${shape}`;
  seen.add(id);

  const part: SceneFilePart = {
    id,
    category,
    name: str(v.name) ?? shape,
    shape,
    pos,
    rot,
    dimMM,
    locked: v.locked === true,
  };

  if (v.circle === true) part.circle = true;
  if (v.wallMounted === true) part.wallMounted = true;
  if (v.hidden === true) part.hidden = true;

  const colour = hex(v.color);
  if (colour) part.color = colour;

  const finish = oneOf<Finish>(v.finish, FINISHES);
  if (finish) part.finish = finish;

  const groupId = str(v.groupId);
  if (groupId) part.groupId = groupId;

  // Left unresolved (raw, may reference an id not parsed yet, one that gets
  // reminted, or nothing at all) — `parseSceneFile` resolves and cycle-checks
  // it once every part in the file has been read.
  const parentId = str(v.parentId);
  if (parentId) part.parentId = parentId;

  // `meshHash` is deliberately not carried across. It points into THIS browser's
  // mesh cache, which an imported file has no entries in, so honouring it would
  // render nothing where a sofa should be. Dropping it falls the piece back to its
  // procedural shape, which is exactly what `shape` is for.

  const decor = readDecor(v.decor);
  if (decor) part.decor = decor;

  const light = readLight(v.light);
  if (light) part.light = light;

  return { part, originalId };
}

function readDecor(v: unknown): DecorItem[] | null {
  if (!Array.isArray(v)) return null;
  const out: DecorItem[] = [];
  for (const item of v.slice(0, MAX_DECOR)) {
    if (!isObj(item)) continue;
    const kind = oneOf(item.kind, DECOR_KINDS);
    const x = num(item.x, -MAX_COORD, MAX_COORD);
    const z = num(item.z, -MAX_COORD, MAX_COORD);
    if (!kind || x === null || z === null) continue;
    out.push({ id: str(item.id) ?? `decor-${out.length}`, kind, x, z });
  }
  // An empty array is meaningful — it is how the app records "the user cleared this
  // surface" as distinct from "never touched it" — so it is returned, not nulled.
  return out;
}

function readLight(v: unknown): PartLight | null {
  if (!isObj(v)) return null;
  // Bounds are the physical range the units module already works in: kelvin is
  // clamped to the Planckian fit's own 1667–25000 K, and a fixture brighter than
  // 20000 lm is a floodlight, not a lamp.
  const lumens = num(v.lumens, 0, 20000);
  const kelvin = num(v.kelvin, 1667, 25000);
  if (lumens === null || kelvin === null) return null;
  const coneDeg = num(v.coneDeg, 1, 180);
  return coneDeg === null ? { lumens, kelvin } : { lumens, kelvin, coneDeg };
}

/** Split a parsed file back into the two shapes the stores keep.
 *
 *  The inverse of the baking `buildSceneFile` does: parts carry final transforms, so
 *  the override maps are left empty and only `hidden` — which has nowhere else to
 *  live — is written into `Transforms`. */
export function sceneFileToRoom(file: SceneFile): { parts: ScenePart[]; transforms: Transforms } {
  const hidden: Record<string, boolean> = {};
  const parentIds: Record<string, string> = {};
  const parts = file.parts.map((p) => {
    const { hidden: isHidden, parentId, ...part } = p;
    if (isHidden) hidden[part.id] = true;
    if (parentId) parentIds[part.id] = parentId;
    return part;
  });
  return { parts, transforms: { positions: {}, rotations: {}, dims: {}, hidden, parentIds } };
}
