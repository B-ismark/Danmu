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
// same one-transaction save — unless the room has been saved since, which means either the
// save landed after all or something newer did. The note never overwrites a newer save; the
// worst it can do is write again what already landed, which changes nothing.
//
// It is transient: written only on the way out, cleared as soon as the save it stands in
// for lands on a page that is still alive, and cleared by the replay. A CLOSED tab is the
// one way out that clears neither — its save lands, but the page that would have cleared
// the note is gone, and nothing reopens the room — so the room list also clears every note
// whose room has been saved since, or no longer exists (`roomStore.settleLeaveNotes`),
// rather than a copy of the room waiting indefinitely beside the room itself. It holds the
// room's shape and furniture, never a photograph (`CLAUDE.md` rule 5).
//
// The storage is a parameter so the suite can hand it a plain object; the default reads
// `localStorage` inside a try, because merely touching it throws where site data is blocked.

import type { Transforms } from './storage';

/** Everything the room's one save still had waiting when the page went, as data: the
 *  shell to lay over the stored room rather than the function that lays it. */
export type LeaveNote<Shell = unknown> = {
  /** When the page went. A room last saved at or after it has already been saved. */
  at: number;
  shell: Shell;
  /** The part list to store as the scene if the edit reshaped a room the picker built. */
  pin?: unknown;
  transforms?: Transforms;
  parts?: unknown;
};

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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSize = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** A note this app wrote seconds ago, still read as bytes from outside the program: the
 *  three sizes it would lay over the room are checked, and anything malformed is refused
 *  whole rather than half-applied. */
function parse(raw: string): LeaveNote | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v) || typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
  const shell = v.shell;
  if (!isRecord(shell) || !isSize(shell.width) || !isSize(shell.depth) || !isSize(shell.height)) return null;
  if (v.transforms !== undefined && !(isRecord(v.transforms) && isRecord(v.transforms.positions))) return null;
  if (v.parts !== undefined && !Array.isArray(v.parts)) return null;
  if (v.pin !== undefined && !Array.isArray(v.pin)) return null;
  return v as LeaveNote;
}

/** Whether a room last saved at `touched` has been saved since a note written `at`. Later,
 *  not at: a save landing in the same millisecond as the leave is written again, which
 *  changes nothing, where treating it as newer could drop one that was lost. The replay and
 *  the room list ask the same question, so they cannot disagree about which notes are done. */
export const savedSince = (touched: unknown, at: number) => typeof touched === 'number' && touched > at;

/** Write the note, synchronously. False when it could not be written — no storage, a full
 *  one, a value that will not serialise — in which case the save goes on without it, as
 *  it did before there was one. */
export function writeLeaveNote(roomId: string, note: LeaveNote, storage = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(leaveNoteKey(roomId), JSON.stringify(note));
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
    // Nothing to do: the note stays, and the next open finds the room already saved.
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
