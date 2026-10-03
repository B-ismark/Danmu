// @vitest-environment jsdom
//
// The ghost a Library drag shows over the 3D room promises where the piece will land.
// A promise like that is only worth anything if it is the SAME computation as the
// drop — an imitation would be right in the middle of the room and wrong exactly where
// it matters, against a wall, on a desk, beside a piece already standing there. So the
// ghost reads `planPiece` and the drop runs `addPieceToRoom`, which is `planPiece` plus
// a write, and this file holds the two to each other over the whole Library rather
// than over examples picked to pass.

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { footprintForLayout } from '@/lib/footprint';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { addPieceToRoom, planPiece, type NewPiece } from '@/lib/add-piece';
import { dropCarry } from '@/lib/drop-carry';
import { PART_LIBRARY, type ScenePart } from '@/lib/scene-spec';
import * as announceModule from '@/lib/announce';
import { stripComments } from './helpers/source';

const SEED: ScenePart[] = [
  { id: 'desk-1', name: 'Desk', category: 'desk', shape: 'desk-standard', dimMM: [1400, 700, 750], pos: [-1.5, 0, -1.5], rot: 0, locked: false },
  { id: 'chair-1', name: 'Armchair', category: 'chair', shape: 'chair-armchair', dimMM: [700, 700, 900], pos: [1.5, 0, 1], rot: 0, locked: false },
];

function reset() {
  useScene.setState({
    parts: SEED.map((p) => ({ ...p })),
    room: {
      ...useScene.getState().room,
      width: 6, depth: 5, height: 2.5,
      footprint: footprintForLayout('rect', 6, 5), layoutId: 'rect',
    },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {}, hidden: {}, selection: [], selectedPartId: null });
}

beforeEach(() => {
  vi.spyOn(announceModule, 'announce').mockImplementation(() => {});
  reset();
});
afterEach(() => vi.restoreAllMocks());

/** Aims that matter: open floor, over the desk, on the armchair, hard by a wall, a corner. */
const AIMS: [number, number][] = [[0, 0], [-1.5, -1.5], [1.5, 1], [2.9, 0], [-2.8, 2.3]];

describe('the drag ghost stands where the drop lands', () => {
  it('for every Library piece at every aim: same pose, same support, same refusal', () => {
    let compared = 0;
    let refusedSeen = 0;
    for (const lib of PART_LIBRARY) {
      const item: NewPiece = { label: lib.label, category: lib.category, shape: lib.shape, dimMM: lib.dimMM };
      for (const aim of AIMS) {
        reset();
        const plan = planPiece(item, aim);
        const out = addPieceToRoom(item, aim);
        const tag = `${lib.label} @ ${aim}`;
        if ('refused' in plan) {
          refusedSeen++;
          expect(out, tag).toEqual({ refused: plan.refused });
          continue;
        }
        expect('id' in out, tag).toBe(true);
        if (!('id' in out)) continue;
        const added = useScene.getState().parts.find((p) => p.id === out.id)!;
        expect(added.pos, tag).toEqual(plan.pose.pos);
        expect(added.rot, tag).toBe(plan.pose.rot);
        expect(added.wallMounted, tag).toBe(plan.pose.wallMounted);
        expect(useStudio.getState().parentIds[out.id] ?? null, tag).toBe(plan.pose.supportId);
        compared++;
      }
    }
    expect(compared).toBe(PART_LIBRARY.length * AIMS.length - refusedSeen);
    expect(compared).toBeGreaterThan(PART_LIBRARY.length * 3);
  });

  it('shows a lamp over the desk ON the desk, and a piece aimed at the armchair at the clear spot it will go to', () => {
    const lamp = PART_LIBRARY.find((p) => p.shape === 'lamp-table')!;
    const onDesk = planPiece(lamp, [-1.5, -1.5]);
    expect('pose' in onDesk && !('refused' in onDesk) && onDesk.pose.supportId).toBe('desk-1');
    const sofa = PART_LIBRARY.find((p) => p.shape === 'sofa')!;
    const moved = planPiece(sofa, [1.5, 1]);
    if ('refused' in moved) throw new Error(moved.refused);
    expect(Math.hypot(moved.pose.pos[0] - 1.5, moved.pose.pos[2] - 1)).toBeGreaterThan(0.3);
    expect(moved.note).toMatch(/nearest clear/);
  });

  it('a refused piece still has somewhere to stand, so the ghost can show it in red', () => {
    const plan = planPiece({ label: 'Painting', category: 'painting', shape: 'painting', dimMM: [9000, 30, 600] }, [2.9, 0]);
    expect('refused' in plan).toBe(true);
    expect(plan.pose).toBeDefined();
  });

  it('planning writes nothing: no piece, no selection, no announcement', () => {
    const said = vi.mocked(announceModule.announce);
    for (const lib of PART_LIBRARY.slice(0, 12)) planPiece(lib, [0, 0]);
    expect(useScene.getState().parts).toHaveLength(SEED.length);
    expect(useStudio.getState().selectedPartId).toBeNull();
    expect(useStudio.getState().parentIds).toEqual({});
    expect(said).not.toHaveBeenCalled();
  });
});

describe('what the drag carries', () => {
  it('ends with the drag, however it ended, and takes the ghost with it', () => {
    const heard = vi.fn();
    const off = dropCarry.subscribe(heard);
    const item = PART_LIBRARY[0];
    dropCarry.start(item);
    expect(dropCarry.carried()).toBe(item);
    dropCarry.show({ item, plan: planPiece(item, [0, 0]), at: { x: 1, y: 1 } });
    expect(heard).toHaveBeenCalledTimes(1);
    dropCarry.end();
    expect(dropCarry.carried()).toBeNull();
    expect(dropCarry.ghost()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  it('is parked by the Library row on dragstart and cleared on dragend', () => {
    const src = stripComments(readFileSync(join(__dirname, '../components/studio/LibraryPicker.tsx'), 'utf8'));
    expect(src).toMatch(/dropCarry\.start\(/);
    expect(src).toMatch(/onDragEnd=\{[^}]*dropCarry\.end\(\)/);
  });

  it('is turned into a ghost by the room with the drop\'s own planner and aim', () => {
    const src = stripComments(readFileSync(join(__dirname, '../components/three/Room.tsx'), 'utf8'));
    const over = src.slice(src.indexOf('function onDragOver'), src.indexOf('function onDragLeave'));
    expect(over).toMatch(/planPiece\(item, aim\)/);
    expect(over).toMatch(/aimAt\(/);
    const drop = src.slice(src.indexOf('function onDrop'), src.indexOf('function onDragOver'));
    expect(drop).toMatch(/aimAt\(/);
    expect(drop).toMatch(/dropCarry\.show\(null\)/);
    expect(src).toMatch(/onDragLeave=\{onDragLeave\}/);
    expect(src).toMatch(/<DropGhost \/>/);
  });

  it('frees the faded copies it makes when the ghost goes away', () => {
    const src = stripComments(readFileSync(join(__dirname, '../components/three/DropGhost.tsx'), 'utf8'));
    expect(src).toMatch(/clones\.current\.add\(c\)/);
    expect(src).toMatch(/made\.forEach\(\(m\) => m\.dispose\(\)\)/);
  });
});
