// How often does `isWorthOffering` refuse a suggestion that FIXED A RELATION?
//
// `lib/layout-score.ts`'s `bandCost` docblock records the defect and the measurement
// behind it: swept over all ten relation specs the library can form, a piece 300 mm
// outside its band costs LESS than `MIN_GAIN_ABS`, so a nightstand 450 mm off a bed
// scores 0.90, the solver finds the fix, and the offer gate prices it as noise. The
// promising direction recorded there is a relation-aware floor — "offer it if any
// relation went from out of band to in" — and it has never been measured end to end.
//
// This is that measurement, and it exists to answer two questions BEFORE any code
// changes, because both have an answer that could kill the change:
//
//   1. Does the case actually occur? If no solve in a realistic population is both
//      refused by the floor and a relation repair, the fix is for a room nobody has.
//   2. Does "ANY relation came into band" differ from "MORE came in than went out"?
//      § C's wording is the first. The first will also offer a solve that fixed one
//      relation and broke three, which is a different thing to show a user. If the two
//      never disagree, say so and take the stricter one anyway; if they do, the
//      difference is the decision.
//
// WHY THE POPULATION IS NUDGED AND NOT SCRAMBLED. A scramble costs hundreds, so the
// floor — one cost unit, or a fifteenth of the total — is met by anything. The band
// defect lives in the NEAR field, which is a room that is nearly right: a seeded scene
// with a few pieces pushed a couple of hundred millimetres. That is also the room a
// user presses Suggest in.
//
//   node scripts/offer-floor-sweep.mjs                  # five presets x 12 nudges
//   node scripts/offer-floor-sweep.mjs --nudges 4       # a shorter probe
//
// EXIT CODES, because the two bad outcomes are not the same outcome:
//   0  the sweep ran and found at least one refused-but-repairing solve
//   1  the sweep ran and found NONE — the proposed floor has no population
//   2  the sweep never produced a solve to classify, so it measures nothing
//
// **IT EXITS 1 TODAY, AND THAT IS THE ANSWER RATHER THAN A BREAKAGE.** 0 of 45 whole-room
// solves and 0 of 11 isolated repairs were both refused by the floor and a band repair,
// so a relation-aware floor keyed on an out-of-band → in-band transition would fire on
// nothing. The reason is in the last two columns of the isolated table and it is one
// layer below the offer stage: with every other piece locked, the solver moves the piece
// most of the way back and **stops short of the band** — 0.90 m → 0.58 m against a 0.50 m
// maximum — because in `arrange` mode the origin it is anchored to is the DISPLACED
// position, so `inertia` charges the repair for being a change. Re-solved with
// `inertia: 0` and nothing else altered, **10 of the 11 land in band** instead of 3.
//
// So the sentence in `bandCost` — "the thing that is wrong is what gets OFFERED, not what
// gets searched" — is refuted on this population by its own successor measurement. The
// price of a band miss really is about one cost unit, exactly as recorded; what is not
// true is that the solver finds the fix. Do not build the offer floor on this evidence.
//
// Loaded through vite's SSR pipeline for the same reason `openroutes-sweep.mjs` is:
// the modules are TypeScript and import through the repo's `@/` alias.

import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUSHES = [0.2, 0.3, 0.45, 0.6, 0.8];
/** Radial is away from the anchor; the two tangents are along it, in both signs.
 *  `tangent+` and `tangent-` are not one case with a flag — a room is not symmetric
 *  about a piece, so sliding a nightstand left and sliding it right are two different
 *  rooms, and a sweep closed under negation cannot see anything that depends on which
 *  way it went. */
const DIRS = ['radial', 'tangent+', 'tangent-'];

const PRESETS = [
  ['rect', 5.6, 4.2],
  ['l', 6.0, 5.0],
  ['t', 6.0, 5.0],
  ['u', 6.0, 5.0],
  ['open', 6.0, 4.0],
];

const server = await createServer({
  configFile: false,
  root: ROOT,
  resolve: { alias: { '@': ROOT } },
  server: { middlewareMode: true },
  logLevel: 'warn',
});

let classified = 0;
let refusedAndRepairing = 0;

try {
  const solveMod = await server.ssrLoadModule('/lib/layout-solve.ts');
  const scoreMod = await server.ssrLoadModule('/lib/layout-score.ts');
  const spec = await server.ssrLoadModule('/lib/scene-spec.ts');
  const fp = await server.ssrLoadModule('/lib/footprint.ts');

  const { solveLayout, isWorthOffering, MIN_GAIN_ABS, MIN_GAIN_SHARE, HARD_TERMS } = solveMod;
  const { prepare, relationParents, costBreakdown, DEFAULT_WEIGHTS, NAV_CELL } = scoreMod;
  let skippedInBand = 0;
  let skippedNoMove = 0;

  /** In-band, per obligation, for one arrangement. The model's feet are SCRATCH — the
   *  file says one model, one evaluation at a time — so each call is taken to a plain
   *  array before the next one runs. Keyed by `child`, because an obligation belongs to
   *  the piece that owes it and the winning anchor may legitimately differ between two
   *  arrangements: "is this child's relation discharged" is the question, not "is it
   *  discharged by the same piece". */
  const bandsOf = (model, placements) => {
    const out = new Map();
    for (const e of relationParents(model, placements)) out.set(e.child, e.inBand);
    return out;
  };

  const rows = [];
  let bothAgree = 0;
  let anyOnly = 0;

  for (const [id, w, d] of PRESETS) {
    const poly = fp.footprintForLayout(id, w, d);
    const seeded = spec.defaultScene(id, w, d, { footprint: poly });
    const seedOrigin = seeded.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
    const seedModel = prepare({
      parts: seeded,
      movable: seeded.map((p) => !p.wallMounted),
      footprint: poly,
      origin: seedOrigin,
    });
    // Only pieces that OWE a relation and are currently discharging it. Pushing a piece
    // with no obligation cannot produce the case under test, and pushing one already out
    // of band measures the solver's ordinary work rather than this floor's.
    const inBandChildren = relationParents(seedModel, seedOrigin)
      .filter((e) => e.inBand)
      .map((e) => ({ child: e.child, parent: e.parent, d: e.d }));

    for (const e of inBandChildren) {
      for (const push of PUSHES) {
       for (const dir of DIRS) {
        // **Two directions, and having only the first is a bias that took a whole run to
        // see.** Radial — straight away from the anchor — is the axis the band is most
        // directly measured on, and it is also the axis that walks a piece toward a wall,
        // because furniture is usually anchored inward. In the first version every push
        // was radial and 32 of 35 rooms came back with `outside`, `door` or `navigation`
        // already non-zero: the sweep had conflated "out of band" with "through the
        // plaster", and a floor that is one cost unit cannot bind against a term weighted
        // 1000. TANGENTIAL is the nightstand slid ALONG the bed — the case the docblock
        // actually describes — and `obbGap` grows there too, so it leaves the band
        // without heading anywhere.
        const parts = seeded.map((p) => ({ ...p, pos: [...p.pos] }));
        const c = parts[e.child];
        const a = parts[e.parent];
        const dx = c.pos[0] - a.pos[0];
        const dz = c.pos[2] - a.pos[2];
        const len = Math.hypot(dx, dz) || 1;
        const ux = dir === 'radial' ? dx / len : -dz / len;
        const uz = dir === 'radial' ? dz / len : dx / len;
        const sign = dir === 'tangent-' ? -1 : 1;
        c.pos[0] += ux * push * sign;
        c.pos[2] += uz * push * sign;

        const origin = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
        const model = prepare({
          parts,
          movable: parts.map((p) => !p.wallMounted),
          footprint: poly,
          origin,
        });
        // **Every HARD term must still be zero.** A push that put the piece through a
        // wall, into a neighbour, across a door swing, inside an access zone or over a
        // route costs hundreds — the hard tier sits three orders of magnitude up — and a
        // floor that is one cost unit or a fifteenth of the total cannot bind there.
        //
        // `HARD_TERMS`, not `IMPOSSIBLE_TERMS`, and the first version of this filter used
        // the latter and let half the population through: `impossibility` is overlap and
        // outside only, so a floor lamp pushed 600 mm into a doorway read as legal and
        // arrived with `before` at 744. The two lists answer different questions and this
        // one wants the wider.
        const bd = costBreakdown(model, origin, DEFAULT_WEIGHTS, NAV_CELL);
        // **Which hard term fired is RECORDED rather than used to skip**, and that is a
        // correction to this script's own first version. Filtering on `HARD_TERMS` threw
        // away 88 of 150 rooms and left three to reason from — and the discarded ones are
        // not all the same thing. `overlap` / `outside` is a broken room. `access`,
        // `door` and `navigation` are FINDINGS: rooms the room report would flag and a
        // user would press Suggest in, which is the population this whole question is
        // about. Throwing them out silently would have answered a narrower question than
        // the one asked, and reported the answer as if it were the wider one.
        const firedHard = HARD_TERMS.filter((k) => bd[k] > 1e-9);
        const b0 = bandsOf(model, origin);
        // …and the push must have done what it was for.
        if (b0.get(e.child) !== false) { skippedInBand++; continue; }

        const locked = parts.map(() => false);
        const res = solveLayout(parts, poly, locked, { seed: 1, mode: 'arrange' });
        if (res.moved.length === 0) { skippedNoMove++; continue; }

        const b1 = bandsOf(model, res.placements);
        let gained = 0;
        let lost = 0;
        for (const [child, was] of b0) {
          const now = b1.get(child);
          if (now === undefined) continue;
          if (!was && now) gained++;
          else if (was && !now) lost++;
        }

        const worth = isWorthOffering(res.before, res.after);
        const any = gained > 0;
        const net = gained > lost;
        classified++;
        if (any === net) bothAgree++; else anyOnly++;
        if (!worth && net) refusedAndRepairing++;

        rows.push({
          room: `${id} ${w}x${d}`,
          n: `${parts[e.child].shape ?? e.child} ${dir} ${push.toFixed(2)}`,
          dir,
          before: res.before,
          after: res.after,
          gain: res.before - res.after,
          floor: Math.max(MIN_GAIN_ABS, MIN_GAIN_SHARE * res.before),
          worth,
          gained,
          lost,
          moved: res.moved.length,
          fixedIt: b1.get(e.child) === true,
          hard: firedHard.join('+') || '-',
          declined: res.declined ?? '-',
        });
       }
      }
    }
  }

  // ── The isolated instrument ────────────────────────────────────────────────
  //
  // The sweep above measures whole-room solves, where the solver moves several pieces
  // and the gain is the sum of everything it fixed. That is the realistic population and
  // it is NOT the docblock's claim. The claim is narrower: the price of a band miss
  // alone is below the offer floor, so a suggestion whose ONLY content is a relation
  // repair is priced as noise.
  //
  // So: push one child out of band, LOCK every other piece, and solve. The only move
  // available is the repair, which makes `before - after` the band's own price and
  // nothing else. This is the exact shape of the sentence in `bandCost`, end to end,
  // through the gate rather than through `chargeFor`.
  //
  // (`RoomTools` exempts a confined "Try a fix" from `isWorthOffering` — someone who
  // pressed it has asked for that finding cleared. That exemption is why this is an
  // INSTRUMENT and not a bug report about Try-a-fix: what it measures is what the
  // UNCONFINED Suggest path would do with the same repair.)
  const iso = [];
  for (const [id, w, d] of PRESETS) {
    const poly = fp.footprintForLayout(id, w, d);
    const seeded = spec.defaultScene(id, w, d, { footprint: poly });
    const seedOrigin = seeded.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
    const seedModel = prepare({
      parts: seeded,
      movable: seeded.map((p) => !p.wallMounted),
      footprint: poly,
      origin: seedOrigin,
    });
    for (const e of relationParents(seedModel, seedOrigin)) {
      if (!e.inBand) continue;
      for (const push of [0.3, 0.45]) {
        const parts = seeded.map((p) => ({ ...p, pos: [...p.pos] }));
        const c = parts[e.child];
        const a = parts[e.parent];
        const dx = c.pos[0] - a.pos[0];
        const dz = c.pos[2] - a.pos[2];
        const len = Math.hypot(dx, dz) || 1;
        c.pos[0] += (dx / len) * push;
        c.pos[2] += (dz / len) * push;
        const origin = parts.map((p) => ({ x: p.pos[0], z: p.pos[2], yaw: p.rot }));
        const model = prepare({
          parts,
          movable: parts.map((p) => !p.wallMounted),
          footprint: poly,
          origin,
        });
        const bd = costBreakdown(model, origin, DEFAULT_WEIGHTS, NAV_CELL);
        const hard = HARD_TERMS.filter((k) => bd[k] > 1e-9);
        const b0 = bandsOf(model, origin);
        if (b0.get(e.child) !== false) continue;
        const locked = parts.map((_, i) => i !== e.child);
        const res = solveLayout(parts, poly, locked, { seed: 1, mode: 'arrange' });
        if (res.moved.length === 0) continue;
        // **The inertia control, and it is the whole reason this column exists.** In
        // `arrange` mode the origin the search is anchored to is the PUSHED position, so
        // moving the piece back costs `inertia` — the term is charging the repair for
        // being a change. If the gap closes with the term switched off, the piece
        // stopping short of its band is a price the search is paying, not a limit of the
        // search. If it does not close, the search cannot reach the band and no offer
        // gate can rescue that.
        const free = solveLayout(parts, poly, locked, {
          seed: 1,
          mode: 'arrange',
          weights: { ...DEFAULT_WEIGHTS, inertia: 0 },
        });
        const eFree = free.moved.length
          ? relationParents(model, free.placements).find((x) => x.child === e.child)
          : null;
        const b1 = bandsOf(model, res.placements);
        const e0 = relationParents(model, origin).find((x) => x.child === e.child);
        const e1 = relationParents(model, res.placements).find((x) => x.child === e.child);
        const moveM = Math.hypot(
          res.placements[e.child].x - origin[e.child].x,
          res.placements[e.child].z - origin[e.child].z,
        );
        const gain = res.before - res.after;
        const floor = Math.max(MIN_GAIN_ABS, MIN_GAIN_SHARE * res.before);
        iso.push({
          room: `${id} ${w}x${d}`,
          piece: `${c.shape} +${push.toFixed(2)}`,
          before: res.before,
          gain,
          floor,
          worth: isWorthOffering(res.before, res.after),
          fixed: b1.get(e.child) === true,
          hard: hard.join('+') || '-',
          // The band question in metres, because "did it fix it" alone cannot tell a
          // solver that declined to move the piece from one that moved it and still
          // missed. `specId` is carried too: the winning ANCHOR may differ between the
          // two arrangements, and a child discharging a different obligation after the
          // solve is a third outcome again.
          d0: e0 ? e0.d : NaN,
          d1: e1 ? e1.d : NaN,
          spec0: e0 ? e0.specId : '-',
          spec1: e1 ? e1.specId : '-',
          moveM,
          dFree: eFree ? eFree.d : NaN,
          fixedFree: eFree ? eFree.inBand : false,
        });
      }
    }
  }
  console.log('\n── one piece out of band, every other piece LOCKED ──────────────────');
  console.log(
    'room         piece                 before     gain    floor  offered  band fixed   gap0   gap1   moved  gapF0  fixedF  hard terms',
  );
  for (const r of iso) {
    console.log(
      [
        r.room.padEnd(12),
        r.piece.padEnd(20),
        r.before.toFixed(2).padStart(8),
        r.gain.toFixed(2).padStart(8),
        r.floor.toFixed(2).padStart(8),
        (r.worth ? 'yes' : 'NO').padStart(8),
        (r.fixed ? 'yes' : 'no').padStart(11),
        r.d0.toFixed(2).padStart(6),
        r.d1.toFixed(2).padStart(6),
        r.moveM.toFixed(2).padStart(7),
        r.dFree.toFixed(2).padStart(6),
        (r.fixedFree ? 'yes' : 'no').padStart(7),
        '  ' + r.hard,
      ].join(' '),
    );
  }
  const isoBite = iso.filter((r) => !r.worth && r.fixed).length;
  const isoClean = iso.filter((r) => r.hard === '-');
  console.log(`\n  ${iso.length} isolated repairs`);
  console.log(`  refused by the floor AND repaired the band : ${isoBite}`);
  console.log(`  …of those, in a room with NO hard term     : ${isoClean.filter((r) => !r.worth && r.fixed).length}`);
  console.log(`  rooms with no hard term at all            : ${isoClean.length}`);

  if (classified === 0) {
    console.log('NOTHING TO CLASSIFY — every solve moved nothing. The sweep measures nothing.');
    process.exit(2);
  }

  console.log(
    '\nroom          n   before    after     gain   floor  offered  band+  band-  moved',
  );
  for (const r of rows) {
    console.log(
      [
        r.room.padEnd(12),
        String(r.n).padEnd(28),
        r.before.toFixed(2).padStart(8),
        r.after.toFixed(2).padStart(8),
        r.gain.toFixed(2).padStart(8),
        r.floor.toFixed(2).padStart(7),
        (r.worth ? 'yes' : 'NO').padStart(8),
        String(r.gained).padStart(6),
        String(r.lost).padStart(6),
        String(r.moved).padStart(6),
        r.fixedIt ? '  fixed' : '  ----',
        ('  ' + r.hard).padEnd(22),
      ].join(' '),
    );
  }

  const refusedAny = rows.filter((r) => !r.worth && r.gained > 0).length;
  const refused = rows.filter((r) => !r.worth).length;
  console.log(`\n${classified} solves classified across ${PRESETS.length} presets x ${PUSHES.length} pushes`);
  // No 'skipped as illegal' count here on purpose: the hard terms are RECORDED, not
  // filtered, so a zero on that line would have read as 'none were illegal' when it
  // meant 'nothing was skipped for that reason'. Two different facts, one number.
  console.log(`  skipped: ${skippedInBand} still in band after the push, ${skippedNoMove} moved nothing`);
  console.log(`  refused by the floor today                : ${refused}`);
  console.log(`  …of those, ANY relation came into band    : ${refusedAny}`);
  console.log(`  …of those, MORE came in than went out     : ${refusedAndRepairing}`);
  console.log(`  the two predicates AGREE on               : ${bothAgree} of ${classified}`);
  console.log(`  they DISAGREE on                          : ${anyOnly} of ${classified}`);
  console.log(
    anyOnly === 0
      ? '  → "any" and "net" are indistinguishable on this population; take the stricter one.'
      : '  → they differ, so the choice between them is a decision with evidence behind it.',
  );
} finally {
  await server.close();
}

process.exit(refusedAndRepairing > 0 ? 0 : 1);
