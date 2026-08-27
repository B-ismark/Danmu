import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIGHTINGS, type Lighting } from '@/lib/store';
import { LIGHTING } from '@/lib/lighting-moods';
import { sunDirection } from '@/lib/solar';

// One lighting mood is described in three places:
//
//   · `LIGHTINGS` in `lib/store.ts` — the vocabulary, and the persisted value.
//   · `LIGHTING` in `lib/lighting-moods.ts` — what the mood looks like, and where
//     a sun mood's light comes from.
//   · `MOODS` in `components/studio/ViewOptions.tsx` — its label and its chip.
//
// The first two are importable, so the assertions about them are real assertions
// about real values. The mood table was inside `components/three/Room.tsx` when
// this file was first written, which forced these checks to parse the component's
// source with regexes — brittle, and testing a *transcript* of the data rather
// than the data. Moving the table to `lib/` was the right fix for a reason that
// has nothing to do with tests (the north dial needs the same rows, and cannot
// import R3F), and it made this suite honest as a side effect. **If a check here
// ever needs a regex again, that is the signal the data is in the wrong place.**
//
// `ViewOptions` still gets read as text, because it is a client component holding
// icon names; that one check is the exception and says so.
//
// All three are typed `Record<Lighting, …>`, so a missing OR extra mood is
// already a compile error. What this file tests is what the compiler cannot see:
//
//   1. A sun mood whose elevation is at or below the horizon. `sunDirection`
//      returns null there — deliberately, a light shining up through the floor is
//      worse than no light — and `Room` renders no key light at all. The mood
//      appears in the panel, is selectable, and does nothing. Nothing throws,
//      nothing logs, and a screenshot of it looks like a dim room.
//   2. Four sun moods that all arrive from the same direction, which would be
//      four names for one picture.
//   3. A mood that is neither a studio look nor a sun angle, or somehow both.

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PICKER = src('components', 'studio', 'LightingPicker.tsx');
const TOOLTIP = src('components', 'ui', 'Tooltip.tsx');

/** The moods that name a sun angle, as `[name, angle]`. */
const suns = (Object.entries(LIGHTING) as Array<[Lighting, (typeof LIGHTING)[Lighting]]>)
  .flatMap(([name, mood]) => (mood.sun ? [[name, mood.sun] as const] : []));

describe('the lighting moods', () => {
  it('describes exactly the vocabulary, with no row left over', () => {
    // Belt and braces: `Record<Lighting, Mood>` makes both directions a type
    // error for an object literal, but nothing stops a future table being built
    // by a function or spread, where excess-property checking does not apply.
    expect(Object.keys(LIGHTING).sort()).toEqual([...LIGHTINGS].sort());
  });

  it('gives every mood a label, a hint and an icon', () => {
    // The one source-level check, because `LightingPicker` is a client component
    // and its `MOODS` holds icon names rather than data worth importing here.
    //
    // The `hint` matters as much as the label and is asserted with it: the control
    // is icon-only, so the label is all a sighted user gets from the tooltip, and
    // "Sunrise" versus "Sunset" is a difference of DIRECTION that no glyph and no
    // one-word label conveys. The hint is the half of the accessible name that
    // says "from the east".
    const start = PICKER.indexOf('const MOODS: Record<Lighting, { label: string; hint: string; icon: IconName }> = {');
    expect(start, 'MOODS should be a Record keyed by Lighting — that is the exhaustiveness check').toBeGreaterThan(-1);
    const inner = PICKER.slice(start, PICKER.indexOf('\n};', start));
    const named = [...inner.matchAll(/^ {2}(\w+): \{ label: '[^']+', hint: '[^']+',/gm)].map((m) => m[1]);
    expect(named.sort()).toEqual([...LIGHTINGS].sort());
  });

  it('reads its own name out on focus, not only on hover', () => {
    // An icon-only control whose name lives in a native `title` is unreadable to
    // anyone tabbing through — `title` never appears on keyboard focus. So the
    // tooltip has to be ours, and it has to open on focus as well as on hover.
    // Both are single properties that read as harmless to delete, which is why
    // they are pinned here rather than trusted.
    expect(PICKER, 'the picker should use ui/Tooltip, not a native title').toMatch(
      /import \{ Tooltip \} from '@\/components\/ui\/Tooltip'/,
    );
    expect(TOOLTIP, 'Tooltip must open on focus').toMatch(/onFocus=\{open\}/);
    expect(TOOLTIP, 'Tooltip must close on blur').toMatch(/onBlur=\{close\}/);
    // `position: fixed`, because every consumer sits in `.rail`, which is
    // `overflow: hidden` — an absolutely-positioned bubble is clipped at the
    // rail's edge, the failure `Select.tsx` and `RoomTools.tsx` both hit.
    expect(TOOLTIP).toMatch(/position: 'fixed'/);
  });

  it('makes every mood exactly one of a studio look or a sun angle', () => {
    for (const [name, mood] of Object.entries(LIGHTING)) {
      const kinds = [mood.key ? 'key' : null, mood.sun ? 'sun' : null].filter(Boolean);
      expect(kinds, `${name} should name a key light or a sun angle, not ${kinds.length}`).toHaveLength(1);
    }
  });

  it('puts every sun preset above the horizon, where it actually casts', () => {
    // The silent one. `sunDirection` returns null at or below 0°, so a preset
    // authored at, say, `elevationDeg: 0` for "just on the horizon" would ship a
    // mood with no key light: selectable, plausible-looking, and doing nothing.
    //
    // Two studio looks (Evening, Cool), three sun angles (Day, Sunrise, Sunset).
    // The count is asserted so that deleting the sun moods entirely cannot make
    // this pass by leaving nothing to check — the failure mode of every "for each
    // of the things I found" test.
    //
    // It was four. `Day` and `Noon` were merged (two names for bright overhead
    // light, and the survivor is the sun because a direction is the point), as
    // were `Golden` and `Sunset`. So `day` is a sun angle now, not a studio look.
    expect(suns).toHaveLength(3);

    for (const [name, { azimuthDeg, elevationDeg }] of suns) {
      expect(
        sunDirection(elevationDeg, azimuthDeg),
        `${name} is at ${elevationDeg}° — at or below the horizon, so it casts no light`,
      ).not.toBeNull();
    }
  });

  it('spreads the sun presets around the room rather than stacking them', () => {
    const azimuths = suns.map(([, a]) => a.azimuthDeg).sort((x, y) => x - y);
    for (let i = 1; i < azimuths.length; i++) {
      expect(
        azimuths[i] - azimuths[i - 1],
        `two presets are ${azimuths[i - 1]}° and ${azimuths[i]}° — the same direction`,
      ).toBeGreaterThan(30);
    }
  });

  it('gives them usefully different heights, not one height and four bearings', () => {
    // Elevation is what sets shadow length and colour temperature, so four
    // presets at the same height would differ only in direction — half a set.
    const elevations = suns.map(([, a]) => a.elevationDeg);
    expect(Math.max(...elevations) - Math.min(...elevations)).toBeGreaterThan(30);
  });

  it('no longer carries the mood that needed a latitude and a clock', () => {
    // The collapse's own guard. `'sun'` was one mood driven by four typed facts;
    // re-adding it by name would quietly reintroduce a `Site.lat`, a `Site.lon`, a
    // geolocation permission and a device-orientation read, none of which this app
    // has any more.
    expect(LIGHTINGS as readonly string[]).not.toContain('sun');
  });
});
