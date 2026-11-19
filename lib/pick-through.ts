// Turning a 3D raycast into "which pieces are under the cursor".
//
// R3F hands a click `e.intersections` — every object the ray crossed, sorted by
// distance — which is already the depth order a disambiguation menu wants. What
// it is NOT is a list of furniture: the same ray also crosses the room shell, the
// wall hit planes, gizmo arcs, measurement guides, the dressing, and the invisible
// helper meshes lights carry. So each hit is walked up to the nearest ancestor
// that claims a part id, and anything with no such ancestor is dropped.
//
// `Pickable` is what stamps the id, under `PART_ID_KEY` in `userData`. The types
// here are structural rather than three.js's on purpose: this file is the piece of
// the picker worth testing, and a test should not have to build an Object3D tree
// to do it.

export const PART_ID_KEY = 'danmuPartId';

/** The shape of an object this needs: something with `userData` and a parent. */
export type PickNode = {
  userData?: Record<string, unknown> | null;
  parent?: PickNode | null;
};

/** How far up the tree to look before giving up. A part's mesh sits a handful of
 *  groups under its `Pickable`; a bound this size is a runaway guard, not a
 *  limit anybody's scene graph is near. */
const MAX_DEPTH = 32;

/** The part a scene object belongs to, or null if it is not furniture. */
export function partIdOf(node: PickNode | null | undefined): string | null {
  let cur: PickNode | null | undefined = node;
  for (let i = 0; cur && i < MAX_DEPTH; i++) {
    const id = cur.userData?.[PART_ID_KEY];
    if (typeof id === 'string' && id.length > 0) return id;
    cur = cur.parent;
  }
  return null;
}

/**
 * The part ids a raycast crossed, nearest first, each appearing once.
 *
 * De-duplication matters more than it looks: one piece is many meshes (a sofa's
 * frame, its cushions, its feet), so the raw intersection list names the front
 * piece several times before it ever mentions the one behind it.
 */
export function pickIdsFrom(intersections: Array<{ object?: PickNode | null }>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const hit of intersections) {
    const id = partIdOf(hit?.object);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Marks a wall mesh, holding its index — set by `RoomShell`, read by
 *  `firstSurface`. The index is the mesh's own; callers that act on the wall map
 *  the hit POINT back to the outline (`nearestWall`) rather than trusting it,
 *  because `wallSegments` skips a degenerate edge and the two can differ. */
export const WALL_KEY = 'danmuWall';

/** What a scene object needs to be judged as a surface. Duck-typed so the rule is
 *  testable without three. */
export type SurfaceNode = PickNode & {
  type?: string;
  visible?: boolean;
  material?: { visible?: boolean; colorWrite?: boolean } | Array<{ visible?: boolean; colorWrite?: boolean }>;
  parent?: SurfaceNode | null;
};

/**
 * The first thing a ray actually SEES, nearest first: a piece, a wall, or some
 * other drawn surface (the floor) — or null when it saw nothing.
 *
 * A raycast reports everything the ray passes through, and the first hit is not
 * what the user is looking at: the room's shadow-only ceiling sits above every
 * dollhouse view and is hit first on every press, editor helpers (selection
 * frames, the floor grid's lines) are drawn but are not surfaces, and an object
 * hidden by `visible` is still intersected. So a hit counts only when it is a
 * mesh, no ancestor is hidden or marked `helper`, and its material draws colour.
 * Asking `hits[0]` instead meant a right-click on a wall answered "the ceiling".
 */
export function firstSurface<P>(
  hits: Array<{ object?: SurfaceNode | null; point: P }>,
): { kind: 'part'; id: string; point: P } | { kind: 'wall'; point: P } | { kind: 'other'; point: P } | null {
  for (const hit of hits) {
    const o = hit.object;
    if (!o || !MESH_TYPES.has(o.type ?? '')) continue;
    const mats = o.material === undefined ? [] : Array.isArray(o.material) ? o.material : [o.material];
    if (mats.length > 0 && mats.every((m) => m.visible === false || m.colorWrite === false)) continue;
    let hidden = false;
    let wall = false;
    let cur: SurfaceNode | null | undefined = o;
    for (let i = 0; cur && i < MAX_DEPTH; i++) {
      if (cur.visible === false || cur.userData?.helper === true) hidden = true;
      if (cur.userData?.[WALL_KEY] !== undefined) wall = true;
      cur = cur.parent;
    }
    if (hidden) continue;
    const id = partIdOf(o);
    if (id) return { kind: 'part', id, point: hit.point };
    if (wall) return { kind: 'wall', point: hit.point };
    return { kind: 'other', point: hit.point };
  }
  return null;
}

const MESH_TYPES = new Set(['Mesh', 'InstancedMesh', 'SkinnedMesh']);
