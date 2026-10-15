// @vitest-environment jsdom
//
// The top bar reads the room's name from storage, and that read is slow enough to
// lose a race. Moving from one room to the next while the first room's read is still
// out used to let it land late and name the second room after the first. The same
// late answer, arriving after the bar had gone, is what React 19.3 began reporting as
// an unhandled error once the test's window was torn down.
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ roomId: 'a' }));
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(() => nav.roomId));

const reads = vi.hoisted(() => new Map<string, (name: string) => void>());
vi.mock('@/lib/storage', () => ({
  roomStore: {
    loadRoom: (id: string) => new Promise((resolve) => reads.set(id, (name) => resolve({ id, name }))),
  },
}));

const { TopBar } = await import('@/components/studio/TopBar');

describe('the top bar names the room it is on', () => {
  it('a slow read for the room just left does not rename the room arrived at', async () => {
    const view = render(<TopBar />);
    nav.roomId = 'b';
    view.rerender(<TopBar />);
    await act(async () => reads.get('b')!('Bedroom'));
    await act(async () => reads.get('a')!('Kitchen'));
    expect(screen.queryByText('Kitchen')).toBeNull();
    expect(screen.getAllByText('Bedroom').length).toBeGreaterThan(0);
  });
});
