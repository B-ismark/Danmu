// @vitest-environment jsdom
//
// The waiting picture on the scan card: decoration, so what is held here is that it stays
// decoration. It is hidden from assistive tech (the card's title and live region already
// say what is happening), it does not claim a count or a time, and its words are the
// steps the code takes — never a model, a service or a render.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FindingFurniture } from '@/components/ui/FindingFurniture';

afterEach(cleanup);

describe('FindingFurniture', () => {
  it('draws five pieces, each in its own piece colour, and hides the drawing and its lines from assistive tech', () => {
    const { container } = render(<FindingFurniture photos={3} />);
    const pieces = [...container.querySelectorAll<SVGGElement>('.ff__piece')];
    expect(pieces).toHaveLength(5);
    expect(new Set(pieces.map((p) => p.style.getPropertyValue('--piece'))).size).toBe(5);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    const lines = [...container.querySelectorAll('.ff__say')];
    expect(lines.length).toBe(6);
    expect(lines.every((l) => l.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('says how many photos it is reading, from what it was handed, and nothing about time or counts found', () => {
    const { container, rerender } = render(<FindingFurniture photos={3} />);
    expect(container.querySelector('.ff__meta')!.textContent).toBe('Reading your 3 wall photos');
    rerender(<FindingFurniture photos={1} />);
    expect(container.querySelector('.ff__meta')!.textContent).toBe('Reading your wall photo');
    rerender(<FindingFurniture />);
    expect(container.querySelector('.ff__meta')).toBeNull();
    const words = container.textContent!;
    expect(words).not.toMatch(/\d+\s*(%|s\b|sec|min)|\bAI\b|model|Gemini|render|found \d/i);
  });

  it('leaves a reader without motion the finished drawing and its last line', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start, 'the global reduced-motion block').toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('\n}\n', start));
    expect(block).toMatch(/\.ff__piece[^{]*\{ animation: none !important; \}/);
    expect(block).toMatch(/\.ff__line \{ stroke-dashoffset: 0; \}/);
    expect(block).toMatch(/\.ff__lens \{ display: none; \}/);
    expect(block).toMatch(/\.ff__say:last-child \{ opacity: 1; \}/);
  });
});
