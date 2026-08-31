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
  isWallMountedPart,
} from './scene-spec';
import { clampDims, roomAxisRange, ROOM_SIDE_EPS, ROOM_SIDE_M } from './dimension-ranges';
import { anchorFor, heightForNewCeiling } from './physics';
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
      // Projected field by field, never spread. `Site` declares one key, but a
      // record written by the old sun mood also carries `lat` and `lon`, and those
      // are coordinates for the inside of someone's home in a file whose whole
      // purpose is to be sent to someone else. `loadRoom` strips them on read, so
      // this is the second of two defences, and it is the one that matters: an
      // explicit projection cannot leak a key it does not name, whereas a spread
      // leaks every key a future record grows.
      ...(room.site ? { site: { bearingDeg: room.site.bearingDeg } } : {}),
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

/** `num` without the range — is this a real number at all. The two questions are
 *  separate wherever an out-of-range value is worth keeping in clamped form, and
 *  keeping them separate is the point: `Number.isFinite` still refuses NaN and
 *  the `1e400` that `JSON.parse` turns into `Infinity`. */
function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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
  const ceiling: { raw: number | null } = { raw: null };
  const room = readRoom(raw.room, dropped, ceiling);
  // Names the three numbers, because that is now the whole of what is fatal here:
  // a ceiling out of range is clamped and reported (see `clampRoomHeight`), so
  // reaching this line means the width or depth is missing, is not a number, or is
  // outside `ROOM_SIDE_M` — none of which leave a floor to stand furniture on.
  if (!room) {
    return {
      ok: false,
      error: "That room file has no usable room — its width, depth or height is missing or unreadable.",
    };
  }

  const partsIn = Array.isArray(raw.parts) ? raw.parts : [];
  if (partsIn.length > MAX_PARTS) {
    dropped.push(`only the first ${MAX_PARTS} pieces were read (the file listed ${partsIn.length})`);
  }

  const parts: SceneFilePart[] = [];
  const seen = new Set<string>();
  const originalToFinal = new Map<string, string>();
  let unreadable = 0;
  for (const candidate of partsIn.slice(0, MAX_PARTS)) {
    const read = readPart(candidate, seen, dropped);
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

  // A clamped ceiling invalidates every piece whose height is measured from it, and
  // clamping it while leaving them where they were is half a repair. `readRoom`
  // reports that the ceiling moved; nothing re-hung the parts, so a fan saved under
  // a 1.65 m ceiling arrived in a 1.80 m room still at 1.50 m — the fan bug that
  // prompted the clamp in the first place, reproduced by the fix for it, in a file
  // this app wrote. The toast named the ceiling and never the pieces it had just
  // invalidated.
  //
  // `heightForNewCeiling` is the same function the room editor reaches through
  // `regradeForNewCeiling`, so which pieces follow a ceiling — and which stay at eye
  // level or on the floor — is decided in one place for both paths rather than
  // twice. Reported like every other lossy read here: never silent.
  if (ceiling.raw !== null && ceiling.raw !== room.height) {
    let rehung = 0;
    for (const p of parts) {
      const y = heightForNewCeiling(p.category, p.shape, p.dimMM, p.pos[1], ceiling.raw, room.height);
      if (y !== p.pos[1]) {
        p.pos = [p.pos[0], y, p.pos[2]];
        rehung++;
      }
    }
    if (rehung > 0) {
      dropped.push(
        `${rehung} ${rehung === 1 ? 'piece was' : 'pieces were'} re-hung to match that ceiling`,
      );
    }
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

/** A ceiling held inside `ROOM_HEIGHT_M`, saying so when it had to move. Split
 *  out so the sentence the user reads and the bound that produced it come from
 *  one place. */
function clampRoomHeight(m: number, dropped: string[]): number {
  const r = roomAxisRange('height');
  const out = Math.min(r.max, Math.max(r.min, m));
  if (out !== m) {
    dropped.push(
      `the ceiling in the file was ${m} m and was read as ${out} m (rooms here are ${r.min}–${r.max} m tall)`,
    );
  }
  return out;
}

function readRoom(
  v: unknown,
  dropped: string[],
  /** Out-param: the ceiling as the FILE stated it, before `clampRoomHeight` moved
   *  it. The caller needs both ends to re-hang the pieces measured from it. */
  ceiling?: { raw: number | null },
): SceneFileRoom | null {
  if (!isObj(v)) return null;
  // `ROOM_SIDE_EPS` on both ends, and this reader is the THIRD consumer of that
  // constant rather than a place that got lenient. A wall is dragged to a bound by
  // repeated addition, so a room walked to its 1 m floor is stored as
  // 0.99999999999999844 — measured, on five of six (start width, step) pairs. An
  // exact `>= lo` here makes that width FATAL, and a fatal width is the whole file
  // refused: *"That room file has no usable room."* About a room this app itself
  // just wrote, and only when the user tries to hand it to someone else, which is
  // the entire sharing story of rule 5.
  //
  // It is also, precisely, the regression `docs/what-is-still-open.md` § 22 chose
  // "permit corridors" in order to avoid — arriving from the other end, because the
  // tolerance was added to the two movers and not to the one boundary already
  // documented as fatal. A bound with a tolerance has to carry it everywhere it is
  // read, or the readers disagree about what the bound is.
  const width = num(v.width, ROOM_SIDE_M.min - ROOM_SIDE_EPS, ROOM_SIDE_M.max + ROOM_SIDE_EPS);
  const depth = num(v.depth, ROOM_SIDE_M.min - ROOM_SIDE_EPS, ROOM_SIDE_M.max + ROOM_SIDE_EPS);
  // A ceiling takes the ceiling's range, not the side's — `ROOM_HEIGHT_M`, via the
  // one function that decides which range an axis gets. This file needing a copy
  // of the side bound is the reason that range moved to `dimension-ranges.ts`; it
  // then read the side bound for the HEIGHT too, which is a copy of a different
  // kind and let a one-metre ceiling in through a file.
  //
  // CLAMPED AND REPORTED, not refused — and the difference is a room. Refusing an
  // out-of-range ceiling is fatal for the whole file, and this app WROTE rooms
  // that a 1.8 m floor now rejects: the editor gated every axis with the side
  // range until the commit that added `ROOM_HEIGHT_M`, and the fan bug that
  // prompted it was reported from a 1.65 m room. Saving that room and opening it
  // again answered "that room file is missing its room" — a message naming the
  // wrong problem, about a file this app produced, with no way forward. Clamping
  // is also what every imported PART size already gets from `clampDims`; a
  // ceiling was the one dimension in the file treated as fatal instead of lossy.
  // Lossy is fine here precisely because it is never silent: `dropped` is shown.
  const rawHeight = finite(v.height);
  if (ceiling) ceiling.raw = rawHeight;
  const height = rawHeight === null ? null : clampRoomHeight(rawHeight, dropped);
  // Width and depth stay fatal, and the asymmetry is deliberate rather than
  // leftover: a width of 0 or a missing one is not a room with odd proportions,
  // it is no floor to stand furniture on. A ceiling of 1.65 m is a real room.
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
  else if (v.site !== undefined) dropped.push("which way the room faces was unreadable and was left off");

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

/** The room's orientation, and nothing else.
 *
 *  Files written by an older build carry a `lat` and a `lon` here as well. They
 *  are read past rather than validated: the app no longer holds a coordinate for
 *  the inside of someone's home (see `Site` in `lib/storage.ts`), and a field with
 *  no consumer has no business surviving a round trip through this parser. It is
 *  not reported in `dropped` either — that list is for content the user would
 *  notice missing from their room, and a latitude nothing renders is not. */
function readSite(v: unknown): Site | null {
  if (!isObj(v)) return null;
  const bearingDeg = num(v.bearingDeg, -360, 360);
  return bearingDeg === null ? null : { bearingDeg };
}

/** One part, or null if it cannot be rendered at all.
 *
 *  The line between "drop the part" and "drop the field" is whether the renderer
 *  could do anything sensible without it. An unknown `shape` has no geometry, so the
 *  piece goes; an unreadable `color` just means the shape's default, so the field
 *  goes and the piece stays. */
function readPart(
  v: unknown,
  seen: Set<string>,
  /** Same channel `readRoom` takes, for the same reason: this parser is lossy on
   *  purpose and never silent. A field overruled is content the user wrote and did
   *  not get, so it is reported rather than quietly corrected. */
  dropped: string[],
): { part: SceneFilePart; originalId: string } | null {
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

  // DERIVED, never trusted — the same boundary `clampDims` draws for a size, drawn
  // for the one other field in this record that has a single right answer.
  //
  // `wallMounted` is "is this piece's geometry centred on its origin", and
  // `isWallMountedPart(category, shape)` is that question's only answer: every path
  // inside the app computes it from those two (`placeNewPart`, the Inspector's swap,
  // the scene builder). Reading it off the file made this the one place the app could
  // hold a television that believed it was floor-standing — with the centred geometry
  // sinking half its height through the floor, which is the exact scar
  // `isWallMountedPart`'s own docblock records from the detection path, and a support
  // probe measuring its top 285 mm too high.
  //
  // Both directions matter and the absent one is the likelier: the field is OPTIONAL,
  // so a hand-written or third-party file that simply omits it produced a mounted
  // piece with the flag false. And a file asserting `wallMounted: true` on a sofa is
  // refused just as firmly, because a sofa's geometry is not centred no matter what a
  // file says.
  //
  // Reported only when the file DISAGREED, not on every part that carries the field,
  // because a note on every export would be noise rather than the honest lossiness
  // `dropped` is for. A round trip is silent, but NOT because the writer derives the
  // flag — `buildSceneFile` spreads the `ScenePart` it is handed. It is silent because
  // the builders that produce those parts now agree with `isWallMountedPart`, which is
  // a property of a different file and can regress there without this one changing.
  //
  // Two shapes of disagreement, and they need two messages because one cannot describe
  // both without stating something false. `v` is `unknown`, so `v.wallMounted !==
  // derivedMount` was true for EVERY non-boolean, and the text then rendered
  // `v.wallMounted === true`, which is `false` for every non-boolean too: `0`, `null`
  // and `""` produced a note about a disagreement that did not exist, while `1` and
  // `"true"` reported “said false” about a file that said the opposite. Coercing harder
  // does not fix the second half — it only moves which values lie. A boolean's
  // vocabulary is {true, false}, exactly as `SHAPES` and `CATEGORIES` are vocabularies,
  // so anything else is malformed and is NAMED as malformed rather than folded into a
  // claim the file never made. The malformed note fires even when the derived answer
  // happens to match, because what was ignored is the value, not the conclusion.
  const derivedMount = isWallMountedPart(category, shape);
  if (derivedMount) part.wallMounted = true;
  const saidMount: unknown = v.wallMounted;
  if (saidMount !== undefined) {
    // Named by ANCHOR, not by the flag. `derivedMount` is `anchorFor(...) !== 'floor'`,
    // so rendering it as "is wall-mounted" said a pendant and a ceiling fan are fixed to
    // a wall — false, and the file two lines up knows better. It also interpolated
    // `shape`, which is the internal kebab-case id, so the user was shown "a lamp-pendant"
    // and "an ac-unit". The piece is already named in quotes at the front of the sentence,
    // so this clause only has to say where it belongs.
    const anchor = anchorFor(category, shape);
    const verdict =
      anchor === 'ceiling'
        ? 'it hangs from the ceiling'
        : anchor === 'floor'
          ? 'it stands on the floor'
          : 'it is fixed to a wall';
    if (typeof saidMount !== 'boolean') {
      dropped.push(
        `“${part.name}” gave a wallMounted that is neither true nor false; ${verdict}, so the file's value was ignored`,
      );
    } else if (saidMount !== derivedMount) {
      dropped.push(`“${part.name}” said wallMounted: ${saidMount}; ${verdict}, so that was ignored`);
    }
  }
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
