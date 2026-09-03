import { describe, it, expect } from 'vitest';
import { refusalAfterGesture, turnNudge, REFUSAL_HOLD_MS, TURN_NUDGE_EPS } from '@/lib/refusal';
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

  it('measures the floor plane and ignores y', () => {
    // A turn may legitimately change y — a wall rider re-aimed by the wall it lands
    // on — and that is the wall's answer, not a nudge.
    expect(turnNudge([1, 0, 2], [1, 0.9, 2])).toBe(0);
    expect(turnNudge([0, 0, 0], [0.3, 5, 0.4])).toBeCloseTo(0.5, 12);
  });

  it('swallows float noise but not a real slide', () => {
    // Both ends pinned. Asserted only from below, the epsilon would be free to grow
    // until it ate the smallest slide anyone can make: the finest translate snap in
    // the app is 10 mm, ten times this.
    expect(turnNudge([0, 0, 0], [TURN_NUDGE_EPS / 2, 0, 0])).toBe(0);
    expect(turnNudge([0, 0, 0], [TURN_NUDGE_EPS * 2, 0, 0])).toBeCloseTo(TURN_NUDGE_EPS * 2, 12);
    expect(TURN_NUDGE_EPS).toBeLessThan(0.01);
    expect(TURN_NUDGE_EPS).toBeGreaterThan(0);
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
