import { describe, expect, it } from 'vitest';
import { FAN_HUB_H, FAN_HUB_R, fanBlade, fanColumn, lightAnchor, pendantDrop } from '@/lib/scene-spec';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { groundY, heightForNewCeiling, MOUNT_PAD, verticalExtent } from '@/lib/physics';
import { ROOM_HEIGHT_M } from '@/lib/dimension-ranges';

/** Every height in a shape's legal band, at 10 mm — the band is the assertion,
 *  because picking examples is how the first version of `fanBlade` was missed.
 *
 *  Tested in its own right below rather than trusted. A sweep is worth exactly what
 *  its generator is, and this one's start, step and end were all free: `let v = min`
 *  -> `min + 10` survived every caller and silently stopped exercising 150 mm, which
 *  is the bottom of BOTH bands and the only place either helper's cap branch binds. */
function band(min: number, max: number): number[] {
  if (max < min) throw new RangeError(`band(${min}, ${max}) is inverted`);
  const out: number[] = [];
  for (let v = min; v <= max; v += 10) out.push(v);
  // `!==` on floats would either duplicate `max` or leave a tail gap on a
  // non-integer range. Every range here is whole millimetres, so this is hardening
  // against a future caller rather than a fix.
  if (Math.abs(out[out.length - 1] - max) > 1e-9) out.push(max);
  return out;
}

describe('the sweep generator, which four tests iterate and none of them held', () => {
  it('starts at the minimum, steps by 10 mm, and ends at the maximum', () => {
    const b = band(150, 450);
    expect(b.length, 'a 300 mm span at 10 mm').toBe(31);
    expect(b[0], 'it must START at the minimum — that is where both caps bind').toBe(150);
    expect(b[b.length - 1], '…and end at the maximum').toBe(450);
    expect(b[1] - b[0], 'in 10 mm steps').toBe(10);
    expect(new Set(b).size, 'no duplicates').toBe(31);
  });

  it('reaches the maximum of a ragged span, and refuses an inverted one', () => {
    expect(band(150, 455).at(-1), 'a span that is not a whole number of steps').toBe(455);
    expect(band(150, 455).length, '…gains one short final step').toBe(32);
    expect(() => band(450, 150), 'inverted throws rather than degrading to one value').toThrow();
  });
});

const FAN = dimRangeFor('fan', 'fan');
const PENDANT = dimRangeFor('lamp', 'lamp-pendant');

describe('the ceiling fan is drawn at the height it declares', () => {
  it('spans exactly its declared height, centred on its origin, across the whole band', () => {
    const heights = band(FAN.min[2], FAN.max[2]);
    expect(heights.length, 'the sweep must have something in it').toBeGreaterThan(20);
    for (const hMM of heights) {
      const c = fanColumn(hMM);
      expect(c.top - c.bottom, `${hMM} mm: drawn height`).toBeCloseTo(hMM / 1000, 9);
      // Centred, because a ceiling anchor's `pos[1]` is the mesh CENTRE. This is
      // the half the old drawing got wrong even where the total was close.
      expect(c.top, `${hMM} mm: top`).toBeCloseTo(hMM / 2000, 9);
      expect(c.bottom, `${hMM} mm: bottom`).toBeCloseTo(-hMM / 2000, 9);
    }
  });

  it('is anchored the way every consumer assumes — centred, not standing on a floor', () => {
    // `verticalExtent`'s non-floor branch IS `[y - h/2, y + h/2]`, so this is not
    // independent evidence about the arithmetic, and calling it that overstated the
    // case. What it pins, and nothing else does, is that `anchorFor` still answers
    // something other than 'floor' for this shape: flip that and a ceiling fan is
    // measured from its own base while the sweep above stays green.
    for (const hMM of band(FAN.min[2], FAN.max[2])) {
      const y = 2.6;
      const c = fanColumn(hMM);
      const [lo, hi] = verticalExtent('fan', 'fan', [1000, 1000, hMM], y);
      expect(y + c.bottom, `${hMM} mm`).toBeCloseTo(lo, 9);
      expect(y + c.top, `${hMM} mm`).toBeCloseTo(hi, 9);
    }
  });

  it('tiles the height between housing and downrod, leaving no gap and no overlap', () => {
    for (const hMM of band(FAN.min[2], FAN.max[2])) {
      const c = fanColumn(hMM);
      expect(c.hubH + c.rodH, `${hMM} mm`).toBeCloseTo(hMM / 1000, 9);
      // …and each piece is where its own half-height says it is.
      expect(c.hubY - c.hubH / 2, `${hMM} mm: hub bottom`).toBeCloseTo(c.bottom, 9);
      expect(c.rodY + c.rodH / 2, `${hMM} mm: rod top`).toBeCloseTo(c.top, 9);
      expect(c.hubY + c.hubH / 2, `${hMM} mm: they meet`).toBeCloseTo(c.rodY - c.rodH / 2, 9);
    }
  });

  it('keeps the housing at full thickness once there is room, and caps it when there is not', () => {
    // Both sides of the cap, which is the only branch in the function. A one-ended
    // sweep would leave `Math.min` free to be either argument alone.
    //
    // **Against LITERALS, not against `FAN_HUB_H`.** The first version of this test
    // asserted `fanColumn(450).hubH` equalled the constant it is computed from, which
    // is an assertion measuring its own subject: moving the constant 80 -> 120 mm left
    // this file green, because `Math.min` still picked the same arm at both ends of the
    // band. Measured, not reasoned - it survived the mutation.
    expect(FAN_HUB_H, 'the housing is 80 mm, and that is a decision').toBeCloseTo(0.08, 9);
    expect(fanColumn(450).hubH, 'a tall fan keeps the full housing').toBeCloseTo(0.08, 9);
    expect(fanColumn(450).rodH, '…and spends the rest on downrod').toBeCloseTo(0.37, 9);
    expect(fanColumn(150).hubH, 'a 150 mm fan cannot spare 80 mm for its motor').toBeCloseTo(0.06, 9);
    expect(fanColumn(150).rodH).toBeCloseTo(0.09, 9);
    expect(fanColumn(150).hubH, 'the cap really is below the nominal').toBeLessThan(FAN_HUB_H);
  });

  it('changes hands at exactly the height where the two arms meet', () => {
    // The crossover is `FAN_HUB_H / 0.4` = 200 mm, and pinning it is what actually
    // holds the constant's VALUE: either arm alone is satisfied by the band's ends.
    expect(fanColumn(200).hubH, 'at 200 mm the two arms are equal').toBeCloseTo(0.08, 9);
    expect(fanColumn(210).hubH, 'above it, the nominal thickness wins').toBeCloseTo(0.08, 9);
    expect(fanColumn(190).hubH, 'below it, the height wins').toBeCloseTo(0.076, 9);
    expect(fanColumn(190).hubH, '…which is strictly thinner').toBeLessThan(0.08);
  });

  it('never draws a blade thicker than the housing that carries it', () => {
    // Against `fanBlade`'s own `thickness`, not a copy of it. This read a re-typed
    // `0.012`, so moving the renderer's literal to 200 mm - a blade three times its
    // own motor, exactly the condition named - left the assertion green. Measured.
    for (const wMM of [FAN.min[0], 1000, FAN.max[0]]) {
      expect(fanColumn(FAN.min[2]).hubH, `${wMM} mm wide`)
        .toBeGreaterThan(fanBlade(wMM).thickness);
    }
    expect(fanBlade(1000).thickness, 'the blade is 12 mm thick, and that is a decision')
      .toBeCloseTo(0.012, 9);
    expect(fanBlade(1000).chord, 'and 160 mm deep').toBeCloseTo(0.16, 9);
    expect(fanBlade(900).thickness, 'neither is a function of the fan’s width')
      .toBeCloseTo(fanBlade(1500).thickness, 9);
  });

  it('leaves the swept circle to `fanBlade` and does not touch it', () => {
    // The two axes are separate functions on purpose; this pins that the vertical
    // one has not started having opinions about the horizontal one.
    expect(fanBlade(1000).tip).toBeCloseTo(0.5, 9);
    expect(FAN_HUB_R).toBeCloseTo(0.1, 9);
  });
});

describe('the pendant emits its light from where it draws its bulb', () => {
  // There was no test of `lightAnchor` — or of the `LIGHT_ANCHORS` table it grew
  // out of — anywhere in the repo, which is why a hand-typed copy of the bulb's
  // position could go stale the moment the bulb started deriving from `dimMM`. The
  // table's own docblock had said "these track the geometry in DynamicPart" the
  // whole time. A contract written down and never gated is the shape this repo
  // keeps finding.
  it('is the same number the mesh is drawn from, at every size in the band', () => {
    const sizes = band(PENDANT.min[2], PENDANT.max[2]);
    expect(sizes.length, 'the sweep has something in it').toBeGreaterThan(20);
    for (const hMM of sizes) {
      for (const wMM of [PENDANT.min[0], 350, PENDANT.max[0]]) {
        const [x, y, z] = lightAnchor('lamp-pendant', [wMM, wMM, hMM]);
        expect(y, `${wMM}x${hMM}`).toBeCloseTo(pendantDrop(wMM, hMM).bulbY, 9);
        expect([x, z], `${wMM}x${hMM}: on the axis`).toEqual([0, 0]);
      }
    }
  });

  it('moves when the size moves — which the old constant did not', () => {
    // The mutation that matters is "put the literal back": every size collapsing to
    // one answer is exactly the defect, so the assertion has to be that two sizes
    // DISAGREE, not merely that each matches.
    const small = lightAnchor('lamp-pendant', [350, 350, 150])[1];
    const large = lightAnchor('lamp-pendant', [350, 350, 900])[1];
    expect(small, 'a 150 mm pendant').toBeCloseTo(-0.042, 3);
    expect(large, 'a 900 mm one hangs its bulb far lower').toBeCloseTo(-0.3345, 4);
    expect(large, 'and the two are nowhere near each other').toBeLessThan(small - 0.25);
  });

  it('keeps the source inside the shade, never on the bare cord above it', () => {
    // The user-visible half. At 350x900 the old constant sat 190 mm ABOVE the
    // shade's rim: a 110-degree spot emitting from a point on the cord, with its
    // own shade underneath it as an occluder.
    for (const hMM of band(PENDANT.min[2], PENDANT.max[2])) {
      for (const wMM of [PENDANT.min[0], 350, PENDANT.max[0]]) {
        const g = pendantDrop(wMM, hMM);
        const y = lightAnchor('lamp-pendant', [wMM, wMM, hMM])[1];
        const rim = g.domeY + g.domeH / 2;
        expect(y, `${wMM}x${hMM}: below the shade's rim`).toBeLessThan(rim);
        expect(y, `${wMM}x${hMM}: and above the shade's mouth`).toBeGreaterThan(g.bottom);
      }
    }
  });

  it('leaves the two fixtures whose bulbs really are constants alone', () => {
    // `lamp-table` and `lamp-floor` draw their bulbs at literals, so a constant is
    // the honest answer for them and the table is the right home. Pinned so that
    // "derive everything" does not silently move them too.
    expect(lightAnchor('lamp-table', [400, 400, 500])).toEqual([0, 0.4, 0]);
    expect(lightAnchor('lamp-table', [250, 250, 900]), 'and does not vary with size')
      .toEqual([0, 0.4, 0]);
    expect(lightAnchor('lamp-floor', [400, 400, 1500])).toEqual([0, 1.66, 0]);
    expect(lightAnchor('sofa', [2000, 900, 800]), 'anything else sits at its origin')
      .toEqual([0, 0, 0]);
  });
});

describe('the pendant lamp is drawn at the size it declares', () => {
  it('spans exactly its declared drop, centred on its origin, across the whole band', () => {
    const heights = band(PENDANT.min[2], PENDANT.max[2]);
    expect(heights.length).toBeGreaterThan(20);
    for (const hMM of heights) {
      const g = pendantDrop(350, hMM);
      expect(g.top - g.bottom, `${hMM} mm: drawn drop`).toBeCloseTo(hMM / 1000, 9);
      expect(g.top, `${hMM} mm: top`).toBeCloseTo(hMM / 2000, 9);
      expect(g.bottom, `${hMM} mm: bottom`).toBeCloseTo(-hMM / 2000, 9);
    }
  });

  it('is anchored the way `clearance.ts` assumes when it reports a clash', () => {
    // Same as the fan's above: what this holds is the ANCHOR, not the arithmetic.
    for (const hMM of band(PENDANT.min[2], PENDANT.max[2])) {
      const y = 2.5;
      const g = pendantDrop(350, hMM);
      const [lo, hi] = verticalExtent('lamp', 'lamp-pendant', [350, 350, hMM], y);
      expect(y + g.bottom, `${hMM} mm`).toBeCloseTo(lo, 9);
      expect(y + g.top, `${hMM} mm`).toBeCloseTo(hi, 9);
    }
  });

  it('tiles the drop between cord and shade', () => {
    for (const hMM of band(PENDANT.min[2], PENDANT.max[2])) {
      const g = pendantDrop(350, hMM);
      expect(g.cordH + g.domeH, `${hMM} mm`).toBeCloseTo(hMM / 1000, 9);
      expect(g.domeY - g.domeH / 2, `${hMM} mm: shade bottom`).toBeCloseTo(g.bottom, 9);
      expect(g.cordY + g.cordH / 2, `${hMM} mm: cord top`).toBeCloseTo(g.top, 9);
      expect(g.domeY + g.domeH / 2, `${hMM} mm: they meet`).toBeCloseTo(g.cordY - g.cordH / 2, 9);
    }
  });

  it('takes its WIDTH from the declared width, which the old drawing ignored entirely', () => {
    // The whole horizontal axis was the literal 0.15 — a 300 mm shade on a piece
    // declaring 350, and the same 300 mm shade on one declaring 800.
    for (const wMM of [PENDANT.min[0], 350, 600, PENDANT.max[0]]) {
      expect(pendantDrop(wMM, 400).domeR, `${wMM} mm wide`).toBeCloseTo(wMM / 2000, 9);
    }
  });

  it('keeps the bulb inside the shade at both ends of the band', () => {
    for (const hMM of band(PENDANT.min[2], PENDANT.max[2])) {
      for (const wMM of [PENDANT.min[0], PENDANT.max[0]]) {
        const g = pendantDrop(wMM, hMM);
        expect(g.bulbY - g.bulbR, `${wMM}x${hMM}: bulb bottom`).toBeGreaterThan(g.bottom);
        expect(g.bulbY + g.bulbR, `${wMM}x${hMM}: bulb top`).toBeLessThan(g.domeY + g.domeH / 2);
        expect(g.bulbR, `${wMM}x${hMM}: bulb fits the shade mouth`).toBeLessThan(g.domeR);
        // …and a FLOOR, which the three above are not. Every one of them is an upper
        // bound, so all three are satisfied by a smaller bulb and by NO bulb: `bulbR`
        // -> `domeH * 0` survived this sweep and deleted the light from the scene,
        // because `PendantLampGeo` renders `sphereGeometry args={[g.bulbR, …]}`.
        expect(g.bulbR, `${wMM}x${hMM}: there IS a bulb`).toBeGreaterThan(g.domeH * 0.2);
      }
    }
  });

  it('pins the bulb at the two sizes where each arm of its cap binds', () => {
    // A sweep cannot pin a `Math.min` - it holds wherever the answer is small enough.
    // These are the sizes where the binding arm is known, so each coefficient is held
    // from both sides by a number that changes when it moves.
    const tall = pendantDrop(800, 900);
    expect(tall.domeH, 'the biggest legal pendant: 0.4h binds the shade').toBeCloseTo(0.36, 9);
    expect(tall.bulbR, '0.3r = 0.12 is under 0.35 x 0.36 = 0.126, so WIDTH binds the bulb')
      .toBeCloseTo(0.12, 9);
    const squat = pendantDrop(800, 150);
    expect(squat.domeH, 'the widest, shortest one: 0.4h again').toBeCloseTo(0.06, 9);
    expect(squat.bulbR, '0.35 x 0.06 is far under 0.3r, so the SHADE binds')
      .toBeCloseTo(0.021, 9);
  });

  it('hangs the bulb in the lower half of the shade, not against either end', () => {
    // The `0.55` was free across roughly (0.35, 0.65). Substitute the coefficients
    // into the containment sweep above and it reduces to `0.35 < 0.55` - a comparison
    // between two literals, run 152 times, depending on neither `w` nor `h`. This is
    // what actually holds the placement.
    for (const [wMM, hMM] of [[350, 400], [150, 900], [800, 150]] as const) {
      const g = pendantDrop(wMM, hMM);
      const intoShade = (g.bulbY - g.bottom) / g.domeH;
      expect(intoShade, `${wMM}x${hMM}: how far up the shade the bulb sits`).toBeCloseTo(0.55, 9);
    }
  });

  it('caps the shade against its own width, so a long drop is a cord and not a spike', () => {
    // Both arguments of the `Math.min` reached, which one end of the band cannot do.
    const wide = pendantDrop(800, 900);
    expect(wide.domeH, 'the biggest legal pendant: 0.4h = 0.36 under 1.2r = 0.48, so h binds')
      .toBeCloseTo(0.36, 9);
    const narrow = pendantDrop(150, 900);
    expect(narrow.domeH, 'width binds on a narrow, long pendant').toBeCloseTo(0.09, 9);
    expect(narrow.cordH, '…and the rest is cord').toBeCloseTo(0.81, 9);
    const squat = pendantDrop(800, 150);
    expect(squat.domeH, 'height binds on a wide, short one').toBeCloseTo(0.06, 9);
  });
});

describe('a hung fixture reaches the ceiling it hangs from', () => {
  // **The comparison nothing in this repo made.** Every clause above measures a fixture
  // against its own `dimMM`, and so does `verticalExtent`, `clearance.ts` and the whole
  // shape contract — which is exactly why a 50 mm gap under the slab could sit in the
  // shipping catalogue with every gate green. This is between the fixture and the ROOM.
  //
  // It was `Math.min(roomHeight - 0.15, roomHeight - MOUNT_PAD - h / 2)`. The arms cross
  // at h = 260 mm, so the sweep alone cannot hold it — above the crossover both the old
  // and the new code give the same answer, and a test that only walked the band would
  // have been green against the defect. The pins below sit where the flat arm bound.
  const H = 2.8;
  const shapes: Array<{ label: string; cat: 'fan' | 'lamp'; shape: 'fan' | 'lamp-pendant';
                        range: ReturnType<typeof dimRangeFor> }> = [
    { label: 'ceiling fan', cat: 'fan', shape: 'fan', range: FAN },
    { label: 'pendant', cat: 'lamp', shape: 'lamp-pendant', range: PENDANT },
  ];

  it('hangs its TOP exactly MOUNT_PAD below the slab, at every size in both bands', () => {
    for (const { label, cat, shape, range } of shapes) {
      const sizes = band(range.min[2], range.max[2]);
      expect(sizes.length, `${label}: the sweep has something in it`).toBeGreaterThan(10);
      for (const hMM of sizes) {
        const dim: [number, number, number] = [range.min[0], range.min[1], hMM];
        const y = groundY(cat, shape, dim, H);
        const [bottom, top] = verticalExtent(cat, shape, dim, y);
        expect(top, `${label} ${hMM} mm: top against the slab`).toBeCloseTo(H - MOUNT_PAD, 9);
        expect(top, `${label} ${hMM} mm: and never THROUGH it`).toBeLessThan(H);
        expect(top - bottom, `${label} ${hMM} mm: it still declares its own height`)
          .toBeCloseTo(hMM / 1000, 9);
      }
    }
  });

  it('does the same at every legal ceiling height, not only at 2.8 m', () => {
    // A room is 1.8–12 m; the old flat arm was written for one of those.
    const heights = [ROOM_HEIGHT_M.min, 2.2, 2.4, 2.8, 3.5, 6, ROOM_HEIGHT_M.max];
    for (const rh of heights) {
      for (const { label, cat, shape, range } of shapes) {
        for (const hMM of [range.min[2], 200, 260, range.max[2]]) {
          const dim: [number, number, number] = [range.min[0], range.min[1], hMM];
          const top = verticalExtent(cat, shape, dim, groundY(cat, shape, dim, rh))[1];
          expect(top, `${label} ${hMM} mm in a ${rh} m room`).toBeCloseTo(rh - MOUNT_PAD, 9);
        }
      }
    }
  });

  it('closes the gap the flat 150 mm arm left — pinned where that arm bound', () => {
    // Values, not shape. Each of these was the OLD answer, and each is what a user saw.
    const fanShips: [number, number, number] = [1000, 1000, 200];
    expect(groundY('fan', 'fan', fanShips, H), 'the Library ceiling fan, as it ships')
      .toBeCloseTo(2.68, 9);
    expect(groundY('fan', 'fan', fanShips, H), '…and NOT the old 2.65').not.toBeCloseTo(2.65, 9);
    expect(verticalExtent('fan', 'fan', fanShips, groundY('fan', 'fan', fanShips, H))[1],
      'its downrod used to stop 50 mm short').toBeCloseTo(2.78, 9);

    const small: [number, number, number] = [900, 900, 150];
    expect(verticalExtent('fan', 'fan', small, groundY('fan', 'fan', small, H))[1],
      'the smallest legal fan used to stop 75 mm short').toBeCloseTo(2.78, 9);

    // The crossover itself: at h = 260 mm the two old arms agreed, so this size is the
    // one a regression would keep green. Above it nothing moved at all.
    const at260: [number, number, number] = [1000, 1000, 260];
    expect(groundY('fan', 'fan', at260, H), 'where the old arms crossed').toBeCloseTo(2.65, 9);
    const tall: [number, number, number] = [800, 800, 900];
    expect(groundY('lamp', 'lamp-pendant', tall, H), 'the biggest pendant never moved')
      .toBeCloseTo(2.33, 9);
  });

  it('is a FIXED POINT of the clamp that runs on every ceiling change', () => {
    // The reason `MOUNT_PAD` is in the expression rather than zero. A bare
    // `roomHeight - h / 2` sits 20 mm over `heightForNewCeiling`'s own cap, so each pass
    // would pull the fixture down again and a room would creep on every load.
    for (const { label, cat, shape, range } of shapes) {
      for (const hMM of band(range.min[2], range.max[2])) {
        const dim: [number, number, number] = [range.min[0], range.min[1], hMM];
        const y = groundY(cat, shape, dim, H);
        expect(heightForNewCeiling(cat, shape, dim, y, H, H),
          `${label} ${hMM} mm: a re-settle at the same height must not move it`)
          .toBeCloseTo(y, 9);
        // …and after a real ceiling change it lands where a fresh placement would.
        expect(heightForNewCeiling(cat, shape, dim, y, H, 3.2),
          `${label} ${hMM} mm: raising the ceiling agrees with groundY`)
          .toBeCloseTo(groundY(cat, shape, dim, 3.2), 9);
      }
    }
  });

  it('leaves every other anchor exactly where it was', () => {
    // The guard against fixing this one anchor too widely. `wall-high` has its own two
    // pads (0.05 and 0.1) and its own reason — a curtain rod is mounted below the slab,
    // not against it — so it is NOT the same defect and must not follow.
    expect(groundY('curtain', 'curtain', [1400, 80, 2200], H), 'a curtain')
      .toBeCloseTo(Math.min(H - 1.1 - 0.05, H - 0.1), 9);
    expect(groundY('ac', 'ac-unit', [800, 200, 300], H), 'an AC unit')
      .toBeCloseTo(Math.min(H - 0.15 - 0.05, H - 0.1), 9);
    expect(groundY('ac', 'ac-unit', [800, 200, 300], H), '…which is 0.1 below the slab')
      .toBeCloseTo(2.6, 9);
    // And the floor anchor, which has no business changing either.
    expect(groundY('sofa', 'sofa', [2000, 900, 800], H), 'a sofa still stands at 0').toBe(0);

    // `wall-mid`'s eye level was UNPINNED anywhere in this repo, which the § 35 mutation
    // round found by moving it 1.4 -> 1.5 m and watching every suite stay green. It is
    // a decision — how high a television hangs — not an arithmetic consequence, so it
    // gets a literal. The second clause is the one that matters: in a room low enough,
    // eye level is not reachable and the piece drops to clear the ceiling instead, and
    // the constant alone cannot see which arm bound.
    expect(groundY('tv', 'tv', [1200, 80, 700], H), 'a television hangs at eye level')
      .toBeCloseTo(1.4, 9);
    expect(groundY('mirror', 'mirror', [600, 20, 900], H), 'so does a mirror')
      .toBeCloseTo(1.4, 9);
    expect(groundY('tv', 'tv', [1200, 80, 700], 1.8), 'in a 1.8 m room the ceiling binds')
      .toBeCloseTo(1.8 - 0.35 - 0.1, 9);
    expect(groundY('painting', 'painting', [500, 30, 400], H), 'a small painting, same level')
      .toBeCloseTo(1.4, 9);
  });
});
