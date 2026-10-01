// @vitest-environment jsdom
// A stroke is never an occluder in the floor shadow.
//
// drei's <Edges> and <Line> are `LineSegments2` — a Mesh drawing one template quad,
// x −1..1 and y −1..2, that only `LineMaterial` turns into a line. drei's
// <ContactShadows> renders the whole scene under an override material from below
// the floor, so there every stroke was a 2 × 3 m sheet. Upright at rest it is seen
// edge-on and draws nothing; the lean of a carried piece (`lib/wobble.ts`) tips it
// into view, and dragging a bed painted a dark streak through each of its edged
// legs. `components/three/strokes.tsx` puts every stroke on a layer the
// contact-shadow camera does not see, and this file holds the four things that
// fix needs: the layer excludes from a default camera, the wrappers cannot be
// talked out of it, the main camera is told to see it, and no stroke is built
// anywhere but there.
//
// The browser half — the streak gone on a real drag — is
// `docs/visual-check.md`'s, because no test here renders a frame.
//
// A `//` header rather than a docblock — see `tests/layout-pick.test.ts`.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render } from '@testing-library/react';
import { Object3D, OrthographicCamera, PerspectiveCamera } from 'three';
import { stripComments } from './helpers/source';

// The camera `SeeStrokes` reads, swapped for one the test can inspect. Everything
// else from R3F is the real module, because drei imports it too.
const camera = new PerspectiveCamera();
const invalidate = vi.fn();
vi.mock('@react-three/fiber', async (orig) => ({
  ...(await orig<typeof import('@react-three/fiber')>()),
  useThree: (sel: (s: { camera: PerspectiveCamera; invalidate: () => void }) => unknown) => sel({ camera, invalidate }),
}));

const { Edges, Line, SeeStrokes, STROKE_LAYER } = await import('@/components/three/strokes');

describe('the stroke layer', () => {
  it('is not layer 0, so a camera left at three’s default cannot see it', () => {
    const stroke = new Object3D();
    stroke.layers.set(STROKE_LAYER);
    // drei's ContactShadows builds its camera with three's defaults: layer 0 alone.
    expect(stroke.layers.test(new OrthographicCamera().layers)).toBe(false);
  });

  it('SeeStrokes lets the main camera see strokes AND keep seeing everything else', () => {
    camera.layers.set(0);
    render(<SeeStrokes />);
    const stroke = new Object3D();
    stroke.layers.set(STROKE_LAYER);
    expect(stroke.layers.test(camera.layers)).toBe(true);
    expect(new Object3D().layers.test(camera.layers)).toBe(true);
    // frameloop="demand": without a frame the strokes stay unseen until something moves.
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('the stroke wrappers', () => {
  // Called as functions: what each returns is the drei element it hands R3F, and
  // its `layers` prop is what R3F writes into the object's mask.
  it('put an <Edges> on the stroke layer, whatever the caller passes', () => {
    expect(Edges({}).props.layers).toBe(STROKE_LAYER);
    expect(Edges({ layers: 0 } as Parameters<typeof Edges>[0]).props.layers).toBe(STROKE_LAYER);
  });

  it('put a <Line> on the stroke layer, whatever the caller passes', () => {
    const points: [number, number, number][] = [[0, 0, 0], [1, 0, 0]];
    expect(Line({ points }).props.layers).toBe(STROKE_LAYER);
    expect(Line({ points, layers: 0 } as Parameters<typeof Line>[0]).props.layers).toBe(STROKE_LAYER);
  });
});

// Every drei component built on `Line2` / `LineSegments2`. Any of them, imported
// anywhere but `strokes.tsx`, is a stroke on layer 0.
const LINE_FAMILY = ['Line', 'Edges', 'Segments', 'QuadraticBezierLine', 'CubicBezierLine', 'CatmullRomLine', 'PivotControls', 'Facemesh'];

const ROOT = join(__dirname, '..');
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe('no stroke is built outside strokes.tsx', () => {
  const files = [...sources(join(ROOT, 'components')), ...sources(join(ROOT, 'app'))];
  // Comments go, strings stay: the module name IS a string.
  const code = (f: string) => stripComments(readFileSync(f, 'utf8'));
  const dreiImports = (src: string) =>
    [...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@react-three\/drei['"]/g)].flatMap((m) =>
      m[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ''))
        .filter(Boolean),
    );

  it('imports no line-family drei component anywhere else', () => {
    const offenders = files
      .filter((f) => !f.endsWith(join('three', 'strokes.tsx')))
      .flatMap((f) => dreiImports(code(f)).filter((n) => LINE_FAMILY.includes(n)).map((n) => `${relative(ROOT, f)}: ${n}`));
    expect(offenders).toEqual([]);
  });

  it('builds no stroke by a road the sweep above cannot see: a deep drei path or three’s own line classes', () => {
    const offenders = files.filter((f) =>
      /from\s*['"](?:@react-three\/drei\/|three\/examples\/jsm\/lines)/.test(code(f)) ||
      /\b(?:Line2|LineSegments2|Wireframe)\b/.test(code(f)),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('has no namespace import of drei, which would hide a stroke from the sweep above', () => {
    const offenders = files.filter((f) => /import\s+\*\s+as\s+\w+\s+from\s*['"]@react-three\/drei['"]/.test(code(f)));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('…and the sweep can see: strokes.tsx itself and the three places that draw strokes', () => {
    const at = (p: string) => code(join(ROOT, p));
    expect(dreiImports(at('components/three/strokes.tsx'))).toEqual(expect.arrayContaining(['Edges', 'Line']));
    expect(at('components/three/Box.tsx')).toMatch(/import\s*\{\s*Edges\s*\}\s*from\s*'\.\/strokes'/);
    expect(at('components/three/Highlight.tsx')).toMatch(/import\s*\{\s*Edges\s*\}\s*from\s*'\.\/strokes'/);
    expect(at('components/three/RoomShell.tsx')).toMatch(/import\s*\{\s*Line\s*\}\s*from\s*'\.\/strokes'/);
  });

  it('mounts SeeStrokes in the studio canvas, or every stroke vanishes from the room', () => {
    expect(code(join(ROOT, 'components/three/Room.tsx'))).toMatch(/<SeeStrokes\s*\/>/);
  });
});
