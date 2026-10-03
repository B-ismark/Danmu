import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/source';

// A drag that carries company — a lamp riding its table, a merged set, a
// multi-selection — writes `useStudio.positions` on every pointer move, so every
// component reading the resolved scene re-renders once a frame. That is by design and
// cheap. What is not cheap is a re-render that a drei component reads as NEW INPUT,
// because drei keys its expensive work on the IDENTITY of a prop, not on its value:
//
//   · `<Environment frames={1}>` re-bakes its cube — six renders of the light rig — in
//     a layout effect whose deps include `children`. Inline `<Lightformer>`s are new
//     elements every render.
//   · `<ContactShadows>` builds two render targets, a blur plane and three materials in
//     a useMemo keyed on the `scale` array. An inline `[x, z]` is a new array every
//     render, and the old targets are never disposed — a VRAM leak per frame.
//   · The walls re-triangulated their holes whenever `wallApertures` returned a new Map,
//     which is every time anything in the room moved.
//
// Measured with a WebGL call counter over the same 20-move drag of a coffee table
// (`scripts/drag-churn-probe.mjs`, production build, swiftshader): lamp riding the
// table, before — 38 textures and 372 buffers created, 175 attachments, 36.2 s; after —
// 0, 8, 22, 11.4 s, which is every count the same drag makes with the lamp on the floor.
// The wobble and the lamp's own light cost nothing measurable; turning the wobble off
// (reduced motion) left the before-numbers where they were.
//
// Source-text assertions, like `tests/room-shell.test.ts`, for the reason given there:
// the subject is a prop inside an R3F tree and there is no pure function to call. Each
// pairs with an assertion that drei still behaves the way that makes it matter, so an
// upgrade that fixes drei turns this red with the reason, rather than leaving a rule
// standing after its cause has gone.

const root = (...p: string[]) => join(process.cwd(), ...p);
const read = (...p: string[]) => readFileSync(root(...p), 'utf8').replace(/\r\n/g, '\n');

const ROOM = stripComments(read('components', 'three', 'Room.tsx'));
const SHELL = stripComments(read('components', 'three', 'RoomShell.tsx'));

/** One element's source: to its own closing tag, or to the end of a self-closing tag. */
function element(src: string, tag: string, selfClosing: boolean): string {
  const start = src.indexOf(`<${tag}`);
  expect(start, `<${tag}> not found`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(selfClosing ? '/>' : `</${tag}>`, start);
  expect(end, `<${tag}> is not closed`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('a drag that carries company re-renders the room without rebuilding it', () => {
  it('drei re-bakes an Environment when its children change identity', () => {
    const drei = read('node_modules', '@react-three', 'drei', 'core', 'Environment.js');
    expect(drei).toMatch(/camera\.current\.update\(gl, virtualScene\)[\s\S]{0,400}\}, \[children,/);
  });

  it('…so the Environment is handed memoised panels, not inline elements', () => {
    const env = element(ROOM, 'Environment', false);
    const body = env.slice(env.indexOf('>') + 1);
    expect(body.trim()).toBe('{panels}');
    expect(ROOM).toMatch(/const panels = useMemo\(/);
  });

  it('drei rebuilds ContactShadows\' targets when the scale array changes identity', () => {
    const drei = read('node_modules', '@react-three', 'drei', 'core', 'ContactShadows.js');
    expect(drei).toMatch(/new THREE\.WebGLRenderTarget[\s\S]*?\}, \[resolution, width, height, scale, color\]\)/);
  });

  it('…so its scale is a memoised pair, not an inline array', () => {
    const cs = element(ROOM, 'ContactShadows', true);
    expect(cs).toMatch(/scale=\{scale\}/);
    expect(cs).not.toMatch(/scale=\{\[/);
    expect(ROOM).toMatch(/const scale = useMemo<\[number, number\]>\(\(\) => \[spanX, spanZ\], \[spanX, spanZ\]\)/);
  });

  it('the hour does not re-bake the environment\'s brightness, only its colours', () => {
    // The panels are baked at unit strength; the hour's `envMul` is a uniform on the
    // scene, applied by drei on a bake and by `Daylight` between bakes.
    const drei = read('node_modules', '@react-three', 'drei', 'core', 'Environment.js');
    expect(drei).toMatch(/environmentIntensity: 1,/);
    expect(drei).toMatch(/applyProps\(target, sceneProps\)/);
    const env = element(ROOM, 'Environment', false);
    expect(env).toMatch(/environmentIntensity=\{L\.envMul\}/);
    expect(ROOM).toMatch(/scene\.environmentIntensity = L\.envMul;/);
    expect(element(ROOM, 'Lightformer', true)).not.toMatch(/envMul/);
    expect(ROOM).not.toMatch(/\* envL\.envMul/);
  });

  it('a new hour re-bakes into the same cube target, and a scrub re-bakes on a coarser step', () => {
    // Keyed by quality alone: a key with the hour in it REMOUNTED the Environment per
    // step, allocating a fresh cube target and a fresh PMREM each time.
    expect(element(ROOM, 'Environment', false)).toMatch(/^<Environment key=\{quality\} /);
    expect(ROOM).not.toMatch(/envStep/);
    expect(ROOM).toMatch(/const envHour = lighting === 'overcast' \? 0 : scrubbing \? Math\.round\(hour \/ 2\) \* 2 : Math\.round\(hour \* 2\) \/ 2;/);
    expect(ROOM).toMatch(/const scrubbing = useStudio\(\(s\) => s\.draggingId === SUN_DRAG_ID\);/);
  });

  it('crossing a horizon dims the key light rather than unmounting it', () => {
    // Three keys every material's program on the number of directional lights, so a
    // key light that comes and goes recompiles the room at every sunrise and sunset.
    expect(ROOM).not.toMatch(/&&\s*<KeyLight/);
    expect(ROOM).toMatch(/\n\s*<KeyLight intensity=\{key\.intensity\}/);
    expect(ROOM).toMatch(/const key: KeyLightSpec = L\.key \?\? \{ \.\.\.lastKey\.current, intensity: 0 \};/);
    // Dark, its shadow map is not refreshed; `castShadow` stays (also a program key).
    expect(element(ROOM, 'directionalLight\n      ref={ref}', true)).toMatch(/shadow-autoUpdate=\{intensity > 0\}/);
    expect(element(ROOM, 'directionalLight\n      ref={ref}', true)).toMatch(/castShadow=\{cast\}/);
  });

  it('the wall holes are held by value, so a piece that is not a window leaves the walls alone', () => {
    // The shapes are keyed on `apertures`, and `apertures` on a string of what the holes
    // ARE — not on the Map `wallApertures` builds fresh from every new scene list.
    expect(SHELL).toMatch(/const cutKey = JSON\.stringify\(\[\.\.\.cut\]\)/);
    expect(SHELL).toMatch(/const apertures = useMemo\(\(\) => new Map<number, Aperture\[\]>\(JSON\.parse\(cutKey\)\), \[cutKey\]\)/);
    expect(SHELL).not.toMatch(/const apertures = useMemo\(\s*\(\) => wallApertures\(/);
  });
});
