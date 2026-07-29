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

  // ── Regressions found by the audit ──────────────────────────────────────

  it('flags two pieces occupying the same floor', () => {
    // obbGap returns 0 both for "pushed flush together" (deliberate) and for
    // "in the same place" (a mistake), and the walkway rule skips everything at or
    // under 12 cm as touching — so interpenetrating parts produced NO finding and
    // the panel said "Everything fits". buildSceneFromRoom does no part-vs-part
    // resolution, so a detected scene can genuinely arrive like this.
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, 0] });
    const bed = part({ category: 'bed', shape: 'bed-double', dimMM: [2000, 1600, 600], pos: [0.3, 0, 0.2] });
    const hit = analyzeRoom([sofa, bed], ROOM).issues.find((i) => i.id.startsWith('clash-'));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('error');
  });

  it('stays quiet for pieces that merely touch', () => {
    // A sofa with its back flush to a wardrobe is a composition, not a clash.
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.7] });
    const sofa = part({ category: 'sofa', shape: 'sofa', dimMM: [2200, 950, 880], pos: [0, 0, -0.925] });
    expect(analyzeRoom([wardrobe, sofa], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeUndefined();
  });

  it('does not call a stack a clash', () => {
    // A laptop resting on a desk shares the desk's footprint on purpose.
    const desk = part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
    const laptop = part({ category: 'monitor', shape: 'laptop', dimMM: [340, 240, 220], pos: [0, 0.75, 0] });
    expect(analyzeRoom([desk, laptop], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeUndefined();
  });

  it('does not call a tucked-in chair a clash', () => {
    // Seating pushed under a table or desk shares its footprint ON PURPOSE, and
    // the chair back rises above the top so the vertical test cannot separate
    // them. Four chairs round a dining table is the most ordinary arrangement
    // there is — reporting four errors on it would make the panel cry wolf.
    const table = part({ category: 'table', shape: 'coffee-table', dimMM: [1400, 800, 750], pos: [0, 0, 0] });
    const chairs = [0.5, -0.5].map((z) =>
      part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, z] }),
    );
    const { issues } = analyzeRoom([table, ...chairs], ROOM);
    expect(issues.find((i) => i.id.startsWith('clash-'))).toBeUndefined();
  });

  it('still flags a chair buried in a table', () => {
    // The exemption is for tucking in, not for a chair standing in the same
    // place as the table.
    const table = part({ category: 'table', shape: 'coffee-table', dimMM: [1400, 800, 750], pos: [0, 0, 0] });
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [0, 0, 0] });
    expect(analyzeRoom([table, chair], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeDefined();
  });

  it('does not flag furniture that only clips a corner', () => {
    // A 3 cm bump where two pieces meet is a nudge away from tidy, not "one of
    // them has to move".
    // a spans x -2…0, b spans -0.03…1.97 — a 3 cm bite out of a 1.44 m² bed.
    const a = part({ category: 'sofa', shape: 'sofa', dimMM: [2000, 900, 880], pos: [-1, 0, 0] });
    const b = part({ category: 'bed', shape: 'bed-double', dimMM: [2000, 1600, 600], pos: [0.97, 0, 0] });
    expect(analyzeRoom([a, b], ROOM).issues.find((i) => i.id.startsWith('clash-'))).toBeUndefined();
  });

  it('flags a piece taller than the ceiling instead of shrinking it', () => {
    const low = { ...ROOM, height: 2.4 };
    const tall = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1800, 600, 2600], pos: [0, 0, -1.6] });
    const hit = analyzeRoom([tall], low).issues.find((i) => i.id.startsWith('tall-'));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('error');
    // …and stays quiet when it does fit.
    expect(analyzeRoom([tall], ROOM).issues.find((i) => i.id.startsWith('tall-'))).toBeUndefined();
  });

  it('sees an obstacle at the EDGE of a wardrobe front, not just its centre', () => {
    // faceClearance used to probe one ray from the middle of the face, so anything
    // off to one side reported the doors fully clear.
    const wardrobe = part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 600, 2100], pos: [0, 0, -1.65], rot: 0 });
    // A chair against the LEFT third of the wardrobe front — never under its centre.
    const chair = part({ category: 'chair', shape: 'chair-dining', dimMM: [500, 500, 850], pos: [-0.8, 0, -1.1] });
    const hit = analyzeRoom([wardrobe, chair], ROOM).issues.find((i) => i.id.startsWith('front-'));
    expect(hit).toBeDefined();
  });

  it('counts overlapping furniture once when reporting floor coverage', () => {
    // The old sum double-counted a chair pushed under a desk and ignored rotation,
    // then clamped at 0 — so a busy room reported "100% covered".
    const desk = part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
    const same = part({ category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [0, 0, 0] });
    const one = analyzeRoom([desk], ROOM).freeFloorShare;
    const two = analyzeRoom([desk, same], ROOM).freeFloorShare;
    expect(two).toBeCloseTo(one, 2);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
  });
});

describe('polygonArea', () => {
  it('measures the rectangle', () => {
    expect(polygonArea(RECT)).toBe(24);
  });
});
