import { describe, it, expect } from 'vitest';
import {
  refusalAfterGesture, turnNudge, turnAngleHeld, turnDrop,
  REFUSAL_HOLD_MS, TURN_NUDGE_EPS, TURN_HELD_EPS,
} from '@/lib/refusal';
import { turnInPlace } from '@/lib/drag-resolve';
import { footprintForLayout } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';

// The defect these exist for: a gesture that ends somewhere the piece does not fit is
// TAKEN — a piece in a tight corner has to stay turnable — and the plan outlined it in
// red while `Draggable.commit()` ended `setDragInvalid(false)` / `setLive(null)`
// unconditionally, so 3D computed the refusal and threw it away on the same tick. The
// user saw that as a couch cutting through the walls instead of being constrained.

describe('a gesture that ends somewhere illegal is a finding, not silence', () => {
  it('says nothing when the placement and its company both fit', () => {
    expect(
      refusalAfterGesture({ draggedId: 'sofa', placementValid: true, convoyValid: true }),
    ).toBeNull();
  });

  it('names the dragged piece when the dragged piece is the problem', () => {
    const r = refusalAfterGesture({ draggedId: 'sofa', placementValid: false, convoyValid: true });
    expect(r).not.toBeNull();
    expect(r!.ids).toEqual(['sofa']);
    // No name: "blocked" is the honest word when the thing under the hand is what
    // does not fit, and naming a member would point at the wrong piece.
    expect(r!.by).toBeUndefined();
  });

  it('names the MEMBER when the dragged piece fits and its company does not', () => {
    const r = refusalAfterGesture({
      draggedId: 'bed',
      placementValid: true,
      convoyValid: false,
      blockedIds: ['nightstand-r'],
      blockedByName: 'Nightstand',
    });
    // The piece that refused is not the piece under the hand — that asymmetry is the
    // whole reason `by` exists, and it is why the outline set carries both.
    expect(r!.by).toBe('Nightstand');
    expect(r!.ids).toEqual(['bed', 'nightstand-r']);
  });

  it('drops the member name when the dragged piece is ALSO out of room', () => {
    // Both failed, so the sentence belongs to the piece under the hand. A readout
    // that blames a nightstand while the bed it is beside is itself through a wall
    // sends the user to fix the wrong thing.
    const r = refusalAfterGesture({
      draggedId: 'bed',
      placementValid: false,
      convoyValid: false,
      blockedIds: ['nightstand-r'],
      blockedByName: 'Nightstand',
    });
    expect(r!.by).toBeUndefined();
    expect(r!.ids).toEqual(['bed', 'nightstand-r']);
  });

  it('puts the dragged piece first exactly once, however blockedIds arrives', () => {
    // `blockedIds` may or may not already contain the dragged piece depending on
    // which check failed. Both callers pass it straight through, so the dedup lives
    // here or it lives in two places.
    const withIt = refusalAfterGesture({
      draggedId: 'bed', placementValid: false, convoyValid: false, blockedIds: ['bed', 'ns'],
    });
    const withoutIt = refusalAfterGesture({
      draggedId: 'bed', placementValid: false, convoyValid: false, blockedIds: ['ns'],
    });
    expect(withIt!.ids).toEqual(['bed', 'ns']);
    expect(withoutIt!.ids).toEqual(['bed', 'ns']);
  });

  it('holds long enough to be seen, and the two surfaces read the same number', () => {
    // Not a magic-number test: the point is that it is ONE number. It was a bare 500
    // in `PlanView` and nothing at all in 3D.
    expect(REFUSAL_HOLD_MS).toBeGreaterThanOrEqual(300);
    expect(REFUSAL_HOLD_MS).toBeLessThanOrEqual(2000);
  });
});

describe('the placement that made this a defect', () => {
  it('reports a sofa longer than the room, turned across it', () => {
    // The measurement the user's report reduces to. A 6 × 3 room and a 4 m sofa: the
    // turn is taken, the containment clamp pins it, and it still overhangs — so
    // `valid` is false and a caller that discards that is the whole bug.
    const FP = footprintForLayout('rect', 6, 3);
    const sofa = {
      id: 'sofa', name: 'Sofa', category: 'sofa', shape: 'sofa',
      dimMM: [4000, 900, 800], pos: [0, 0, 0], rot: 0, locked: false,
    } as ScenePart;
    const turned = turnInPlace({
      part: sofa, at: [0, 0, 1.0], rot: Math.PI / 2, dim: sofa.dimMM,
      parts: [sofa], footprint: FP, roomHeight: 2.7,
    });
    expect(turned.valid).toBe(false);
    // …and it is taken rather than refused: the angle asked for is the angle returned.
    expect(turned.rot).toBeCloseTo(Math.PI / 2, 6);
    // 1.000 m of sofa past the south wall, which is what "cutting through the wall"
    // was. Asserted as a number so a change that quietly starts clamping harder shows
    // up here rather than as a piece that cannot be turned.
    const extZ = sofa.dimMM[0] / 2000;
    const overhang = turned.pos[2] + extZ - 1.5;
    expect(overhang).toBeCloseTo(1.0, 6);
    // And the refusal that placement produces is not empty.
    expect(refusalAfterGesture({ draggedId: sofa.id, placementValid: turned.valid, convoyValid: true })).not.toBeNull();
  });

  it('a sofa that DOES fit turned across the room is not a refusal', () => {
    // The negative control. Without it every assertion above passes for a function
    // that calls everything refused.
    const FP = footprintForLayout('rect', 6, 3);
    const sofa = {
      id: 'sofa', name: 'Sofa', category: 'sofa', shape: 'sofa',
      dimMM: [2400, 900, 800], pos: [0, 0, 0], rot: 0, locked: false,
    } as ScenePart;
    const turned = turnInPlace({
      part: sofa, at: [0, 0, 1.0], rot: Math.PI / 2, dim: sofa.dimMM,
      parts: [sofa], footprint: FP, roomHeight: 2.7,
    });
    expect(turned.valid).toBe(true);
    expect(refusalAfterGesture({ draggedId: sofa.id, placementValid: turned.valid, convoyValid: true })).toBeNull();
  });
});

// ─── § B.14: what `valid` structurally cannot say ────────────────────────────

describe('turnNudge — a turn that was slid to make it fit', () => {
  it('is zero for a turn that happened where it stood', () => {
    expect(turnNudge([1, 0, 2], [1, 0, 2])).toBe(0);
  });

  it('measures the floor plane and leaves y to turnDrop', () => {
    // The split is right and the reason first written beside it was not: it said a wall
    // rider's height legitimately moves, which cannot happen — `turnInPlace` passes
    // `currentY` and `resolvePlacement` preserves it for every centred piece. The height
    // is a different SENTENCE, not an exempt axis. See `turnDrop` below.
    expect(turnNudge([1, 0, 2], [1, 0.9, 2])).toBe(0);
    expect(turnNudge([0, 0, 0], [0.3, 5, 0.4])).toBeCloseTo(0.5, 12);
  });

  it('swallows float noise but not a real slide', () => {
    // **Both ends pinned, in ABSOLUTE metres.** The first version of this wrote its two
    // probes as `EPS/2` and `EPS*2` and its bounds as `> 0` and `< 0.01`, which is the
    // `module-tiling` shape CLAUDE.md names: an assertion measured against the very
    // constant it is pinning passes for any positive value, `1e-12` included, and the
    // only mutation it caught was one that made the epsilon absurdly large.
    //
    // So the probes are fixed distances either side of the intended millimetre. A
    // shrunk epsilon lets 0.1 mm of resolve noise through and the app announces
    // "moved 0.0004 m to stay in the room" after a turn nobody can see move.
    expect(turnNudge([0, 0, 0], [0.0001, 0, 0])).toBe(0);
    expect(turnNudge([0, 0, 0], [0.004, 0, 0])).toBeCloseTo(0.004, 12);
    expect(TURN_NUDGE_EPS).toBeGreaterThanOrEqual(0.0005);
    expect(TURN_NUDGE_EPS).toBeLessThanOrEqual(0.002);
  });

  it('fires on exactly the case a valid resolve cannot report', () => {
    // The finding § B.14 turned on. `resolvePlacement` computes
    // `valid = inRoom && !collides` against the position it has ALREADY clamped, so a
    // turn whose new footprint crossed a wall comes back `valid: true` with the piece
    // moved somewhere nobody asked for. If this assertion ever reads `false`, the
    // sentence has become a duplicate of the refusal and should go.
    const desk = {
      id: 'desk-1', name: 'Desk', category: 'desk', shape: 'desk-standard', locked: false,
      dimMM: [1400, 700, 750], pos: [0, 0, -1.65], rot: 0, wallMounted: false,
    } as ScenePart;
    const fp = footprintForLayout('rect', 4, 4);
    const turned = turnInPlace({
      part: desk, at: desk.pos, rot: Math.PI / 2, dim: desk.dimMM,
      parts: [desk], footprint: fp, roomHeight: 2.6,
    });
    expect(turned.valid).toBe(true);
    expect(turnNudge(desk.pos, turned.pos)).toBeGreaterThan(0.3);
  });
});

describe('turnAngleHeld — the angle the piece ended at was not the one asked for', () => {
  it('is false when the request was taken', () => {
    expect(turnAngleHeld(0, 0)).toBe(false);
    expect(turnAngleHeld(Math.PI / 2, Math.PI / 2)).toBe(false);
  });

  it('is false across a full circle, so the same heading by another route is not held', () => {
    // Without the modulo, a piece asked for 3π/2 and given -π/2 — the same direction —
    // would be reported as held by its wall.
    expect(turnAngleHeld((3 * Math.PI) / 2, -Math.PI / 2)).toBe(false);
    expect(turnAngleHeld(0, Math.PI * 2)).toBe(false);
    expect(turnAngleHeld(0, -Math.PI * 2)).toBe(false);
  });

  it('is true when something else chose the angle', () => {
    expect(turnAngleHeld(Math.PI / 2, 0)).toBe(true);
    expect(turnAngleHeld(0, Math.PI)).toBe(true);
  });

  it('has a threshold under a degree and above float noise', () => {
    // Absolute radians, not written in terms of the constant. Half a degree is 0.0087;
    // a threshold near a whole quarter turn would report every wall rider as free and a
    // threshold at zero would report every piece as held by float noise.
    expect(turnAngleHeld(0, 1e-9)).toBe(false);
    expect(turnAngleHeld(0, 0.05)).toBe(true);
    expect(TURN_HELD_EPS).toBeGreaterThan(1e-6);
    expect(TURN_HELD_EPS).toBeLessThan(0.02);
  });

  it('fires on exactly the case the app was mis-narrating — a real wall rider', () => {
    // The measured defect: 11 of 11 `ridesWall` catalogue items come back at the angle
    // they started at, because `turnInPlace` passes `wallEdge: null`. The app announced
    // "Turned a quarter turn." over every one of them.
    const tv = {
      id: 'tv-1', name: 'TV', category: 'tv', shape: 'tv', locked: false,
      dimMM: [1450, 60, 820], pos: [0, 1.2, -2.4], rot: 0, wallMounted: true,
    } as ScenePart;
    const fp = footprintForLayout('rect', 6, 5);
    const wanted = Math.PI / 2;
    const turned = turnInPlace({
      part: tv, at: tv.pos, rot: wanted, dim: tv.dimMM,
      parts: [tv], footprint: fp, roomHeight: 2.5,
    });
    expect(turnAngleHeld(wanted, turned.rot)).toBe(true);
    // …and the height really is untouched, which is what makes the y-exemption reason
    // written beside `turnNudge` wrong rather than merely unnecessary.
    expect(turnDrop(tv.pos, turned.pos)).toBe(0);
  });
});

describe('turnDrop — a turn that took the piece off what it stood on', () => {
  it('is zero for a turn that stayed at its height', () => {
    expect(turnDrop([1, 0.75, 2], [1, 0.75, 2])).toBe(0);
  });

  it('is positive DOWNWARD, and reads the height alone', () => {
    // Positive-down so the caller can pick a verb without re-deriving the direction.
    expect(turnDrop([0, 0.75, 0], [0, 0, 0])).toBeCloseTo(0.75, 12);
    expect(turnDrop([0, 0, 0], [0, 0.42, 0])).toBeCloseTo(-0.42, 12);
    // A pure floor slide is not a drop, or every clamped turn would claim to have
    // fallen.
    expect(turnDrop([0, 0.5, 0], [3, 0.5, 4])).toBe(0);
  });

  it('swallows float noise at the same millimetre the nudge does', () => {
    expect(turnDrop([0, 0, 0], [0, 0.0001, 0])).toBe(0);
    expect(turnDrop([0, 0, 0], [0, -0.004, 0])).toBeCloseTo(0.004, 12);
  });

  it('fires on the case that was being announced as an ANGLE problem', () => {
    // A desk standing on a nightstand. Turned a quarter it no longer covers enough of
    // it, `findSupportDetailed` finds nothing, and the gravity branch of the same
    // resolve writes it to the floor — with a horizontal nudge of zero, so the only
    // sentence the app had was "does not fit at that angle".
    const stand = {
      id: 'nightstand-1', name: 'Nightstand', category: 'nightstand', shape: 'nightstand',
      locked: false, dimMM: [450, 400, 550], pos: [0, 0, 0], rot: 0, wallMounted: false,
    } as ScenePart;
    const desk = {
      id: 'desk-1', name: 'Desk', category: 'desk', shape: 'desk-standard', locked: false,
      dimMM: [1400, 700, 750], pos: [0, 0.55, 0], rot: 0, wallMounted: false,
    } as ScenePart;
    const fp = footprintForLayout('rect', 6, 5);
    const turned = turnInPlace({
      part: desk, at: desk.pos, rot: Math.PI / 2, dim: desk.dimMM,
      parts: [stand, desk], footprint: fp, roomHeight: 2.5,
    });
    expect(turnDrop(desk.pos, turned.pos)).toBeGreaterThan(0.4);
    // …and the horizontal sentence really is silent here, which is the whole reason
    // this function had to exist rather than `turnNudge` growing an axis.
    expect(turnNudge(desk.pos, turned.pos)).toBe(0);
  });
});
