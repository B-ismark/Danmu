// @vitest-environment jsdom
//
// The plan's "Comfort zones" shading is OFF until someone asks for it: on, it washes
// the whole plan orange before the room has been looked at. The toggle must still work.
// The choice is page-local state (nothing is persisted), so there is no stored value to
// migrate and no way for this default to override a user's earlier choice.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('comfort-default', 'plan'));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

describe('comfort zones default', () => {
  it('starts off, and the toggle turns it on and off again', () => {
    cleanup();
    render(<PlanPage />);
    const toggle = screen.getByRole('button', { name: /comfort zones/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });
});
