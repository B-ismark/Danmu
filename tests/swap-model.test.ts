// @vitest-environment jsdom
//
// The model swap left the Inspector for `lib/swap-model.ts` so the right-click menu
// could offer it too. What it owed there it owes here: the new model is re-grounded
// for its own size and mount, keeps the spot, drops stale overrides, and stands on
// whatever it lands on. jsdom because the real stores are driven.

import { describe, expect, it } from 'vitest';
import { swapPartModel } from '@/lib/swap-model';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { footprintForLayout } from '@/lib/footprint';
import { footFromPart, footOverlap, outsideDeficit } from '@/lib/geometry';
import { isRoundPart, type LibraryItem, type ScenePart } from '@/lib/scene-spec';

function part(over: Partial<ScenePart> & { id: string }): ScenePart {
  return { category: 'other', name: over.id, shape: 'box', pos: [0, 0, 0], rot: 0, dimMM: [1000, 600, 800], locked: false, ...over };
}

const table = part({ id: 'table', category: 'table', shape: 'coffee-table', pos: [0, 0, 0], dimMM: [1200, 800, 750] });
const vase = part({ id: 'vase', category: 'plant', shape: 'plant', pos: [0, 0.75, 0], dimMM: [150, 150, 300] });

function setRoom() {
  useScene.setState({
    room: { width: 6, depth: 6, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', 6, 6), wallColors: {} },
    parts: [table, vase],
    ready: true,
  });
  useStudio.setState({ positions: { vase: [0.1, 0.75, 0.1] }, rotations: { vase: 1 }, dims: { vase: [200, 200, 400] }, parentIds: { vase: 'table' } });
}

const lamp: LibraryItem = { label: 'Table lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-table', dimMM: [300, 300, 500] };

describe('changing the model', () => {
  it('keeps the spot, names the piece and stands it on the table it was on', () => {
    setRoom();
    swapPartModel('vase', lamp);
    const s = useStudio.getState();
    const p = useScene.getState().parts.find((q) => q.id === 'vase')!;
    expect(p).toMatchObject({ name: 'Table lamp', category: 'lamp', shape: 'lamp-table', dimMM: [300, 300, 500] });
    expect(s.positions.vase?.[0]).toBeCloseTo(0.1, 9);
    expect(s.positions.vase?.[2]).toBeCloseTo(0.1, 9);
    expect(s.positions.vase?.[1]).toBeCloseTo(0.75, 3);
    expect(s.parentIds.vase).toBe('table');
    // The old turn and size are gone with the old model.
    expect(s.rotations.vase).toBeUndefined();
    expect(s.dims.vase).toBeUndefined();
  });

  it('a size the search named wins over the library size', () => {
    setRoom();
    swapPartModel('vase', lamp, [250, 250, 600]);
    expect(useScene.getState().parts.find((q) => q.id === 'vase')!.dimMM).toEqual([250, 250, 600]);
  });

  it('a wall piece goes on the wall, not on the table', () => {
    setRoom();
    swapPartModel('vase', { label: 'Framed print', group: 'Decor', category: 'painting', shape: 'painting', dimMM: [600, 30, 400] });
    const s = useStudio.getState();
    expect(s.parentIds.vase).toBeUndefined();
    expect(useScene.getState().parts.find((q) => q.id === 'vase')!.wallMounted).toBe(true);
    expect(s.positions.vase?.[1]).toBeGreaterThan(0.75);
  });

  // Reported 2026-10-01: a print on a wall, swapped for curtains from the plan tab,
  // came back turned across the wall and half through it. The swap kept the print's
  // centre — 35 mm off the plaster, where a curtain's centre wants 150 — and dropped
  // the turn that faced the print into the room.
  it('a wall piece swapped for another hangs flat on the same wall, facing in', () => {
    const W = 6;
    // On the EAST wall (x = +3), faced into the room by a drag: authored rot 0, override
    // −90°, so the drop of the override is the half of the defect a north wall hides.
    const print = part({ id: 'print', category: 'painting', shape: 'painting', pos: [0, 1.4, 0], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({
      room: { width: W, depth: W, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', W, W), wallColors: {} },
      parts: [print],
      ready: true,
    });
    useStudio.setState({ positions: { print: [W / 2 - 0.015 - 0.005, 1.4, 0.4] }, rotations: { print: -Math.PI / 2 }, dims: {}, parentIds: {} });
    swapPartModel('print', { label: 'Curtain', group: 'Decor', category: 'curtain', shape: 'curtain', dimMM: [1600, 80, 2200] });
    const s = useStudio.getState();
    const [x, , z] = s.positions.print!;
    // Turned to face west, into the room — the print's own turn, not the authored 0.
    expect(Math.sin(s.rotations.print!)).toBeCloseTo(-1, 9);
    expect(Math.cos(s.rotations.print!)).toBeCloseTo(0, 9);
    // Its back clear of the plaster, by the curtain's own standoff.
    const back = x + 0.08 / 2;
    expect(back).toBeLessThan(W / 2);
    expect(W / 2 - back).toBeGreaterThan(0.08);
    // Still where along the wall the print was.
    expect(z).toBeCloseTo(0.4, 9);
  });

  it('a wall piece already square to its wall writes no turn of its own', () => {
    // A transform write is never free: re-writing the authored turn still creates an
    // override a re-detect cannot touch.
    const W = 6;
    const print = part({ id: 'print', category: 'painting', shape: 'painting', pos: [0, 1.4, -W / 2 + 0.02], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({
      room: { width: W, depth: W, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', W, W), wallColors: {} },
      parts: [print],
      ready: true,
    });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('print', { label: 'Curtain', group: 'Decor', category: 'curtain', shape: 'curtain', dimMM: [1600, 80, 2200] });
    const s = useStudio.getState();
    expect(s.rotations.print).toBeUndefined();
    expect(s.positions.print![2]).toBeGreaterThan(-W / 2 + 0.08 / 2 + 0.08);
  });

  const room6 = (parts: ScenePart[]) =>
    useScene.setState({
      room: { width: 6, depth: 6, height: 2.5, layoutId: 'rect', footprint: footprintForLayout('rect', 6, 6), wallColors: {} },
      parts,
      ready: true,
    });

  it('a piece in a corner stays on its own wall, not the nearer return wall', () => {
    // A 400 mm curtain snapped into the north-east corner: its centre is 210 mm off the
    // north wall (half its depth, the gap, the standoff) and only 200 mm off the east
    // one. Nearest-wall alone carried the swap round the corner and turned it −90°.
    const curtain = part({ id: 'c', category: 'curtain', shape: 'curtain', pos: [2.8, 1.2, -2.79], rot: 0, dimMM: [400, 200, 2200], wallMounted: true });
    room6([curtain]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('c', { label: 'Framed print', group: 'Decor', category: 'painting', shape: 'painting', dimMM: [600, 30, 400] });
    const s = useStudio.getState();
    expect(s.rotations.c).toBeUndefined();
    const [x, , z] = s.positions.c!;
    expect(z).toBeCloseTo(-3 + 0.015 + 0.02, 9);
    expect(x).toBeCloseTo(3 - 0.3, 9);
  });

  it('in a U, a piece stays on the nearest of the walls facing its way, not a far one', () => {
    // Three edges of a U face south: both arms' north walls and the notch's floor-side
    // edge at z = 0. Facing alone cannot tell them apart; distance has to.
    const W = 6;
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    const print = (id: string, x: number, z: number) =>
      part({ id, category: 'painting', shape: 'painting', pos: [x, 1.4, z], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({
      room: { width: W, depth: W, height: 2.5, layoutId: 'u', footprint: footprintForLayout('u', W, W), wallColors: {} },
      parts: [print('arm', -2.2, -3 + 0.035), print('notch', 0, 0.035)],
      ready: true,
    });
    const curtain: LibraryItem = { label: 'Curtain', group: 'Decor', category: 'curtain', shape: 'curtain', dimMM: [1200, 80, 2200] };
    swapPartModel('arm', curtain);
    swapPartModel('notch', curtain);
    const s = useStudio.getState();
    expect(s.positions.arm![0]).toBeCloseTo(-2.2, 9);
    expect(s.positions.arm![2]).toBeCloseTo(-3 + 0.15, 9);
    expect(s.positions.notch![0]).toBeCloseTo(0, 9);
    expect(s.positions.notch![2]).toBeCloseTo(0.15, 9);
  });

  it('a turn equal to the authored one up to a full circle writes nothing', () => {
    // The south wall answers −π; a piece authored at π already faces that way.
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0, 1.4, 2.965], rot: Math.PI, dimMM: [600, 30, 400], wallMounted: true });
    room6([print]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', { label: 'Curtain', group: 'Decor', category: 'curtain', shape: 'curtain', dimMM: [1600, 80, 2200] });
    expect(useStudio.getState().rotations.p).toBeUndefined();
  });

  // The mirror of the curtain: a print swapped for a sofa kept the print's centre,
  // 35 mm off the plaster, and the 2 m sofa stood 400 mm through the wall.
  it('a wall piece swapped for a sofa backs the sofa onto that wall, facing in', () => {
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0, 1.4, 0], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    room6([print]);
    // On the east wall, turned to face west by a drag (authored 0, override −90°).
    useStudio.setState({ positions: { p: [3 - 0.035, 1.4, 0.4] }, rotations: { p: -Math.PI / 2 }, dims: {}, parentIds: {} });
    swapPartModel('p', { label: 'Sofa', group: 'Seating', category: 'sofa', shape: 'sofa', dimMM: [2000, 850, 800] });
    const s = useStudio.getState();
    const [x, y, z] = s.positions.p!;
    expect(Math.sin(s.rotations.p!)).toBeCloseTo(-1, 9);
    // Back on the plaster, by half its depth and the shared gap.
    expect(x).toBeCloseTo(3 - 0.425 - 0.02, 9);
    expect(z).toBeCloseTo(0.4, 9);
    expect(y).toBe(0);
    expect(useScene.getState().parts.find((q) => q.id === 'p')!.wallMounted).toBe(false);
  });

  it('a wall piece swapped for something with no wall of its own is pulled inside the room', () => {
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [1, 1.4, -3 + 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    room6([print]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', { label: 'Floor plant', group: 'Decor', category: 'plant', shape: 'plant', dimMM: [400, 400, 900] });
    const s = useStudio.getState();
    const [x, , z] = s.positions.p!;
    // Its back edge inside the north wall; the turn left alone.
    expect(z - 0.2).toBeGreaterThanOrEqual(-3);
    expect(x).toBeCloseTo(1, 6);
    expect(s.rotations.p).toBeUndefined();
  });

  // Review of #205 (O1): the support probe asked for every kind, so a print hung over
  // a bed, swapped for a nightstand, stood the nightstand ON the bed. The add path only
  // lets a small "goes on a table" piece look for a surface; the swap does now too.
  it('a print over a bed swapped for a nightstand stands it on the floor, not on the bed', () => {
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [0, 0, -2], dimMM: [1600, 2000, 500] });
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0, 1.4, -3 + 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    room6([bed, print]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', { label: 'Nightstand', group: 'Bedroom', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] });
    const s = useStudio.getState();
    expect(s.positions.p![1]).toBe(0);
    expect(s.parentIds.p).toBeUndefined();
  });

  // The user's look at #206, 2026-10-01: on the floor, but at the print's spot — so
  // through the bed, "and it happens with other pieces too". A floor piece arriving
  // where something already stands goes to the nearest clear floor.
  it.each([
    { label: 'Nightstand', group: 'Bedroom', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550] },
    { label: 'Floor lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-floor', dimMM: [300, 300, 1700] },
    { label: 'Plant', group: 'Decor', category: 'plant', shape: 'plant', dimMM: [400, 400, 1600] },
    { label: 'Armchair', group: 'Seating', category: 'chair', shape: 'armchair', dimMM: [800, 800, 850] },
    { label: 'Sofa', group: 'Seating', category: 'sofa', shape: 'sofa', dimMM: [2000, 850, 800] },
  ] as LibraryItem[])('a print over a bed swapped for a $label lands beside the bed, not in it', (item) => {
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [0, 0, -2], dimMM: [1600, 2000, 500] });
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0, 1.4, -3 + 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    room6([bed, print]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', item);
    const s = useStudio.getState();
    const [x, y, z] = s.positions.p!;
    const rot = s.rotations.p ?? 0;
    expect(y).toBe(0);
    const me = footFromPart([x, 0, z], rot, item.dimMM, isRoundPart(item.shape), item.shape);
    expect(footOverlap(me, footFromPart(bed.pos, bed.rot, bed.dimMM, false, bed.shape), 0), item.label).toBe(false);
    expect(outsideDeficit(me, footprintForLayout('rect', 6, 6)), item.label).toBeLessThan(1e-6);
    // Beside the bed's head, by the wall the print hung on — not across the room.
    expect(z - item.dimMM[1] / 2000, item.label).toBeLessThan(-3 + 0.2);
    expect(Math.abs(x), item.label).toBeLessThan(0.8 + item.dimMM[0] / 1000 + 0.25);
  });

  it('…and a floor piece whose spot is clear keeps it to the millimetre', () => {
    // The bed is moved off the print's spot, so nothing is in the way of the nightstand.
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [-1.6, 0, -2], dimMM: [1600, 2000, 500] });
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0.4, 1.4, -3 + 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    room6([bed, print]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', { label: 'Floor lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-floor', dimMM: [300, 300, 1700] });
    const [x, , z] = useStudio.getState().positions.p!;
    expect(x).toBeCloseTo(0.4, 9);
    // Pulled in off the plaster by its own radius and the shared gap, as before.
    expect(z).toBeCloseTo(-3 + 0.15 + 0.02, 6);
  });

  // Review of this branch: the gate was the CATEGORY, so a floor lamp — a `lamp` — and
  // a 1.6 m floor plant each stood on the bed a print hung above.
  it.each([
    { label: 'Floor lamp', group: 'Lighting', category: 'lamp', shape: 'lamp-floor', dimMM: [300, 300, 1700] },
    { label: 'Plant', group: 'Decor', category: 'plant', shape: 'plant', dimMM: [400, 400, 1600] },
  ] as LibraryItem[])('a print over a bed swapped for a $label stands it on the floor', (item) => {
    const bed = part({ id: 'bed', category: 'bed', shape: 'bed-double', pos: [0, 0, -2], dimMM: [1600, 2000, 500] });
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0, 1.4, -3 + 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    room6([bed, print]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', item);
    const s = useStudio.getState();
    expect(s.positions.p![1]).toBe(0);
    expect(s.parentIds.p).toBeUndefined();
  });

  it('…while a lamp swapped in over a table still stands on the table', () => {
    // The gate is the add path's, not "never stack": the first case in this file is the
    // other half, and this one is it at a wall piece's spot.
    const shelf = part({ id: 'shelf', category: 'table', shape: 'desk-standard', pos: [0, 0, -3 + 0.2], dimMM: [1200, 400, 800] });
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0, 1.4, -3 + 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    room6([shelf, print]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', lamp);
    const s = useStudio.getState();
    expect(s.positions.p![1]).toBeCloseTo(0.8, 6);
    expect(s.parentIds.p).toBe('shelf');
  });

  it('a corner print swapped for a sofa backs onto ITS wall, not the nearer return wall', () => {
    // The corner case `ownWall` exists for, on the floor branch: the 400 mm curtain's
    // centre is 210 mm off the north wall and 200 mm off the east one.
    const curtain = part({ id: 'c', category: 'curtain', shape: 'curtain', pos: [2.8, 1.2, -2.79], rot: 0, dimMM: [400, 200, 2200], wallMounted: true });
    room6([curtain]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('c', { label: 'Sofa', group: 'Seating', category: 'sofa', shape: 'sofa', dimMM: [2000, 850, 800] });
    const s = useStudio.getState();
    expect(s.rotations.c).toBeUndefined();
    const [x, , z] = s.positions.c!;
    expect(z).toBeCloseTo(-3 + 0.425 + 0.02, 9);
    // Held off the return wall by the same gap, so the corner is not a contact.
    expect(x).toBeCloseTo(3 - 1 - 0.02, 9);
  });

  it('in a U, the sofa slides along the wall it backs onto rather than past its end', () => {
    // The notch's south-facing wall at z = 0 is shorter than the room: a print near its
    // east end, swapped for a 2 m sofa, is slid west until the whole back is on that
    // wall. Kept where the print was, the sofa's back runs off the wall's end, which in
    // a rectangle cannot be told apart from containment and so needed a U to pin.
    const W = 6;
    const fp = footprintForLayout('u', W, W);
    const print = part({ id: 'n', category: 'painting', shape: 'painting', pos: [1, 1.4, 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({ room: { width: W, depth: W, height: 2.5, layoutId: 'u', footprint: fp, wallColors: {} }, parts: [print], ready: true });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('n', { label: 'Sofa', group: 'Seating', category: 'sofa', shape: 'sofa', dimMM: [2000, 850, 800] });
    const [x, , z] = useStudio.getState().positions.n!;
    // The notch wall's east end, from the polygon rather than a literal.
    const ends = fp.filter(([, vz]) => Math.abs(vz) < 1e-9).map(([vx]) => vx);
    const east = Math.min(...ends.filter((vx) => vx > 0));
    expect(z).toBeCloseTo(0.425 + 0.02, 9);
    expect(x + 1).toBeLessThanOrEqual(east + 1e-9);
  });

  it('a print swapped for a coffee table or a monitor is not pushed onto the wall', () => {
    // Only a piece that PREFERS a wall backs onto one. A coffee table prefers the middle
    // and a monitor belongs on a desk, so neither is snapped or turned.
    for (const item of [
      { label: 'Coffee table', group: 'Tables', category: 'table', shape: 'coffee-table', dimMM: [1200, 600, 450] },
      { label: 'Monitor', group: 'Tech', category: 'monitor', shape: 'monitor', dimMM: [600, 200, 450] },
    ] as LibraryItem[]) {
      const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0, 1.4, 0], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
      room6([print]);
      useStudio.setState({ positions: { p: [3 - 0.035, 1.4, 0.4] }, rotations: { p: -Math.PI / 2 }, dims: {}, parentIds: {} });
      swapPartModel('p', item);
      const s = useStudio.getState();
      expect(s.rotations.p, item.label).toBeUndefined();
      // Pulled in by containment at the authored turn: its half-WIDTH off the wall,
      // not the half-depth a snap would have backed it onto.
      expect(s.positions.p![0], item.label).toBeCloseTo(3 - item.dimMM[0] / 2000 - 0.02, 6);
    }
  });

  it('a piece in the middle of the room swapped for one that prefers a wall stays put', () => {
    // No wall of its own, so nothing to back onto: a coffee table swapped for a
    // bookshelf mid-room must not jump to the nearest wall.
    const t = part({ id: 't', category: 'table', shape: 'coffee-table', pos: [0.5, 0, 0.5], dimMM: [1200, 600, 450] });
    room6([t]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('t', { label: 'Bookshelf', group: 'Storage', category: 'shelf', shape: 'bookshelf', dimMM: [800, 300, 1800] });
    const s = useStudio.getState();
    expect(s.positions.t).toEqual([0.5, 0, 0.5]);
    expect(s.rotations.t).toBeUndefined();
  });

  // The containment and the support probe each take an input a rectangle cannot tell
  // apart from a wrong one. One case per input, each built so the wrong one moves it.
  it('a lamp swapped in for a print looks for its table where the lamp ENDS UP', () => {
    // The table stands 100 mm off the wall. At the print's spot the lamp's footprint
    // is 28% over it, under the half a support needs; pulled in off the plaster by its
    // own depth it is 73% over. Asked at the old spot, it stood on the floor.
    const shelf = part({ id: 'shelf', category: 'table', shape: 'desk-standard', pos: [0, 0, -3 + 0.1 + 0.2], dimMM: [1200, 400, 800] });
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [0, 1.4, -3 + 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    room6([shelf, print]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', lamp);
    const s = useStudio.getState();
    expect(s.positions.p![2]).toBeCloseTo(-3 + 0.15 + 0.02, 6);
    expect(s.positions.p![1]).toBeCloseTo(0.8, 6);
    expect(s.parentIds.p).toBe('shelf');
  });

  it('a round piece is kept off the wall by its radius, not by the square around it', () => {
    // At a 45° authored turn the square around an 800 mm disc reaches 566 mm toward
    // the wall; the disc reaches 400. At x = 2.5 the disc is clear and stays put.
    const t = part({ id: 't', category: 'table', shape: 'coffee-table', pos: [2.5, 0, 0], rot: Math.PI / 4, dimMM: [1200, 600, 450] });
    room6([t]);
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('t', { label: 'Round table', group: 'Tables', category: 'table', shape: 'cylinder', dimMM: [800, 800, 600] });
    expect(useStudio.getState().positions.t).toEqual([2.5, 0, 0]);
  });

  it("an L-shaped desk fits round a room's inside corner with its open corner", () => {
    // A U's notch corner at (−1.32, 0) sits in the desk's open corner: its box pokes
    // 620 × 500 mm into the notch and its two arms touch nothing. Contained as its box
    // it was pushed away from a spot it fits.
    const W = 6;
    const fp = footprintForLayout('u', W, W);
    const t = part({ id: 't', category: 'table', shape: 'coffee-table', pos: [-1.5, 0, 0.2], rot: Math.PI, dimMM: [1200, 600, 450] });
    useScene.setState({ room: { width: W, depth: W, height: 2.5, layoutId: 'u', footprint: fp, wallColors: {} }, parts: [t], ready: true });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('t', { label: 'L-shaped desk', group: 'Tables', category: 'desk', shape: 'desk-l', dimMM: [1600, 1400, 750] });
    expect(useStudio.getState().positions.t).toEqual([-1.5, 0, 0.2]);
  });

  it("in a U, a sofa backed onto an arm's inner wall slides along it, not past its open end", () => {
    // The east arm's inner wall runs from z = −3 to 0, and past 0 is floor — the bar of
    // the U — so nothing but the snap's own slide keeps the sofa's back on the plaster:
    // containment is satisfied with a sofa half in the arm and half in the bar.
    const fp = footprintForLayout('u', 6, 6);
    const wallX = Math.min(...fp.map(([vx]) => vx).filter((vx) => vx > 0));
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [wallX + 0.035, 1.4, -0.4], rot: Math.PI / 2, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({ room: { width: 6, depth: 6, height: 2.5, layoutId: 'u', footprint: fp, wallColors: {} }, parts: [print], ready: true });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', { label: 'Sofa', group: 'Seating', category: 'sofa', shape: 'sofa', dimMM: [2000, 850, 800] });
    const [x, , z] = useStudio.getState().positions.p!;
    expect(x).toBeCloseTo(wallX + 0.425 + 0.02, 9);
    expect(z + 1).toBeLessThanOrEqual(1e-9);
  });

  it('in a U, a piece too wide for its arm is walked toward the floor, not the notch', () => {
    // A 2 m table at the authored turn cannot fit a 1.68 m arm. Containment's last
    // resort walks it toward the middle of the room, and a U's corner average is IN the
    // notch — outside the floor — so walked there it stayed in the arm, 340 mm through
    // the plaster. Toward `interiorPoint` it ends in the bar, 27 mm short of clear: the
    // containment's best, and why "pulled inside the walls" is not a promise in a U.
    const fp = footprintForLayout('u', 6, 6);
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [-3 + 0.035, 1.4, -2.5], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({ room: { width: 6, depth: 6, height: 2.5, layoutId: 'u', footprint: fp, wallColors: {} }, parts: [print], ready: true });
    useStudio.setState({ positions: {}, rotations: { p: Math.PI / 2 }, dims: {}, parentIds: {} });
    const table: LibraryItem = { label: 'Long table', group: 'Tables', category: 'table', shape: 'coffee-table', dimMM: [2000, 900, 750] };
    // It no longer ends 27 mm through the plaster: at a quarter turn the table runs
    // along the arm, fits, and the swap says it turned (§ 50 item 1).
    expect(swapPartModel('p', table)).toEqual({ ok: true, turned: true });
    const at = useStudio.getState().positions.p!;
    const rot = useStudio.getState().rotations.p!;
    expect(Math.abs(Math.sin(rot))).toBeCloseTo(1, 9);
    expect(outsideDeficit(footFromPart(at, rot, table.dimMM), fp)).toBeLessThan(1e-6);
  });

  it('refuses a piece that fits at neither turn, and leaves the old one as it was', () => {
    const fp = footprintForLayout('u', 6, 6);
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [-3 + 0.035, 1.4, -2.5], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({ room: { width: 6, depth: 6, height: 2.5, layoutId: 'u', footprint: fp, wallColors: {} }, parts: [print], ready: true });
    useStudio.setState({ positions: {}, rotations: { p: Math.PI / 2 }, dims: {}, parentIds: {} });
    // 2 × 2 m: no turn of a square changes what it needs, and the arm is 1.68 m.
    const huge: LibraryItem = { label: 'Square table', group: 'Tables', category: 'table', shape: 'coffee-table', dimMM: [2000, 2000, 750] };
    const before = { parts: useScene.getState().parts, positions: useStudio.getState().positions, rotations: useStudio.getState().rotations };
    expect(swapPartModel('p', huge)).toEqual({ ok: false, refused: 'does-not-fit' });
    expect(useScene.getState().parts).toBe(before.parts);
    expect(useStudio.getState().positions).toBe(before.positions);
    expect(useStudio.getState().rotations).toBe(before.rotations);
  });

  it('a room drawn the other way round contains the same way', () => {
    // The presets all wind one way, so a containment handed a fixed winding passes on
    // every one of them. A footprint is a polygon, and either order is a polygon.
    const fp = footprintForLayout('rect', 6, 6).slice().reverse();
    const print = part({ id: 'p', category: 'painting', shape: 'painting', pos: [1, 1.4, -3 + 0.035], rot: 0, dimMM: [600, 30, 400], wallMounted: true });
    useScene.setState({ room: { width: 6, depth: 6, height: 2.5, layoutId: 'custom', footprint: fp, wallColors: {} }, parts: [print], ready: true });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {} });
    swapPartModel('p', { label: 'Floor plant', group: 'Decor', category: 'plant', shape: 'plant', dimMM: [400, 400, 900] });
    const [x, , z] = useStudio.getState().positions.p!;
    expect(z).toBeCloseTo(-3 + 0.2 + 0.02, 6);
    expect(x).toBeCloseTo(1, 6);
  });

  it('does nothing for a piece that is gone', () => {
    setRoom();
    const before = useScene.getState().parts;
    swapPartModel('nope', lamp);
    expect(useScene.getState().parts).toBe(before);
  });
});
