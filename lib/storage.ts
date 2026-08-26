'use client';

import { get, set as idbSet, del, keys } from 'idb-keyval';
import { v4 as uuid } from 'uuid';

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

/** What we managed to learn about the camera when the photo was taken.
 *
 *  The geometry engine otherwise assumes a 66° lens, a level phone and a shooter
 *  exactly 1.5 m tall, and those three assumptions are its largest error terms
 *  (see lib/photo-geometry.ts). Every field is optional: each has a fallback, and
 *  a photo that tells us nothing is calibrated exactly as it always was.
 *
 *  This replaces an earlier `pose?: { yaw, tilt, height }` that was declared but
 *  never once written or read, so there is nothing stored to migrate. */
export type CapturePose = {
  /** 35 mm-equivalent focal length, from EXIF. Deliberately stored as the focal
   *  length rather than a field of view: converting needs the image aspect, and
   *  that is known at calibration time, not here. */
  focal35mm?: number;
  /** Lens tilt at the shutter in degrees, positive when pointing DOWN. Live
   *  capture only — standard EXIF has no tilt field. */
  tiltDeg?: number;
  /** Camera height off the floor in metres, when the user told us. */
  heightM?: number;
  /** Compass bearing the lens faced, degrees clockwise from north.
   *
   *  This is the top rung of `lib/capture-slots.ts`'s ladder: the bearings of the
   *  photos already placed derive an anchor, and an arriving photo's own bearing is
   *  read against it to name its wall. Only DIFFERENCES between bearings are ever
   *  used, which is what makes it safe to store one number with no reference —
   *  see that file's header.
   *
   *  Measured against the four real photos this app was tested on: **absent.** A
   *  Pixel 6 Pro's own EXIF carries no `GPSImgDirection`, and anything that has
   *  passed through a share sheet has been stripped further still. Persisted
   *  anyway, because a phone that does write it makes the difference between
   *  naming the walls and guessing at them — but do not build on the assumption
   *  that it is there. */
  bearingDeg?: number;
};

export type Capture = {
  slot: CaptureSlot;
  blob: Blob;
  takenAt: number;
  pose?: CapturePose;
};

/** Schema version stamped onto every room we write.
 *
 *  Additive change has always been safe here — new optional fields are read
 *  defensively (`wallColors?`, `footprint?`, `hidden?`). A change that is NOT
 *  additive (a renamed field, a units change, a restructured `detectedObjects`)
 *  needs something to branch on, and there was nothing. Records written before
 *  this existed read back as version 0. */
export const ROOM_SCHEMA_VERSION = 1;

/** Where a room is and how it is oriented, for the sun path. */
export type Site = {
  /** Degrees north, -90…90. */
  lat: number;
  /** Degrees east, -180…180. */
  lon: number;
  /** True bearing the room's own north edge faces, degrees clockwise. 0 = the
   *  plan's north really is north. */
  bearingDeg: number;
};

/** Footprint presets, as an array so `lib/scene-file.ts` can check an imported
 *  value at runtime — see the note on `SHAPES` in `lib/scene-spec.ts`. */
export const LAYOUT_IDS = ['rect', 'l', 't', 'u', 'open', 'custom'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export type RoomData = {
  id: string;
  createdAt: number;
  /** Absent on rooms written before the version stamp — treat as 0. */
  version?: number;
  name: string;
  layoutId: LayoutId;
  width: number; // meters
  depth: number;
  height: number;
  /** per-wall paint colour, keyed by footprint-edge index. Optional — absent on
   *  rooms created before wall painting shipped (defensive read on load). */
  wallColors?: Record<number, string>;
  /** Where on earth this room is, and which way it faces — the inputs the sun
   *  path needs (`lib/solar.ts`). A property of the room, not of the device, so a
   *  flat and a holiday cottage do not have to share a latitude.
   *
   *  Entered by the user and never derived from a photo: EXIF carries GPS
   *  coordinates, and `lib/exif.ts` deliberately does not read them — see §3 of
   *  Design.md. Additive, so no version bump. */
  site?: Site;
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
    /** Which detector produced this — 'local' | 'cloud' | 'manual'. A string rather
     *  than the union, like `category` beside it, because a record written by a
     *  later build must not fail to parse in an earlier one. Absent on rooms saved
     *  before it existed; lib/detect-confidence.ts reads those as 'cloud'. */
    source?: string;
    locked: boolean;
    box: [number, number, number, number];
    category?: string;
    dimMM?: [number, number, number];
    position?: { x: number; y: number; z: number };
    yaw?: number;
    shape?: string;
    /** Dominant colour (#rrggbb) — photo-sampled, Gemini hex fallback. */
    color?: string;
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
  /** rigid-parenting relationships (childId -> parentId), same optional/
   *  per-room shape as `hidden` — rooms saved before this shipped have none. */
  parentIds?: Record<string, string>;
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
  /** Land a scene file (`lib/scene-file.ts`) as a brand-new room, and return its id.
   *
   *  **Always additive.** It mints its own id rather than accepting one, so opening a
   *  file can never overwrite the room the user is working in — including the room
   *  the file was exported from, which is the case that would actually come up.
   *
   *  The room argument is typed structurally rather than as `SceneFileRoom` on
   *  purpose: `scene-file.ts` reads `RoomData` from here, so importing its types back
   *  would close a cycle. It is the same reason `saveSceneParts` takes `unknown`.
   *
   *  **`meta` is written last**, mirroring `restoreRoom`. There is no transaction
   *  across keys and `listRooms` decides a room exists by its `meta`, so writing the
   *  furniture first means a half-finished import is invisible rather than a room
   *  that appears in the workspace and opens empty. */
  async importScene(
    room: Omit<RoomData, 'id' | 'createdAt' | 'version' | 'detectedObjects'>,
    parts: unknown,
    transforms: Transforms,
  ): Promise<string> {
    const id = uuid();
    await set(k(id, 'scene'), parts);
    await set(k(id, 'transforms'), transforms);
    await set(k(id, 'meta'), { ...room, id, createdAt: Date.now(), version: ROOM_SCHEMA_VERSION });
    await touch(id);
    return id;
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
  /**
   * Move every photo to a new wall at once — the "rotate them all" control, and
   * the keyboard Move on one card.
   *
   * One operation rather than a loop of `saveCapture` calls at the call site, for
   * three reasons that each cost something the last time they were not honoured:
   *
   *  · **The whole record travels.** The old pairwise swap re-wrote a capture as
   *    `{ slot, blob, takenAt }`, silently dropping `pose` — so reordering photos
   *    threw away the focal length, the tilt and the very bearing that now decides
   *    the wall. `Capture.pose` being optional is what let it typecheck.
   *  · **Writes happen before deletes.** A vacated key that outlives its write is
   *    a duplicate the next reload shows twice; a deleted key whose write never
   *    lands is a photograph the user has lost. Only one of those is recoverable.
   *  · **A mapping that collides is refused.** Two photos onto one wall loses
   *    one of them. Every real caller is a rotation or a swap, both bijections,
   *    so a collision here is a bug upstream and saying so beats absorbing it.
   *
   * Slots absent from `mapping` stay where they are.
   */
  async reslotCaptures(roomId: string, mapping: Partial<Record<CaptureSlot, CaptureSlot>>) {
    const current = await this.loadCaptures(roomId);
    const moved = current.map((c) => ({ ...c, slot: mapping[c.slot] ?? c.slot }));
    const landing = new Set<CaptureSlot>();
    for (const c of moved) {
      if (landing.has(c.slot)) {
        throw new Error(`reslotCaptures: two photos would land on ${c.slot}`);
      }
      landing.add(c.slot);
    }
    await Promise.all(moved.map((c) => set(k(roomId, `cap:${c.slot}`), c)));
    const vacated = current.map((c) => c.slot).filter((s) => !landing.has(s));
    await Promise.all(vacated.map((s) => del(k(roomId, `cap:${s}`))));
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
        const [meta, scene, touched] = await Promise.all([
          get<RoomData>(k(id, 'meta')),
          get<unknown[]>(k(id, 'scene')),
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
          // The furniture, counted from the furniture. This read `transforms.positions`
          // — the pieces the user has MOVED — so a room full of starter furniture
          // nobody had dragged yet advertised "0 pieces", and an imported room always
          // would: a scene file bakes its transforms into the parts, so its override
          // map is legitimately empty. One extra parallel get per room, on a path that
          // was already reading three keys at once.
          itemCount: Array.isArray(scene) ? scene.length : 0,
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
