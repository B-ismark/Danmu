'use client';

// Local cache of generated 3D meshes.
//
// Keyed by perceptual hash (dHash) of the source object crop so the same wardrobe
// detected in two different rooms reuses one mesh. Each mesh is a GLB blob plus
// metadata about the provider it came from and the original crop.
//
// We do NOT auto-evict yet — the user can clear from Settings.

import { get, set as idbSet, del, keys } from 'idb-keyval';

export type MeshProviderId = 'meshy' | 'tripo' | 'manual';

export type MeshRecord = {
  hash: string;
  label: string;
  provider: MeshProviderId;
  /** Some providers return remote URLs first — we mirror them locally on first hit. */
  remoteUrl?: string;
  /** The actual GLB once downloaded / generated. */
  glb?: Blob;
  /** Approx mm bounds (if provider reports them). Lets us preserve scale on the 3D scene. */
  dimMM?: [number, number, number];
  createdAt: number;
  /** Provenance: which room / capture / detection produced this mesh originally. */
  source?: { roomId: string; slot: string; bbox: [number, number, number, number] };
};

const META = (h: string) => `mesh:${h}:meta`;
const BLOB = (h: string) => `mesh:${h}:glb`;

export const meshCache = {
  async get(hash: string): Promise<MeshRecord | undefined> {
    const meta = await get<MeshRecord>(META(hash));
    if (!meta) return undefined;
    if (!meta.glb) {
      const glb = await get<Blob>(BLOB(hash));
      if (glb) meta.glb = glb;
    }
    return meta;
  },
  async has(hash: string): Promise<boolean> {
    const meta = await get<MeshRecord>(META(hash));
    return !!meta;
  },
  async put(rec: MeshRecord): Promise<void> {
    const { glb, ...meta } = rec;
    await idbSet(META(rec.hash), meta);
    if (glb) await idbSet(BLOB(rec.hash), glb);
  },
  async setBlob(hash: string, glb: Blob): Promise<void> {
    const meta = await get<MeshRecord>(META(hash));
    if (!meta) throw new Error(`meshCache.setBlob: no meta for ${hash}`);
    await idbSet(BLOB(hash), glb);
  },
  async list(): Promise<MeshRecord[]> {
    const all = await keys();
    const metaKeys = all.filter(
      (key): key is string => typeof key === 'string' && key.startsWith('mesh:') && key.endsWith(':meta'),
    );
    const records = await Promise.all(metaKeys.map((key) => get<MeshRecord>(key)));
    return records
      .filter((m): m is MeshRecord => !!m)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  async delete(hash: string): Promise<void> {
    await Promise.all([del(META(hash)), del(BLOB(hash))]);
  },
  async clearAll(): Promise<void> {
    const all = await keys();
    const mine = all.filter((key): key is string => typeof key === 'string' && key.startsWith('mesh:'));
    await Promise.all(mine.map((key) => del(key)));
  },
};
