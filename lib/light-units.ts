// Real lighting units, so a lamp in the scene is described the way a lamp on a
// shelf is: in lumens off the box and a colour temperature in kelvin.
//
// three.js lights have been photometric since r155 — point and spot intensity is
// in CANDELA with `decay = 2`. So the conversion below is the actual interface to
// the renderer, not a fudge factor, and it is what makes two lamps in one room
// relate to each other correctly: a 400 lm bedside lamp really is half a 800 lm
// floor lamp.
//
// (The absolute level is a separate question — see LIGHT_SCALE in
// components/three/PartLight.tsx. The scene's exposure is artistic, not
// photometric, so the ratios come from here and the overall level is set there.)

/** Luminous intensity of a bulb radiating equally in all directions.
 *
 *  A sphere is 4π steradians, so an 800 lm bulb — the usual "60 W equivalent" —
 *  is 800/4π ≈ 63.7 cd. */
export function candelaFromLumens(lumens: number): number {
  if (!(lumens > 0)) return 0;
  return lumens / (4 * Math.PI);
}

/** …and for a shaded fixture that throws into a cone of full angle `coneDeg`.
 *
 *  The same lumens concentrated into a narrower solid angle are brighter within
 *  it: Ω = 2π(1 − cos(θ)) for a half-angle θ. A pendant's shade is exactly this —
 *  it does not create light, it aims it. */
export function candelaFromLumensInCone(lumens: number, coneDeg: number): number {
  if (!(lumens > 0)) return 0;
  const half = (Math.min(180, Math.max(1, coneDeg)) / 2) * (Math.PI / 180);
  const solidAngle = 2 * Math.PI * (1 - Math.cos(half));
  if (solidAngle <= 0) return 0;
  return lumens / solidAngle;
}

// ─── Colour temperature ─────────────────────────────────────────────────────
// Kelvin → sRGB via the Planckian locus. Warm domestic bulbs sit around 2700 K,
// "cool white" around 4000 K, and daylight around 6500 K; getting this right is
// what makes the Evening mood read as lamplight rather than as an orange filter.

/** Kim et al. (2002) cubic approximation of the Planckian locus in CIE 1931 xy.
 *  Valid over 1667–25000 K, which comfortably spans every domestic bulb. */
function planckianXY(kelvin: number): [number, number] {
  const T = Math.min(25000, Math.max(1667, kelvin));
  const inv = 1000 / T;
  const x =
    T <= 4000
      ? -0.2661239 * inv ** 3 - 0.2343589 * inv ** 2 + 0.8776956 * inv + 0.17991
      : -3.0258469 * inv ** 3 + 2.1070379 * inv ** 2 + 0.2226347 * inv + 0.24039;
  const y =
    T <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : T <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

const srgbEncode = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/**
 * Colour temperature as an sRGB hex string, normalised to full brightness —
 * intensity is carried in candela, so only the hue belongs here.
 */
export function hexFromKelvin(kelvin: number): string {
  const [x, y] = planckianXY(kelvin);
  if (y <= 0) return '#ffffff';
  // xyY → XYZ at unit luminance, then the sRGB primaries.
  const X = x / y;
  const Z = (1 - x - y) / y;
  const rgb = [
    3.2406 * X - 1.5372 - 0.4986 * Z,
    -0.9689 * X + 1.8758 + 0.0415 * Z,
    0.0557 * X - 0.204 + 1.057 * Z,
  ].map((c) => Math.max(0, c));
  // Normalise rather than clip: the hue is what matters, and the brightest
  // channel of a saturated warm white would otherwise clip and shift it.
  const peak = Math.max(...rgb, 1e-6);
  const hex = rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, srgbEncode(c / peak))) * 255))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}
