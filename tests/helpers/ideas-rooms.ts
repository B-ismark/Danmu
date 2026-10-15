import { defaultScene, type ScenePart } from '@/lib/scene-spec';
import { footprintForLayout, type Footprint } from '@/lib/footprint';
import type { LayoutId } from '@/lib/storage';

// The rooms the Ideas bench (`tests/ideas-bench.test.ts`) and the search's measured
// tests are judged on: every preset at a roomy and a tight size, a crowded room and
// the user's scanned L bedroom of 2026-10-15.

export type Room = { name: string; parts: ScenePart[]; footprint: Footprint };

function preset(id: LayoutId, w: number, d: number): Room {
  return { name: `${id} ${w}x${d}`, parts: defaultScene(id, w, d), footprint: footprintForLayout(id, w, d) };
}

/** The 6 x 4 rect's furniture in a 4.5 x 3.5 room: the crowded case. */
function crowded(): Room {
  return { name: 'crowded 4.5x3.5', parts: defaultScene('rect', 6, 4), footprint: footprintForLayout('rect', 4.5, 3.5) };
}

/** The user's scanned L bedroom (2026-10-15), floor pieces and door. */
function scanned(): Room {
  const P = (p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
    ({ name: p.shape, rot: 0, locked: true, ...p }) as ScenePart;
  return {
    name: 'scanned L',
    footprint: [[-3, -2.191], [2.627, -2.191], [2.627, -0.185], [1.917, -0.185], [1.917, 1.56], [-3, 1.56]],
    parts: [
      P({ id: 'desk', category: 'desk', shape: 'desk-standard', pos: [-0.048, 0, -1.84], dimMM: [1400, 700, 750], groupId: 'g' }),
      P({ id: 'chair', category: 'chair', shape: 'chair-office', pos: [-0.048, 0, -1.42], rot: Math.PI, dimMM: [600, 600, 1100], groupId: 'g' }),
      P({ id: 'wardrobe', category: 'wardrobe', shape: 'wardrobe', pos: [-1.87, 0, -1.79], dimMM: [1800, 600, 2200] }),
      P({ id: 'fridge', category: 'fridge', shape: 'fridge', pos: [1.595, 0, 0.351], rot: -Math.PI / 2, dimMM: [600, 500, 800] }),
      P({ id: 'shoes', category: 'shelf', shape: 'shoe-rack', pos: [2.31, 0, -1.26], rot: -Math.PI / 2, dimMM: [800, 300, 900] }),
      P({ id: 'rail', category: 'wardrobe', shape: 'clothes-rack', pos: [1.02, 0, 1.23], rot: Math.PI, dimMM: [1200, 450, 1600] }),
      P({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [-1.49, 0, 0.641], rot: Math.PI / 2, dimMM: [1520, 2000, 600] }),
      P({ id: 'door', category: 'door', shape: 'door', pos: [1.57, 1.07, -2.146], dimMM: [900, 50, 2100], wallMounted: true }),
    ],
  };
}

export const ROOMS = (): Room[] => [
  preset('rect', 5, 4),
  preset('rect', 4, 3.5),
  preset('l', 6, 5),
  preset('l', 4.5, 4),
  preset('t', 6, 5),
  preset('u', 6, 5),
  preset('open', 6, 4),
  preset('open', 7.5, 5.6),
  crowded(),
  scanned(),
];
