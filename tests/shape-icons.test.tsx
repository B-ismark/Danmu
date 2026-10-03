// @vitest-environment jsdom
//
// The drawing at the start of each row that names a piece. The table is a total
// `Record<Shape, …>`, so the compiler already refuses a shape with no drawing; what it
// cannot see is a drawing that is the WRONG one — another shape's, a colour of its
// own, or markup that is more than lines — and a row drawn with some other piece's
// shape. Those are the clauses here.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SHAPES, PART_LIBRARY, type ScenePart, type Shape } from '@/lib/scene-spec';
import { SHAPE_GLYPHS } from '@/components/ui/shape-glyphs';
import { ShapeIcon } from '@/components/ui/ShapeIcon';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('icons-room', 'model'));

const { PartTree } = await import('@/components/studio/PartTree');
const { LibraryPicker } = await import('@/components/studio/LibraryPicker');

afterEach(cleanup);

describe('the shape drawings', () => {
  const entries = SHAPES.map((s) => [s, SHAPE_GLYPHS[s]] as const);

  it('draw in the ink of the row and nothing else', () => {
    for (const [shape, g] of entries) {
      const paints = [...g.body.matchAll(/\b(fill|stroke)="([^"]*)"/g)].map((m) => m[2]);
      expect(paints.length, shape).toBeGreaterThan(0);
      for (const p of paints) expect(['none', 'currentColor'], `${shape} paints ${p}`).toContain(p);
    }
  });

  // The clause above reads the paints a body NAMES, so a body could pass it on a
  // transparent spacer while every line that draws fell back to SVG's default fill:
  // solid black. The window did, and showed as a blot in a list of outlines. Here
  // every mark is followed up its own tree to the paint it actually inherits.
  it('leave no mark to the default black fill', () => {
    const marks = 'path, rect, circle, ellipse, line, polyline, polygon';
    for (const [shape, g] of entries) {
      const box = document.createElement('div');
      box.innerHTML = `<svg>${g.body}</svg>`;
      const svg = box.firstElementChild!;
      for (const el of svg.querySelectorAll(marks)) {
        let fill: string | null = null;
        for (let n: Element | null = el; n && n !== svg && fill === null; n = n.parentElement) fill = n.getAttribute('fill');
        expect(fill, `${shape} has a mark with no fill of its own`).not.toBeNull();
      }
    }
  });

  it('are lines and shapes only', () => {
    const allowed = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
    for (const [shape, g] of entries) {
      const tags = [...g.body.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]);
      expect(tags.length, shape).toBeGreaterThan(0);
      for (const t of tags) expect(allowed.has(t), `${shape} has <${t}>`).toBe(true);
      expect(g.body, shape).not.toMatch(/\son[a-z]+=|href|url\(/i);
    }
  });

  it('are each their own, except the closet, which is a wardrobe', () => {
    const byBody = new Map<string, Shape[]>();
    for (const [shape, g] of entries) byBody.set(g.body, [...(byBody.get(g.body) ?? []), shape]);
    const shared = [...byBody.values()].filter((s) => s.length > 1);
    expect(shared).toEqual([['closet', 'wardrobe']]);
  });

  it('give a shape this build does not know the box the 3D draws for it', () => {
    const unknown = render(<ShapeIcon shape={'hammock' as Shape} />).container.querySelector('svg')!;
    const box = render(<ShapeIcon shape="box" />).container.querySelector('svg')!;
    const sofa = render(<ShapeIcon shape="sofa" />).container.querySelector('svg')!;
    expect(unknown.innerHTML).toBe(box.innerHTML);
    expect(unknown.innerHTML).not.toBe(sofa.innerHTML); // the comparison can tell two drawings apart
  });
});

describe('the rows that name pieces', () => {
  const part = (id: string, name: string, shape: Shape, category: string) =>
    ({ id, name, shape, category, dimMM: [800, 600, 900], pos: [0, 0, 0], rot: 0 }) as unknown as ScenePart;

  beforeEach(() => {
    useStudio.setState({ selectedPartId: null, selection: [], selectedWall: null, catalogOpen: false });
  });

  it("the room's Catalog draws each row with its own piece's shape", () => {
    // Named against type, so a row that drew from its name or its category would show.
    const parts = [part('a', 'Reading lamp', 'lamp-floor', 'lamp'), part('b', 'Lamp', 'lamp-table', 'lamp'), part('c', 'Seat', 'sofa', 'sofa')];
    useScene.getState().setParts(parts);
    render(<PartTree />);
    for (const p of parts) {
      const row = document.querySelector(`[data-part-id="${p.id}"]`)!;
      expect(row.querySelector('.shape-chip')?.getAttribute('data-shape'), p.name).toBe(p.shape);
    }
  });

  it('the Library draws each model with its own shape', () => {
    render(<LibraryPicker onPick={() => {}} />);
    const rows = [...document.querySelectorAll('button')].filter((b) => b.querySelector('.shape-chip'));
    expect(rows.length).toBeGreaterThan(20);
    for (const b of rows) {
      const label = b.querySelector('.truncate')!.textContent;
      const item = PART_LIBRARY.find((i) => i.label === label)!;
      expect(b.querySelector('.shape-chip')!.getAttribute('data-shape'), label!).toBe(item.shape);
    }
  });
});
