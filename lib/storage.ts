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

// IndexedDB-backed room data: captures (blobs), depth maps, render variants, masks.
// Single-room v0.1. Keys are namespaced by roomId.

export type CaptureSlot = 'n' | 'e' | 's' | 'w';

export type Capture = {
  slot: CaptureSlot;
  blob: Blob;
  takenAt: number;
  pose?: { yaw: number; tilt: number; height: number };
};

export type RenderVariant = {
  id: string;
  blob: Blob;
  prompt: string;
  seed: number;
  createdAt: number;
  costAmount: number;
  costCurrency: string;
  pinned?: boolean;
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
    /** PhotoEditor: target bbox after user drag. */
    dstBox?: [number, number, number, number];
    /** PhotoEditor: user flagged for removal. */
    removed?: boolean;
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

export type RoomSummary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
  renderCount: number;
  pinnedRenderCount: number;
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
  /** First pinned render variant for a room (for spec PDF cover, share preview). */
  async firstPinnedRender(roomId: string): Promise<RenderVariant | undefined> {
    const all = await keys();
    const prefix = k(roomId, 'render:');
    const list: RenderVariant[] = [];
    for (const key of all) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        const v = await get<RenderVariant>(key);
        if (v?.pinned) list.push(v);
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt)[0];
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
  async saveRender(roomId: string, variant: RenderVariant) {
    await set(k(roomId, `render:${variant.id}`), variant);
  },
  async pinRender(roomId: string, variantId: string, pinned: boolean) {
    const v = await get<RenderVariant>(k(roomId, `render:${variantId}`));
    if (!v) return;
    await set(k(roomId, `render:${variantId}`), { ...v, pinned });
  },
  async deleteRender(roomId: string, variantId: string) {
    await del(k(roomId, `render:${variantId}`));
  },
  async listRenders(roomId: string): Promise<RenderVariant[]> {
    const all = await keys();
    const prefix = k(roomId, 'render:');
    const out: RenderVariant[] = [];
    for (const key of all) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        const v = await get<RenderVariant>(key);
        if (v) out.push(v);
      }
    }
    return out.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
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
  /** Latest 3D-scene screenshot — used as the render base when the user never
   *  uploaded real photos (AI reimagines the blockout as a real room). */
  async saveSceneSnap(roomId: string, blob: Blob) {
    await set(k(roomId, 'scenesnap'), blob);
  },
  async loadSceneSnap(roomId: string): Promise<Blob | undefined> {
    return get<Blob>(k(roomId, 'scenesnap'));
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
      // count renders + captures for this room
      let renderCount = 0;
      let pinnedRenderCount = 0;
      let captureCount = 0;
      const renderPrefix = k(id, 'render:');
      const capPrefix = k(id, 'cap:');
      for (const key of all) {
        if (typeof key === 'string') {
          if (key.startsWith(renderPrefix)) {
            renderCount++;
            const v = await get<RenderVariant>(key);
            if (v?.pinned) pinnedRenderCount++;
          } else if (key.startsWith(capPrefix)) {
            captureCount++;
          }
        }
      }
      const detected = !!(meta?.detectedObjects && meta.detectedObjects.length > 0);
      if (meta) {
        out.push({
          id,
          name: meta.name,
          createdAt: meta.createdAt,
          updatedAt: meta.createdAt,
          itemCount,
          renderCount,
          pinnedRenderCount,
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
