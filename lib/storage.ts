'use client';

import { get, set as idbSet, del, keys } from 'idb-keyval';

// Wrap set so QuotaExceededError fires a global event the StorageToast listens to.
async function set<T>(key: IDBValidKey, value: T): Promise<void> {
  try {
    await idbSet(key, value);
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'QuotaExceededError' || /quota/i.test(String(e))) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('danmu:storage-full', { detail: String(e) }));
      }
    }
    throw e;
  }
}

// IndexedDB-backed room data: captures (blobs), detections, scene parts, transforms.
// Single-room v0.1. Keys are namespaced by roomId.

export type CaptureSlot = 'n' | 'e' | 's' | 'w';

export type Capture = {
  slot: CaptureSlot;
  blob: Blob;
  takenAt: number;
  pose?: { yaw: number; tilt: number; height: number };
};

/** Schema version stamped onto every room we write.
 *
 *  Additive change has always been safe here — new optional fields are read
 *  defensively (`wallColors?`, `footprint?`, `hidden?`). A change that is NOT
 *  additive (a renamed field, a units change, a restructured `detectedObjects`)
 *  needs something to branch on, and there was nothing. Records written before
 *  this existed read back as version 0. */
export const ROOM_SCHEMA_VERSION = 1;

export type RoomData = {
  id: string;
  createdAt: number;
  /** Absent on rooms written before the version stamp — treat as 0. */
  version?: number;
  name: string;
  layoutId: 'rect' | 'l' | 't' | 'u' | 'open' | 'custom';
  width: number; // meters
  depth: number;
  height: number;
  /** per-wall paint colour, keyed by footprint-edge index. Optional — absent on
   *  rooms created before wall painting shipped (defensive read on load). */
  wallColors?: Record<number, string>;
  /** custom footprint polygon (XZ metres) after independent wall moves. When
   *  present it overrides the layout-derived shape on load. Optional. */
  footprint?: Array<[number, number]>;
  detectedObjects?: Array<{
    id: number;
    /** Stable per-detection key, minted once when the detection is first saved.
     *  It becomes the ScenePart id, so every transform the user makes stays
     *  attached to the same piece of furniture across a re-detect. Absent on
     *  rooms saved before this shipped — those fall back to the positional
     *  `${category}-${n}` id (see buildSceneFromRoom). */
    uid?: string;
    label: string;
    conf: number;
    locked: boolean;
    box: [number, number, number, number];
    category?: string;
    dimMM?: [number, number, number];
    position?: { x: number; y: number; z: number };
    yaw?: number;
    shape?: string;
    /** Dominant colour (#rrggbb) — photo-sampled, Gemini hex fallback. */
    color?: string;
    /** Cached mesh hash → lib/mesh-cache.ts. */
    meshHash?: string;
  }>;
};

const k = (roomId: string, sub: string) => `room:${roomId}:${sub}`;

/** Deleted rooms are moved under this prefix instead of being erased, so a
 *  mis-click is recoverable. Purged after TRASH_TTL on the next listRooms. */
const TRASH = 'trash:';
const TRASH_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Last-modified stamp, kept in its own tiny key. Writing it here rather than
 *  into `meta` means the 300ms-debounced transform/scene saves don't have to
 *  read-modify-write the whole room record just to record that it changed. */
async function touch(roomId: string) {
  await set(k(roomId, 'touched'), Date.now());
}

export type Transforms = {
  positions: Record<string, [number, number, number]>;
  rotations: Record<string, number>;
  dims: Record<string, [number, number, number]>;
  /** which parts the user hid. Per-room like the transforms, and optional —
   *  rooms saved before this shipped simply have nothing hidden. Without it, a
   *  refresh silently brought hidden parts back while the top bar had been
   *  showing a "saved" state the whole time. */
  hidden?: Record<string, boolean>;
};

/** A named furniture-arrangement snapshot ("Layout A / B") — lets the user
 *  save competing arrangements of the same room and flip between them. */
export type LayoutVariant = {
  id: string;
  name: string;
  createdAt: number;
  /** ScenePart[] — stored opaque to avoid a lib cycle (same as saveSceneParts). */
  parts: unknown;
  transforms: Transforms;
};

export type RoomSummary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
  /** captures uploaded; 0 = never started capture */
  captureCount: number;
  /** has detectedObjects from a successful detect run */
  detected: boolean;
};

export const roomStore = {
  async saveRoom(room: RoomData) {
    await set(k(room.id, 'meta'), { ...room, version: ROOM_SCHEMA_VERSION });
    await touch(room.id);
  },
  async renameRoom(roomId: string, name: string) {
    const meta = await get<RoomData>(k(roomId, 'meta'));
    if (!meta) return;
    await set(k(roomId, 'meta'), { ...meta, name, version: ROOM_SCHEMA_VERSION });
    await touch(roomId);
  },
  async loadRoom(roomId: string): Promise<RoomData | undefined> {
    return get<RoomData>(k(roomId, 'meta'));
  },
  async saveCapture(roomId: string, capture: Capture) {
    await set(k(roomId, `cap:${capture.slot}`), capture);
    await touch(roomId);
  },
  /** Remove one wall photo. Without this, moving a photo between slots left the
   *  original behind in IndexedDB — React showed the source slot as empty while
   *  a reload resurrected the same photo in both slots and fed a duplicate wall
   *  into detection. Also backs the per-photo Remove action. */
  async deleteCapture(roomId: string, slot: CaptureSlot) {
    await del(k(roomId, `cap:${slot}`));
    await touch(roomId);
  },
  async loadCaptures(roomId: string): Promise<Capture[]> {
    const all = await keys();
    const prefix = k(roomId, 'cap:');
    // Fan out rather than awaiting one multi-megabyte blob at a time — this runs
    // on mount of both the capture and the detect screen, so it was four
    // serialised reads before either could paint. Same treatment listRooms
    // already had.
    const matching = all.filter((key): key is string => typeof key === 'string' && key.startsWith(prefix));
    const values = await Promise.all(matching.map((key) => get<Capture>(key)));
    return values.filter((v): v is Capture => !!v);
  },
  async saveLayout(roomId: string, v: LayoutVariant) {
    await set(k(roomId, `layout:${v.id}`), v);
  },
  async deleteLayout(roomId: string, layoutId: string) {
    await del(k(roomId, `layout:${layoutId}`));
  },
  async listLayouts(roomId: string): Promise<LayoutVariant[]> {
    const all = await keys();
    const prefix = k(roomId, 'layout:');
    const matching = all.filter((key): key is string => typeof key === 'string' && key.startsWith(prefix));
    const values = await Promise.all(matching.map((key) => get<LayoutVariant>(key)));
    return values
      .filter((v): v is LayoutVariant => !!v)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
  async saveTransforms(roomId: string, t: Transforms) {
    await set(k(roomId, 'transforms'), t);
    await touch(roomId);
  },
  async loadTransforms(roomId: string): Promise<Transforms | undefined> {
    return get<Transforms>(k(roomId, 'transforms'));
  },
  async saveSceneParts(roomId: string, parts: unknown) {
    await set(k(roomId, 'scene'), parts);
    await touch(roomId);
  },
  async loadSceneParts<T>(roomId: string): Promise<T | undefined> {
    return get<T>(k(roomId, 'scene'));
  },
  async listRooms(): Promise<RoomSummary[]> {
    const all = (await keys()).filter((key): key is string => typeof key === 'string');

    // One pass over the key list to bucket everything per room, then parallel
    // reads. The previous shape did two sequential gets *plus* a full rescan of
    // every key for each room, so 40 rooms meant ~160 serialised round trips
    // before the grid could paint.
    const ids = new Set<string>();
    const captureCounts = new Map<string, number>();
    for (const key of all) {
      const meta = key.match(/^room:([^:]+):meta$/);
      if (meta) {
        ids.add(meta[1]);
        continue;
      }
      const cap = key.match(/^room:([^:]+):cap:/);
      if (cap) captureCounts.set(cap[1], (captureCounts.get(cap[1]) ?? 0) + 1);
    }

    const rows = await Promise.all(
      [...ids].map(async (id) => {
        const [meta, transforms, touched] = await Promise.all([
          get<RoomData>(k(id, 'meta')),
          get<Transforms>(k(id, 'transforms')),
          get<number>(k(id, 'touched')),
        ]);
        if (!meta) return null;
        return {
          id,
          name: meta.name,
          createdAt: meta.createdAt,
          // Rooms saved before `touched` existed fall back to their creation
          // date — the honest answer for a room we have no edit record for.
          updatedAt: touched ?? meta.createdAt,
          itemCount: transforms ? Object.keys(transforms.positions).length : 0,
          captureCount: captureCounts.get(id) ?? 0,
          detected: !!(meta.detectedObjects && meta.detectedObjects.length > 0),
        } satisfies RoomSummary;
      }),
    );

    // Expiring old trash here keeps deletion recoverable without needing a
    // background job in a product that has no server.
    void roomStore.purgeTrash();

    return rows.filter((r): r is RoomSummary => r !== null).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** Soft-delete: every `room:{id}:*` key is moved under `trash:{ts}:`, so the
   *  room disappears from the workspace but is recoverable. Returns the token
   *  needed to undo. A sandbox that can undo moving a chair should not lose a
   *  whole room permanently to one mis-aimed click.
   *
   *  `meta` moves FIRST and on its own. There is no transaction across keys here
   *  (idb-keyval is a single store), so a tab closed mid-delete used to leave a
   *  room with its meta still live and its scene, transforms and photos already
   *  in the trash — a room that appears in the workspace and opens empty.
   *  `listRooms` keys off `meta`, so retiring that key first makes the visible
   *  state flip exactly once: worst case now is orphaned non-meta keys, which are
   *  invisible and get swept by the next purge. */
  async clearRoom(roomId: string): Promise<{ roomId: string; deletedAt: number }> {
    const all = await keys();
    const prefix = `room:${roomId}:`;
    const deletedAt = Date.now();
    const metaKey = k(roomId, 'meta');
    const move = async (key: string) => {
      const value = await get(key);
      if (value !== undefined) await set(`${TRASH}${deletedAt}:${key}`, value);
      await del(key);
    };

    await move(metaKey);
    const rest = all.filter(
      (key): key is string => typeof key === 'string' && key.startsWith(prefix) && key !== metaKey,
    );
    await Promise.all(rest.map(move));
    return { roomId, deletedAt };
  },

  /** Undo a soft delete.
   *
   *  Mirror image of clearRoom: everything else lands first and `meta` last, so
   *  the room only reappears in the workspace once it is whole. Refuses when a
   *  live room already holds the id rather than overwriting it. */
  async restoreRoom(token: { roomId: string; deletedAt: number }): Promise<boolean> {
    const metaKey = k(token.roomId, 'meta');
    if ((await get(metaKey)) !== undefined) return false;

    const all = await keys();
    const trashPrefix = `${TRASH}${token.deletedAt}:`;
    const prefix = `${trashPrefix}room:${token.roomId}:`;
    const trashedMeta = `${trashPrefix}${metaKey}`;
    const restore = async (key: string) => {
      const value = await get(key);
      if (value !== undefined) await set(key.slice(trashPrefix.length), value);
      await del(key);
    };

    const matching = all.filter((key): key is string => typeof key === 'string' && key.startsWith(prefix));
    await Promise.all(matching.filter((key) => key !== trashedMeta).map(restore));
    if (matching.includes(trashedMeta)) await restore(trashedMeta);
    return matching.length > 0;
  },

  /** Drop trashed keys older than TRASH_TTL. Cheap: one key scan, no reads. */
  async purgeTrash(maxAgeMs: number = TRASH_TTL) {
    const all = await keys();
    const cutoff = Date.now() - maxAgeMs;
    const expired = all.filter((key): key is string => {
      if (typeof key !== 'string' || !key.startsWith(TRASH)) return false;
      const ts = Number(key.slice(TRASH.length).split(':')[0]);
      return Number.isFinite(ts) && ts < cutoff;
    });
    await Promise.all(expired.map((key) => del(key)));
  },

  /** Irreversible erase, bypassing trash. Only for an explicit "delete
   *  permanently" affordance — never for the ordinary delete path. */
  async destroyRoom(roomId: string) {
    const all = await keys();
    const prefix = `room:${roomId}:`;
    const metaKey = k(roomId, 'meta');
    // Same ordering rule as clearRoom: retire the key that decides visibility
    // before the payload it describes.
    await del(metaKey);
    const rest = all.filter(
      (key): key is string => typeof key === 'string' && key.startsWith(prefix) && key !== metaKey,
    );
    await Promise.all(rest.map((key) => del(key)));
  },
};

export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
