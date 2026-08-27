import { describe, it, expect } from 'vitest';
import { castsSunShadow } from '@/lib/sun-shadow';
import { moodSunDirection, moodKeyDirection, KEY_DIR } from '@/lib/lighting-moods';
import { LIGHTINGS } from '@/lib/store';

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

describe('a wall-mounted piece and the sun', () => {
  it('casts when the sun is on the room side of its wall', () => {
    // TV on the north wall, sun in the south: the light crosses the room and
    // lands on the screen. A shadow here is real (it falls back onto the wall).
    expect(castsSunShadow(SUN.south, FACING.north, true)).toBe(true);
  });

  it('does not cast when the sun is behind its wall', () => {
    // The reported bug, exactly: same TV, sun swung round to the north. The wall
    // is between them, the wall does not cast, so the TV must not either.
    expect(castsSunShadow(SUN.north, FACING.north, true)).toBe(false);
  });

  it('gets the side walls right, where a sign error hides', () => {
    // A flipped sign in `frontVector` is invisible on the north and south walls
    // (where front is ±Z and the x term is zero) and inverts the answer on the
    // east and west ones. So these two are the assertions that actually pin the
    // convention.
    expect(castsSunShadow(SUN.east, FACING.west, true)).toBe(true);
    expect(castsSunShadow(SUN.west, FACING.west, true)).toBe(false);
    expect(castsSunShadow(SUN.west, FACING.east, true)).toBe(true);
    expect(castsSunShadow(SUN.east, FACING.east, true)).toBe(false);
  });

  it('ignores the sun for a piece standing on the floor', () => {
    // A sofa is in the room with the light whichever way it faces. Gating it
    // would delete shadows that are the whole point of a low sun.
    for (const dir of Object.values(SUN)) {
      for (const rot of Object.values(FACING)) {
        expect(castsSunShadow(dir, rot, false)).toBe(true);
      }
    }
  });

  it('casts when there is no key light at all', () => {
    // `null` is the answer for a sun at or below the horizon, where `Room` renders
    // no key light and casting cannot matter. It must mean "unchanged" rather than
    // "never cast" — otherwise a mood with no sun would silently lose every shadow
    // in the room instead of simply having no sun to cast one.
    for (const rot of Object.values(FACING)) {
      expect(castsSunShadow(null, rot, true)).toBe(true);
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
      expect(castsSunShadow(dir, FACING.south, true)).toBe(false);
      expect(castsSunShadow(dir, FACING.east, true)).toBe(false);
      expect(castsSunShadow(dir, FACING.north, true)).toBe(true);
      expect(castsSunShadow(dir, FACING.west, true)).toBe(true);
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
      const answers = Object.values(FACING).map((rot) => castsSunShadow(dir, rot, true));
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
    expect(castsSunShadow(at0, FACING.north, true)).not.toBe(
      castsSunShadow(at180, FACING.north, true),
    );
  });
});
