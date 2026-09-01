// § 32 — a piece added from the Library was square-footed, whatever shape it was.
//
// The defect was never "the fan is drawn wrong". It was that the SAME shape got a
// different footprint depending on how it entered the room: the detection builder read
// `CATEGORY_DEFAULTS.circle`, the seeder wrote four `{ circle: true }` literals by hand,
// and the add path had no answer at all because `LibraryItem` has no such field. So a
// ceiling fan found in a photograph was a circle and one added from the picker was a
// square — confirmed in the plan by eye before this was written.
//
// Every assertion below therefore compares ROUTES against each other rather than
// checking one route against a literal. A test that only asserted "the fan is round"
// would have passed on the broken code for the detection path and never asked the
// question that mattered.

import { describe, it, expect } from 'vitest';
import {
  PART_LIBRARY,
  CATALOG_SHAPES_ORDERED,
  isRoundPart,
  normalizeStoredParts,
  defaultScene,
  buildSceneFromRoom,
  type ScenePart,
  type Shape,
} from '@/lib/scene-spec';
import { footprintForLayout } from '@/lib/footprint';
import { footArea, footFromPart } from '@/lib/geometry';

const stored = (o: Partial<ScenePart> & Pick<ScenePart, 'shape'>): ScenePart =>
  ({
    id: 'x',
    name: 'x',
    category: 'other',
    pos: [0, 0, 0],
    rot: 0,
    dimMM: [500, 500, 500],
    ...o,
  }) as ScenePart;

describe('§ 32 · roundness is a property of the shape, so every route agrees', () => {
  it('gives a persisted part the shape’s answer, not the file’s', () => {
    // A room saved before `ROUND_SHAPES` existed holds `circle` only where the detection
    // path happened to set it. Both directions: a missing flag is added, a wrong one is
    // corrected.
    const [addedRound] = normalizeStoredParts([stored({ shape: 'fan', category: 'fan' })]);
    expect(addedRound.circle, 'a stored fan with no flag must come back round').toBe(true);

    const [strippedSquare] = normalizeStoredParts([
      stored({ shape: 'wardrobe', category: 'wardrobe', circle: true }),
    ]);
    expect(strippedSquare.circle, 'a stored wardrobe claiming roundness must not keep it').toBeUndefined();
  });

  it('leaves a part that already agrees alone, by identity', () => {
    // `normalizeStoredParts` returns the same object when nothing changes, and the whole
    // memoised part list depends on that. Adding a second derived field is exactly how
    // that gets broken without anyone noticing.
    const same = stored({ shape: 'fan', category: 'fan', circle: true, wallMounted: true });
    expect(normalizeStoredParts([same])[0]).toBe(same);

    const flat = stored({ shape: 'wardrobe', category: 'wardrobe' });
    expect(normalizeStoredParts([flat])[0]).toBe(flat);
  });

  it('corrects one field without discarding the other', () => {
    // Each field must be corrected without discarding the other. Written when the
    // normaliser had a third arm that fixed `circle` alone; this test is what showed the
    // arm was dead, because the final arm sets BOTH correctly and nothing could tell the
    // two apart. Two arms now: agree, or rebuild.
    const [p] = normalizeStoredParts([
      stored({ shape: 'fan', category: 'fan', wallMounted: true }),
    ]);
    expect(p.circle, 'circle added').toBe(true);
    expect(p.wallMounted, 'and the mount flag survived').toBe(true);

    const [q] = normalizeStoredParts([stored({ shape: 'fan', category: 'fan', circle: true })]);
    expect(q.circle, 'circle kept').toBe(true);
    expect(q.wallMounted, 'and the mount flag was derived').toBe(true);
  });

  it('agrees with the seeded rooms, which used to hand-write the flag', () => {
    // Four `{ circle: true }` literals lived in the seeder. They are gone; these are the
    // pieces they were for, and any seeded piece whose shape is round must now be round
    // without anyone having typed it.
    const poly = footprintForLayout('rect', 6, 4);
    const parts = defaultScene('rect', 6, 4, { footprint: poly, height: 2.8 });
    expect(parts.length, 'the seeder must produce a room to check').toBeGreaterThan(5);
    const wrong = parts.filter((p) => !!p.circle !== isRoundPart(p.shape));
    expect(
      wrong.map((p) => `${p.name}/${p.shape}`),
      'a seeded piece disagrees with its own shape',
    ).toEqual([]);
    expect(
      parts.some((p) => p.circle),
      'the rect preset seeds at least one round piece, or this proves nothing',
    ).toBe(true);
  });


  it('makes a DETECTED round piece round, which is the path that already worked', () => {
    // The survivor of the mutation run: setting `circle: undefined` in the detection
    // builder killed nothing, because the seeded test above uses `defaultScene` and
    // `buildSceneFromRoom` short-circuits an empty detection list into it. So this one
    // has to supply a real detection, or it is testing the other function again.
    //
    // It matters in-session rather than after a reload: `normalizeStoredParts` would
    // correct it on the next load, so the window is exactly the session in which the
    // user detected the room — which is when they are looking at it.
    const parts = buildSceneFromRoom({
      id: 'r1', createdAt: 0, name: 'Detected', layoutId: 'rect',
      width: 5, depth: 4, height: 2.8,
      detectedObjects: [
        { id: 0, label: 'ceiling fan__slot:n', conf: 0.9, locked: false, box: [0.4, 0.1, 0.2, 0.2], category: 'fan' },
        { id: 1, label: 'wardrobe__slot:n', conf: 0.9, locked: false, box: [0.1, 0.3, 0.2, 0.4], category: 'wardrobe' },
      ],
    } as never);
    const fan = parts.find((p) => p.shape === 'fan');
    const wardrobe = parts.find((p) => p.shape === 'wardrobe');
    expect(fan, 'the detection fixture must produce a fan, or this asserts nothing').toBeDefined();
    expect(wardrobe, 'and a wardrobe to contrast it with').toBeDefined();
    expect(fan!.circle, 'a detected ceiling fan is round').toBe(true);
    expect(wardrobe!.circle, 'a detected wardrobe is not').toBeUndefined();
  });

  it('makes a round footprint actually smaller than its box', () => {
    // The point of the flag, and the reason it is not cosmetic: `footArea` is π/4 of the
    // box for a circle, and clearance, overlap and picking all read it.
    const box = footFromPart([0, 0, 0], 0, [1000, 1000, 500], false);
    const disc = footFromPart([0, 0, 0], 0, [1000, 1000, 500], true);
    expect(footArea(disc) / footArea(box)).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe('§ 32 · which shapes are round is a decision, and it is pinned', () => {
  it('names them, both the members and the deliberate non-members', () => {
    // Pinned exactly rather than as "at least these", because the failure this guards is
    // a shape being ADDED to the set on a hunch. `mirror-oval` is the one that keeps
    // wanting to join: it is oval on the WALL and a thin rectangle in plan.
    const round = CATALOG_SHAPES_ORDERED.filter(isRoundPart);
    expect([...round].sort()).toEqual(
      ['fan', 'fan-standing', 'lamp-floor', 'lamp-pendant', 'lamp-table', 'plant', 'stool'].sort(),
    );
    for (const s of ['mirror-oval', 'side-table', 'ottoman', 'coffee-table'] as Shape[]) {
      expect(isRoundPart(s), `${s} is deliberately NOT round — see the ROUND_SHAPES note`).toBe(false);
    }
  });

  it('covers the Library rows the user actually sees', () => {
    const roundLabels = PART_LIBRARY.filter((i) => isRoundPart(i.shape)).map((i) => i.label);
    // The ceiling fan is the piece § 32 was written about: round when detected, square
    // when added, for the whole life of the add path.
    expect(roundLabels).toContain('Ceiling fan');
    expect(roundLabels).toContain('Standing fan');
    expect(roundLabels).toContain('Stool');
    expect(roundLabels.length, 'and it is a handful, not most of the catalogue').toBe(7);
  });
});

describe('§ 32 · the route that was actually broken', () => {
  it('makes a piece added from the Library round, which is the whole defect', async () => {
    // THE regression test. `LibraryItem` has no `circle` field and `spawn` never set one,
    // so this is the path that produced a square ceiling fan for the entire life of the
    // add path — while the same fan found in a photograph came out round.
    const { useScene } = await import('@/lib/scene-store');
    useScene.getState().setParts([]);
    useScene.getState().addPart(
      stored({ id: 'f1', name: 'Ceiling fan', category: 'fan', shape: 'fan', dimMM: [1000, 1000, 200] }),
    );
    useScene.getState().addPart(
      stored({ id: 'w1', name: 'Wardrobe', category: 'wardrobe', shape: 'wardrobe' }),
    );
    const parts = useScene.getState().parts;
    expect(parts.find((p) => p.id === 'f1')?.circle, 'an added ceiling fan must be round').toBe(true);
    expect(parts.find((p) => p.id === 'w1')?.circle, 'and an added wardrobe must not be').toBeUndefined();
  });

  it('derives it for an imported file rather than believing the bytes', async () => {
    // Same trust boundary `clampDims` draws for a size and `isWallMountedPart` for the
    // mount flag: a file has nothing to say about a property of the shape. Both
    // directions, since the absent one is the likelier — a file written before
    // `ROUND_SHAPES` existed simply omits it.
    const { parseSceneFile, buildSceneFile } = await import('@/lib/scene-file');
    const text = JSON.stringify(
      buildSceneFile(
        { name: 'r', layoutId: 'rect', width: 5, depth: 4, height: 2.8 } as never,
        [
          stored({ id: 'f1', name: 'Fan', category: 'fan', shape: 'fan', circle: undefined }),
          stored({ id: 'w1', name: 'Wardrobe', category: 'wardrobe', shape: 'wardrobe', circle: true }),
        ],
        { positions: {}, rotations: {}, dims: {} } as never,
        0,
      ),
    );
    const out = parseSceneFile(text);
    expect(out.ok, `the fixture must parse, or this asserts nothing: ${!out.ok && out.error}`).toBe(true);
    const parts = out.ok ? out.file.parts : [];
    expect(parts.length, 'both parts must survive the read').toBe(2);
    expect(parts.find((p) => p.id === 'f1')?.circle, 'a file omitting it still gets a round fan').toBe(true);
    expect(
      parts.find((p) => p.id === 'w1')?.circle,
      'and a file asserting it on a wardrobe is refused',
    ).toBeUndefined();
  });
});
