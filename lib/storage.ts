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

export type RoomData = {
  id: string;
  createdAt: number;
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

export type Transforms = {
  positions: Record<string, [number, number, number]>;
  rotations: Record<string, number>;
  dims: Record<string, [number, number, number]>;
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
    await set(k(room.id, 'meta'), room);
  },
  async renameRoom(roomId: string, name: string) {
    const meta = await get<RoomData>(k(roomId, 'meta'));
    if (!meta) return;
    await set(k(roomId, 'meta'), { ...meta, name });
  },
  async loadRoom(roomId: string): Promise<RoomData | undefined> {
    return get<RoomData>(k(roomId, 'meta'));
  },
  async saveCapture(roomId: string, capture: Capture) {
    await set(k(roomId, `cap:${capture.slot}`), capture);
  },
  async loadCaptures(roomId: string): Promise<Capture[]> {
    const all = await keys();
    const prefix = k(roomId, 'cap:');
    const out: Capture[] = [];
    for (const key of all) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        const v = await get<Capture>(key);
        if (v) out.push(v);
      }
    }
    return out;
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
    const out: LayoutVariant[] = [];
    for (const key of all) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        const v = await get<LayoutVariant>(key);
        if (v) out.push(v);
      }
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  },
  async saveTransforms(roomId: string, t: Transforms) {
    await set(k(roomId, 'transforms'), t);
  },
  async loadTransforms(roomId: string): Promise<Transforms | undefined> {
    return get<Transforms>(k(roomId, 'transforms'));
  },
  async saveSceneParts(roomId: string, parts: unknown) {
    await set(k(roomId, 'scene'), parts);
  },
  async loadSceneParts<T>(roomId: string): Promise<T | undefined> {
    return get<T>(k(roomId, 'scene'));
  },
  async listRooms(): Promise<RoomSummary[]> {
    const all = await keys();
    const roomIds = new Set<string>();
    for (const key of all) {
      if (typeof key === 'string') {
        const m = key.match(/^room:([^:]+):meta$/);
        if (m) roomIds.add(m[1]);
      }
    }
    const out: RoomSummary[] = [];
    for (const id of roomIds) {
      const meta = await get<RoomData>(k(id, 'meta'));
      const transforms = await get<Transforms>(k(id, 'transforms'));
      const itemCount = transforms ? Object.keys(transforms.positions).length : 0;
      // count captures for this room
      let captureCount = 0;
      const capPrefix = k(id, 'cap:');
      for (const key of all) {
        if (typeof key === 'string' && key.startsWith(capPrefix)) captureCount++;
      }
      const detected = !!(meta?.detectedObjects && meta.detectedObjects.length > 0);
      if (meta) {
        out.push({
          id,
          name: meta.name,
          createdAt: meta.createdAt,
          updatedAt: meta.createdAt,
          itemCount,
          captureCount,
          detected,
        });
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async clearRoom(roomId: string) {
    const all = await keys();
    const prefix = `room:${roomId}:`;
    for (const key of all) {
      if (typeof key === 'string' && key.startsWith(prefix)) await del(key);
    }
  },
};

export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
