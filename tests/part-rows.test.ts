import { describe, it, expect } from 'vitest';
import { groupRows, type Groupable } from '@/lib/part-rows';

// The layer tree's grouping is DERIVED, not stored — see the header of
// `lib/part-rows.ts`. That makes it pure logic worth testing here rather than a
// component detail, and it makes the three rules it enforces assertable:
//
//   1. members cluster under their first member, and nothing else moves
//   2. a group of one is not a group
//   3. a filter hides members but never the fact of the group
//
// Each of those is silent when wrong. A group that re-orders the list makes
// merging feel like it shuffled the room; a "Group · 1" header describes
// something that has no behaviour; and a group that dissolves under a search
// tells the user a merged piece is loose right before they drag it.

const p = (id: string, groupId?: string): Groupable => (groupId ? { id, groupId } : { id });

/** A compact picture of the rows: `a` for a loose part, `[g1 x3` for a group
 *  header, `·b` for a member. Assertions read as the panel looks. */
const shape = (rows: ReturnType<typeof groupRows<Groupable>>) =>
  rows.map((r) => (r.kind === 'group' ? `[${r.gid} x${r.total}` : r.gid ? `·${r.part.id}` : r.part.id));

describe('the layer tree rows', () => {
  it('leaves an ungrouped room exactly as it was', () => {
    const parts = [p('a'), p('b'), p('c')];
    expect(shape(groupRows(parts))).toEqual(['a', 'b', 'c']);
    expect(groupRows(parts).map((r) => r.key)).toEqual(['part:a', 'part:b', 'part:c']);
  });

  it('pulls members up to their first member and moves nothing else', () => {
    // `b` and `d` are merged. The group is anchored where `b` already sat, so
    // `a` stays first and `c` follows the group — the list a user recognises.
    const parts = [p('a'), p('b', 'g1'), p('c'), p('d', 'g1'), p('e')];
    expect(shape(groupRows(parts))).toEqual(['a', '[g1 x2', '·b', '·d', 'c', 'e']);
  });

  it('keeps two groups apart, each at its own anchor', () => {
    const parts = [p('a', 'g1'), p('b', 'g2'), p('c', 'g1'), p('d', 'g2')];
    expect(shape(groupRows(parts))).toEqual(['[g1 x2', '·a', '·c', '[g2 x2', '·b', '·d']);
  });

  it('marks only the last visible member, so the spine knows where to stop', () => {
    const rows = groupRows([p('a', 'g'), p('b', 'g'), p('c', 'g')]);
    expect(rows.filter((r) => r.kind === 'part' && r.lastOfGroup).map((r) => r.key)).toEqual(['part:c']);
  });

  it('does not draw a group around a single part', () => {
    // What deleting two of three merged chairs leaves behind. `deletePart` does
    // not scrub the survivor's groupId — and should not have to, because a lone
    // member behaves in every way like a loose part.
    const parts = [p('a'), p('survivor', 'g1')];
    expect(shape(groupRows(parts))).toEqual(['a', 'survivor']);
  });

  it('reports the room count, not the visible count, when a search hides members', () => {
    // The filtered case: one of three merged chairs matches the query. It is
    // still merged, and dragging it will still carry the other two.
    const all = [p('x'), p('chair-1', 'g1'), p('chair-2', 'g1'), p('chair-3', 'g1')];
    const rows = groupRows([all[1]], all);
    expect(shape(rows)).toEqual(['[g1 x3', '·chair-1']);
    // `ids` is what selecting the header selects, so it must stay the VISIBLE
    // members: a range that reached into hidden rows is the bug `selectRange`
    // already avoids by measuring over the rows the user can see.
    expect(rows[0].kind === 'group' && rows[0].ids).toEqual(['chair-1']);
  });

  it('still hides a lone group behind a filter that leaves one member', () => {
    // The rule above cuts the other way too: `total` comes from the room, so a
    // real two-member group filtered down to one still renders as a group…
    const all = [p('a', 'g1'), p('b', 'g1')];
    expect(shape(groupRows([all[0]], all))).toEqual(['[g1 x2', '·a']);
    // …while a group that is genuinely one part in the room does not, even
    // unfiltered.
    expect(shape(groupRows([p('a', 'g1')]))).toEqual(['a']);
  });

  it('keeps the two row kinds in separate key namespaces', () => {
    // The roving tabindex and `focusRow` both key off this, so two rows sharing a
    // key move focus to the wrong one. Both kinds are prefixed, which is what makes
    // this safe by construction: with only the group prefixed, a part whose id was
    // literally `group:g1` collided — unreachable under today's id scheme, which is
    // a fact about the id scheme and not about this module.
    const rows = groupRows([p('group:g1'), p('m1', 'g1'), p('m2', 'g1')]);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size, `duplicate key in ${keys.join(', ')}`).toBe(keys.length);
    expect(keys).toContain('group:g1');
    expect(keys).toContain('part:group:g1');
  });
});
