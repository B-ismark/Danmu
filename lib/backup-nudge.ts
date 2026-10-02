// Keeping a person's rooms from vanishing with the browser's site data.
//
// Rooms live only in IndexedDB (`lib/storage.ts`). A browser may clear that for a
// site that never asked to keep it — Safari's tracking prevention does it to a site
// unused for seven days, unless it is installed — and clearing site data by hand
// does the same. Either way every room goes, with no warning. Two answers, both
// local, both quiet:
//
//  1. `requestPersistentStorage` asks the browser to keep this site's storage. It
//     is called only from a press (create a room, open a file, save a file), never
//     on mount: Firefox shows a prompt for it, and a permission is never asked for
//     before the person has done something that explains it.
//  2. `noteRoomSaved` counts a room's saves and says when to offer a backup FILE,
//     once, after the room has had real work put into it. A file is the only copy
//     that survives the browser, and saving one is a feature that already exists
//     (`saveSceneFile`).
//
// The offer is made once per room, ever. Offering and declining are the same
// outcome here, since a toast's close button reports nothing, and "doesn't come
// back" is the promise that keeps a nudge from becoming a nag. A room that has
// already been saved to a file is never offered one.
//
// What is stored is a flag per room in localStorage, inside a try, because touching
// localStorage throws where site data is blocked. A lost flag costs one repeat
// offer, never a lost room.

/** Saves (debounced writes, each at least 300 ms apart) before a room has had
 *  enough put into it to be worth a backup. A drag is one save; twenty is a few
 *  minutes of arranging, not a first look around. */
export const BACKUP_NUDGE_AFTER_SAVES = 20;

const KEY = 'danmu:backup-nudge';

/** Per room: how many saves so far, and whether the question is closed — offered
 *  once, or a file already saved. */
export type NudgeEntry = { saves: number; done?: true };
export type NudgeState = Record<string, NudgeEntry>;

/** The decision, pure: the state after one more save of `roomId`, and whether this
 *  is the save to make the offer on. */
export function afterSave(state: NudgeState, roomId: string, threshold = BACKUP_NUDGE_AFTER_SAVES): { state: NudgeState; offer: boolean } {
  const prev = state[roomId] ?? { saves: 0 };
  if (prev.done) return { state, offer: false };
  const saves = prev.saves + 1;
  const offer = saves >= threshold;
  return { state: { ...state, [roomId]: offer ? { saves, done: true } : { saves } }, offer };
}

/** The state once `roomId` has a file: never offered one again. */
export function afterFileSaved(state: NudgeState, roomId: string): NudgeState {
  return { ...state, [roomId]: { saves: state[roomId]?.saves ?? 0, done: true } };
}

function read(): NudgeState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: NudgeState = {};
    for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
      if (!e || typeof e !== 'object') continue;
      const { saves, done } = e as { saves?: unknown; done?: unknown };
      if (typeof saves !== 'number' || !Number.isFinite(saves) || saves < 0) continue;
      out[id] = done === true ? { saves, done: true } : { saves };
    }
    return out;
  } catch {
    return {};
  }
}

function write(state: NudgeState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Blocked or full: the cost is one repeat offer.
  }
}

/** Count one save of `roomId`; true when this is the save to offer a backup on. */
export function noteRoomSaved(roomId: string): boolean {
  const { state, offer } = afterSave(read(), roomId);
  write(state);
  return offer;
}

/** `roomId` was saved to a file: never offer it one. */
export function noteFileSaved(roomId: string): void {
  write(afterFileSaved(read(), roomId));
}

/** The state with only the rooms in `rooms` left: a deleted room's entry would
 *  otherwise outlive it. A room in the trash is dropped too, and restoring it costs
 *  at most one repeat offer. */
export function keepOnly(state: NudgeState, rooms: ReadonlySet<string>): NudgeState {
  return Object.fromEntries(Object.entries(state).filter(([id]) => rooms.has(id)));
}

/** Drop the entries of rooms that no longer exist. Writes only when one went. */
export function pruneNudges(rooms: ReadonlySet<string>): void {
  const state = read();
  const kept = keepOnly(state, rooms);
  if (Object.keys(kept).length !== Object.keys(state).length) write(kept);
}

/** Ask the browser to keep this site's storage. Call from a press only. Answers
 *  whether storage is persistent now, or null where the browser cannot say. Never
 *  throws: a refusal changes nothing the person can see. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist) return null;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}
