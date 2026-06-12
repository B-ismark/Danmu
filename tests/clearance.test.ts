import { describe, it, expect } from 'vitest';
import { analyzeRoom, polygonArea } from '@/lib/clearance';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

const RECT: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
];
const ROOM = { footprint: RECT, height: 2.8 };

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return {
    id: `${p.category}-${++n}`,
    name: p.category,
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

describe('analyzeRoom', () => {
  it('flags furniture inside a door swing', () => {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true });
    const blocker = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0.3, 0, -1.5] });
    const { issues } = analyzeRoom([door, blocker], ROOM);
    const hit = issues.find((i) => i.id.startsWith('door-'));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('error');
    expect(hit!.partIds).toContain(blocker.id);
  });

  it('does not flag a clear door', () => {
    const door = part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true });
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.4] });
    const { issues } = analyzeRoom([door, sofa], ROOM);
    expect(issues.find((i) => i.id.startsWith('door-'))).toBeUndefined();
  });

  it('warns about a pinched walkway between bulky pieces', () => {
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.5] });
    // Wardrobe 0.3m in front of the sofa face — squeeze zone.
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, 0.25] });
    const { issues } = analyzeRoom([sofa, wardrobe], ROOM);
    expect(issues.find((i) => i.id.startsWith('walk-'))).toBeDefined();
  });

  it('stays quiet when bulky pieces touch (deliberate composition) or sit far apart', () => {
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 1.5] });
    const far = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.6] });
    const { issues } = analyzeRoom([sofa, far], ROOM);
    expect(issues.find((i) => i.id.startsWith('walk-'))).toBeUndefined();
  });

  it('warns when storage has no room to open', () => {
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.65], rot: 0 });
    // Bed right in front of the wardrobe doors.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [2000, 1600, 600], pos: [0, 0, -0.4] });
    const { issues } = analyzeRoom([wardrobe, bed], ROOM);
    expect(issues.find((i) => i.id.startsWith('front-'))).toBeDefined();
  });

  it('warns when a double bed loses both side strips', () => {
    // Bed pushed into a corner: one side is the wall, other side blocked.
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [2000, 1600, 600], pos: [-1.9, 0, 0], rot: 0 });
    const shelf = part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 350, 1800], pos: [-0.55, 0, 0], rot: 0 });
    const { issues } = analyzeRoom([bed, shelf], ROOM);
    expect(issues.find((i) => i.id.startsWith('bed-'))).toBeDefined();
  });

  it('reports free floor share', () => {
    const { freeFloorShare } = analyzeRoom([], ROOM);
    expect(freeFloorShare).toBe(1);
  });
});

describe('polygonArea', () => {
  it('measures the rectangle', () => {
    expect(polygonArea(RECT)).toBe(24);
  });
});
