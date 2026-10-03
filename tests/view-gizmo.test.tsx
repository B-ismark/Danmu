// @vitest-environment jsdom
//
// The camera switcher is three words — Corner, Front, Top — and nothing else. 'free' is
// the state orbiting puts the camera in, so it is a value with no button: with it set,
// none of the three is pressed. On a phone the same three buttons show glyphs, not words.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { viewportAt } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('view-gizmo-room', 'model'));

const { ViewGizmo } = await import('@/components/studio/ViewGizmo');

let restore: (() => void) | null = null;
const buttons = () => screen.getAllByRole('button');
const visibleText = (b: HTMLElement) => b.querySelector('.gizmo__word')?.textContent;
const pressed = () => buttons().map((b) => b.getAttribute('aria-pressed'));

beforeEach(() => {
  cleanup();
  useStudio.getState().setView('iso');
});
afterEach(() => {
  restore?.();
  restore = null;
});

describe('ViewGizmo', () => {
  it('is a Camera group of exactly three buttons: Corner, Front, Top', () => {
    restore = viewportAt(1440);
    render(<ViewGizmo />);
    expect(screen.getByRole('group', { name: 'Camera' })).toBeTruthy();
    expect(buttons().map(visibleText)).toEqual(['Corner', 'Front', 'Top']);
    for (const b of buttons()) {
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('maps Corner to iso, Front to front, Top to top', () => {
    restore = viewportAt(1440);
    render(<ViewGizmo />);
    const [corner, front, top] = buttons();
    fireEvent.click(front);
    expect(useStudio.getState().viewPreset).toBe('front');
    fireEvent.click(top);
    expect(useStudio.getState().viewPreset).toBe('top');
    fireEvent.click(corner);
    expect(useStudio.getState().viewPreset).toBe('iso');
  });

  it('shows the active preset as pressed, and nothing as pressed when free', () => {
    restore = viewportAt(1440);
    render(<ViewGizmo />);
    expect(pressed()).toEqual(['true', 'false', 'false']);
    fireEvent.click(buttons()[2]);
    expect(pressed()).toEqual(['false', 'false', 'true']);
    cleanup();
    useStudio.getState().setView('free');
    render(<ViewGizmo />);
    expect(pressed()).toEqual(['false', 'false', 'false']);
  });

  it('on a phone uses the glyph layout: same three buttons in order, an svg each', () => {
    restore = viewportAt(390, { touch: true });
    render(<ViewGizmo />);
    expect(document.querySelector('.gizmo')!.classList.contains('gizmo--glyphs')).toBe(true);
    const bs = buttons();
    expect(bs.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Look from the corner',
      'Look straight at the front wall',
      'Look down from above',
    ]);
    for (const b of bs) expect(b.querySelector('svg')).toBeTruthy();
  });

  it('on a laptop does not use the glyph layout', () => {
    restore = viewportAt(1440);
    render(<ViewGizmo />);
    expect(document.querySelector('.gizmo')!.classList.contains('gizmo--glyphs')).toBe(false);
  });
});
