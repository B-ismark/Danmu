// § H.6.7 — the Inspector's Wall button moves through the convoy.
//
// Wall moved the piece and what stood on it, and nothing else, unchecked: merged-set
// siblings and the rest of a selection stayed behind, and a press into an occupied wall
// spot stacked the piece inside its neighbour. It is a drag's gesture now, with a drag's
// company and a drag's veto, and these pin the four answers a press can get.
//
// The room is 6 × 5 m, so the north wall is z = −2.5 and a 400 mm-deep piece stands
// against it at z = −2.28 (half its depth plus `WALL_GAP`), facing +z (rot 0).
import { describe, expect, it } from 'vitest';
import { moveToWall, wallSentence, type WallMove } from '@/lib/to-wall';
import { riderRelation } from '@/lib/rider-height';
import { footprintForLayout } from '@/lib/footprint';
import { WALL_GAP } from '@/lib/layout-rules';
import type { ScenePart } from '@/lib/scene-spec';

const ROOM = footprintForLayout('rect', 6, 5);
const FLUSH = -2.5 + 0.2 + WALL_GAP;
/** Too small to stand anything on, so a piece sent onto it collides rather than
 *  climbing it the way a dragged piece climbs a table. */
const post = (id: string, x: number, z: number) => part({ id, dimMM: [150, 150, 900], pos: [x, 0, z] });

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart =>
  ({
    name: over.id, category: 'other', shape: 'box', locked: false,
    dimMM: [400, 400, 500], pos: [0, 0, 0], rot: 0, wallMounted: false,
    ...over,
  }) as ScenePart;

function press(
  world: ScenePart[],
  selection: string[],
  opts: { id?: string; parentIds?: Record<string, string>; overridden?: string[] } = {},
): WallMove {
  const over = new Set(opts.overridden ?? []);
  return moveToWall({
    id: opts.id ?? selection[0],
    parts: world,
    selection,
    restsOn: riderRelation(world, opts.parentIds ?? {}),
    footprint: ROOM,
    roomHeight: 2.5,
    memberHasPosOverride: (id) => over.has(id),
  });
}

const moved = (m: WallMove) => {
  if (m.kind !== 'moved') throw new Error(`expected a move, got ${m.kind}`);
  return m;
};
const posOf = (m: WallMove, id: string) => moved(m).moves.find((mv) => mv.id === id)?.pos;

describe('Wall takes the selection with it (§ H.6.7)', () => {
  it('moves the rest of the selection by the same step, unturned', () => {
    // The piece goes 0.78 m north to the wall; the chair beside it goes as far too
    // and keeps its own angle — the set translates, it does not swing round the lead.
    const world = [part({ id: 'box', pos: [0, 0, -1.5] }), part({ id: 'chair', pos: [1.5, 0, -1.0], rot: 0.4 })];
    const m = press(world, ['box', 'chair']);
    expect(posOf(m, 'box')).toEqual([0, 0, FLUSH]);
    expect(posOf(m, 'chair')![2]).toBeCloseTo(-1.0 + FLUSH + 1.5, 9);
    expect(posOf(m, 'chair')![0]).toBeCloseTo(1.5, 9);
    expect(moved(m).moves.find((mv) => mv.id === 'chair')!.rot).toBeUndefined();
    expect(moved(m).short).toBe(false);
    expect(moved(m).behind).toBe(false);
  });

  it('records where every member was set down', () => {
    const world = [part({ id: 'box', pos: [0, 0, -1.5] }), part({ id: 'chair', pos: [1.5, 0, -1.0] })];
    expect(moved(press(world, ['box', 'chair'])).landings).toEqual([
      { id: 'box', on: undefined },
      { id: 'chair', on: undefined },
    ]);
  });

  it('lets gravity have the piece, rather than leaving it at the height it was lifted to', () => {
    // A lamp sent to the wall from the nightstand it stood on lands on the floor there,
    // and is unlinked from the nightstand. It used to hang in the air at 0.55 m.
    const world = [
      part({ id: 'ns', category: 'nightstand', shape: 'nightstand', dimMM: [450, 400, 550], pos: [0, 0, 0] }),
      part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.55, 0] }),
    ];
    const m = moved(press(world, ['lamp'], { parentIds: { lamp: 'ns' } }));
    expect(posOf(m, 'lamp')![1]).toBe(0);
    expect(m.landings).toEqual([{ id: 'lamp', on: undefined }]);
  });

  it('stops the set short when a member reaches the wall first, and says so', () => {
    // The chair is 1 m nearer the wall than the piece, so it meets the wall when the
    // piece still has 1 m to go. A drag slides to that limit; so does the button. The
    // limit is the room's edge, not the wall gap — the members are clamped, not
    // snapped — so the chair ends flush with the plaster.
    const world = [part({ id: 'box', pos: [0, 0, -1.0] }), part({ id: 'chair', pos: [1.5, 0, -2.0] })];
    const m = moved(press(world, ['box', 'chair']));
    expect(m.short).toBe(true);
    expect(posOf(m, 'box')![2]).toBeCloseTo(-1.3, 9);
    expect(posOf(m, 'chair')![2]).toBeCloseTo(-2.3, 9);
  });

  it('takes the piece through where the rest of the selection is leaving', () => {
    // The stool stands between the crate and the wall, so it meets the wall first and
    // the crate stops short, over the spot the stool STARTED on. Counted there rather
    // than where it is going, the stool is something to stand on, and the crate climbed
    // onto a stool that had left.
    const world = [part({ id: 'box', pos: [0, 0, -1.0] }), part({ id: 'stool', pos: [0, 0, -1.6] })];
    const m = moved(press(world, ['box', 'stool']));
    expect(m.short).toBe(true);
    expect(posOf(m, 'stool')![2]).toBeCloseTo(-2.3, 9);
    expect(posOf(m, 'box')).toEqual([0, 0, expect.closeTo(-1.7, 9)]);
    expect(m.landings[0]).toEqual({ id: 'box', on: undefined });
  });
});

describe('Wall refuses what a drag refuses, and moves nothing', () => {
  it('refuses when the set must stop short and the piece cannot stand there', () => {
    // The chair reaches the wall with the crate still 1 m out, and a post stands on
    // that spot. All the way leaves the chair behind and part way is taken, so neither.
    const world = [
      part({ id: 'box', pos: [0, 0, -1.0] }),
      part({ id: 'chair', pos: [1.5, 0, -2.0] }),
      post('post', 0, -1.3),
    ];
    expect(press(world, ['box', 'chair'])).toEqual({ kind: 'refused', blocked: [] });
  });

  it('names the member that cannot follow', () => {
    // The chair's destination is taken by a piece nobody selected. A shorter step does
    // not fix a collision, so the whole press is refused.
    const world = [
      part({ id: 'box', pos: [0, 0, -1.5] }),
      part({ id: 'chair', pos: [1.5, 0, -1.5] }),
      post('post', 1.5, FLUSH),
    ];
    const m = press(world, ['box', 'chair']);
    expect(m.kind).toBe('refused');
    expect(m.kind === 'refused' && m.blocked.map((p) => p.id)).toEqual(['chair']);
  });

  it('names every member that cannot follow, since a button outlines none of them', () => {
    const world = [
      part({ id: 'box', pos: [0, 0, -1.5] }),
      part({ id: 'chair', pos: [1.5, 0, -1.5] }),
      part({ id: 'stool', pos: [-1.5, 0, -1.5] }),
      post('p1', 1.5, FLUSH),
      post('p2', -1.5, FLUSH),
    ];
    const m = press(world, ['box', 'chair', 'stool']);
    expect(m.kind === 'refused' && m.blocked.map((p) => p.id).sort()).toEqual(['chair', 'stool']);
  });

  it('refuses a wall spot that is already taken, with its reason', () => {
    const world = [part({ id: 'box', pos: [0, 0, -1.5] }), post('post', 0, FLUSH)];
    const m = press(world, ['box']);
    expect(m).toEqual({ kind: 'refused', blocked: [], refusal: 'blocked' });
  });
});

describe('Wall writes only what it changes', () => {
  it('says a piece already against its wall is there, and writes nothing', () => {
    expect(press([part({ id: 'box', pos: [0, 0, FLUSH] })], ['box'])).toEqual({ kind: 'there' });
  });

  it('writes a turn only when the wall turns the piece', () => {
    const still = moved(press([part({ id: 'box', pos: [0, 0, -1.5] })], ['box']));
    expect(still.moves[0]).toEqual({ id: 'box', pos: [0, 0, FLUSH] });
    const turned = moved(press([part({ id: 'box', pos: [0, 0, -1.5], rot: 1 })], ['box']));
    expect(turned.moves[0].pos).toEqual([0, 0, FLUSH]);
    // −0 from the wall's own heading, which is the same angle.
    expect(turned.moves[0].rot).toBeCloseTo(0, 12);
  });

  it('counts a piece between its wall spot and the plaster as there', () => {
    // A drag clamps a piece flush with the plaster, 20 mm nearer the wall than the
    // button's spot. Pulling it back into the room would move it away from the wall.
    expect(press([part({ id: 'box', pos: [0, 0, -2.3] })], ['box'])).toEqual({ kind: 'there' });
    // In front of its spot is not there, however close, and neither is past the plaster's
    // side of the gap — which is inside the wall, and only reachable by a scan.
    expect(posOf(press([part({ id: 'box', pos: [0, 0, FLUSH + 0.01] })], ['box']), 'box')).toEqual([0, 0, FLUSH]);
    expect(press([part({ id: 'box', pos: [0, 0, FLUSH - WALL_GAP - 0.005] })], ['box']).kind).not.toBe('there');
  });

  it('says a piece is there even when something overlaps it where it stands', () => {
    // Asked of the target before the target is judged: the press changes nothing, so
    // "will not fit against the nearest wall" would be about a wall it is already on.
    const world = [part({ id: 'box', pos: [0, 0, FLUSH] }), post('post', 0.3, -2.2)];
    expect(press(world, ['box'])).toEqual({ kind: 'there' });
  });
});

describe('Wall never turns a piece that has company', () => {
  // The crate faces north (rot 0), so its back is to the north wall; the west wall is
  // nearer. The stool is in front of it, where a chair stands at a desk.
  const crate = part({ id: 'box', pos: [-2, 0, 0] });
  const stool = part({ id: 'stool', pos: [-2, 0, 0.8] });

  it('alone, takes the nearest wall and turns to face the room', () => {
    const m = moved(press([crate], ['box']));
    expect(m.moves[0].pos[0]).toBeCloseTo(-3 + 0.2 + WALL_GAP, 9);
    expect(m.moves[0].rot).toBeCloseTo(Math.PI / 2, 9);
    expect(m.behind).toBe(false);
  });

  it('with company, takes the wall behind it, and the set arrives as it was', () => {
    // Turned to the west wall, the stool would arrive at the crate's end instead of
    // its front: valid, said nothing, and wrong.
    const m = moved(press([crate, stool], ['box', 'stool']));
    expect(posOf(m, 'box')).toEqual([-2, 0, FLUSH]);
    expect(m.moves[0].rot).toBeUndefined();
    expect(posOf(m, 'stool')).toEqual([-2, 0, expect.closeTo(0.8 + FLUSH, 9)]);
    expect(m.behind).toBe(true);
    expect(m.short).toBe(false);
  });

  it('takes the nearest of two walls behind it, and never one in front', () => {
    // An L whose notch is cut from the south-east: the notch's own wall faces north,
    // the way the south wall does. From the west half, both are behind a crate facing
    // north-to-south, and the notch's is the nearer (2.93 m against 3.28 m)…
    const L = footprintForLayout('l', 6, 5);
    const at = (pos: [number, number, number], st: [number, number, number]) =>
      moved(moveToWall({
        id: 'box',
        parts: [part({ id: 'box', pos, rot: Math.PI }), part({ id: 'stool', pos: st })],
        selection: ['box', 'stool'],
        restsOn: riderRelation([], {}),
        footprint: L,
        roomHeight: 2.5,
        memberHasPosOverride: () => false,
      }));
    const far = at([-2, 0, -1], [-2, 0, -1.8]);
    expect(far.moves[0].pos[0]).toBeCloseTo(0.68, 9);
    expect(far.moves[0].pos[2]).toBeCloseTo(0.4 - 0.2 - WALL_GAP, 9);
    // …while from the stem the notch's wall is in FRONT of it, through the corner, and
    // the wall it backs onto is the south one.
    const stem = at([0.2, 0, 0.7], [0.2, 0, 0.2]);
    expect(stem.moves[0].pos).toEqual([expect.closeTo(0.2, 9), 0, expect.closeTo(2.5 - 0.2 - WALL_GAP, 9)]);
  });

  it('refuses when no wall stands behind it', () => {
    const angled = { ...crate, rot: 0.4 };
    expect(press([angled, stool], ['box', 'stool'])).toEqual({ kind: 'refused', blocked: [], needsTurn: true });
  });
});

describe('Wall does not stand a piece on top of something taller than itself', () => {
  // The convoy's climb rule, for the lead. A 500 mm crate sent to a wall where a
  // sideboard stands would land on top of it; a bench lower than the crate is a step.
  const crate = part({ id: 'box', pos: [0, 0, -1.5] });
  const against = (id: string, h: number) =>
    part({ id, dimMM: [1200, 450, h], pos: [0, 0, -2.5 + 0.225 + WALL_GAP] });

  it('refuses a sideboard taller than the piece', () => {
    expect(press([crate, against('sb', 800)], ['box'])).toEqual({ kind: 'refused', blocked: [], refusal: 'blocked' });
  });

  it('steps up onto a bench lower than the piece', () => {
    const m = moved(press([crate, against('bench', 450)], ['box']));
    expect(posOf(m, 'box')![1]).toBeCloseTo(0.45, 9);
    expect(m.landings).toEqual([{ id: 'box', on: 'bench' }]);
  });
});

describe('what the panel says after a press', () => {
  const chair = part({ id: 'chair', name: 'Armchair' });
  const stool = part({ id: 'stool', name: 'Stool' });
  it.each<[WallMove, string | null]>([
    [{ kind: 'moved', moves: [], landings: [], short: false, behind: false }, null],
    [{ kind: 'moved', moves: [], landings: [], short: true, behind: false }, 'Desk stopped short of the wall, so the rest of the selection still fits.'],
    [{ kind: 'moved', moves: [], landings: [], short: false, behind: true }, 'Desk went to the wall behind it, so the rest of the selection did not have to turn.'],
    [{ kind: 'moved', moves: [], landings: [], short: true, behind: true }, 'Desk went to the wall behind it and stopped short, so the rest of the selection still fits.'],
    [{ kind: 'there' }, 'Desk is already against the nearest wall.'],
    [{ kind: 'refused', blocked: [chair] }, 'Nothing moved: Armchair will not fit there, so the rest of the selection cannot follow.'],
    [{ kind: 'refused', blocked: [chair, stool] }, 'Nothing moved: Armchair and Stool will not fit there, so the rest of the selection cannot follow.'],
    [{ kind: 'refused', blocked: [chair, stool, part({ id: 'x', name: 'Lamp' })] }, 'Nothing moved: Armchair, Stool and Lamp will not fit there, so the rest of the selection cannot follow.'],
    [{ kind: 'refused', blocked: [], needsTurn: true }, 'Nothing moved: Desk would have to turn to meet a wall, and the rest of the selection does not turn with it.'],
    [{ kind: 'refused', blocked: [], refusal: 'room' }, 'Desk will not fit against the nearest wall: it would stick out of the room.'],
    [{ kind: 'refused', blocked: [] }, 'Nothing moved: the selection has no room to reach the wall together.'],
  ])('%#', (move, said) => {
    expect(wallSentence('Desk', move)).toBe(said);
  });
});
