import { describe, it, expect } from 'vitest';
import { castsSunShadow } from '@/lib/sun-shadow';
import { moodSunDirection, moodKeyDirection, KEY_DIR } from '@/lib/lighting-moods';
import { LIGHTINGS } from '@/lib/store';
import type { Shape } from '@/lib/scene-spec';

// A wall-mounted piece must not cast a shadow the sun cannot have thrown.
//
// Walls only `receiveShadow` — never cast, because the dollhouse view culls the
// near ones — so the sun goes through the plaster, hits the back of a TV bolted
// to the far wall, and the TV drops a shadow on a floor the light never reached.
// The bug is invisible in a screenshot taken from the front and obvious from the
// side, which is why it survived.
//
// The interesting property is a SIGN, and a sign is exactly the thing that is
// invisible at 0° and 180° and wrong on the side walls (the scar CLAUDE.md
// records against `geometry.ts`'s rotation convention). So the cases below are
// deliberately the four walls, not one.

/** Facing, in radians, for a piece flat against each wall. A part's front is
 *  local +Z = `(sin rot, cos rot)`, so rot=0 faces +Z (south) — which is the
 *  facing of a piece hung on the NORTH wall. */
const FACING = {
  north: 0, // mounted on the north wall, looking south into the room
  south: Math.PI,
  west: Math.PI / 2, // front is +X, i.e. east
  east: -Math.PI / 2,
};

/** A sun in the given direction, at a plausible elevation. `[x, y, z]` points
 *  from the room TOWARD the light, which is what `moodSunDirection` returns. */
const SUN = {
  south: [0, 0.5, 0.87] as const,
  north: [0, 0.5, -0.87] as const,
  east: [0.87, 0.5, 0] as const,
  west: [-0.87, 0.5, 0] as const,
};

/** The gate for an ordinary wall-rider — a TV on solid plaster. The shape is only
 *  spelled out in the tests that are ABOUT the shape, so the rest stay readable. */
const casts = (
  dir: readonly [number, number, number] | null,
  rot: number,
  ridesWall = true,
  shape: Shape = 'tv',
) => castsSunShadow(dir, rot, ridesWall, shape);

describe('a wall-mounted piece and the sun', () => {
  it('casts when the sun is on the room side of its wall', () => {
    // TV on the north wall, sun in the south: the light crosses the room and
    // lands on the screen. A shadow here is real (it falls back onto the wall).
    expect(casts(SUN.south, FACING.north, true)).toBe(true);
  });

  it('does not cast when the sun is behind its wall', () => {
    // The reported bug, exactly: same TV, sun swung round to the north. The wall
    // is between them, the wall does not cast, so the TV must not either.
    expect(casts(SUN.north, FACING.north, true)).toBe(false);
  });

  it('gets the side walls right, where a sign error hides', () => {
    // A flipped sign in `frontVector` is invisible on the north and south walls
    // (where front is ±Z and the x term is zero) and inverts the answer on the
    // east and west ones. So these two are the assertions that actually pin the
    // convention.
    expect(casts(SUN.east, FACING.west, true)).toBe(true);
    expect(casts(SUN.west, FACING.west, true)).toBe(false);
    expect(casts(SUN.west, FACING.east, true)).toBe(true);
    expect(casts(SUN.east, FACING.east, true)).toBe(false);
  });

  it('ignores the sun for a piece standing on the floor', () => {
    // A sofa is in the room with the light whichever way it faces. Gating it
    // would delete shadows that are the whole point of a low sun.
    for (const dir of Object.values(SUN)) {
      for (const rot of Object.values(FACING)) {
        expect(casts(dir, rot, false)).toBe(true);
      }
    }
  });

  it('casts when there is no key light at all', () => {
    // `null` is the answer for a sun at or below the horizon, where `Room` renders
    // no key light and casting cannot matter. It must mean "unchanged" rather than
    // "never cast" — otherwise a mood with no sun would silently lose every shadow
    // in the room instead of simply having no sun to cast one.
    for (const rot of Object.values(FACING)) {
      expect(casts(null, rot, true)).toBe(true);
    }
  });

  it('gates the studio moods too, which the first version of this did not', () => {
    // The regression this pins. `castsSunShadow` was originally fed
    // `moodSunDirection`, so `evening` and `cool` came back `null` and were
    // exempted — on the reasoning that their key light is a lighting rig rather
    // than something standing outside the building.
    //
    // The arithmetic does not support that. The rig is realised at
    // `max(12, extent * 1.6)` metres, so it stands well outside a six-metre room,
    // and its horizontal component puts it behind the south and east walls exactly
    // as a low sun does. The exemption therefore left the bug this file is about
    // standing on half the walls, in the mood with the brightest ambient of the
    // set — where a shadow that cannot exist is most visible.
    for (const mood of ['evening', 'cool'] as const) {
      const dir = moodKeyDirection(mood, 0);
      expect(dir, `${mood} should have a key direction, not null`).not.toBeNull();
      expect(dir).toEqual(KEY_DIR);
      // Behind its wall on the south and east; in the room on the north and west.
      expect(casts(dir, FACING.south, true)).toBe(false);
      expect(casts(dir, FACING.east, true)).toBe(false);
      expect(casts(dir, FACING.north, true)).toBe(true);
      expect(casts(dir, FACING.west, true)).toBe(true);
    }
  });

  it('answers for every mood, so no mood can be silently exempt again', () => {
    // The shape of the original defect was a whole CLASS of mood falling through a
    // null. Asserting the count is what stops that returning as "the two moods I
    // happened to loop over".
    const answered = LIGHTINGS.filter((id) => moodKeyDirection(id, 0) !== null);
    expect(answered.length).toBe(LIGHTINGS.length);
  });

  it('does not swing the studio rig when the room turns', () => {
    // The bearing belongs to the sun. The rig is fixed relative to the ROOM, so
    // turning the north dial must move the sun moods' shadows and leave the studio
    // moods' alone — otherwise the dial would appear to relight a room lit by
    // nothing outdoors.
    expect(moodKeyDirection('cool', 0)).toEqual(moodKeyDirection('cool', 137));
    expect(moodKeyDirection('day', 0)).not.toEqual(moodKeyDirection('day', 137));
  });

  it('treats the walls the sun runs parallel to alike, at every square bearing', () => {
    // The float-dust bug, and it was live in the configuration every room opens in.
    // `day` is the default lighting, 0 the default bearing, `day`'s azimuth is
    // exactly 180, and `Math.sin(Math.PI)` is 1.2246e-16 rather than 0 — so the
    // horizontal dot against the east and west walls came out at ±3e-17 and `> 0`
    // called one wall lit and its mirror image dark. Two identical TVs on opposite
    // walls, one casting and one not.
    //
    // The pair to assert is the one the sun runs PARALLEL to, which is where the
    // dot is nominally zero and dust decides. The perpendicular pair must and does
    // differ — the sun really is on one side of it — so asserting symmetry for all
    // four walls would be asserting the sun does not have a direction.
    const PARALLEL_PAIR = {
      0: ['west', 'east'], // sun along ±Z, so the side walls are edge-on to it
      90: ['north', 'south'],
      180: ['west', 'east'],
      270: ['north', 'south'],
    } as const;
    for (const [bearing, pair] of Object.entries(PARALLEL_PAIR)) {
      const dir = moodKeyDirection('day', Number(bearing))!;
      const [a, b] = pair;
      expect(casts(dir, FACING[a]), `${a} at bearing ${bearing}`).toBe(true);
      expect(casts(dir, FACING[b]), `${b} at bearing ${bearing}`).toBe(true);
      // And the perpendicular pair still disagrees, so this test cannot pass by
      // the gate having become "always cast".
      const [c, d] = pair[0] === 'west' ? (['north', 'south'] as const) : (['west', 'east'] as const);
      expect(casts(dir, FACING[c]), `${c}/${d} at bearing ${bearing}`).not.toBe(casts(dir, FACING[d]));
    }
  });

  it('lets the degenerate case cast rather than swallow a real shadow', () => {
    // A sun running exactly parallel to a wall. The first version called this
    // "casts nothing worth drawing either way" and took the false branch, which is
    // wrong for the pieces this gate applies to: a wall-rider is a box standing
    // PROUD of the wall, so a sun parallel to that wall throws a real shadow along
    // it. The tie falls toward casting.
    const parallel = [1, 0.5, 0] as const; // due east, a piece on the north wall
    expect(casts(parallel, FACING.north)).toBe(true);
    expect(casts(parallel, FACING.south)).toBe(true);
  });

  it('never gates an opening, because that is where the light comes in', () => {
    // A regression this had for one commit. `anchorFor('door')` is `'wall-floor'`,
    // so `ridesWall` is true for a door and the gate caught it — removing the
    // shadow that reads as light coming in THROUGH the doorway, on the one wall a
    // lighting study cares about. Same for a window, and for a curtain hung over
    // one: the sun behind that wall is shining through the glass onto its back.
    //
    // It failed in the quiet direction — a shadow silently missing rather than one
    // wrongly present — which is why it needs a test rather than an eye.
    const behind = SUN.north; // sun behind a piece on the north wall
    expect(casts(behind, FACING.north), 'a TV on plaster is still gated').toBe(false);
    for (const shape of ['door', 'window', 'curtain'] as const) {
      expect(casts(behind, FACING.north, true, shape), `${shape} must keep casting`).toBe(true);
      // …and an opening is not a blanket exemption from the module: it still casts
      // when the sun IS on the room side, which is the uninteresting direction but
      // proves the branch is an exemption and not a short circuit that ignores the
      // geometry entirely.
      expect(casts(SUN.south, FACING.north, true, shape)).toBe(true);
    }
  });

  it('never leaves a sun mood with nothing to gate against', () => {
    // Ties the predicate to the real table rather than to the hand-written
    // vectors above. If a mood's angle drifts below the horizon,
    // `moodSunDirection` returns null and this file's whole subject quietly
    // becomes vacuous for that mood — the failure mode of every test that loops
    // over what it happened to find.
    const withSun = LIGHTINGS.filter((id) => moodSunDirection(id, 0) !== null);
    expect(withSun.length).toBe(3);
    for (const id of withSun) {
      const dir = moodSunDirection(id, 0)!;
      // A gate that always answers the same way is not a gate. Every real sun
      // angle must light SOME wall and leave another in shadow.
      const answers = Object.values(FACING).map((rot) => casts(dir, rot, true));
      expect(answers, `${id} answers the same for all four walls`).toContain(true);
      expect(answers, `${id} answers the same for all four walls`).toContain(false);
    }
  });

  it('turns with the room, so the dial actually changes the shadows', () => {
    // `moodSunDirection` takes the room's own bearing. Rotating the room 180°
    // must swap which walls are lit — otherwise the north dial moves the sun
    // marker on its rim and nothing else.
    const at0 = moodSunDirection('day', 0)!;
    const at180 = moodSunDirection('day', 180)!;
    expect(casts(at0, FACING.north, true)).not.toBe(
      casts(at180, FACING.north, true),
    );
  });
});
