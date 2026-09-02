// The contract every shape in the catalogue has to satisfy.
//
// Adding a shape means touching eleven places (Design.md § Adding a shape lists them
// and is the prose half of this file). FIVE are places you put the shape and SIX are
// tables it otherwise inherits from its category — and of all eleven the compiler holds
// exactly ONE: `scene-palette`'s `BY_SHAPE`, the only exhaustive `Record<Shape, …>` in
// the tree. `CATALOG_SHAPES_ORDERED` is a `readonly Shape[]` and `PART_LIBRARY` a
// `LibraryItem[]`; omitting a shape from either compiles. That asymmetry is the whole
// reason this file exists: a `Partial<Record<Shape, …>>` is how a shape inherits
// behaviour it never declared, and inheriting is silent.
//
// The scar. `fan-standing` shipped with no row in `ANCHOR_BY_SHAPE`, so it took its
// CATEGORY's answer — and `fan` means the ceiling one. A 1300 mm pedestal fan hung
// from the slab at mesh-centre 2.65 m, spanning 2.00–3.30 m: half a metre through a
// 2.8 m ceiling. Nothing said so. `isObstacle` gates on `pos[1] < 0.05`, so the room
// report could not see it, the solver never priced it, `roleOf` returned 'other', and
// every catalogue-wide sweep in this suite stayed green — because each one asks
// whether a shape is PRESENT in some table, and this shape was present in all of
// them. Absence was never the defect; a wrong inherited answer was.
//
// So every clause below is phrased as a question about BEHAVIOUR at the catalogue's
// own default — where does this piece end up, can anything move it, can a person
// find it, can a photograph produce it — rather than about the presence of a row.
//
// Each `it` is one clause of the contract and its name is the rule. When one goes
// red, the message names the shape and the rule, and Design.md explains the rule.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PART_LIBRARY,
  CATALOG_SHAPES_ORDERED,
  CATEGORIES,
  SHAPES,
  refineShape,
  type Shape,
  type ScenePart,
} from '@/lib/scene-spec';
import { ROOM } from '@/lib/parts-catalog';
import { anchorFor, groundY, ridesWall, verticalExtent, wallAffinity } from '@/lib/physics';
import { isObstacle, roleOf } from '@/lib/layout-rules';
import { dimRangeFor } from '@/lib/dimension-ranges';
import { searchLibrary } from '@/lib/shape-search';
import { NAME_TO_SHAPE, WORLD_PROMPTS, WORLD_TO_CATEGORY } from '@/lib/local-detect';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** The lowest a ceiling fixture may hang at its catalogue size, in metres.
 *
 *  Not a building regulation and not tuned to pass: it is the line between the two
 *  things `anchorFor` can mean. Above it a piece is hung and you walk under it; below
 *  it a piece is standing in the room, and if it is hanging there it is because it
 *  lost its floor anchor. The catalogue's real fixtures clear it by 400 mm and more,
 *  so nothing here sits near the bound. */
const HEAD_CLEARANCE_M = 2.0;

/** A library entry as the scene would hold it, standing where the app puts it. */
function asPart(i: (typeof PART_LIBRARY)[number]): ScenePart {
  const y = groundY(i.category, i.shape, i.dimMM, ROOM.height);
  return {
    id: `x-${i.shape}`,
    name: i.label,
    category: i.category,
    shape: i.shape,
    pos: [0, y, 0],
    rot: 0,
    dimMM: i.dimMM,
    wallMounted: ridesWall(i.category, i.shape),
  } as ScenePart;
}

// ─── 1. It exists in every vocabulary ───────────────────────────────────────

describe('a catalogue shape is spelled the same everywhere', () => {
  it('offers every add-path shape from the real SHAPES union, once', () => {
    const seen = new Set<Shape>();
    for (const s of CATALOG_SHAPES_ORDERED) {
      expect(SHAPES, `${s} is offered by the picker but is not a Shape`).toContain(s);
      expect(seen.has(s), `${s} is listed twice in CATALOG_SHAPES_ORDERED`).toBe(false);
      seen.add(s);
    }
  });

  it('ships every Library entry as an add-path shape', () => {
    for (const i of PART_LIBRARY) {
      expect(
        CATALOG_SHAPES_ORDERED,
        `"${i.label}" can be added from the Library but is not in CATALOG_SHAPES_ORDERED, ` +
          'so no detector may name it',
      ).toContain(i.shape);
    }
  });

  it('draws every add-path shape with geometry of its own', () => {
    // A regex over a renderer, which this suite normally treats as a smell. The
    // exception is named rather than assumed: `ShapeDispatch` is a `switch` in TSX
    // whose arms are JSX elements, so there is no value to import and no table to
    // read — and the failure it guards is the quietest in the file. `ShapeDispatch` has
    // no `default:` arm, so a shape with no case of its own renders NOTHING at all: an
    // invisible, still-selectable, still-collidable piece of furniture.
    //
    // Its limit, named rather than left to be discovered: it sees a missing LABEL, not a
    // missing body. Delete the `return` under `case 'chest-freezer':` and it falls
    // through to the next arm's geometry with this clause still green.
    const src = read('components/three/DynamicPart.tsx');
    const missing = CATALOG_SHAPES_ORDERED.filter((s) => !src.includes(`case '${s}':`));
    expect(missing, `these shapes have no arm in ShapeDispatch: ${missing.join(', ')}`).toEqual([]);
  });
});

// ─── 2. It ends up where it belongs ─────────────────────────────────────────

describe('a shape lands somewhere the room can hold it', () => {
  it('fits between the floor and the ceiling at its catalogue size', () => {
    for (const i of PART_LIBRARY) {
      const y = groundY(i.category, i.shape, i.dimMM, ROOM.height);
      const [lo, hi] = verticalExtent(i.category, i.shape, i.dimMM, y);
      // This is the clause the standing fan failed: hung at mesh-centre 2.65 m it
      // spanned 2.00–3.30 m. Slack is one millimetre, not a tolerance — a piece is
      // either inside the room or it is a bug.
      //
      // **For a CEILING anchor this is now true by construction and cannot fail**, and
      // saying so is the point: `groundY` returns `roomHeight - MOUNT_PAD - h/2` for any
      // fixture over 300 mm, so `hi` is `roomHeight - MOUNT_PAD` whatever `h` is. It had
      // teeth against the pendant before that fix and has none now. The clause still
      // earns its place on the floor and wall anchors, where the arithmetic is not
      // circular — the ceiling case is guarded by the NEXT clause, which stays
      // falsifiable and is what killed the deleted-anchor mutation.
      //
      // It measures `verticalExtent`, which computes from `dimMM`, so it is blind to a
      // renderer drawing outside its own declared size. Two of them used to — the
      // pendant and the ceiling fan, `what-is-still-open.md` § 34, now fixed and swept
      // by `tests/ceiling-fixtures.test.ts`. The blindness is unchanged and is still
      // worth stating: this clause would not have caught them, and it would not catch
      // the next one.
      expect(lo, `"${i.label}" (${anchorFor(i.category, i.shape)}) starts ${lo.toFixed(2)} m — below the floor`).toBeGreaterThanOrEqual(-0.001);
      expect(
        hi,
        `"${i.label}" (${anchorFor(i.category, i.shape)}) reaches ${hi.toFixed(2)} m through a ${ROOM.height} m ceiling`,
      ).toBeLessThanOrEqual(ROOM.height + 0.001);
    }
  });

  it('hangs nothing from the ceiling that a person would walk into', () => {
    // Fitting inside the room is not enough, and finding that out is the reason this
    // clause exists rather than the one above alone. Deleting `fan-standing`'s anchor
    // row — the exact defect that shipped — no longer overflows the ceiling, because
    // the `groundY` fix hangs a deep fixture by its own half-height: a 1300 mm fan
    // comes to rest spanning 1.48–2.78 m. Inside the room, entirely, with its base
    // floating at chest height. The first clause goes green on it.
    //
    // So the ceiling case needs its own question, and it is what "hung from the
    // ceiling" actually means: you can walk under it. A ceiling fan clears 2.55 m, the
    // pendant 2.38 m, and a pedestal fan that has lost its floor anchor clears 1.48 m —
    // all three re-derived below rather than trusted from this comment.
    let hung = 0;
    for (const i of PART_LIBRARY) {
      if (anchorFor(i.category, i.shape) !== 'ceiling') continue;
      hung++;
      const y = groundY(i.category, i.shape, i.dimMM, ROOM.height);
      const [lo] = verticalExtent(i.category, i.shape, i.dimMM, y);
      expect(
        lo,
        `"${i.label}" hangs down to ${lo.toFixed(2)} m — under head height, so it is not a ` +
          'ceiling fixture, it is a floor piece that has lost its anchor row',
      ).toBeGreaterThanOrEqual(HEAD_CLEARANCE_M);
    }
    expect(hung, 'the catalogue ships ceiling fixtures and this found none').toBe(2);

    // **Pinned from BOTH sides, because this constant is the sole guard for the defect
    // this branch is named after.** Mutation testing found that with
    // `'fan-standing': 'floor'` deleted AND this lowered to 1.0, the whole suite was
    // green — 111 files, 2014 passed. Anything in [1.51, 2.40] was free, and under 1.50
    // the scar returns in silence. A bound asserted from one side is not a bound.
    expect(HEAD_CLEARANCE_M, 'a decision, not a threshold that drifted to fit').toBe(2.0);
    // The floor under it is DERIVED, not typed: where does a pedestal fan come to rest
    // if it loses its anchor row again? `lamp-pendant` is ceiling-anchored, so asking
    // `groundY` for it at the fan's own height runs the real ceiling rule without
    // restating it here.
    const fan = PART_LIBRARY.find((i) => i.shape === 'fan-standing');
    expect(fan, 'the fan this clause exists for is not in the catalogue').toBeDefined();
    const asIfHung = groundY('lamp', 'lamp-pendant', fan!.dimMM, ROOM.height) - fan!.dimMM[2] / 2000;
    expect(
      HEAD_CLEARANCE_M,
      `a fan that lost its anchor hangs at ${asIfHung.toFixed(2)} m and must be rejected`,
    ).toBeGreaterThan(asIfHung);
    // …and a ceiling over it, so it cannot drift up and start rejecting real fixtures.
    const lowest = Math.min(
      ...PART_LIBRARY.filter((i) => anchorFor(i.category, i.shape) === 'ceiling').map(
        (i) => verticalExtent(i.category, i.shape, i.dimMM, groundY(i.category, i.shape, i.dimMM, ROOM.height))[0],
      ),
    );
    expect(lowest, 'the lowest real fixture must clear the bound with room to spare').toBeGreaterThan(
      HEAD_CLEARANCE_M + 0.25,
    );
  });

  it('agrees with itself about whether it is on a wall', () => {
    // Two tables used to answer this, and they disagreed. `anchorFor` said a window is
    // `wall-mid`; `wallAffinity` looked up its CATEGORY, which is the `other`
    // catch-all, and told the solver `free` — park it in the middle of the room. The
    // disagreement survived because a window is rarely moved.
    //
    // `wallAffinity` derives the wall case from `ridesWall` now, so sweeping the
    // catalogue for a disagreement would be a check that cannot fail: it is true by
    // construction, for every input, including ones with the defect. What is worth
    // pinning is the derivation itself — that it fires where the table is silent, and
    // that it has not simply pinned everything to a wall.
    let wallRiders = 0;
    for (const i of PART_LIBRARY) {
      if (!ridesWall(i.category, i.shape)) continue;
      wallRiders++;
      expect(wallAffinity(i.category, i.shape), `"${i.label}"`).toBe('must-wall');
    }
    expect(wallRiders, 'the catalogue ships wall-mounted pieces and this found none').toBe(11);
    // The named case: `other` is `free`, and the window overrules it by anchor alone.
    expect(wallAffinity('other', 'window')).toBe('must-wall');
    expect(wallAffinity('other', 'box')).toBe('free');
    // …and the derivation must not have flattened the middle of the scale.
    expect(wallAffinity('sofa', 'sofa')).toBe('prefers-wall');
    expect(wallAffinity('rug', 'rug')).toBe('prefers-middle');
    expect(wallAffinity('chair', 'chair-dining')).toBe('free');
  });

  it('is something the room report and the solver can both see', () => {
    let obstacles = 0;
    for (const i of PART_LIBRARY) {
      const part = asPart(i);
      if (!isObstacle(part)) continue;
      obstacles++;
      // 'other' is a legal role for a ceiling fan, which nothing on the floor has to
      // make room for. For a piece standing IN the room it is not a description, it
      // is a gap: no access zone, nothing it belongs beside, and `RULE_HANDLING` has
      // no term that can move it.
      expect(
        roleOf(part),
        `"${i.label}" stands on the floor and blocks it, but its role is "other" — ` +
          'give it a row in ROLE_BY_SHAPE or ROLE_BY_CATEGORY',
      ).not.toBe('other');
    }
    // The one filtered loop here that had no count, which is exactly how a narrowed
    // `isObstacle` could make it iterate zero times and stay green.
    expect(obstacles, 'the catalogue is mostly floor-standing furniture').toBe(32);
  });
});

// ─── 3. It owns its size ────────────────────────────────────────────────────

describe('a shape states its own size bounds', () => {
  it('does not borrow a band from whichever category it was filed under', () => {
    // `dimRangeFor` falls through shape → category → FALLBACK, so a shape with no
    // band of its own silently takes its category's. That is how a 1250 mm chest
    // freezer would have been clamped to a 950 mm upright fridge's maximum: a
    // catalogue default the app itself refuses.
    //
    // Asked without exporting the table: if the shape owns its band, the answer is
    // the SAME OBJECT whatever category is passed.
    for (const s of CATALOG_SHAPES_ORDERED) {
      const own = dimRangeFor('other', s);
      const borrowed = CATEGORIES.find((c) => dimRangeFor(c, s) !== own);
      expect(
        borrowed,
        `${s} has no band of its own — filed under "${borrowed}" it would be clamped to ` +
          "that category's limits instead",
      ).toBeUndefined();
    }
  });

  it('admits the size the catalogue actually ships', () => {
    for (const i of PART_LIBRARY) {
      const r = dimRangeFor(i.category, i.shape);
      for (const ax of [0, 1, 2] as const) {
        expect(r.min[ax], `${i.shape} axis ${ax}: min is not below max`).toBeLessThan(r.max[ax]);
        expect(
          i.dimMM[ax] >= r.min[ax] && i.dimMM[ax] <= r.max[ax],
          `"${i.label}" ships ${i.dimMM[ax]} mm on axis ${ax}, outside its own ${r.min[ax]}–${r.max[ax]} band`,
        ).toBe(true);
      }
    }
  });
});

// ─── 4. A person can find it ────────────────────────────────────────────────

describe('a shape is reachable by the two things a person types', () => {
  it('comes back first when its own name is searched', () => {
    for (const i of PART_LIBRARY) {
      const hits = searchLibrary(i.label, 5);
      expect(hits[0]?.label, `searching "${i.label}" does not put it first`).toBe(i.label);
    }
  });

  it('leaves no group heading empty', () => {
    const groups = new Set(PART_LIBRARY.map((i) => i.group));
    for (const g of groups) {
      expect(PART_LIBRARY.filter((i) => i.group === g).length, `group "${g}"`).toBeGreaterThan(0);
    }
    // The picker renders one heading per group present; a group named in the type
    // but shipped empty is a heading with nothing under it.
    expect(groups.size, 'every group in the LibraryItem union should ship something').toBe(8);
  });
});

// ─── 5. A photograph can produce it ─────────────────────────────────────────

describe('the detector and the app agree on what the labels mean', () => {
  it('mirrors the prompt order the model was exported with', () => {
    // Two sources of truth for one frozen list. `set_classes(list(WORLD_VOCAB))`
    // bakes the CLIP text embeddings into the graph in KEY ORDER, so channel N of the
    // model's output IS `WORLD_PROMPTS[N]`. Insert one prompt in the middle here and
    // every label after it comes back shifted by one — no crash, no warning, just a
    // detector that reports a sofa as an armchair. Nothing checked this until now.
    const py = read('scripts/export-detector.py');
    const body = py.slice(py.indexOf('WORLD_VOCAB = {'), py.indexOf('\n}', py.indexOf('WORLD_VOCAB = {')));
    const keys = [...body.matchAll(/"([^"]+)":\s*"[^"]+"/g)].map((m) => m[1]);
    expect(keys.length, 'no prompts parsed out of export-detector.py — the parse is wrong, not the data').toBeGreaterThan(20);
    expect(
      [...WORLD_PROMPTS],
      'WORLD_PROMPTS has drifted from WORLD_VOCAB in scripts/export-detector.py. ' +
        'They are the model class-channel order; re-export the graph rather than editing one side.',
    ).toEqual(keys);
  });

  it('maps every prompt it asks the model for', () => {
    for (const p of WORLD_PROMPTS) {
      expect(
        WORLD_TO_CATEGORY[p],
        `"${p}" is asked of the model but maps to no category, so every hit on it is dropped`,
      ).toBeDefined();
    }
  });

  it('never refines a label into a shape no detector may name', () => {
    // `NAME_TO_SHAPE` answers first for the handful of labels whose category is the
    // `other` catch-all, and `refineShape` is never consulted for them — its `other`
    // branch returns a plain box. Skipping them is the difference between testing the
    // pipeline and testing a call the pipeline does not make; asserting on them would
    // have demanded a fix to a path with no defect in it.
    let checked = 0;
    for (const p of WORLD_PROMPTS) {
      const c = WORLD_TO_CATEGORY[p];
      if (!c || NAME_TO_SHAPE[p]) continue;
      const s = refineShape(c, p);
      expect(CATALOG_SHAPES_ORDERED, `"${p}" refines to ${s}, which is not an offered shape`).toContain(s);
      checked++;
    }
    // …and the skip must not be able to swallow the sweep: a typo in the guard that
    // skipped every prompt would leave this a green loop over nothing.
    expect(checked, 'the label sweep checked almost nothing').toBe(40);
  });

  it('tells a pedestal fan from a ceiling fan', () => {
    // The label layer of the same defect: `electric fan` is what the exported
    // vocabulary calls a pedestal fan, and with no `fan` case in `refineShape` it took
    // the category default — the ceiling one. Geometry fidelity cannot help here;
    // the detector never sees our meshes, only its own label.
    expect(refineShape('fan', 'electric fan')).toBe('fan-standing');
    expect(refineShape('fan', 'standing fan')).toBe('fan-standing');
    expect(refineShape('fan', 'pedestal fan')).toBe('fan-standing');
    expect(refineShape('fan', 'ceiling fan')).toBe('fan');
    // A bare label keeps the old default rather than being silently re-answered.
    expect(refineShape('fan', 'fan')).toBe('fan');
    // The case that makes the ceiling branch load-bearing rather than decorative.
    // Cloud labels are free noun phrases, not a fixed vocabulary, and "ceiling fan over
    // the dining table" is an ordinary thing for one to say — `table` is a standing-fan
    // word, so with the ceiling test removed this label lands on the floor. Checked by
    // deleting that line and watching this go red; without it the mutation survived,
    // because for every SINGLE-word label the branch and the default agree.
    expect(refineShape('fan', 'ceiling fan over the dining table')).toBe('fan');
  });

  it('tells the other three new shapes from their neighbours', () => {
    expect(refineShape('fridge', 'chest freezer')).toBe('chest-freezer');
    expect(refineShape('fridge', 'deep freezer')).toBe('chest-freezer');
    expect(refineShape('fridge', 'refrigerator')).toBe('fridge');
    expect(refineShape('shelf', 'tv console')).toBe('tv-console');
    expect(refineShape('shelf', 'media unit')).toBe('tv-console');
    expect(refineShape('shelf', 'bookshelf')).toBe('bookshelf');
    expect(refineShape('chair', 'bar stool')).toBe('stool');
    // "footstool" contains "stool" and is an ottoman. Order in the switch decides it,
    // which is exactly the kind of thing that holds by accident until someone tidies.
    expect(refineShape('chair', 'footstool')).toBe('ottoman');
    // …and "TV cabinet" is a TV console, not a wardrobe, for the same reason.
    expect(refineShape('shelf', 'tv cabinet')).toBe('tv-console');
    expect(refineShape('shelf', 'storage cabinet')).toBe('wardrobe');
  });
});
