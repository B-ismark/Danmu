import { describe, expect, it } from 'vitest';
import { SCENE, PLAN, DETAIL, DECOR, defaultBodyColor, wallColor } from '../lib/scene-palette';
import type { Category, Shape } from '../lib/scene-spec';

// The point of this module is that the 3D layer, the exported plan, and the
// panels that edit them read ONE set of values. These tests guard the properties
// that regressed before it existed: a semantic rendering as different colours in
// different files, and a lookup silently falling through.

// Every member of each union, listed literally. This is the REAL key space —
// which is what the previous version of this test got wrong. It asserted over
// material-group names ('seating', 'wall') that no caller has ever passed, so it
// could not see that eighteen of the twenty-two categories were collapsing onto
// a single tan default.
const CATEGORIES: Category[] = [
  'sofa', 'tv', 'chair', 'table', 'lamp', 'plant', 'shelf', 'rug', 'bed', 'desk',
  'monitor', 'fan', 'fridge', 'wardrobe', 'curtain', 'mirror', 'painting',
  'nightstand', 'ottoman', 'ac', 'door', 'other',
];

const SHAPES: Shape[] = [
  'sofa', 'tv', 'closet', 'rug', 'plant',
  'chair-dining', 'chair-office', 'chair-armchair', 'ottoman',
  'bed-single', 'bed-double',
  'desk-standard', 'desk-l', 'coffee-table', 'side-table', 'nightstand',
  'lamp-floor', 'lamp-table', 'lamp-pendant',
  'mirror', 'mirror-oval', 'painting', 'ac-unit', 'window',
  'monitor', 'laptop', 'fan', 'fridge', 'wardrobe', 'curtain',
  'bookshelf', 'shoe-rack', 'door',
  'soundbar', 'radiator', 'air-purifier', 'washing-machine', 'microwave',
  'water-dispenser',
  'box', 'cylinder', 'plane',
];

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('scene palette', () => {
  it('exposes every semantic the scene and inspector share', () => {
    for (const key of ['accent', 'accentHover', 'invalid', 'locked', 'lockedTint', 'wall', 'floor', 'ceiling'] as const) {
      expect(SCENE[key], key).toMatch(HEX);
    }
  });

  it('keeps selection and hover visually distinct', () => {
    expect(SCENE.accent).not.toBe(SCENE.accentHover);
  });

  // The sync guard that used to live here asserted `SCENE.accent === '#E2613A'`
  // — a literal against a literal, both inside this test's own reach. Editing the
  // token in app/globals.css and forgetting scene-palette left it green, which is
  // the entire failure it was written to catch. It reads the stylesheet now, and
  // lives in tests/color-tokens.test.ts with the rest of the colour maths.

  it('exposes the default wall paint', () => {
    expect(wallColor()).toBe(SCENE.wall);
  });
});

describe('plan export palette', () => {
  it('exposes every value the canvas export draws with', () => {
    for (const [key, value] of Object.entries(PLAN)) {
      expect(value, key).toMatch(HEX);
    }
  });

  it('stays in sync with the CSS tokens it duplicates', () => {
    expect(PLAN.paper).toBe('#FBF8F2'); // --paper
    expect(PLAN.ink).toBe('#2A2520'); // --ink
    expect(PLAN.ink2).toBe('#5A5147'); // --ink-2
    expect(PLAN.accent).toBe(SCENE.accent);
  });

  it('never reintroduces the retired CAD blue', () => {
    // #3A78C2 / #6E94C8 / #7AA4D2 / #3E8FD8 were an institutional blue that
    // belonged to no part of the brand. The plan export carried #3E8FD8 for its
    // wall-mounted ticks and legend numerals long after the 3D layer dropped it,
    // because it kept a private hex set instead of reading this module.
    const retired = ['#3a78c2', '#6e94c8', '#7aa4d2', '#3e8fd8'];
    for (const [key, value] of Object.entries(PLAN)) {
      expect(retired, key).not.toContain(value.toLowerCase());
    }
  });
});

describe('defaultBodyColor', () => {
  it('gives every shape a hex', () => {
    for (const shape of SHAPES) {
      expect(defaultBodyColor('other', shape), shape).toMatch(HEX);
    }
  });

  it('gives every category a hex through the generic primitives', () => {
    for (const category of CATEGORIES) {
      expect(defaultBodyColor(category, 'box'), category).toMatch(HEX);
    }
  });

  it('distinguishes shapes inside one category', () => {
    // The bug this guards: a lookup keyed on category alone cannot tell a walnut
    // dining chair from a charcoal office chair, so the Inspector's "Default for
    // this piece" swatch showed one colour for both — and matched neither.
    expect(defaultBodyColor('chair', 'chair-dining')).not.toBe(
      defaultBodyColor('chair', 'chair-office'),
    );
    expect(defaultBodyColor('table', 'coffee-table')).not.toBe(
      defaultBodyColor('table', 'side-table'),
    );
  });

  it('does not collapse most categories onto one default', () => {
    const distinct = new Set(CATEGORIES.map((c) => defaultBodyColor(c, 'box')));
    expect(distinct.size).toBeGreaterThan(CATEGORIES.length / 2);
  });

  it('resolves a generic primitive by its category, not by the primitive', () => {
    // A low-confidence detection labelled "bed" should read as a bed rather than
    // as anonymous filler.
    expect(defaultBodyColor('bed', 'box')).toBe(defaultBodyColor('bed', 'bed-single'));
    expect(defaultBodyColor('fridge', 'cylinder')).toBe(defaultBodyColor('fridge', 'fridge'));
  });
});

describe('furniture detail + decor palettes', () => {
  it('exposes every detail colour as a full hex', () => {
    for (const [key, value] of Object.entries(DETAIL)) {
      expect(value, key).toMatch(HEX);
    }
  });

  it('gives every decor kind a non-empty set of distinct colours', () => {
    for (const [kind, set] of Object.entries(DECOR)) {
      expect(set.length, kind).toBeGreaterThan(1);
      for (const c of set) expect(c, kind).toMatch(HEX);
      // A repeat inside one set is a colour that shows up twice as often as it
      // looks like it will, which is not a decision anybody made.
      expect(new Set(set).size, kind).toBe(set.length);
    }
  });

  // ── The guard that matters ────────────────────────────────────────────────
  // This module's whole reason for existing is that a shared colour written out
  // in several renderers is several colours pretending to be one — and that is
  // exactly what was found here: `Box`'s outline, dark walnut legs, near-black
  // hardware, and TWO different book-spine palettes (`Dressing` had six spines,
  // `BookshelfGeo` eight, so the books on a shelf did not match the books beside
  // it). Adding them to this file fixes today; this stops tomorrow.
  it('is not re-declared as a literal in any renderer', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'components', 'three');
    const owned = new Set(
      [...Object.values(DETAIL), ...Object.values(DECOR).flat()].map((c) => c.toLowerCase()),
    );
    // Three-digit shorthand counts: '#222' and '#222222' are the same colour to
    // the renderer and a different string to a grep, which is how one of these
    // survived a previous sweep.
    const expand = (h: string) =>
      h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;

    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      for (const m of src.matchAll(/#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?\b/g)) {
        const hex = expand(m[0]).toLowerCase();
        if (owned.has(hex)) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders, 'read it from lib/scene-palette instead').toEqual([]);
  });
});
