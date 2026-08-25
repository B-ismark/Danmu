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
