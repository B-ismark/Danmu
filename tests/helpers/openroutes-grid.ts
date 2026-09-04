/** The scramble grid that `tests/suggest-tidiness.test.ts` freezes a specimen out of, and
 *  that `scripts/openroutes-sweep.mjs` sweeps in full.
 *
 *  **This file exists because those two had a copy each, and the drift between them would
 *  have been one-directional and silent.** The script's output is quoted *into* the test
 *  file as authority — the cut count, the trial count, the refusal seed — so a script whose
 *  generator had drifted would not have failed anything. It would have printed a table
 *  about a different population, and that table would have been believed, because the only
 *  thing tying the two together was a comment saying they matched.
 *
 *  A helper is the right home rather than `lib/`: nothing the app ships needs a scramble
 *  generator, and a module only tests and tooling import does not belong where it reads as
 *  shipped code. `tests/helpers/` is not collected by vitest's `include`, so this is never
 *  run as a suite.
 *
 *  The two encodings are the search's own and are kept in that form deliberately — a
 *  re-run must be able to name the same point rather than a magic number that has to be
 *  trusted. */

/** Numerical Recipes' LCG constants. A generator of this file's own, so the scramble is a
 *  property of the grid rather than of whatever `solveLayout` happens to use — its rng is
 *  an implementation detail and a number measured against it would move with it. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Scramble `i` of the grid. */
export const layoutSeed = (i: number) => i * 2654435761;

/** Repair seed `j` within scramble `i`. */
export const repairSeed = (i: number, j: number) => i * 31 + j;

/** The bounding box a scramble throws pieces into. Named rather than inlined so the test
 *  and the script cannot disagree about which corner is which. */
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/** A part as this grid needs to read it — position, rotation, and whether it is pinned to
 *  a wall. Structural rather than importing `ScenePart`, so the script does not have to
 *  load the scene module to describe its own input. */
export type GridPart = { pos: [number, number, number]; rot: number; wallMounted?: boolean };

/** A placement as the solver's cost functions take one. */
export type GridPlacement = { x: number; z: number; yaw: number };

/** Throw every movable piece into the bounding box at a random angle.
 *
 *  Wall-mounted pieces keep their authored transform: a scramble that tore the TV off the
 *  wall would be measuring a room the app cannot produce. */
export function scatterInto(base: readonly GridPart[], b: Bounds, seed: number): GridPlacement[] {
  const r = lcg(seed);
  return base.map((p) =>
    p.wallMounted
      ? { x: p.pos[0], z: p.pos[2], yaw: p.rot }
      : {
          x: b.minX + r() * (b.maxX - b.minX),
          z: b.minZ + r() * (b.maxZ - b.minZ),
          yaw: r() * Math.PI * 2,
        },
  );
}
