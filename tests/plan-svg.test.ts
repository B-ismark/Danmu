// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { planSvg, planSvgFileName } from '@/lib/plan-export';
import type { ScenePart } from '@/lib/scene-spec';
import type { Footprint } from '@/lib/footprint';

// The SVG is the PNG's drawing on another surface (lib/svg-sheet.ts), so what is
// asserted here is that the drawing survives the trip: it parses, it says what the
// sheet says, and the badge-over-footprint order the PNG test pins holds here too.

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart => ({
  category: 'sofa',
  name: 'Sofa',
  shape: 'sofa',
  pos: [0, 0.4, 0],
  rot: 0,
  dimMM: [2200, 950, 880],
  locked: false,
  ...over,
});

const ROOM: { footprint: Footprint; width: number; depth: number; height: number } = {
  footprint: [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ],
  width: 4,
  depth: 4,
  height: 2.4,
};

const PARTS = [
  part({ id: 'sofa' }),
  part({ id: 'lamp', name: 'Floor lamp', category: 'lamp', shape: 'lamp-floor', pos: [1, 0, 1], dimMM: [400, 400, 1600], circle: true } as never),
];

function parse(text: string): Document {
  return new DOMParser().parseFromString(text, 'image/svg+xml');
}

describe('the floor plan as SVG', () => {
  it('is a well-formed document, even for a room name full of markup', () => {
    const doc = parse(planSvg(PARTS, ROOM, 'm', "Tom & Jerry's <Den>"));
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.tagName).toBe('svg');
    const texts = Array.from(doc.getElementsByTagName('text')).map((t) => t.textContent);
    expect(texts).toContain("Tom & Jerry's <Den>");
  });

  it('carries the legend, a badge per piece and the round piece as an ellipse', () => {
    const doc = parse(planSvg(PARTS, ROOM, 'm', 'Front Room'));
    const texts = Array.from(doc.getElementsByTagName('text')).map((t) => t.textContent ?? '');
    expect(texts).toContain('Pieces');
    expect(texts.filter((t) => t.startsWith('Sofa ·'))).toHaveLength(1);
    expect(texts.filter((t) => t.startsWith('Floor lamp ·'))).toHaveLength(1);
    expect(texts.filter((t) => t === '1' || t === '2')).toHaveLength(2);
    const arcs = Array.from(doc.getElementsByTagName('path')).filter((p) => p.getAttribute('d')?.includes('A'));
    // fill and stroke of the one round piece
    expect(arcs).toHaveLength(2);
  });

  it('draws every footprint before any number badge, as the PNG does', () => {
    const text = planSvg(PARTS, ROOM, 'm', 'Front Room');
    // A furniture outline is the only thing on the sheet stroked at 1.2; a badge is the
    // only text centred on its point.
    const outlines = [...text.matchAll(/stroke-width="1\.2"/g)].map((m) => m.index!);
    const badges = [...text.matchAll(/dy="0\.35em"[^>]*>\d+<\/text>/g)].map((m) => m.index!);
    expect(outlines).toHaveLength(2);
    expect(badges).toHaveLength(2);
    expect(Math.max(...outlines)).toBeLessThan(Math.min(...badges));
  });

  it('prints at 1:50 at 100%, and says so on the sheet', () => {
    const doc = parse(planSvg(PARTS, ROOM, 'm', 'Front Room'));
    const svg = doc.documentElement;
    const [, , vw] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // 90 sheet px per metre; at 1:50 a metre is 20 mm of paper.
    expect(svg.getAttribute('width')).toBe(`${Math.round((vw * 20) / 90 * 1000) / 1000}mm`);
    const texts = Array.from(doc.getElementsByTagName('text')).map((t) => t.textContent ?? '');
    expect(texts.some((t) => t.endsWith('scale 1:50 printed at 100%'))).toBe(true);
  });

  it('survives a control character in a piece name', () => {
    const doc = parse(planSvg([part({ id: 's', name: 'Sofa\u000B' })], ROOM, 'm', 'Den\u0007'));
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('is named like the PNG, with its own extension', () => {
    expect(planSvgFileName('Front Room')).toBe('front-room-floor-plan.svg');
  });
});
