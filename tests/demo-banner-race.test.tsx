// @vitest-environment jsdom
//
// The getting-started strip decides from storage whether this is the starter room,
// and that read is slow enough to lose a race. Moving from a starter room to a
// photographed one while the first room's read is still out let it land late and
// put the strip over a room the user had already photographed. The same late answer,
// arriving after the strip had gone, is what React 19.3 reports as an unhandled error
// once a test's window is torn down — the TopBar race, one component over.
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ roomId: 'a' }));
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(() => nav.roomId));

const reads = vi.hoisted(() => new Map<string, (captures: number) => void>());
vi.mock('@/lib/storage', () => ({
  roomStore: {
    loadRoom: async (id: string) => ({ id, name: id }),
    loadCaptures: (id: string) =>
      new Promise((resolve) => reads.set(id, (n) => resolve(Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}` }))))),
  },
}));

const { DemoBanner } = await import('@/components/studio/DemoBanner');

describe('the getting-started strip describes the room it is on', () => {
  it('a slow read for the starter room just left does not show the strip on a photographed room', async () => {
    const view = render(<DemoBanner />);
    nav.roomId = 'b';
    view.rerender(<DemoBanner />);
    await act(async () => {});
    await act(async () => reads.get('b')!(3));
    await act(async () => reads.get('a')!(0));
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull();
  });

  it('the starter room itself still shows it', async () => {
    nav.roomId = 'c';
    render(<DemoBanner />);
    await act(async () => {});
    await act(async () => reads.get('c')!(0));
    expect(screen.getByRole('region', { name: 'Getting started' })).toBeTruthy();
  });
});
