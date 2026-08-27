// What a suggestion looks like when it comes back, as distinct from what it scores.
//
// The complaint that produced this file was "clicking Suggest feels like randomising
// — items get rotated at odd angles for no reason". The score was not the problem;
// the *finish* was. Two passes run on the answer after the search, and both had a
// hole in them:
//
//   · `snapYaws` squares up anything within `SNAP_TOL` of true, and then asked the
//     full cost function for permission. Measured per degree, wall-facing costs
//     `alignment × FACING_GAIN / 180` = 0.089 while the relation term's own facing
//     gradient on the same piece is 0.10 — within 12 % of each other, so whichever
//     way a sofa's partner happened to land decided whether the sofa came back
//     square. Over twelve seeds of an eighteen-piece room, 6 of 51 moved pieces were
//     handed back at 1°, 3°, 4°, 7° and 8° off. Nobody chose those angles and nobody
//     can see why they are there.
//
//   · `openRoutes` ran AFTER the tidy and is a search like any other, so on the only
//     rooms it runs on — the ones with floor cut off from the door — the yaws the
//     user saw were the untidied ones.
//
// The property below is the one a person actually checks by looking at the room: a
// piece is square, or it is at an angle big enough to read as a decision. Nothing
// comes back three degrees off.

import { describe, it, expect } from 'vitest';
import { solveLayout } from '@/lib/layout-solve';
import {
  costBreakdown,
  navigabilityCost,
  NAV_CELL,
  prepare,
  type LayoutContext,
  type Placement,
} from '@/lib/layout-score';
import { defaultScene } from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

/** `SNAP_TOL` in lib/layout-solve — the band inside which an angle is not a choice.
 *  Restated rather than exported: the constant is that module's business, and a test
 *  that imported it would move whenever it moved instead of holding it to something. */
const SNAP_TOL = 0.21; // 12°

/** How far this yaw is from the nearest quarter turn, radians. */
function offSquare(yaw: number): number {
  const q = Math.PI / 2;
  const r = ((yaw % q) + q) % q;
  return Math.min(r, q - r);
}

let n = 0;
function part(p: Partial<ScenePart> & Pick<ScenePart, 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart {
  return { id: `p${++n}`, name: p.category, rot: 0, locked: false, ...p } as ScenePart;
}

/** A room with enough in it that the solver has real work to do — the seeded presets
 *  are already at a local minimum and move nothing, which would make this vacuous. */
function busyRoom(): { poly: Footprint; parts: ScenePart[] } {
  const poly = footprintForLayout('rect', 7.5, 5.6);
  const seeded = defaultScene('rect', 7.5, 5.6, { footprint: poly });
  const added: ScenePart[] = [
    part({ category: 'chair', shape: 'chair-armchair', dimMM: [800, 850, 900], pos: [-2.4, 0, 1.0], rot: Math.PI / 2, name: 'Armchair' }),
    part({ category: 'shelf', shape: 'bookshelf', dimMM: [900, 320, 1800], pos: [-3.4, 0, -1.0], rot: Math.PI / 2, name: 'Bookcase' }),
    part({ category: 'table', shape: 'side-table', dimMM: [450, 450, 550], pos: [-1.6, 0, 1.4], name: 'Side table' }),
    part({ category: 'table', shape: 'desk-standard', dimMM: [1500, 900, 750], pos: [2.3, 0, -1.2], name: 'Dining table' }),
    part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 480, 900], pos: [2.3, 0, -0.4], rot: Math.PI, name: 'Chair A' }),
    part({ category: 'chair', shape: 'chair-dining', dimMM: [450, 480, 900], pos: [2.3, 0, -2.0], name: 'Chair B' }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1600, 600, 2100], pos: [-3.5, 0, 0.6], rot: Math.PI / 2, name: 'Wardrobe' }),
  ];
  return { poly, parts: [...seeded, ...added] };
}

describe('a suggestion never hands back a piece a few degrees off square', () => {
  const { poly, parts } = busyRoom();
  const locked = parts.map(() => false);

  it('over twelve seeds, every moved piece is square or deliberately angled', { timeout: 120_000 }, () => {
    const crooked: string[] = [];
    let movedTotal = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = solveLayout(parts, poly, locked, { seed });
      for (const i of r.moved) {
        movedTotal++;
        const off = offSquare(r.placements[i].yaw);
        // 1e-3 rad ≈ 0.06°, i.e. floating-point rather than an angle.
        if (off > 1e-3 && off < SNAP_TOL) {
          crooked.push(`seed ${seed}: ${parts[i].name} at ${((off * 180) / Math.PI).toFixed(1)}° off square`);
        }
      }
    }
    // The room has to actually be worked on, or this passes by moving nothing.
    expect(movedTotal, 'the fixture must give the solver something to do').toBeGreaterThan(20);
    expect(crooked, crooked.join('\n')).toEqual([]);
  });

  it('still allows an angle big enough to be a decision', { timeout: 60_000 }, () => {
    // The tidy must not be a blanket quantiser: `SNAP_TOL` is the whole distinction
    // between residue and intent, and a pass that squared everything would be just
    // as wrong in the other direction. A chair angled 45° toward a sofa is a thing a
    // person does, and nothing here may undo it.
    const r = solveLayout(parts, poly, locked, { seed: 4 });
    for (const i of r.moved) {
      const off = offSquare(r.placements[i].yaw);
      expect(off === 0 || off <= 1e-3 || off >= SNAP_TOL, `${parts[i].name}`).toBe(true);
    }
  });
});

// ─── A route-opening move can say that is what it did ───────────────────────
//
// `navigation` was missing from `TERMS`, and `explain` scored with the term switched
// off — `costBreakdown` defaults it off for the annealer's sake, and nobody passed a
// cell. So its gain was zero for every move and the term could never be credited even
// after it was listed. The one pass that exists solely to reconnect a stranded part
// of the room could not name what it had done, and the sentence the user reads named
// whichever taste term happened to shift instead.
//
// The fixture is a room with a NECK, and that is deliberate rather than convenient.
// `explain` works by putting one piece back and asking which term got worse, so a
// move is only creditable to navigation when that single piece is the plug. Seven
// chairs strung across an open rectangle also cut the room, but no one of them
// re-seals it on its own — the credit is collective and this method cannot see it,
// which is a real limit of the explanation and not a bug in it.
const ALCOVE: Footprint = [
  [-3, -2],
  [3, -2],
  [3, 0],
  [0.7, 0],
  [0.7, 2],
  [-0.7, 2],
  [-0.7, 0],
  [-3, 0],
];

/** A chest parked across the 1.4 m neck, sealing the alcove off from the only door. */
function pluggedRoom(): ScenePart[] {
  return [
    part({ category: 'door', shape: 'door', dimMM: [900, 50, 2100], pos: [0, 0, -1.95], wallMounted: true, name: 'Door' }),
    part({ category: 'wardrobe', shape: 'wardrobe', dimMM: [1300, 500, 900], pos: [0, 0, 0.3], name: 'Chest' }),
  ];
}

describe('a route-opening move can say that is what it did', () => {
  const navOf = (parts: ScenePart[], at: Placement[]) => {
    const ctx: LayoutContext = { parts, movable: parts.map((p) => !p.wallMounted), footprint: ALCOVE };
    return navigabilityCost(prepare(ctx), at, NAV_CELL);
  };
  const at = (parts: ScenePart[]) => parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));

  it('scores the room as cut before it starts', () => {
    const parts = pluggedRoom();
    expect(navOf(parts, at(parts)), 'the fixture must actually strand some floor').toBeGreaterThan(0);
  });

  it('credits the move to navigation rather than to a taste term', () => {
    const parts = pluggedRoom();
    const r = solveLayout(parts, ALCOVE, parts.map((p) => !!p.wallMounted), { seed: 1 });
    expect(r.moved.length, 'a sealed alcove is worth rearranging').toBeGreaterThan(0);
    expect(r.moves.some((m) => m.term === 'navigation')).toBe(true);
  });

  it('and the answer is genuinely less cut than what it was given', () => {
    const parts = pluggedRoom();
    const r = solveLayout(parts, ALCOVE, parts.map((p) => !!p.wallMounted), { seed: 1 });
    expect(navOf(parts, r.placements)).toBeLessThan(navOf(parts, at(parts)));
    // …on the FINE grid. `openRoutes` optimises a coarse proxy because it is paid per
    // proposal, and its own doc comment claimed the answer was re-checked against the
    // real grid before being kept. It was not: it returned whatever the proxy found,
    // so it could spend the search and hand back something the fine grid scores worse.
    const ctx: LayoutContext = { parts, movable: parts.map((p) => !p.wallMounted), footprint: ALCOVE };
    expect(costBreakdown(prepare(ctx), r.placements, undefined, NAV_CELL).total).toBeLessThanOrEqual(r.before);
  });
});
