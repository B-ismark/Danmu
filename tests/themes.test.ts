import { describe, it, expect } from 'vitest';
import { THEMES, themeColorFor } from '@/lib/themes';
import { LIGHTINGS } from '@/lib/store';
import { parseHex } from './helpers/color';

// The one-tap themes.
//
// The user's report was that "some of the lighting and the style override each
// other". Two things came out of it. The override itself is fixed in
// `PartTree.tsx` — a theme chip reports the COLOURS now, so changing the light no
// longer unticks it. And the set went from five to four: `Coastal` and `Studio Loft`
// both set `cool`, so two of the five swatches offered the same lighting mood, and
// they are `Cool Neutral`.
//
// The honest note, because the reasoning I gave for that merge was partly wrong.
// I said the two were near-duplicates on COLOUR as well as on mood. They are not —
// see the measurement in the duplicate test below, which puts them among the most
// distinct pairs in the set and the actual close pairs elsewhere. The merge stands on
// the lighting overlap alone, which was the half of the report that was about
// overriding. Whether a different pair should have gone instead is the user's call
// and the numbers are in front of them.
//
// A redundant pair is invisible to every other gate — it typechecks, lints and
// renders, and looks like a full set until someone presses both. What this file can
// pin without inventing a threshold is below.

const rgb = (hex: string) => {
  const c = parseHex(hex);
  expect(c, `unparseable hex ${hex}`).not.toBeNull();
  return c!;
};

/** The four roles a theme paints, in a fixed order, so two themes can be compared
 *  role by role rather than as unordered bags of colour. */
const ROLE_CATEGORIES = ['table', 'sofa', 'lamp', 'ac'] as const;

describe('the one-tap themes', () => {
  it('has a set worth showing', () => {
    // The count is not the point; having any is. Without this the loops below pass
    // over an empty list and report a perfectly distinct set of nothing.
    expect(THEMES.length).toBeGreaterThanOrEqual(3);
    // Four 30px swatches and three gaps are 138px, against the 176px of content the
    // narrowest rail affords. Six would be 186px and would wrap, which is the real
    // ceiling on this set — recorded here because the number lives in a comment in
    // `PartTree.tsx` and a comment is not a gate.
    expect(THEMES.length * 30 + (THEMES.length - 1) * 6).toBeLessThanOrEqual(176);
  });

  it('gives every theme a unique id and label', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.label)).size).toBe(THEMES.length);
  });

  it('sets a lighting mood that exists', () => {
    // `Theme.lighting` is typed `Lighting`, so this cannot fail at compile time —
    // but a mood removed from `LIGHTINGS` and left in a theme row would be a
    // `setLighting` call with a value the store's own validator refuses.
    for (const t of THEMES) {
      expect(LIGHTINGS as readonly string[], t.id).toContain(t.lighting);
    }
  });

  it('shows three parseable colours per swatch', () => {
    for (const t of THEMES) {
      expect(t.swatch, t.id).toHaveLength(3);
      for (const hex of t.swatch) rgb(hex);
    }
  });

  it('paints every role with a parseable colour', () => {
    for (const t of THEMES) {
      for (const cat of ROLE_CATEGORIES) rgb(themeColorFor(cat, t));
    }
  });

  it('makes no two themes paint an identical room', () => {
    // The merge's guard, and it is deliberately a guard against a DUPLICATE rather
    // than against a near-duplicate. The first version of this assertion had a
    // `deltaEOk` threshold and a comment claiming `Coastal` against `Studio Loft`
    // averaged 0.089 across the four roles. That number was invented — I never
    // measured it — and measuring the set said something else entirely:
    //
    //     warm-min vs coastal      0.073   <- closest pair in the original five
    //     heritage vs afro-mod     0.078
    //     studio   vs afro-mod     0.138
    //     heritage vs studio       0.168
    //     warm-min vs afro-mod     0.266   <- same `day` mood, and STILL IN THE SET
    //     warm-min vs heritage     0.277
    //     warm-min vs studio       0.279
    //     coastal  vs studio       0.304   <- same `cool` mood; the pair that was MERGED
    //     coastal  vs heritage     0.317
    //     coastal  vs afro-mod     0.321
    //
    // So the pair that read as redundant was the third most DISTINCT pair in the set
    // by this metric, and the two closest pairs are one warm-pale against one
    // cool-pale, and one dark-brown against one dark-rust. Which tells you the metric
    // is wrong for the question rather than that the set is: mean `deltaEOk` over the
    // tones is dominated by lightness, so it scores two pale palettes as similar even
    // when one is beige and the other sage — a difference that is obvious the instant
    // you press both, because a whole-room hue shift is perceptually loud at a small
    // per-colour distance.
    //
    // A threshold tuned until the current set passes it is not a gate, it is a
    // record of today's palette wearing a gate's clothes. What IS worth pinning is
    // the thing that needs no threshold: two themes must not paint the same room.
    // That catches the copy-paste — a new row added by duplicating an old one and
    // changing only the label, which is how a set grows a real duplicate.
    const painted = THEMES.map((t) => ROLE_CATEGORIES.map((c) => themeColorFor(c, t)).join('/'));
    expect(new Set(painted).size, `two themes paint the same room: ${painted.join(' | ')}`).toBe(
      THEMES.length,
    );
    // Nor the same room under a different lighting mood — swatch, tones AND mood.
    const whole = THEMES.map((t, i) => `${painted[i]}@${t.lighting}`);
    expect(new Set(whole).size).toBe(THEMES.length);
  });

  it('keeps the two values the merge was supposed to keep', () => {
    // `Cool Neutral` exists to carry the useful half of each side rather than to be
    // whichever of the two happened to be listed first: Coastal's sage accent, which
    // is the hue that distinguished it from a grey room, and Studio Loft's charcoal
    // case goods, which is what gave that one its weight. Losing either would make
    // the merge a deletion, which is not what was asked for.
    const merged = THEMES.find((t) => t.id === 'cool-neutral');
    expect(merged, 'the merged cold neutral is gone').toBeTruthy();
    expect(merged!.tones.accent.toUpperCase()).toBe('#7C9C8E');
    expect(merged!.tones.wood.toUpperCase()).toBe('#5B554E');
    // And the two ids it replaced are not still hanging around beside it.
    expect(THEMES.map((t) => t.id)).not.toContain('coastal');
    expect(THEMES.map((t) => t.id)).not.toContain('studio');
  });
});
