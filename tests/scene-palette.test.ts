import { describe, expect, it } from 'vitest';
import { SCENE, PLAN, defaultBodyColor, wallColor } from '../lib/scene-palette';
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

  it('stays in sync with the CSS tokens it duplicates', () => {
    // If a token in app/globals.css changes, these must be updated by hand —
    // that is the cost of Three.js not being able to read a custom property.
    expect(SCENE.accent).toBe('#E2613A'); // --accent
    expect(SCENE.accentHover).toBe('#5E8B6E'); // --accent-2
    expect(SCENE.invalid).toBe('#C8472A'); // --danger
    expect(SCENE.locked).toBe('#7A4B63'); // --locked
  });

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
