// Two rooms' starter pieces share ids (`shoe-rack-1`, `bed-1`), so their dressing is
// rolled from the id salted with the room's (`useDressed` in DynamicPart). This holds
// the property that makes that salt worth having: the same piece in two rooms dresses
// differently, and the same piece in one room dresses the same every time.
import { describe, expect, it } from 'vitest';
import { clothesRail, shoeRow } from '@/lib/scene-spec';
import { softHash } from '@/lib/soft-goods';

const rack = { dimMM: [800, 300, 900] as const };
const rail = { dimMM: [1200, 450, 1700] as const };
const tones = (id: string) => shoeRow({ id, ...rack }).map((s) => s.tone).join(',');
const clothes = (id: string) => clothesRail({ id, ...rail }).garments.map((g) => g.tone).join(',');

describe('dressing seeded per room', () => {
  it('rolls differently in two rooms and the same within one', () => {
    expect(tones('room-a/shoe-rack-1')).not.toBe(tones('room-b/shoe-rack-1'));
    expect(tones('room-a/shoe-rack-1')).toBe(tones('room-a/shoe-rack-1'));
    expect(clothes('room-a/clothes-rack-1')).not.toBe(clothes('room-b/clothes-rack-1'));
    const cushion = (room: string) => Math.floor(softHash(`${room}/sofa-1`, 'throw0') * 64);
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(cushion)).size).toBeGreaterThan(1);
  });
});
