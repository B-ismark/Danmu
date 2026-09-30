// A note left on the way out, for the one save that cannot finish there.
//
// `RoomSync` saves a changed room as a read and then a write: `roomStore.savePending` reads
// the stored room and writes the edited one inside the read's success handler, because the
// edit is laid over whatever else the record holds — its name, its detections, its photos'
// state — and a blind write would put back an older copy of all of that. On a RELOAD the
// old document is gone before that read comes back, so nothing is written at all: a width
// typed and reloaded at once came back as it was, 0 of 5 in Chromium
// (`docs/what-is-still-open.md` § 47). A closed tab kept it 5 of 5, which is the same race
// won, not a different path. A save with no room edit in it writes without reading and was
// kept on a reload 5 of 5, so it needs none of this.
//
// localStorage is the one storage a leaving page can finish writing, because it is
// synchronous. So when the page goes with a room edit waiting, `RoomSync` also writes the
// whole of that save here, as data, and the next open of the room replays it through the
// same one-transaction save — each of its parts only if nothing has written that part since.
//
// **"Since" is asked of each part, never of the room.** The save has three parts — the
// shell, the positions, the scene — and `savePending` stamps each one it writes with the
// moment its data was taken (`stillOwed`, below). The first version asked the room's
// `touched` stamp instead, which every writer shares and which records when a write
// COMMITTED rather than how new its data was. So renaming the room, adding a photo, or an
// older debounced save that happened to commit after the leave each made an owed change
// look landed, and it was thrown away with nothing said. A rename writes none of the three
// parts, so it no longer counts; a re-scan writes the scene and the positions, so it still
// does, for those two and not for the shell.
//
// It is transient: written only on the way out, cleared as soon as the save it stands in
// for lands on a page that is still alive, and cleared by the replay, which is given one
// try — a change the user has now seen missing, and gone on working past, is not one to
// spring on them at a later open. A try the user saw no room for (the read failed too) is
// not spent. A CLOSED tab is the one way out that clears neither — its
// save lands, but the page that would have cleared the note is gone, and nothing reopens the
// room — so the room list also clears every note that is no longer owed, or whose room no
// longer exists (`roomStore.settleLeaveNotes`). It holds the room's shape and furniture,
// never a photograph (`CLAUDE.md` rule 5).
//
// The storage is a parameter so the suite can hand it a plain object; the default reads
// `localStorage` inside a try, because merely touching it throws where site data is blocked.

import type { PendingWrite, RoomData, Transforms } from './storage';

/** Everything the room's one save still had waiting when the page went, as data: the
 *  shell to lay over the stored room rather than the function that lays it. */
export type LeaveNote = {
  /** When the page went, and what the save it stands in for stamps each part it writes. */
  at: number;
  /** The live room's shell. Its three sizes are checked on the way back in; the rest is the
   *  app's own write, and `RoomSync` is the one reader that knows its type. */
  shell: unknown;
  /** The part list to store as the scene if the edit reshaped a room the picker built. */
  pin?: unknown;
  transforms?: Transforms;
  parts?: unknown;
};

/** The three parts of a save that each carry a stamp of their own. */
export type SavePart = 'room' | 'transforms' | 'scene';

type NoteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const PREFIX = 'danmu-leave:';
export const leaveNoteKey = (roomId: string) => `${PREFIX}${roomId}`;

function defaultStorage(): NoteStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The note for the save `RoomSync` is about to start, `at` being the time it stamps. The
 *  pin is left out when a part list rides the same save, because `savePending` stores that
 *  list over the pin, and a second copy of the furniture only brings the quota nearer. The
 *  inverse is `pendingOf`; the two are here together so a field cannot be added to one. */
export function leaveNoteOf(
  at: number,
  shell: unknown,
  w: { transforms?: Transforms; parts?: unknown; pin?: unknown },
): LeaveNote {
  return { at, shell, transforms: w.transforms, parts: w.parts, pin: w.parts === undefined ? w.pin : undefined };
}

/** The save a note stands in for, to replay: stamped with the note's time, and written only
 *  where nothing has written since. `edit` lays the note's shell over the stored room. */
export function pendingOf(note: LeaveNote, edit: (stored: RoomData, shell: unknown) => RoomData): PendingWrite {
  return {
    at: note.at,
    transforms: note.transforms,
    parts: note.parts,
    room: { edit: (stored) => edit(stored, note.shell), pin: note.pin },
    unlessSavedSince: note.at,
  };
}

/** Which parts of a save whose data was taken `at` are still owed, given when each part was
 *  last written (`undefined` where it never has been). Written at or after `at` is written:
 *  the save a note stands in for stamps exactly `at`, and `roomStore`'s save times never
 *  repeat within a page, so equal is that save having landed.
 *
 *  The pin rides the room edit, and is a scene: owed only while both are. The replay and
 *  the room list both ask this, so they cannot disagree about which notes are done. */
export function stillOwed(
  at: number,
  has: { room: boolean; transforms: boolean; parts: boolean; pin: boolean },
  written: Partial<Record<SavePart, unknown>>,
) {
  const since = (part: SavePart) => {
    const t = written[part];
    return typeof t === 'number' && t >= at;
  };
  const room = has.room && !since('room');
  const scene = !since('scene');
  return {
    room,
    transforms: has.transforms && !since('transforms'),
    parts: has.parts && scene,
    pin: has.pin && room && scene,
  };
}

/** Whether any of a note's save is still owed. */
export function noteOwed(note: LeaveNote, written: Partial<Record<SavePart, unknown>>): boolean {
  const owed = stillOwed(
    note.at,
    { room: true, transforms: note.transforms !== undefined, parts: note.parts !== undefined, pin: note.pin !== undefined },
    written,
  );
  return owed.room || owed.transforms || owed.parts;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSize = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Every number in it is finite. JSON has no NaN, but `1e400` parses to Infinity. */
function allFinite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (isRecord(v)) return Object.values(v).every(allFinite);
  return true;
}

/** A note this app wrote seconds ago, still read as bytes from outside the program: its
 *  shape is checked — a time, a shell with three sizes, transforms with positions, lists
 *  where lists go — and every number in it must be finite, and anything malformed is
 *  refused whole rather than half-applied. The values within that shape are the app's own
 *  write, which `writeLeaveNote` refuses to make with a number JSON cannot carry. */
function parse(raw: string): LeaveNote | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v) || typeof v.at !== 'number' || !allFinite(v)) return null;
  const shell = v.shell;
  if (!isRecord(shell) || !isSize(shell.width) || !isSize(shell.depth) || !isSize(shell.height)) return null;
  if (v.transforms !== undefined && !(isRecord(v.transforms) && isRecord(v.transforms.positions))) return null;
  if (v.parts !== undefined && !Array.isArray(v.parts)) return null;
  if (v.pin !== undefined && !Array.isArray(v.pin)) return null;
  return v as LeaveNote;
}

/** JSON writes NaN and Infinity as `null`, which would reach the room as a vertex or a size
 *  of nothing. Such a note is not written; the save goes on without it. */
function finiteOnly(_key: string, value: unknown) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('not a finite number');
  return value;
}

/** Write the note, synchronously. False when it could not be written — no storage, a full
 *  one, a value that will not serialise, or will not serialise as itself — in which case
 *  the save goes on without it, as it did before there was one. */
export function writeLeaveNote(roomId: string, note: LeaveNote, storage = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(leaveNoteKey(roomId), JSON.stringify(note, finiteOnly));
    return true;
  } catch {
    return false;
  }
}

/** The room's note, or null. One that cannot be read is removed, so it is not met again. */
export function readLeaveNote(roomId: string, storage = defaultStorage()): LeaveNote | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(leaveNoteKey(roomId));
    if (raw === null) return null;
    const note = parse(raw);
    if (!note) storage.removeItem(leaveNoteKey(roomId));
    return note;
  } catch {
    return null;
  }
}

/** Remove the note written `at`, and only that one: a save that lands late must not remove
 *  a note a later leave has written since. */
export function clearLeaveNote(roomId: string, at: number, storage = defaultStorage()): void {
  if (!storage) return;
  try {
    const raw = storage.getItem(leaveNoteKey(roomId));
    if (raw === null) return;
    const note = parse(raw);
    if (!note || note.at === at) storage.removeItem(leaveNoteKey(roomId));
  } catch {
    // Nothing to do: the note stays, and the next open finds its parts already written.
  }
}

/** Every room that has a note. */
export function leaveNoteRooms(storage = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const rooms: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) rooms.push(key.slice(PREFIX.length));
    }
    return rooms;
  } catch {
    return [];
  }
}

/** Remove the room's note whatever it says: the room itself is being deleted. */
export function dropLeaveNote(roomId: string, storage = defaultStorage()): void {
  try {
    storage?.removeItem(leaveNoteKey(roomId));
  } catch {
    // Blocked storage holds no note to remove.
  }
}
