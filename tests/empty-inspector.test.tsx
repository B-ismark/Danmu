// @vitest-environment jsdom
//
// The right rail with nothing selected (`EmptyInspector`): a mark and one line. It was
// a card of room facts and two shortcuts for a release, and those were cut in review
// as too much to read before every pick. What is pinned here is that it stays one line,
// and that the line speaks the device's verb.
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
  it('is one line, and nothing to press', () => {
    const { container } = render(<Inspector />);
    expect(screen.getByText('Click a piece to style it')).toBeTruthy();
    expect(container.querySelectorAll('p, h1, h2, h3, dl, section')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
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
