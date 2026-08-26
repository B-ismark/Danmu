import type { Lighting } from './store';

// What each lighting mood looks like. Read by the 3D scene (`Room`), by the
// north dial that explains where a sun mood comes from (`NorthDial`), and by
// `tests/lighting-moods.test.ts`.
//
// It lived inside `Room.tsx` first, which was wrong for the reason rule 3 of
// CLAUDE.md gives about `layout-rules.ts`: the moment a second consumer needs
// the same numbers, a table inside one renderer becomes a table each consumer
// copies. That was not hypothetical here — the dial had drawn the sun on its rim
// for as long as the sun existed, and moving the angles into a component the
// rail cannot import (R3F) is what silently dropped the marker. The dial now
// reads the same row the light does.
//
// Hex rather than a token because none of these can be reached from CSS — the
// same reason `lib/scene-palette.ts` exists, and the reason this belongs in
// `lib/` beside it rather than in a renderer. These are LIGHT colours, not
// surfaces the user can recolour, so rule 4 has nothing to say about them
// beyond where they live.
// Lighting moods — background, hemisphere sky/ground, key + fill, and the
// emissive environment panels all shift together so the room reads as daylight,
// warm evening, or cool overcast.
//
// These are the AMBIENT conditions only. Since lamps became real emitters
// (components/three/PartLight.tsx) the moods no longer have to fake the whole
// result: Evening in particular is pulled well down, because its job is to leave
// room for the fixtures in the scene rather than to be an orange filter over a
// fully-lit room. A room with no lamps in it will read as genuinely dim at
// Evening — which is correct, and is what a lighting study is for.
//
// A mood is one of two kinds, and the type says so rather than leaving a dead
// field on half the rows:
//
//   · a **studio look** — it names its own `key` light, and that is the whole
//     answer;
//   · a **sun angle** — it names an azimuth and an elevation, and the key light's
//     direction, colour and strength are all DERIVED from those two numbers
//     (`sunDirection`, `daylightKelvin`, and the air-mass term below). So the
//     table holds two facts about the sky and none about the look, which is what
//     stops Sunrise and Sunset drifting apart in colour while agreeing on height.
//
// The four sun angles replaced a single 'sun' mood that computed a real solar
// position from a latitude, a longitude, a date and a clock. See the header of
// `lib/solar.ts` for why that went: they are the four moments it existed to
// reach, and the only one of its inputs whose effect is visible at furniture
// scale — the room's own bearing — is still the user's (`Site.bearingDeg`).
//
// `Record<Lighting, Mood>` rather than a bare object: it is the exhaustiveness
// check. A mood added to `LIGHTINGS` and not to this table is a compile error
// here, instead of an `undefined` row that takes the scene down on first paint.
export type Mood = {
  bg: string;
  hemi: [string, string, number];
  fill: { color: string; intensity: number };
  env: [string, string, string];
  /** Scales the studio environment with the mood. Dimming the three lights and
   *  leaving this at full strength was the reason a "dark" Evening still read as
   *  a fully-lit amber room: every material has envMapIntensity 0.5, so the
   *  environment was quietly supplying most of the light in the scene. */
  envMul: number;
  exposure: number;
} & (
  | { key: { color: string; intensity: number }; sun?: undefined }
  /** Degrees clockwise from true north, and degrees above the horizon. */
  | { sun: { azimuthDeg: number; elevationDeg: number }; key?: undefined }
);

export const LIGHTING: Record<Lighting, Mood> = {
  day: {
    bg: '#FBF8F2',
    hemi: ['#ffffff', '#cfc7b6', 0.85] as [string, string, number],
    key: { color: '#fff4e2', intensity: 1.1 },
    fill: { color: '#dfe7ff', intensity: 0.25 },
    env: ['#fffaf0', '#eef3ff', '#fff3e0'] as [string, string, string],
    envMul: 1,
    exposure: 1.0,
  },
  evening: {
    bg: '#27201C',
    // Ambient pulled down hard — this is the mood where the lamps are supposed to
    // do the work. At the old levels (hemi 0.5, key 1.25) a shadeless room was
    // already fully lit, so adding a real 800 lm floor lamp changed nothing
    // visible and the whole point was lost.
    hemi: ['#ffd9a8', '#3a2c20', 0.07] as [string, string, number],
    key: { color: '#ffb15e', intensity: 0.12 },
    fill: { color: '#6a4b8a', intensity: 0.06 },
    env: ['#ffce93', '#ff9d5c', '#5b4a8a'] as [string, string, string],
    envMul: 0.2,
    exposure: 1.15,
  },
  cool: {
    bg: '#EAEEF1',
    hemi: ['#eaf1ff', '#c4cdd4', 0.95] as [string, string, number],
    key: { color: '#eef4ff', intensity: 0.95 },
    fill: { color: '#d6e2ee', intensity: 0.4 },
    env: ['#f2f6ff', '#dfe9f5', '#e8eef5'] as [string, string, string],
    envMul: 1,
    exposure: 0.95,
  },
  // ── The four sun angles ────────────────────────────────────────────────────
  //
  // Their ambient terms are the SKY, not the sun: anything they contribute is
  // light the sun is not responsible for, which is why they all sit lower than
  // 'day'. The point of these moods is to see exactly where the sun does and
  // does not reach, and an ambient term generous enough to be flattering is an
  // ambient term that fills the shadow you were trying to look at.
  //
  // The angles are a temperate mid-latitude, which is a stated choice rather
  // than a guess dressed as a fact: they are not offered as this room's real
  // sun, and nothing in the UI claims a date or a place. What they are is four
  // usefully different directions with four usefully different heights — which
  // is the entire question someone arranging furniture asks of the sun.
  sunrise: {
    bg: '#F3E9E2',
    hemi: ['#ffd9be', '#8f7f70', 0.3] as [string, string, number],
    sun: { azimuthDeg: 78, elevationDeg: 7 },
    fill: { color: '#b9c6e0', intensity: 0.1 },
    env: ['#ffe6cf', '#f2ded2', '#e8e0dc'] as [string, string, string],
    envMul: 0.55,
    exposure: 1.05,
  },
  noon: {
    bg: '#EDF1F5',
    hemi: ['#cfe0f5', '#b8ad98', 0.35] as [string, string, number],
    sun: { azimuthDeg: 180, elevationDeg: 58 },
    fill: { color: '#cfe0f5', intensity: 0.12 },
    env: ['#eef5ff', '#e6eefb', '#f6f1e6'] as [string, string, string],
    envMul: 0.7,
    exposure: 1.0,
  },
  golden: {
    bg: '#F5E7D5',
    hemi: ['#ffdfae', '#94826b', 0.28] as [string, string, number],
    sun: { azimuthDeg: 252, elevationDeg: 14 },
    fill: { color: '#c2c9e2', intensity: 0.1 },
    env: ['#ffeacc', '#f6dcc0', '#ece2d6'] as [string, string, string],
    envMul: 0.6,
    exposure: 1.05,
  },
  sunset: {
    bg: '#E9DAD2',
    hemi: ['#ffc79b', '#7d6c60', 0.24] as [string, string, number],
    sun: { azimuthDeg: 285, elevationDeg: 2 },
    fill: { color: '#a9b3cc', intensity: 0.09 },
    env: ['#ffdcbb', '#efcbb4', '#ded4cf'] as [string, string, string],
    envMul: 0.5,
    exposure: 1.1,
  },
};
