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
    expect(press(world, ['box', 'chair'])).toEqual({ kind: 'refused', blockedIds: [] });
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
    expect(m.kind === 'refused' && m.blocked?.id).toBe('chair');
    expect(m.kind === 'refused' && m.blockedIds).toEqual(['chair']);
  });

  it('refuses a wall spot that is already taken, with its reason', () => {
    const world = [part({ id: 'box', pos: [0, 0, -1.5] }), post('post', 0, FLUSH)];
    const m = press(world, ['box']);
    expect(m).toEqual({ kind: 'refused', refusal: 'blocked', blockedIds: [] });
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

  it('turns a piece in place without stamping the rest of the selection', () => {
    // Flush already, but facing the wall: a square piece turns about its own centre and
    // does not travel, so a member that was never moved is not written.
    const world = [part({ id: 'box', pos: [0, 0, FLUSH], rot: Math.PI }), part({ id: 'chair', pos: [1.5, 0, 0] })];
    const m = moved(press(world, ['box', 'chair']));
    expect(m.moves.map((mv) => mv.id)).toEqual(['box']);
    expect(m.moves[0].pos).toEqual([0, 0, FLUSH]);
    expect(m.moves[0].rot).toBeCloseTo(0, 12);
    // …and one that was is put back where it stands, which is a write it already has.
    const again = moved(press(world, ['box', 'chair'], { overridden: ['chair'] }));
    expect(again.moves.find((mv) => mv.id === 'chair')!.pos).toEqual([1.5, 0, 0]);
  });
});

describe('what the panel says after a press', () => {
  const chair = part({ id: 'chair', name: 'Armchair' });
  it.each<[WallMove, string | null]>([
    [{ kind: 'moved', moves: [], landings: [], short: false }, null],
    [{ kind: 'moved', moves: [], landings: [], short: true }, 'Desk stopped short of the wall, so the rest of the selection still fits.'],
    [{ kind: 'there' }, 'Desk is already against the nearest wall.'],
    [{ kind: 'refused', blocked: chair, blockedIds: ['chair'] }, 'Nothing moved: Armchair has no room to follow.'],
    [{ kind: 'refused', refusal: 'room', blockedIds: [] }, 'Desk will not fit against the nearest wall: it would stick out of the room.'],
    [{ kind: 'refused', blockedIds: [] }, 'Nothing moved: the selection has no room to reach the wall together.'],
  ])('%#', (move, said) => {
    expect(wallSentence('Desk', move)).toBe(said);
  });
});
