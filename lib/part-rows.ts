// Turning a flat part list into the rows the layer tree draws.
//
// A "group" in this app is not a container. `groupParts` writes one shared
// `groupId` onto each member (`lib/scene-store.ts`) and nothing else changes:
// no node, no name, no ordering, no place in the list. That is a deliberate
// shape — it survives a re-detect, a scene-file round trip and a delete without
// any tree to keep consistent — but it means a merged set was, until now,
// **completely invisible in the rail**. Three chairs merged look exactly like
// three chairs not merged, and the only tell is that clicking one in the 3D
// scene lights up the other two.
//
// That invisibility is what made the convoy bug so confusing to report: the set
// moved as one and there was nothing on screen saying it would.
//
// So the grouping is derived here, at read time, rather than stored. Rules:
//
//   · **Order is the part list's order.** A group is anchored at its FIRST
//     member and its other members are pulled up to sit under it. Nothing else
//     moves. Anchoring at the first member (not, say, sorting groups to the top)
//     means merging pieces never makes the rest of the list jump.
//   · **A group of one is not a group.** Deleting members can leave a lone part
//     still carrying a `groupId` — `deletePart` does not clean up, and it should
//     not have to. Such a part behaves in every way like an ungrouped one
//     (the convoy adds nobody, a click selects only it), so drawing it under a
//     "Group · 1" header would be the panel describing something that isn't
//     there.
//   · **A filter hides members, never the fact of the group.** The list is
//     searchable, so a query can match one of three merged chairs. The row still
//     renders as a group and reports `total: 3` against one visible member,
//     because "this piece is merged with two you can't see" is exactly what a
//     user needs to know before dragging it. Counting only the visible members
//     would quietly un-merge the set on screen.
//
// Pure, and generic over anything with an id and an optional groupId, so it is
// testable in the node environment without a scene, a store or React.

export type Groupable = { id: string; groupId?: string };

export type TreeRow<T extends Groupable> =
  | {
      kind: 'group';
      /** DOM id / focus target, prefixed so the two row kinds cannot collide — a
       *  group is a row you can land on and needs its own key in the roving
       *  tabindex.
       *
       *  BOTH kinds are prefixed, not just this one. Prefixing only the group left a
       *  namespace that was safe by convention rather than by construction: a part
       *  whose id was literally `group:g1` would produce a duplicate React key and
       *  send `focusRow` to the wrong row. Unreachable today, because ids are
       *  `${category}-${n}` or uuids — which is a fact about today's id scheme and
       *  not a property of this module. */
      key: string;
      gid: string;
      /** what selecting this row selects: every VISIBLE member, in list order */
      ids: string[];
      /** members in the room, including any the filter is hiding */
      total: number;
    }
  | {
      kind: 'part';
      /** DOM id / focus target, prefixed `part:` for the same reason a group row is
       *  prefixed `group:` — see the note on that field. */
      key: string;
      /** one id, but the same field name as a group row so navigation and range
       *  selection never have to ask which kind of row they are holding */
      ids: string[];
      part: T;
      /** set when this row sits inside a group — drives the indent and the spine */
      gid?: string;
      /** last visible member of its group, so the spine can stop */
      lastOfGroup?: boolean;
    };

/**
 * Rows for the layer tree.
 *
 * @param visible the parts to draw — already filtered by the search box
 * @param all     every part in the room, for counting group members the filter
 *                is hiding. Defaults to `visible` for the unfiltered case.
 */
export function groupRows<T extends Groupable>(
  visible: readonly T[],
  all: readonly T[] = visible,
): TreeRow<T>[] {
  // Sizes come from the WHOLE room, which is what makes "a group of one is not a
  // group" and `total` both answer about the room rather than about the query.
  const sizes = new Map<string, number>();
  for (const p of all) if (p.groupId) sizes.set(p.groupId, (sizes.get(p.groupId) ?? 0) + 1);

  const isGroup = (gid: string | undefined): gid is string => !!gid && (sizes.get(gid) ?? 0) > 1;

  const membersOf = new Map<string, T[]>();
  for (const p of visible) {
    if (!isGroup(p.groupId)) continue;
    const list = membersOf.get(p.groupId);
    if (list) list.push(p);
    else membersOf.set(p.groupId, [p]);
  }

  const rows: TreeRow<T>[] = [];
  const done = new Set<string>();

  for (const p of visible) {
    const gid = p.groupId;
    if (!isGroup(gid)) {
      rows.push({ kind: 'part', key: `part:${p.id}`, ids: [p.id], part: p });
      continue;
    }
    // Every member is emitted when the group's first visible member is reached,
    // so later members are already placed.
    if (done.has(gid)) continue;
    done.add(gid);
    const members = membersOf.get(gid) ?? [];
    rows.push({
      kind: 'group',
      key: `group:${gid}`,
      gid,
      ids: members.map((m) => m.id),
      total: sizes.get(gid) ?? members.length,
    });
    members.forEach((m, i) =>
      rows.push({
        kind: 'part',
        key: `part:${m.id}`,
        ids: [m.id],
        part: m,
        gid,
        lastOfGroup: i === members.length - 1,
      }),
    );
  }

  return rows;
}
