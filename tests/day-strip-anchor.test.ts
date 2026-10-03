// The day strip keeps its place when the Library opens, and the sun is golden.
//
// It used to move: `CanvasDay` backed its right edge off by the Library card's
// published width (`--canvas-panel-width`), so opening the Library re-centred the
// strip in a narrower span and shoved it left. Source-level on purpose: the defect
// is a wiring one, and a layout engine is not available under jsdom.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compassName, turnedBearing } from '@/lib/lighting-moods';

const read = (p: string) => readFileSync(p, 'utf8');
const CHROME = read('components/studio/CanvasChrome.tsx');
const CATALOG = read('components/studio/CatalogPanel.tsx');
const CSS = read('app/globals.css');

function dayFn(): string {
  const a = CHROME.indexOf('export function CanvasDay');
  return CHROME.slice(a, CHROME.indexOf('\n}\n', a));
}

describe('the day strip does not react to the Library panel', () => {
  it('has its span from the canvas alone', () => {
    expect(dayFn()).not.toMatch(/panel/i);
    expect(dayFn()).toMatch(/right: `calc\(\$\{EDGE\}px \+ \$\{INSET_R\}\)`/);
  });
  it('and the Library docks beneath the strip rather than over it', () => {
    expect(CATALOG).toMatch(/belowDay \? `calc\(\$\{DAY_ROW_BOTTOM\} \+ 8px\)`/);
    expect(read('app/room/[roomId]/model/page.tsx')).toMatch(/<CatalogPanel canDrag belowDay \/>/);
  });
  it('and nothing publishes the panel width any more', () => {
    expect(CHROME + CATALOG).not.toMatch(/canvas-panel-width/);
  });
  it('has its width measured from the slot and capped, not a fixed number', () => {
    expect(read('lib/day-strip.ts')).toMatch(/Math\.min\(MAX_WIDTH, available\)/);
  });
});

describe('the sun is golden, the moon is not', () => {
  const get = (n: string) => new RegExp(`--${n}: (#[0-9A-Fa-f]{6})`).exec(CSS)![1];
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  it('uses a --sun token for the glyph, and the night pill keeps its paper moon', () => {
    expect(CSS).toMatch(/\.day-strip__glyph \{[^}]*color: var\(--sun\)/);
    expect(CSS).toMatch(/\.day-strip--night \.day-strip__glyph \{ color: var\(--on-ink\)/);
  });
  it('is dark enough to read as a graphic on paper (3:1)', () => {
    const [a, b] = [lum(get('sun')), lum(get('paper'))].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(3);
  });
});

describe('the Light section left the rail, its unique jobs did not', () => {
  it('turns the room by compass points', () => {
    expect(compassName(0)).toBe('north');
    expect(compassName(225)).toBe('south-west');
    expect(turnedBearing(0, 1)).toBe(45);
    expect(turnedBearing(0, -1)).toBe(315);
    expect(turnedBearing(213, 1)).toBe(225);
    expect(turnedBearing(213, -1)).toBe(180);
  });
  it('keeps Overcast and the no-opening hint on the strip', () => {
    const strip = read('components/studio/DayStrip.tsx');
    expect(strip).toMatch(/Overcast/);
    expect(strip).toMatch(/No window or door, so no sunlight gets in/);
    expect(read('components/studio/PartTree.tsx')).not.toMatch(/sunHasNoWayIn|LightingPicker/);
  });
});
