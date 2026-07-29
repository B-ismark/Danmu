import { describe, expect, it } from 'vitest';
import { SCENE, categoryColor } from '../lib/scene-palette';

// The point of this module is that the 3D layer and the panels that edit it read
// ONE set of values. These tests guard the two properties that regressed before
// it existed: a semantic rendering as different colours in different files, and
// an unknown category falling through to nothing.
describe('scene palette', () => {
  it('exposes every semantic the scene and inspector share', () => {
    for (const key of ['accent', 'accentHover', 'invalid', 'locked', 'lockedTint', 'wall', 'floor', 'ceiling'] as const) {
      expect(SCENE[key], key).toMatch(/^#[0-9A-Fa-f]{6}$/);
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

  it('gives every known category its own default and never returns undefined', () => {
    expect(categoryColor('seating')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(categoryColor('plant')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(categoryColor('wall')).toBe(SCENE.wall);
    expect(categoryColor('not-a-real-category')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
