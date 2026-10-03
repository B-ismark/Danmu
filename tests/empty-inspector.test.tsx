// @vitest-environment jsdom
//
// The right rail with nothing selected (`EmptyInspector`): a header, a mark, one
// instruction and its one-line hint, then the panel's two room-level verbs. It was a
// card of room facts and two shortcuts for a release, cut in review as too much to read
// before every pick; then the bare line it became left Add and Start over at the foot
// of an empty rail, the farthest place from the eye. What is pinned here is that it
// stays that short, and that the line speaks the device's verb.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { viewportAt } from './helpers/mount';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('empty-room', 'model'));

const { Inspector } = await import('@/components/studio/Inspector');

beforeEach(() => {
  useScene.setState({ parts: [] });
  useStudio.setState({ selectedPartId: null, selection: [], selectedWall: null });
});
afterEach(() => cleanup());

describe('the Inspector with nothing selected', () => {
  it('is one instruction and its hint, and nothing to press but Add and Start over', () => {
    const { container } = render(<Inspector />);
    expect(screen.getByRole('heading', { name: 'Details' })).toBeTruthy();
    expect(screen.getByText('Click a piece to style it')).toBeTruthy();
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Click a piece to style it',
      'Or press Add to bring something in from the Library.',
    ]);
    expect(container.querySelectorAll('h1, h3, dl, section')).toHaveLength(0);
    // An emptied room differs from its start, so Start over is owed here too.
    const names = screen.queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/Add/);
    expect(names[1]).toMatch(/^Start over/);
  });

  it('says Tap on a touch screen', () => {
    const restore = viewportAt(800, { touch: true });
    try {
      render(<Inspector />);
      expect(screen.getByText('Tap a piece to style it')).toBeTruthy();
    } finally {
      restore();
    }
  });
});
