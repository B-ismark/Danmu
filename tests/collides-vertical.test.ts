import { describe, it, expect } from 'vitest';
import { collidesAt, type ScenePart } from '../lib/scene-spec';
import { verticalExtent } from '../lib/physics';

function part(p: Partial<ScenePart> & Pick<ScenePart, 'id' | 'dimMM' | 'pos'>): ScenePart {
  return {
    name: p.id,
    category: 'table',
    shape: 'coffee-table',
    rot: 0,
    locked: false,
    ...p,
  } as ScenePart;
}

/** A television on the wall at eye level. `groundY`'s `wall-mid` anchor makes
 *  `pos[1]` the mesh CENTRE, so this hangs across 1.05 m … 1.75 m — not
 *  1.40 m … 2.10 m, which is what `[y, y + h]` would say. */
const tv = part({
  id: 'tv',
  category: 'tv',
  shape: 'tv',
  pos: [1, 1.4, 1],
  dimMM: [1200, 60, 700],
  wallMounted: true,
});

/** A ceiling fan. Centred on its origin exactly like the television — and it
 *  carries NO `wallMounted` flag, because `ridesWall` is false for the ceiling
 *  family. It spans 2.20 m … 2.50 m, where `[y, y + h]` would say 2.35 … 2.65. */
const fan = part({
  id: 'fan',
  category: 'fan',
  shape: 'fan',
  pos: [1, 2.35, 1],
  dimMM: [1000, 1000, 300],
});

/** A floor-standing piece directly beneath both of them, `h` mm tall. Its own
 *  `pos[1]` really is a bottom, so its extent is `[0, h/1000]`. */
function wardrobe(h: number): ScenePart {
  return part({
    id: 'wardrobe',
    category: 'wardrobe',
    shape: 'wardrobe',
    pos: [1, 0, 1],
    dimMM: [1000, 600, h],
  });
}

const hits = (parts: ScenePart[], mover: ScenePart) =>
  collidesAt(parts, mover.id, mover.pos, mover.rot, mover.dimMM);

describe('vertical extents in collidesAt', () => {
  it('knows that pos[1] is a centre for a mounted piece and a bottom for a floor one', () => {
    // The whole fix in one assertion, and the one that makes the rest legible.
    // `toBeCloseTo` because 1.4 − 0.35 is 1.0499999999999998 in binary floating
    // point, which is the arithmetic being right rather than a tolerance being lax.
    const [tvBottom, tvTop] = verticalExtent('tv', 'tv', [1200, 60, 700], 1.4);
    expect(tvBottom).toBeCloseTo(1.05, 10);
    expect(tvTop).toBeCloseTo(1.75, 10);
    expect(verticalExtent('wardrobe', 'wardrobe', [1000, 600, 2000], 0)).toEqual([0, 2]);
    // A ceiling fan is centred too, and is the case no `wallMounted` flag covers.
    const [fanBottom, fanTop] = verticalExtent('fan', 'fan', [1000, 1000, 300], 2.35);
    expect(fanBottom).toBeCloseTo(2.2, 10);
    expect(fanTop).toBeCloseTo(2.5, 10);
  });

  it('lets a wall-mounted piece obstruct at all — a 2 m wardrobe cannot stand through the TV', () => {
    // `collidesAt` used to open its obstacle loop with `if (o.wallMounted) continue;`,
    // so NOTHING in the room could collide with a mounted television or a floating
    // shelf. This is that skip.
    const w = wardrobe(2000);
    expect(hits([tv, w], w)).toBe(true);
  });

  it('measures the TV from its centre, not its origin — a 1.2 m shelf under it clashes', () => {
    // This one fails even with the skip removed, if the extent stays `[y, y + h]`:
    // that arithmetic puts the television at 1.40…2.10 m, which a 1.2 m piece clears.
    // Its real underside is at 1.05 m and does not.
    const w = wardrobe(1200);
    expect(hits([tv, w], w)).toBe(true);
  });

  it('and still lets something fit underneath — 1.0 m clears a TV whose underside is 1.05 m', () => {
    const short = wardrobe(1000);
    expect(hits([tv, short], short)).toBe(false);

    // FIXTURE GUARD. The `false` above has to be about height. If these two did not
    // share any floor, it would pass for a reason that has nothing to do with the
    // change — so the same piece, made tall enough to reach, must collide.
    const tall = wardrobe(1200);
    expect(hits([tv, tall], tall)).toBe(true);
  });

  it('measures a ceiling fan the same way, which no skip was ever hiding', () => {
    // The fan was never skipped — `wallMounted` is undefined on it — so this is the
    // extent defect with nothing else in front of it. Real span 2.20…2.50 m.
    const w = wardrobe(2300);
    expect(hits([fan, w], w)).toBe(true);

    // FIXTURE GUARD, two halves. The fan must genuinely carry no flag, or the
    // assertion above would be a second copy of the skip test…
    expect(fan.wallMounted).toBeUndefined();
    // …and the bar must be a boundary rather than "everything collides now": 2.1 m
    // passes under a fan whose blades start at 2.20 m.
    const under = wardrobe(2100);
    expect(hits([fan, under], under)).toBe(false);
  });

  it('measures the MOVER from its centre too, not only the obstacle', () => {
    // The dragged piece is the television itself, over a 1.2 m sideboard. Its real
    // underside is 1.05 m and clashes; `[y, y + h]` puts it at 1.40 m and does not.
    const w = wardrobe(1200);
    expect(hits([tv, w], tv)).toBe(true);
  });
});
