// The contract every shape in the catalogue has to satisfy.
//
// Adding a shape means touching seven places (Design.md § Adding a shape lists
// them). Five are held by the compiler — an `as const` array, a union derived from
// it, two exhaustive `Record<Shape, …>`s. The other two are not, and that asymmetry
// is the whole reason this file exists: `Partial<Record<Shape, …>>` tables are how
// a shape inherits behaviour it never declared, and inheriting is silent.
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
    // read — and the failure it guards is the quietest in the file. A shape with no
    // arm falls to the default box, renders at the right SIZE, and so looks like a
    // deliberately blocky piece of furniture rather than a missing one.
    const src = read('components/three/DynamicPart.tsx');
    const missing = CATALOG_SHAPES_ORDERED.filter((s) => !src.includes(`case '${s}':`));
    expect(missing, `these shapes fall through to the default box: ${missing.join(', ')}`).toEqual([]);
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
      expect(lo, `"${i.label}" (${anchorFor(i.category, i.shape)}) starts ${lo.toFixed(2)} m — below the floor`).toBeGreaterThanOrEqual(-0.001);
      expect(
        hi,
        `"${i.label}" (${anchorFor(i.category, i.shape)}) reaches ${hi.toFixed(2)} m through a ${ROOM.height} m ceiling`,
      ).toBeLessThanOrEqual(ROOM.height + 0.001);
    }
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
    expect(wallRiders, 'the catalogue ships wall-mounted pieces and this found none').toBeGreaterThan(5);
    // The named case: `other` is `free`, and the window overrules it by anchor alone.
    expect(wallAffinity('other', 'window')).toBe('must-wall');
    expect(wallAffinity('other', 'box')).toBe('free');
    // …and the derivation must not have flattened the middle of the scale.
    expect(wallAffinity('sofa', 'sofa')).toBe('prefers-wall');
    expect(wallAffinity('rug', 'rug')).toBe('prefers-middle');
    expect(wallAffinity('chair', 'chair-dining')).toBe('free');
  });

  it('is something the room report and the solver can both see', () => {
    for (const i of PART_LIBRARY) {
      const part = asPart(i);
      if (!isObstacle(part)) continue;
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
    expect(checked, 'the label sweep checked almost nothing').toBeGreaterThan(30);
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
