import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The room is closed to the sun, and every part of that is a renderer fact.
//
// These are assertions over SOURCE TEXT, which is normally a smell — it usually
// means the data is in the wrong place. It is the right shape here for the same
// reason `tests/color-tokens.test.ts` reads `globals.css` and `tests/reflow.test.ts`
// reads component sources: the subject is a prop on a mesh inside an R3F tree, there
// is no pure function to call, and there is no gate anywhere that notices when one
// of them goes. Each one below fails SILENTLY and looks like a lighting bug rather
// than a missing line:
//
//   · a wall that stops casting lets the sun back through the plaster, and the only
//     symptom is furniture on the far wall throwing shadows into a room the light
//     never entered — the exact report this work came from;
//   · a ceiling that stops casting puts the sun on the whole floor at once, which
//     reads as "the sun mood is just brighter" rather than as broken;
//   · a ceiling that starts RENDERING hides the room from the dollhouse camera,
//     which reads as the scene failing to load;
//   · a ceiling that answers a raycast sits between the pointer and every piece of
//     furniture in the room, which reads as selection being broken.
//
// `\r\n` is stripped on read. A `\n`-anchored pattern matches a hand-written file
// and then fails the moment the same file arrives through a checkout with
// `autocrlf=true` — which is invisible on Linux CI and red on every local run.

const root = (...p: string[]) => join(process.cwd(), ...p);
const readSrc = (...p: string[]) => readFileSync(root(...p), 'utf8').replace(/\r\n/g, '\n');

const SHELL = readSrc('components', 'three', 'RoomShell.tsx');

/** One `<mesh>…</mesh>` block, located by a marker only that mesh contains.
 *
 *  The WHOLE element rather than its opening tag, and that is a scar: slicing to the
 *  first `>` after the marker looked obviously right and cut the ceiling's tag off
 *  in the middle of `raycast={() => null}`, because the arrow in an arrow function
 *  is a `>`. The assertion then passed a truncated string to `not.toMatch` and went
 *  green while reporting on nothing. Matching the element's own closing tag has no
 *  such edge, and none of these meshes nest. */
function meshBlock(marker: string): string | null {
  const at = SHELL.indexOf(marker);
  if (at < 0) return null;
  const open = SHELL.lastIndexOf('<mesh', at);
  const close = SHELL.indexOf('</mesh>', at);
  return open < 0 || close < 0 ? null : SHELL.slice(open, close + '</mesh>'.length);
}

/** The ceiling, identified by the one thing only it does: it sits at the wall
 *  height. */
const ceiling = meshBlock('position={[0, height, 0]}');

/** A wall, likewise: positioned at half the wall height and rotated to its yaw. */
const wall = meshBlock('position={[wl.x, height / 2, wl.z]}');

describe('the room is closed to the sun', () => {
  it('finds the two meshes these assertions are about', () => {
    // Without this, every assertion below would pass over a `null` and report a
    // sealed room after someone renamed a variable. The tests that follow are only
    // worth their tokens if this one holds.
    expect(wall, 'wall mesh not found in RoomShell.tsx').toBeTruthy();
    expect(ceiling, 'ceiling mesh not found in RoomShell.tsx').toBeTruthy();
    // And that they are the two DIFFERENT meshes they claim to be — one marker
    // matching both would make every assertion below report on the same element.
    expect(wall).not.toBe(ceiling);
  });

  it('makes the walls cast, not only receive', () => {
    expect(wall).toContain('castShadow');
    // Still receives — the sun coming through a window has to land on the wall
    // opposite, and that wall is the same mesh.
    expect(wall).toContain('receiveShadow');
  });

  it('gives the room a ceiling that casts', () => {
    expect(ceiling).toContain('castShadow');
  });

  it('does not draw that ceiling', () => {
    // It has to stay `visible` — three skips an invisible object in the shadow pass
    // too, so `visible={false}` would silently un-seal the roof — which is why the
    // material is what opts out instead.
    expect(ceiling).not.toMatch(/visible=\{false\}/);
    expect(ceiling).toContain('colorWrite={false}');
    expect(ceiling).toContain('depthWrite={false}');
  });

  it('does not let that ceiling answer a raycast', () => {
    expect(ceiling).toMatch(/raycast=\{\(\) => null\}/);
  });

  it('cuts the openings once, in the geometry both passes read', () => {
    // The walls' `shapeGeometry` already carries the aperture holes, so the light
    // that comes through a window comes through the same polygon in the shadow map.
    // A second description of where the openings are — a separate caster mesh, a
    // list of hole rectangles rebuilt for the shadow pass — is the rule 3 failure,
    // and it would show up as a sun patch beside a window rather than through it.
    expect(SHELL).toContain('wallShapes[i]');
    expect(SHELL).toContain('shape.holes.push(hole)');
  });
});

describe('the per-piece shadow gate is gone, not merely unused', () => {
  // The removed-vocabulary check, kept as a gate rather than run once by hand.
  // `lib/sun-shadow.ts` was a workaround for a room with no ceiling: it asked, per
  // piece, whether the sun was on the room side of the wall that piece rode. The
  // shell answers the same question for the whole room, so the gate is redundant —
  // and a redundant gate is worse than none, because the two can now disagree. A
  // piece standing in a sun patch that came through a window is lit; the old gate
  // would have refused its shadow anyway on the strength of which wall it hangs on.
  const DEAD = ['castsSunShadow', 'moodKeyDirection'];

  it('leaves no module behind', () => {
    expect(existsSync(root('lib', 'sun-shadow.ts'))).toBe(false);
    expect(existsSync(root('tests', 'sun-shadow.test.ts'))).toBe(false);
  });

  it('leaves no caller or exported name behind', () => {
    // Checked against the files that referenced it, rather than by walking the tree:
    // a sweep would be the better test and a slower one, and these four are where
    // every reference lived.
    const surfaces = [
      ['components', 'three', 'Draggable.tsx'],
      ['components', 'three', 'Room.tsx'],
      ['lib', 'lighting-moods.ts'],
      ['lib', 'apertures.ts'],
    ];
    for (const path of surfaces) {
      const src = readSrc(...path);
      for (const name of DEAD) {
        expect(src, `${path.join('/')} still names ${name}`).not.toContain(name);
      }
    }
  });

  it('asks the aperture question through one predicate, not an exported list', () => {
    // `APERTURE_SHAPES` is still in `lib/apertures.ts` and should be — what changed
    // is that it stopped being exported. The gate was its second reader; the Style
    // panel's "no window to shine through" hint is its second reader now, and it
    // gets a predicate instead of the raw Set so that the two cannot answer
    // differently. `wallMounted` is half of that answer and a copy of the Set does
    // not carry it.
    const ap = readSrc('lib', 'apertures.ts');
    expect(ap).not.toContain('export const APERTURE_SHAPES');
    expect(ap).toContain('export function isAperture');
    expect(ap).toContain('wallMounted === true');
    // And the wall-cutting path goes through it, rather than testing the Set again
    // beside it.
    expect(ap).toContain('if (!isAperture(p)) continue;');
    expect(readSrc('components', 'studio', 'PartTree.tsx')).toContain('isAperture');
  });

  it('keeps the dependency that was never about the shadow', () => {
    // `shapeKey` arrived in the same commit as the gate and looks like the other
    // half of this removal. It is not: `PartGeometry` dispatches on `part.shape`, and
    // the Inspector's model picker writes `dimMM` on the part rather than as an
    // override, so without this dep the effect does not re-run on a model change and
    // the piece's FINISH is silently lost. That bug predates the gate and is still
    // live. This assertion exists so the next sweep cannot take it.
    const dr = readSrc('components', 'three', 'Draggable.tsx');
    expect(dr).toContain('shapeKey');
    expect(dr).toMatch(/dimKey,\s*shapeKey,\s*invalidate\]/);
  });
});
