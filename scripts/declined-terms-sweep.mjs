// Does naming the impossible condition ever say anything the old sentence did not?
//
// #121 gives `SolveResult.declinedTerms` so four sentences say "through a wall" OR
// "inside another one" instead of always saying both. That is only a change if a real
// refusal ever names ONE of them. `scripts/reconcile-declined.mjs` answers that for the
// one room that refuses at all: **48 solves over `u`/`l`/`t` at 6x4, seeds 1-8, both
// modes -> 9 impossible, 38 applied, 1 no-gain; all 9 name `outside` alone and all 9 are
// on the `u`.** `l` and `t` at the same size never refuse.
//
// THIS FILE HAS NOT COMPLETED A RUN. It is committed as the next measurement rather than
// as a result, and the two questions it exists to answer are still open:
//
//   * Is `outside` alone the answer everywhere, or only on `u` 6x4? Reconcile covers one
//     room because that is the only one that refused; a fixed denominator over five
//     presets x four sizes x three modes x twelve seeds is a different claim.
//   * Can `overlap` EVER reach a user? `IMPOSSIBLE_PHRASE.overlap` -- "inside another
//     one" -- has never been produced by any solve measured so far. A phrase table with
//     an entry nothing can reach is the same shape as a token with no `var()` reader: it
//     looks live and is not.
//
// SETTLED 2026-09-05, and the correction went the other way from the one this header
// expected. An earlier version quoted "9 declines, zero naming one term" from a review
// lens; a later version replaced BOTH halves with "11 declines, all naming one term".
// Re-run against a `lib/layout-solve.ts` hash-verified before and after: the count was 9
// all along and only the terms half was contaminated. So the lens was right about how
// many and wrong about which, the replacement was right about which and wrong about how
// many, and the 11 then propagated into `Design.md` and `docs/visual-check.md` where
// three agreeing copies read as settled fact.
//
// The contamination mechanism is confirmed as the one hypothesised: another lens was
// mutating `after[k] > before[k]` to `>=` in the same worktree, which names both terms on
// every refusal of a legal room because `0 >= 0` is true. Restoring after each mutation
// window protects the repo and does nothing for a concurrent reader. **Hash the module
// against its commit before AND after any run whose number you intend to quote**; a clean
// `git status` afterwards cannot tell you what the run actually read. And when you correct
// a contaminated measurement, re-derive EVERY figure in it -- a contaminated run is not
// wrong in only the place you noticed.
//
// Two arms, and the second is the one the remaining answer rests on:
//
//   ARM A - rooms the app seeds, with a fixed denominator: five presets x four sizes x
//           three modes x twelve seeds, every outcome bucketed including "did nothing".
//   ARM B - rooms that arrive ALREADY illegal in exactly ONE way. A piece through a wall
//           with nothing overlapping, or two pieces intersecting with nothing outside.
//           `before` is then non-zero on one term only, so a refusal CAN name one.
//
// Arm B is not a synthetic curiosity: `lib/wall-move.ts:146` says in its own words that
// a detection can land a piece through a wall, and moving a wall carries furniture
// inward. A room that arrives broken in one specific way is exactly the room where a
// user most needs to be told WHICH way.
//
// Method notes, each of which is a scar in this repo:
//  * The origin's own cost terms are PRINTED per constructed case, and a case that did
//    not come out clean is COUNTED rather than dropped. Pushing a piece "out of band" in
//    a random direction is what put 32 of 35 rooms through a wall in an earlier sweep.
//  * Every outcome gets a bucket including "did nothing" and "threw", so the denominator
//    does not move with the setting.
//  * Seeds run to 12 and modes are swept. The solver is deterministic per seed, so
//    re-running is not replicating.
//
// Loaded through vite's SSR pipeline, like `offer-floor-sweep.mjs`, because the modules
// are TypeScript and import through the repo's `@/` alias.

import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PRESETS = ['rect', 'l', 't', 'u', 'open'];
const SIZES = [
  [5.6, 4.2],
  [6.0, 4.0],
  [6.0, 5.0],
  [4.5, 3.6],
];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MODES = ['arrange', 'refit', 'shuffle'];

const server = await createServer({
  configFile: false,
  root: ROOT,
  resolve: { alias: { '@': ROOT } },
  server: { middlewareMode: true },
  logLevel: 'warn',
});

let armAImpossible = 0;
let armBImpossible = 0;
let armASingle = 0;
let armBSingle = 0;

try {
  const solveMod = await server.ssrLoadModule('/lib/layout-solve.ts');
  const scoreMod = await server.ssrLoadModule('/lib/layout-score.ts');
  const spec = await server.ssrLoadModule('/lib/scene-spec.ts');
  const fp = await server.ssrLoadModule('/lib/footprint.ts');

  const { solveLayout, impossibleClause, IMPOSSIBLE_TERMS } = solveMod;
  const { prepare, costBreakdown, DEFAULT_WEIGHTS, NAV_CELL } = scoreMod;

  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const originOf = (parts) => parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));

  /** The two impossible terms of an arrangement, weighted, as the solver sees them. */
  const hardOf = (parts, poly) => {
    const at = originOf(parts);
    const model = prepare({
      parts,
      movable: parts.map((p) => !p.wallMounted),
      footprint: poly,
      origin: at,
    });
    const bd = costBreakdown(model, at, DEFAULT_WEIGHTS, NAV_CELL);
    return { overlap: bd.overlap, outside: bd.outside };
  };

  const clone = (parts) => parts.map((p) => ({ ...p, pos: [...p.pos] }));

  /** Run one room through every mode and seed, recording every outcome. */
  const runRoom = (label, parts, poly, outcome, shape, arm) => {
    const locked = parts.map(() => false);
    for (const mode of MODES) {
      for (const seed of SEEDS) {
        let r;
        try {
          r = solveLayout(parts, poly, locked, { seed, mode });
        } catch (err) {
          bump(outcome, 'THREW: ' + (err && err.message ? String(err.message).slice(0, 50) : err));
          continue;
        }
        const dec = r.declined == null ? 'applied' : r.declined;
        bump(outcome, dec);
        if (r.declined !== 'impossible') {
          if (r.declinedTerms && r.declinedTerms.length > 0) {
            bump(outcome, 'LEAK: non-impossible decline carrying terms');
          }
          continue;
        }
        const terms = [...(r.declinedTerms || [])].sort();
        const key = terms.length === 0 ? '(EMPTY - fallback)' : terms.join('+');
        bump(shape, key);
        const single = terms.length === 1;
        if (arm === 'A') {
          armAImpossible++;
          if (single) armASingle++;
        } else {
          armBImpossible++;
          if (single) armBSingle++;
        }
        if (single) bump(shape, 'SINGLETON ROOM: ' + label + ' [' + key + ']');
      }
    }
  };

  // ── ARM A · rooms the app seeds ─────────────────────────────────────────────
  const outcomeA = new Map();
  const shapeA = new Map();
  let roomsA = 0;
  for (const id of PRESETS) {
    for (const [w, d] of SIZES) {
      const poly = fp.footprintForLayout(id, w, d);
      const parts = spec.defaultScene(id, w, d, { footprint: poly });
      if (!parts || parts.length === 0) {
        bump(outcomeA, 'EMPTY SCENE');
        continue;
      }
      roomsA++;
      runRoom(id + ' ' + w + 'x' + d, parts, poly, outcomeA, shapeA, 'A');
    }
  }

  // ── ARM B · rooms already illegal in exactly ONE way ────────────────────────
  //
  // Two constructions. `outsideOnly` walks one movable piece along +x until the room's
  // `outside` term is non-zero; `overlapOnly` drops one piece onto another's centre.
  // Both are then CHECKED against `hardOf`, and a construction that produced the wrong
  // shape (both terms, or neither) is counted under its own key rather than discarded --
  // a filter here is how a denominator starts moving with the setting.
  const outcomeB = new Map();
  const shapeB = new Map();
  const built = new Map();
  let roomsB = 0;

  for (const id of PRESETS) {
    for (const [w, d] of SIZES) {
      const poly = fp.footprintForLayout(id, w, d);
      const base = spec.defaultScene(id, w, d, { footprint: poly });
      if (!base || base.length < 2) {
        bump(built, 'scene too small to break');
        continue;
      }
      const movableIdx = base.map((p, i) => (p.wallMounted ? -1 : i)).filter((i) => i >= 0);
      if (movableIdx.length < 2) {
        bump(built, 'fewer than two movable pieces');
        continue;
      }

      // outside-only: shove one piece well past the far wall.
      for (const shove of [1.2, 2.0]) {
        const parts = clone(base);
        parts[movableIdx[0]].pos[0] += shove;
        const h = hardOf(parts, poly);
        const kind = h.outside > 1e-9 && h.overlap <= 1e-9 ? 'outside-only'
          : h.outside > 1e-9 && h.overlap > 1e-9 ? 'both (unusable)'
          : h.overlap > 1e-9 ? 'overlap-only (unexpected)' : 'still legal (no push)';
        bump(built, 'shove ' + shove + ' -> ' + kind);
        if (kind !== 'outside-only') continue;
        roomsB++;
        console.log('  built  ' + (id + ' ' + w + 'x' + d).padEnd(12) +
          ' outside-only  overlap=' + h.overlap.toFixed(3) + ' outside=' + h.outside.toFixed(3));
        runRoom(id + ' ' + w + 'x' + d + ' +' + shove, parts, poly, outcomeB, shapeB, 'B');
      }

      // overlap-only: stand one piece in the middle of another, both well inside.
      {
        const parts = clone(base);
        const a = movableIdx[0];
        const b = movableIdx[1];
        parts[a].pos[0] = parts[b].pos[0];
        parts[a].pos[2] = parts[b].pos[2];
        const h = hardOf(parts, poly);
        const kind = h.overlap > 1e-9 && h.outside <= 1e-9 ? 'overlap-only'
          : h.overlap > 1e-9 && h.outside > 1e-9 ? 'both (unusable)'
          : h.outside > 1e-9 ? 'outside-only (unexpected)' : 'still legal (no overlap)';
        bump(built, 'stack -> ' + kind);
        if (kind === 'overlap-only') {
          roomsB++;
          console.log('  built  ' + (id + ' ' + w + 'x' + d).padEnd(12) +
            ' overlap-only  overlap=' + h.overlap.toFixed(3) + ' outside=' + h.outside.toFixed(3));
          runRoom(id + ' ' + w + 'x' + d + ' stack', parts, poly, outcomeB, shapeB, 'B');
        }
      }
    }
  }

  const table = (title, outcome, shape, rooms, impossible, single) => {
    console.log('\n=== ' + title + ' — ' + rooms + ' rooms, ' +
      MODES.length + ' modes x ' + SEEDS.length + ' seeds each ===');
    for (const [k, v] of [...outcome.entries()].sort((a, b) => b[1] - a[1])) {
      console.log('  ' + String(v).padStart(6) + '  ' + k);
    }
    if (impossible === 0) {
      console.log('  no impossible refusal in this arm — it cannot answer the question');
      return;
    }
    console.log('  -- which condition the ' + impossible + ' refusals named --');
    for (const [k, v] of [...shape.entries()].sort((a, b) => b[1] - a[1])) {
      if (k.startsWith('SINGLETON ROOM')) continue;
      const sentence = k === '(EMPTY - fallback)'
        ? impossibleClause([])
        : impossibleClause(k.split('+'));
      console.log('  ' + String(v).padStart(6) + '  ' +
        ((v / impossible) * 100).toFixed(1).padStart(5) + '%  ' +
        k.padEnd(22) + '"' + sentence + '"');
    }
    console.log('  naming exactly ONE condition: ' + single + ' of ' + impossible +
      '  (' + ((single / impossible) * 100).toFixed(1) + '%)');
    for (const [k, v] of shape.entries()) {
      if (k.startsWith('SINGLETON ROOM')) console.log('    ' + String(v).padStart(4) + '  ' + k);
    }
  };

  table('ARM A · rooms the app seeds', outcomeA, shapeA, roomsA, armAImpossible, armASingle);

  console.log('\n=== ARM B · what the construction actually produced ===');
  for (const [k, v] of [...built.entries()].sort((a, b) => b[1] - a[1])) {
    console.log('  ' + String(v).padStart(6) + '  ' + k);
  }
  table('ARM B · rooms already illegal in ONE way', outcomeB, shapeB, roomsB, armBImpossible, armBSingle);

  console.log('\n  IMPOSSIBLE_TERMS = [' + IMPOSSIBLE_TERMS.join(', ') + ']');
  console.log('\n  THE QUESTION: #121 changes what a user reads only on a refusal that');
  console.log('  names one condition. Arm A ' + armASingle + '/' + armAImpossible +
    ', arm B ' + armBSingle + '/' + armBImpossible + '.');
} finally {
  await server.close();
}

// Exit 1 when NOTHING in either arm named a single condition: that is the reading on
// which the branch is a refactor rather than a feature, and it should be loud.
process.exit(armASingle + armBSingle === 0 ? 1 : 0);
