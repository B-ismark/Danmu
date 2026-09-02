import { describe, expect, it } from 'vitest';
import { heightForNewCeiling, MOUNT_PAD, groundY } from '../lib/physics';
import { regradeForNewCeiling } from '../lib/transforms';
import { ROOM_HEIGHT_M, ROOM_SIDE_M, roomAxisRange, roomAxisWithin } from '../lib/dimension-ranges';
import type { ScenePart } from '../lib/scene-spec';

const FAN: [number, number, number] = [1000, 1000, 200];
const TV: [number, number, number] = [1200, 120, 700];

function part(over: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: 'p', name: 'x', rot: 0, locked: false, wallMounted: false, ...over } as ScenePart;
}

describe('a piece whose height comes from the ceiling follows the ceiling', () => {
  // The reported bug, with the reported numbers — **re-derived, because the numbers
  // moved.** They were 1.60 and 2.65, which is `roomHeight - 0.15`: the flat nominal
  // drop `groundY` took for anything shallower than 260 mm, and which left this 200 mm
  // fan's downrod 50 mm below the slab (`what-is-still-open.md` § 35). The ceiling arm
  // hangs a fixture by its own top now, so the same fan sits 30 mm higher at both ends.
  // The BUG this test is about is unchanged and so is its shape: a fan dropped into a
  // 1.75 m room and then corrected to 2.80 must arrive where a fan dropped into a
  // 2.80 m room hangs — the same answer by both routes.
  it('puts the fan back at the ceiling when the room is corrected upwards', () => {
    const hung = groundY('fan', 'fan', FAN, 1.75);
    expect(hung).toBeCloseTo(1.63, 6);
    const after = heightForNewCeiling('fan', 'fan', FAN, hung, 1.75, 2.8);
    expect(after).toBeCloseTo(2.68, 6);
    expect(after).toBeCloseTo(groundY('fan', 'fan', FAN, 2.8), 6);
    // And what the Inspector prints off it — the number the user read as 1.50.
    expect(after - FAN[2] / 2000).toBeCloseTo(2.58, 6);
  });

  it('follows the ceiling down too, and the two directions round-trip', () => {
    const up = heightForNewCeiling('fan', 'fan', FAN, 2.65, 2.8, 3.8);
    expect(up).toBeCloseTo(3.65, 6);
    // Asymmetric on purpose: a sign error here is invisible if you only test one
    // direction, and a fan that follows a rising ceiling while ignoring a falling
    // one looks correct in exactly the case people try first.
    const down = heightForNewCeiling('fan', 'fan', FAN, 2.65, 2.8, 2.0);
    expect(down).toBeCloseTo(1.85, 6);
    expect(heightForNewCeiling('fan', 'fan', FAN, up, 3.8, 2.8)).toBeCloseTo(2.65, 6);
  });

  it('carries a curtain rod with it — wall-high is measured from the ceiling', () => {
    const rod = groundY('curtain', 'curtain', [1400, 80, 2200], 2.8);
    const after = heightForNewCeiling('curtain', 'curtain', [1400, 80, 2200], rod, 2.8, 3.2);
    expect(after - rod).toBeCloseTo(0.4, 6);
  });

  it('never pushes a piece through the floor to follow a ceiling down', () => {
    // A 2.2 m curtain in a room dropping to 2.0 m does not fit at all. It keeps its
    // real height and pokes through the ceiling; it is NOT shrunk, and it is not
    // buried. `lib/clearance.ts` is what says so out loud.
    const y = heightForNewCeiling('curtain', 'curtain', [1400, 80, 2200], 1.65, 2.8, 2.0);
    expect(y).toBeCloseTo(1.1 + MOUNT_PAD, 6);
    expect(y + 1.1).toBeGreaterThan(2.0);
  });
});

describe('a piece measured from the FLOOR keeps its height off the floor', () => {
  it('leaves a TV at eye level when the ceiling rises', () => {
    expect(heightForNewCeiling('tv', 'tv', TV, 1.4, 2.4, 3.0)).toBe(1.4);
  });

  it('but tucks it under a ceiling that drops below it', () => {
    expect(heightForNewCeiling('tv', 'tv', TV, 1.4, 2.8, 1.5)).toBeCloseTo(1.5 - 0.35 - MOUNT_PAD, 6);
  });

  it('does not move a floor-standing piece at all, even one that no longer fits', () => {
    // The wardrobe is 2.2 m and the ceiling is now 2.0. Moving it would be the
    // silent resize this repo forbids one step removed — it keeps its place and the
    // room report is where the user hears about it.
    expect(heightForNewCeiling('wardrobe', 'wardrobe', [1000, 600, 2200], 0, 2.8, 2.0)).toBe(0);
    expect(heightForNewCeiling('sofa', 'sofa', [1800, 900, 800], 0, 2.4, 4.0)).toBe(0);
  });

  it('leaves a door standing on its own threshold', () => {
    const y = groundY('door', 'door', [900, 100, 2000], 2.8);
    expect(heightForNewCeiling('door', 'door', [900, 100, 2000], y, 2.8, 2.4)).toBe(y);
  });
});

describe('both transform layers, and no write that changes nothing', () => {
  const fan = part({ id: 'fan1', category: 'fan', shape: 'fan', dimMM: FAN, pos: [0, 1.6, 0], wallMounted: true });
  const sofa = part({ id: 'sofa1', category: 'sofa', shape: 'sofa', dimMM: [1800, 900, 800], pos: [1, 0, 1] });

  it('regrades the authored height and the override separately, each from its own value', () => {
    const out = regradeForNewCeiling([fan, sofa], { positions: { fan1: [0.5, 1.4, 0.5] } }, 1.75, 2.8);
    expect(out.authored).toEqual([{ id: 'fan1', y: 2.65 }]);
    // 1.4 + 1.05, not 2.65: the override is a different height and stays one.
    expect(out.overridden).toHaveLength(1);
    expect(out.overridden[0].id).toBe('fan1');
    expect(out.overridden[0].y).toBeCloseTo(2.45, 6);
  });

  it('returns nothing for a piece that does not move, and nothing at all for no change', () => {
    // A no-op write to the override layer still CREATES an override, which then
    // pins the piece against a re-detect and is persisted.
    expect(regradeForNewCeiling([sofa], { positions: { sofa1: [1, 0, 1] } }, 1.75, 2.8)).toEqual({
      authored: [],
      overridden: [],
    });
    expect(regradeForNewCeiling([fan], {}, 2.8, 2.8).authored).toEqual([]);
  });

  it('an unchanged height moves nothing, not even a piece already out of bounds', () => {
    // What the equality guard is actually for. A fan poking 10 cm through the
    // ceiling is a piece the clamp would happily "fix" — but the user committed a
    // height edit that changed no height, and that must not quietly tidy the room.
    // Nor must a nonsense ceiling: 0 would clamp every centred piece to h/2.
    const high = part({ id: 'fan1', category: 'fan', shape: 'fan', dimMM: FAN, pos: [0, 2.9, 0], wallMounted: true });
    expect(regradeForNewCeiling([high], { positions: { fan1: [0, 2.9, 0] } }, 2.8, 2.8)).toEqual({
      authored: [],
      overridden: [],
    });
    expect(regradeForNewCeiling([high], {}, 2.8, 0)).toEqual({ authored: [], overridden: [] });
  });

  it('clamps by the size the piece is NOW, not the size it shipped as', () => {
    // Authored 200 mm tall, resized to 450. Following the ceiling from 2.8 down to
    // 0.6 aims the fan below the floor, so the FLOOR bound is what binds — and it
    // is the effective half-height that sets it. Reading `p.dimMM` here gives 0.12.
    const out = regradeForNewCeiling([fan], { dims: { fan1: [1000, 1000, 450] } }, 2.8, 0.6);
    expect(out.authored).toHaveLength(1);
    expect(out.authored[0].y).toBeCloseTo(0.225 + MOUNT_PAD, 6);
  });
});

describe('a ceiling is not a side', () => {
  it('gives the height its own range', () => {
    expect(roomAxisRange('height')).toBe(ROOM_HEIGHT_M);
    expect(roomAxisRange('width')).toBe(ROOM_SIDE_M);
    expect(roomAxisRange('depth')).toBe(ROOM_SIDE_M);
    expect(ROOM_HEIGHT_M.min).toBeGreaterThan(ROOM_SIDE_M.min);
    expect(ROOM_HEIGHT_M.max).toBeLessThan(ROOM_SIDE_M.max);
  });

  it('refuses the ceiling that stranded the fan, while 1.65 m stays a legal side', () => {
    expect(roomAxisWithin('height', 1.65)).toBe(false);
    expect(roomAxisWithin('width', 1.65)).toBe(true);
    expect(roomAxisWithin('height', 2.8)).toBe(true);
    expect(roomAxisWithin('height', 13)).toBe(false);
    expect(roomAxisWithin('height', NaN)).toBe(false);
    expect(roomAxisWithin('width', 0.9)).toBe(false);
  });
});
