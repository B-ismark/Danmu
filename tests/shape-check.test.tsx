// @vitest-environment jsdom
//
// The room's shape on the photos screen (`components/studio/ShapeCheck.tsx`): kept in
// view under the title with a way to change it, and checked once more — the plan with
// each photo pinned to its wall — before the scan. Nothing reads the outline off the
// photos, so this is where a wrong one gets caught.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('shape-room', { router }));
vi.mock('@/lib/image-quality', async (orig) => ({
  ...(await orig<typeof import('@/lib/image-quality')>()),
  scoreQuality: async () => ({ width: 1600, height: 1200, brightness: 120, sharpness: 80, flags: ['ok'] }),
}));

import CapturePage from '@/app/onboarding/capture/page';
import { roomStore, type RoomData } from '@/lib/storage';
import { useRoom } from '@/lib/store';
import { PRESET_HEIGHT } from '@/lib/room-presets';

const ROOM_ID = 'shape-room';
const room: RoomData = {
  id: ROOM_ID,
  name: 'Living room',
  createdAt: 1,
  layoutId: 'rect',
  width: 6,
  depth: 4,
  height: PRESET_HEIGHT,
  roughSize: true,
};

beforeEach(async () => {
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
  router.push.mockClear();
  await roomStore.destroyRoom(ROOM_ID);
  await roomStore.saveRoom(room);
  await roomStore.saveCapture(ROOM_ID, { slot: 'n', blob: new Blob(['a']), takenAt: 1 });
  await roomStore.saveCapture(ROOM_ID, { slot: 'e', blob: new Blob(['b']), takenAt: 2 });
  useRoom.setState({ roomId: ROOM_ID });
});
afterEach(cleanup);

async function mounted() {
  render(<CapturePage />);
  await screen.findByAltText('Your photo of Wall 1');
  await screen.findByText(/Your room:/);
}

const continueButton = () => screen.getAllByRole('button', { name: /^Continue/ })[0];

describe('the shape on the photos screen', () => {
  it('names the shape under the title, with a way to change it', async () => {
    await mounted();
    const line = screen.getByText(/Your room:/).closest('p')!;
    expect(line.textContent).toMatch(/Your room:\s*Rectangle/);
    expect(within(line).getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('changes the shape from that line and keeps the photos on their walls', async () => {
    await mounted();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'L-Shape' }));
    await waitFor(async () => expect((await roomStore.loadRoom(ROOM_ID))?.layoutId).toBe('l'));
    const saved = (await roomStore.loadRoom(ROOM_ID))!;
    // A typical-size room takes the new shape's typical size, and its starter name.
    expect([saved.width, saved.depth]).toEqual([6.0, 4.7]);
    expect(saved.name).toBe('Living + reading nook');
    expect((await roomStore.loadCaptures(ROOM_ID)).map((c) => c.slot).sort()).toEqual(['e', 'n']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Your room:/).closest('p')!.textContent).toMatch(/L-Shape/);
  });

  it('asks whether the plan looks like the room before the scan, photos pinned to their walls', async () => {
    await mounted();
    fireEvent.click(continueButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Does this look like your room?' })).toBeTruthy();
    // Not yet: the check is the step, the scan is behind it.
    expect(router.push).not.toHaveBeenCalled();
    expect(dialog.querySelectorAll('.shape-check__plan image')).toHaveLength(2);
    expect(within(dialog).getByRole('img').getAttribute('aria-label')).toMatch(/photos on Wall 1, Wall 2/);
    fireEvent.click(within(dialog).getByRole('button', { name: /Yes, find the furniture/ }));
    expect(router.push).toHaveBeenCalledWith('/onboarding/detect');
  });

  it('changes the shape from the check and comes back to it with the new outline', async () => {
    await mounted();
    fireEvent.click(continueButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Change the shape/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('radio', { name: 'U-Shape' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Does this look like your room?' })).toBeTruthy());
    expect(screen.getByRole('dialog').textContent).toMatch(/drawn as U-Shape/);
    // From the middle of a U, Wall 1 has no wall straight ahead: said, by name, as
    // the likely sign of a wrong shape — and that photo is not pinned.
    expect(screen.getByRole('dialog').textContent).toMatch(/Wall 1: from the middle of this outline there is no wall straight ahead/);
    expect(screen.getByRole('dialog').querySelectorAll('.shape-check__plan image')).toHaveLength(1);
    expect((await roomStore.loadRoom(ROOM_ID))?.layoutId).toBe('u');
  });

  it('shows but does not offer the shape once furniture is arranged for it', async () => {
    await roomStore.saveSceneParts(ROOM_ID, []);
    await mounted();
    const line = screen.getByText(/Your room:/).closest('p')!;
    expect(within(line).queryByRole('button', { name: 'Change' })).toBeNull();
    expect(line.textContent).toMatch(/furniture already arranged/);
    fireEvent.click(continueButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /Change the shape/ })).toBeNull();
    expect(dialog.textContent).toMatch(/already has furniture arranged/);
  });
});
