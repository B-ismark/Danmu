import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { dropPlaneConstant, dropPlaneY, hangsFromCeiling, mountedY, type Category, type Shape } from '@/lib/scene-spec';
import { groundY } from '@/lib/physics';

// Where a DROP lands in the 3D tab.
//
// A pointer ray carries no depth, so **the plane you resolve it against IS the answer**.
// `components/three/Room.tsx` resolved every drop against the floor (`y = 0`), which was
// harmless for exactly as long as `ceilingSpot` discarded the aim: the wrong number was
// computed and then thrown away. The moment an explicit aim began to win (§ H.3 residue 1,
// 2026-09-04) it became the whole answer for the ceiling family, and a fan released over
// the middle of the ceiling landed in the far corner of the room.
//
// The 2D plan never had this — `PlanView.onDrop` calls `svgToWorldAt`, a direct
// screen-to-world map that is exact at every height — so the two tabs answered one gesture
// two ways, which is CLAUDE.md's "two features that render the same must not be two code
// paths".
//
// **This file tests the round trip, not a coordinate.** Take a point on the plane the piece
// will live in, project it through the camera to the pixel it appears at, and resolve that
// pixel back. The answer must be the point you started from. A hand-typed expected
// coordinate is also satisfied by a fix that moves the error somewhere consistent; a round
// trip is not, and it needs no fixture camera position to be blessed as correct.
//
// The cross-tab half of the claim — that a drop at the same room position on either tab
// produces the same placement — needs both handlers and therefore a browser. It is in
// `docs/visual-check.md`.

const CEILING = 2.5;
const FAN: [Category, Shape, [number, number, number]] = ['fan', 'fan', [1000, 1000, 200]];
const PENDANT: [Category, Shape, [number, number, number]] = ['lamp', 'lamp-pendant', [350, 350, 400]];
const BED: [Category, Shape, [number, number, number]] = ['bed', 'bed-double', [1600, 2000, 500]];
const TV: [Category, Shape, [number, number, number]] = ['tv', 'tv', [1200, 100, 700]];

/** The studio's own default camera — `Room.tsx`'s Canvas `position`, looking at the middle
 *  of the room. Read as a literal here on purpose: it is the camera a user actually has
 *  when they drop something, and the error this file is about is a function of it. */
function defaultCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
  cam.position.set(5, 4.5, 5.5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** Resolve the pixel `world` appears at, back onto a horizontal plane.
 *
 *  **The constant comes from `dropPlaneConstant`, never from a negation written here.**
 *  `Plane` is `normal · x + constant = 0`, so a plane at `y = h` carries `-h` — and a
 *  test that spells that sign itself cannot see the handler's copy of it change. Flip
 *  the sign in `Room.tsx` and a fan aims at a plane below the floor, which a ray from
 *  above never reaches, so the drop silently does nothing; a gate holding its own copy
 *  flips too and stays green. */
function resolveThrough(cam: PerspectiveCamera, world: Vector3, planeConstant: number): Vector3 | null {
  const ndc = world.clone().project(cam);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(ndc.x, ndc.y), cam);
  const hit = new Vector3();
  return ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), planeConstant), hit) ? hit : null;
}

describe('dropPlaneY names the height a drop is aimed at', () => {
  it('is the mounting height for anything that hangs, and the floor for everything else', () => {
    // Derived from the same function `placeNewPart` uses to choose the height, so the aim
    // and the placement cannot drift apart. Asserting the AGREEMENT rather than a literal
    // is the point: a literal here would go stale the day `groundY` changes and would say
    // nothing about whether the two still match.
    expect(dropPlaneY(...FAN, CEILING)).toBeCloseTo(mountedY(...FAN, CEILING), 12);
    expect(dropPlaneY(...PENDANT, CEILING)).toBeCloseTo(mountedY(...PENDANT, CEILING), 12);
    // …and the literal too, because an agreement between two functions that both went
    // wrong together is still an agreement. 2.38 is the § 35 answer for a 200 mm fan
    // under a 2.5 m slab.
    expect(dropPlaneY(...FAN, CEILING)).toBeCloseTo(2.38, 6);
    expect(dropPlaneY(...FAN, CEILING)).toBeCloseTo(groundY(...FAN, CEILING), 9);
    // Zero for a floor piece, and zero for a WALL rider: a TV is `wallMounted` but rides a
    // wall, and `snapToWall` takes it from the aim's x/z, so its aiming plane is the floor
    // like everything else. That distinction is the whole content of `hangsFromCeiling`.
    expect(dropPlaneY(...BED, CEILING)).toBe(0);
    expect(dropPlaneY(...TV, CEILING)).toBe(0);
    expect(hangsFromCeiling(FAN[0], FAN[1])).toBe(true);
    expect(hangsFromCeiling(TV[0], TV[1])).toBe(false);
    expect(hangsFromCeiling(BED[0], BED[1])).toBe(false);
  });
});

describe('a drop lands where it was released, in the 3D tab', () => {
  const cam = defaultCamera();

  // Nine points across a 6 x 5 room, so the check is not a single spot near the camera
  // axis where every plane agrees. The corners are the rows that matter: the error grows
  // with distance from the point the camera looks at.
  const SPOTS: Array<[number, number]> = [
    [0, 0], [2, 0], [-2, 0], [0, 1.5], [0, -1.5],
    [2, 1.5], [-2, 1.5], [2, -1.5], [-2, -1.5],
  ];

  it('resolves a ceiling piece back to the point it appears at', () => {
    const planeY = dropPlaneY(...FAN, CEILING);
    for (const [x, z] of SPOTS) {
      const target = new Vector3(x, planeY, z);
      const back = resolveThrough(cam, target, dropPlaneConstant(...FAN, CEILING));
      expect(back, `no intersection for ${x},${z}`).not.toBeNull();
      expect(back!.x, `x at ${x},${z}`).toBeCloseTo(x, 9);
      expect(back!.z, `z at ${x},${z}`).toBeCloseTo(z, 9);
    }
  });

  it('and would not, against the floor plane — which is what it used to do', () => {
    // The negative half, and it is the assertion that makes the positive one mean
    // something. Without it "the round trip closes" is a statement about `three`'s
    // projection maths, which was never in doubt.
    //
    // **The size of the error is DERIVED, not bounded by a guess.** For the point the
    // camera looks at, similar triangles give it in closed form: the ray leaves the
    // camera at height `camY`, and to fall from `planeY` to 0 it must travel a further
    // `planeY / (camY - planeY)` of its horizontal run, so
    //
    //     error = |camera x,z| × planeY / (camY - planeY)
    //
    // A first draft of this comment quoted "about 1.65 m per metre of height", which is
    // `|camera x,z| / camY` — the ratio for a ray that falls the WHOLE way to the floor,
    // not the part of the fall that is left below the plane. It understates the real
    // error by a factor of two here, and it was repeated from a review note rather than
    // worked out. The denominator is what makes this sharp: as the camera drops toward
    // the plane the error diverges, which is the next test.
    const planeY = dropPlaneY(...FAN, CEILING);
    const predicted = Math.hypot(cam.position.x, cam.position.z) * (planeY / (cam.position.y - planeY));
    const centre = resolveThrough(cam, new Vector3(0, planeY, 0), 0)!;
    expect(Math.hypot(centre.x, centre.z), `centre error, predicted ${predicted.toFixed(3)} m`)
      .toBeCloseTo(predicted, 6);
    // …and about 8.3 m of it, in a room 6 m across. The literal is here as well as the
    // derivation because the two can only agree by both being right: a sign slip in the
    // formula would move them together, but not onto a number that is four room-widths
    // of error at the middle of a 6 x 5 room.
    expect(predicted).toBeCloseTo(8.34, 1);

    // Every spot is wrong, and the corners are worse than the middle — the error grows
    // with distance from what the camera is looking at, so a fixture sampling only the
    // centre would understate it.
    let worst = 0;
    for (const [x, z] of SPOTS) {
      const back = resolveThrough(cam, new Vector3(x, planeY, z), 0);
      expect(back).not.toBeNull();
      worst = Math.max(worst, Math.hypot(back!.x - x, back!.z - z));
    }
    expect(worst, `worst floor-plane error is ${worst.toFixed(3)} m`).toBeGreaterThan(predicted);
  });

  it('leaves a floor piece exactly where it always was', () => {
    // The control on the other side. The change must not have moved the 34 library rows
    // that stand on the floor, and for those the aiming plane IS the floor — so this is
    // the same round trip with `planeY = 0`, and it closes both before and after. A
    // reversal that "fixed" the ceiling by aiming everything at the ceiling would pass
    // every assertion above and fail this one.
    expect(dropPlaneY(...BED, CEILING)).toBe(0);
    for (const [x, z] of SPOTS) {
      const back = resolveThrough(cam, new Vector3(x, 0, z), dropPlaneConstant(...BED, CEILING));
      expect(back!.x, `x at ${x},${z}`).toBeCloseTo(x, 9);
      expect(back!.z, `z at ${x},${z}`).toBeCloseTo(z, 9);
    }
  });

  it('is a property of the camera, so it holds from a low angle too', () => {
    // The default camera is high and close. A user who has orbited down to eye level has
    // a much larger ratio — the error is `height × (horizontal / elevation)` and the
    // elevation is the denominator — so a fix that happened to work only at the shipped
    // camera would be worth catching. The room here is the same; only the eye moves.
    const low = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
    low.position.set(7, 1.2, 7);
    low.lookAt(0, 1, 0);
    low.updateMatrixWorld(true);
    const planeY = dropPlaneY(...FAN, CEILING);
    for (const [x, z] of SPOTS) {
      const back = resolveThrough(low, new Vector3(x, planeY, z), dropPlaneConstant(...FAN, CEILING));
      expect(back!.x, `x at ${x},${z}`).toBeCloseTo(x, 9);
      expect(back!.z, `z at ${x},${z}`).toBeCloseTo(z, 9);
    }
    // …and the floor plane is worse from here, not better, which is the direction the
    // ratio predicts and the reason this camera is in the file.
    const lowWorst = Math.max(
      ...SPOTS.map(([x, z]) => {
        const b = resolveThrough(low, new Vector3(x, planeY, z), 0);
        return b ? Math.hypot(b.x - x, b.z - z) : Infinity;
      }),
    );
    const highWorst = Math.max(
      ...SPOTS.map(([x, z]) => {
        const b = resolveThrough(cam, new Vector3(x, planeY, z), 0);
        return b ? Math.hypot(b.x - x, b.z - z) : Infinity;
      }),
    );
    expect(lowWorst, `low camera ${lowWorst.toFixed(2)} m vs default ${highWorst.toFixed(2)} m`).toBeGreaterThan(highWorst);
  });
});
