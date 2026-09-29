// How far a floor piece may stand from where its placer left it, for a reason the photo
// did not show (`GeoPlacement.distanceDoubt`), and the hard merge that reads it.
//
// The merge's second rule calls two rows of one kind one piece when their centres agree.
// A centre the room's walls stopped is not a centre the photo gave: a bound stops every
// piece that runs past it on the same line, so two chairs one behind the other came out
// on one spot and the merge deleted one of them (§ 46.3), and a single bed seen from its
// side was held half its catalogue LENGTH off the east wall, onto the bed beside it
// (§ 46.1). These tests hold what the doubt is, and that the merge no longer decides a
// pair on it.

import { describe, expect, it } from 'vitest';
import { dedupeDetections, geoMeasure, refineDetections, type CalMap } from '@/lib/detect-refine';
import {
  calFromHfov, frameCuts, placeFloorObject, placeWallObject, wallFrame, type CameraCal, type PieceFootprint,
} from '@/lib/photo-geometry';
import { footprintForLayout } from '@/lib/footprint';
import { defaultAxisFor, defaultDepthFor } from '@/lib/scene-spec';
import type { Detection } from '@/lib/detection';
import type { CaptureSlot } from '@/lib/storage';
import { framedBoxFor, CAL, CALS, ROOM, type Truth } from './helpers/known-room';

const lens = (deg: number): CameraCal => calFromHfov(deg, 4 / 3);
const every = (c: CameraCal): CalMap => ({ n: c, e: c, s: c, w: c });
/** The same camera in a room no wall of which is in reach: where the photo alone puts a piece. */
const OPEN = { height: ROOM.height, footprint: footprintForLayout('rect', 40, 40) };

const chair = (x: number, z: number): Truth => ({
  name: `chair ${z}`, label: 'dining chair', category: 'chair', shape: 'chair-dining',
  x, z, dimMM: [450, 500, 900], slots: ['n'],
});
const bed = (x: number): Truth => ({
  name: `single ${x}`, label: 'bed', category: 'bed', shape: 'bed-single',
  x, z: -2.05, dimMM: [900, 1900, 450], slots: ['e'],
});
const box = (t: Truth, slot: CaptureSlot) => framedBoxFor(t, slot, CAL)!;
const seen = (t: Truth, slot: CaptureSlot = t.slots[0]): Detection => ({
  label: t.label, conf: 0.9, source: 'local', box: box(t, slot), category: t.category, slot, shape: t.shape,
});

describe('distanceDoubt — what the walls moved a floor piece by', () => {
  // Each case asserted against the same box placed in a room no wall reaches, which is
  // the reading before any bound: the doubt is how far, on the floor, the bounds moved
  // the centre from it. And each says which bounds it reaches, so the fixture is shown to
  // hold every term: the near face's clamp, the centre's, and the wall's end stopping a
  // width grown past the side of the photo.
  const plant = (z: number): Truth => ({
    name: `plant ${z}`, label: 'plant', category: 'plant', shape: 'plant', x: 0.3, z, dimMM: [600, 600, 1200], slots: ['n'],
  });
  const sofa: Truth = {
    name: 'sofa', label: 'sofa', category: 'sofa', shape: 'sofa', x: -2.5, z: -2.4, dimMM: [2000, 850, 800], slots: ['n'],
  };
  const smallPlant: Truth = {
    name: 'small plant', label: 'plant', category: 'plant', shape: 'plant', x: -3.35, z: -2.4, dimMM: [300, 300, 900], slots: ['n'],
  };
  type Case = { name: string; b: [number, number, number, number]; slot: CaptureSlot; cal: CameraCal; foot: PieceFootprint; near: boolean; centre: boolean; side: boolean };
  const cases: Case[] = [
    // In the middle of the floor, on the lens it was taken on: nothing moved it.
    { name: 'a chair mid-room', b: box(chair(0.3, -2.0), 'n'), slot: 'n', cal: CAL, foot: { depthM: 0.5 }, near: false, centre: false, side: false },
    // The same chair read on a lens narrower than the photo's: its near face reads beyond
    // the far wall, so both bounds move it.
    { name: 'a chair on a narrow lens', b: box(chair(0.3, -2.0), 'n'), slot: 'n', cal: lens(66), foot: { depthM: 0.5 }, near: true, centre: true, side: false },
    // Off to one side, the near face held on its own ray carries the chair across the
    // photo as well as toward it: 0.26 m of its 1.11.
    { name: 'a chair off to one side', b: box(chair(1.8, -2.0), 'n'), slot: 'n', cal: lens(66), foot: { depthM: 0.5 }, near: true, centre: true, side: false },
    // A round piece's centre is solved from its rim, and moves further than its face.
    { name: 'a plant on a narrow lens', b: box(plant(-2.4), 'n'), slot: 'n', cal: lens(66), foot: { depthM: 0.6, round: true }, near: true, centre: true, side: false },
    // A bed seen from its side, from the east: its near face is where the photo put it,
    // and its centre, half the catalogue length behind that, is past the wall.
    { name: 'a bed side-on', b: box(bed(3.0), 'e'), slot: 'e', cal: CAL, foot: { depthM: 2.0 }, near: false, centre: true, side: false },
    // A sofa against the west wall, cut by the photo's left edge and shorter than its
    // kind's typical: grown to the typical 2.4 m from the end the photo saw, and stopped
    // at the wall. Here the wall is right, and it is still not the photo.
    { name: 'a short sofa grown to the wall', b: box(sofa, 'n'), slot: 'n', cal: CAL, foot: { depthM: 0.85, whole: { widthM: 2.4, heightM: 0.8 } }, near: false, centre: false, side: true },
    // The round version, which is a different solve: a small plant in the corner, cut by
    // the same edge, is drawn at its kind's typical 400 mm, and that radius stops at the
    // wall. Its centre moves 9 cm, most of it along the wall.
    { name: 'a small plant whose typical size the wall stopped', b: box(smallPlant, 'n'), slot: 'n', cal: CAL, foot: { depthM: 0.3, round: true, whole: { widthM: 0.4, heightM: 1.6 } }, near: false, centre: false, side: true },
  ];
  for (const c of cases) {
    it(`is how far the bounds moved ${c.name}`, () => {
      const frame = wallFrame(c.slot, ROOM.footprint)!;
      const free = placeFloorObject(c.b, c.slot, OPEN, c.cal, c.foot)!;
      const held = placeFloorObject(c.b, c.slot, ROOM, c.cal, c.foot)!;
      expect(frameCuts(c.b).bottom, 'the foot is in the picture').toBe(false);
      // Which bounds this case reaches, read off the unbounded placement.
      const half = (c.foot.round ? free.widthMM / 1000 : c.foot.depthM) / 2;
      expect(free.distance - half > frame.distance, 'near face read past the wall').toBe(c.near);
      expect(free.distance > frame.distance - half, 'centre read past the bound').toBe(c.centre);
      const along = c.slot === 'n' ? free.position.x : free.position.z;
      expect(along - free.widthMM / 2000 < frame.left, 'width grown past the wall’s end').toBe(c.side);
      expect(free.distanceDoubt).toBe(0);
      const moved = Math.hypot(free.position.x - held.position.x, free.position.z - held.position.z);
      expect(held.distanceDoubt).toBeCloseTo(moved, 12);
      if (!c.near && !c.centre && !c.side) expect(held.distanceDoubt).toBe(0);
      else expect(held.distanceDoubt).toBeGreaterThan(0.05);
    });
  }

  it('is a distance on the floor, not a distance from the lens', () => {
    // The chair off to one side: measured toward the lens alone, its move would be
    // 1.08 m, and the merge would call it a quarter of a metre surer than it is.
    const b = box(chair(1.8, -2.0), 'n');
    const free = placeFloorObject(b, 'n', OPEN, lens(66), { depthM: 0.5 })!;
    const held = placeFloorObject(b, 'n', ROOM, lens(66), { depthM: 0.5 })!;
    expect(free.distance - held.distance).toBeCloseTo(1.0761, 4);
    expect(held.distanceDoubt).toBeCloseTo(1.1075, 4);
  });

  it('counts the floor the near face may not come inside, too', () => {
    // Tipped down 40° to get the floor in, a footstool at the photographer's feet reads
    // nearer than the 0.3 m the placer lets any face be, and is put at 0.3. That is a move
    // the photo did not make, in the other direction from the walls'.
    const down: CameraCal = { ...CAL, tiltRad: (40 * Math.PI) / 180 };
    const stool: Truth = { name: 'stool', label: 'footstool', category: 'ottoman', shape: 'ottoman', x: 0, z: -0.45, dimMM: [400, 400, 400], slots: ['n'] };
    const b = framedBoxFor(stool, 'n', down)!;
    expect(frameCuts(b).bottom).toBe(false);
    const g = placeFloorObject(b, 'n', ROOM, down, { depthM: 0.4 })!;
    expect(g.distance).toBeCloseTo(0.3 + 0.2, 12);
    expect(g.distanceDoubt).toBeCloseTo(0.3 - 0.25, 6);
  });

  it('is no limit at all for a piece the frame cut at its foot', () => {
    // Its near face was never in the picture, so nothing the photo shows says how far
    // it stands, wherever the placer put it.
    const cut = box(chair(0, -1.2), 'n');
    expect(frameCuts(cut).bottom).toBe(true);
    expect(placeFloorObject(cut, 'n', ROOM, CAL, { depthM: 0.5 })!.distanceDoubt).toBe(Infinity);
    expect(placeFloorObject(cut, 'n', OPEN, CAL, { depthM: 0.5 })!.distanceDoubt).toBe(Infinity);
  });

  it('is zero on a wall, whose distance is the wall’s', () => {
    // Two pieces on one wall are told apart along it, not toward it.
    const print: Truth = { name: 'print', label: 'framed print', category: 'painting', shape: 'painting', x: 0.4, z: -3.0, y: 1.5, dimMM: [700, 40, 500], slots: ['n'] };
    const g = placeWallObject(box(print, 'n'), 'n', ROOM, CAL, { depthM: 0.04 })!;
    expect(g).not.toBeNull();
    expect(g.distanceDoubt).toBe(0);
  });

  it('is carried out of the measurement beside the row', () => {
    const narrow = every(lens(66));
    const far = seen(chair(0.3, -2.7));
    const g = geoMeasure(far, narrow, ROOM);
    expect(g.row).not.toBe(far);
    // The placer's own number, not a copy of it.
    const foot: PieceFootprint = {
      depthM: defaultDepthFor('chair', 'chair-dining') / 1000,
      whole: { widthM: defaultAxisFor('chair', 'chair-dining', 0) / 1000, heightM: defaultAxisFor('chair', 'chair-dining', 2) / 1000 },
    };
    const direct = placeFloorObject(far.box, 'n', ROOM, narrow.n!, foot)!;
    expect(direct.distanceDoubt).toBeGreaterThan(1);
    expect(g.distanceDoubt).toBe(direct.distanceDoubt);
    expect(geoMeasure(far, CALS, ROOM).distanceDoubt).toBe(0);
    // A row with no camera for its photo is not measured, and doubts nothing.
    expect(geoMeasure(far, {}, ROOM)).toEqual({ row: far, bounds: expect.anything(), distanceDoubt: 0 });
  });
});

describe('the hard merge and a place the photo did not give — § 46.3', () => {
  it('keeps two chairs one behind the other that a narrow lens runs onto one spot', () => {
    // Across a dining table, 0.7 m apart along the view, both seen whole. Read on 66°,
    // both near faces run past the far wall and the centre bound stops both 0.25 m off
    // it, 70 mm apart. On the lens the photo was taken on they are where they stand.
    const pair = [seen(chair(0.3, -2.0)), seen(chair(0.3, -2.7))];
    const narrow = every(lens(66));
    const placed = pair.map((d) => geoMeasure(d, narrow, ROOM).row);
    const apart = Math.hypot(placed[0].position!.x - placed[1].position!.x, placed[0].position!.z - placed[1].position!.z);
    expect(apart).toBeLessThan(0.1);
    // The merge as it was: one chair.
    expect(dedupeDetections(placed, new Set(placed))).toHaveLength(1);
    expect(refineDetections(pair, narrow, ROOM)).toHaveLength(2);
    expect(refineDetections(pair, CALS, ROOM)).toHaveLength(2);
  });

  it('keeps a chair the frame cut at its foot off the chair across the table', () => {
    // On the lens the photo was taken on. The nearer chair's foot is below the frame, so
    // it is placed as far back as the evidence allows, 0.24 m from the far one.
    const pair = [seen(chair(0, -1.2)), seen(chair(0, -2.0))];
    expect(frameCuts(pair[0].box).bottom).toBe(true);
    const placed = pair.map((d) => geoMeasure(d, CALS, ROOM).row);
    expect(dedupeDetections(placed, new Set(placed))).toHaveLength(1);
    expect(refineDetections(pair, CALS, ROOM)).toHaveLength(2);
  });
});
