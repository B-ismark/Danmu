// @vitest-environment jsdom
//
// The capture screen's photo cards, mounted: the dark wall badge, the two round
// buttons, the Wall dropdown that moves or swaps, and the plan wall that shimmers when
// a wall's name is pointed at.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// IndexedDB's structured clone leaves a Blob a plain object, so the verdict cannot depend on
// its bytes; the test says what the scorer should find.
const scored = vi.hoisted(() => ({ flag: 'ok' as 'ok' | 'blurry' }));
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('card-room'));
// Scoring decodes the picture on a canvas, which jsdom has none of.
vi.mock('@/lib/image-quality', async (orig) => ({
  ...(await orig<typeof import('@/lib/image-quality')>()),
  scoreQuality: async () => ({ width: 1600, height: 1200, brightness: 120, sharpness: 80, flags: [scored.flag] }),
}));

// Resizing draws on a canvas, which jsdom has none of; the bytes pass through.
vi.mock('@/lib/capture', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture')>()),
  normalizePhoto: async (f: Blob) => f,
}));

import CapturePage from '@/app/onboarding/capture/page';
import { footprintForLayout } from '@/lib/footprint';
import { roomStore, type RoomData } from '@/lib/storage';
import { useRoom } from '@/lib/store';
import { flagHelp } from '@/lib/image-quality';

const ROOM_ID = 'card-room';
const room = {
  id: ROOM_ID,
  name: 'Card room',
  createdAt: 1,
  version: 1,
  layoutId: 'rect',
  width: 6,
  depth: 4,
  height: 2.6,
  footprint: footprintForLayout('rect', 6, 4),
} as RoomData;

beforeEach(async () => {
  scored.flag = 'ok';
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
  await roomStore.destroyRoom(ROOM_ID);
  await roomStore.saveRoom(room);
  await roomStore.saveCapture(ROOM_ID, { slot: 'n', blob: new Blob(['a']), takenAt: 1 });
  await roomStore.saveCapture(ROOM_ID, { slot: 'e', blob: new Blob(['b']), takenAt: 2 });
  useRoom.setState({ roomId: ROOM_ID });
});
afterEach(cleanup);

async function mounted() {
  const r = render(<CapturePage />);
  await screen.findByAltText('Your photo of Wall 1');
  // The plan only draws once the room has loaded.
  await waitFor(() => expect(r.container.querySelector('.capture-plan')).toBeTruthy());
  return r;
}

const planWall = (c: HTMLElement, n: number) => c.querySelectorAll('.capture-plan__wall')[n - 1] as SVGGElement;
const cardOf = (alt: string) => screen.getByAltText(alt).closest('div[style*="overflow"]') as HTMLElement;

describe('a filled photo card', () => {
  it('wears its wall and the derived span as a badge, and nothing else is a text button', async () => {
    await mounted();
    const card = cardOf('Your photo of Wall 1');
    // The span is derived from the footprint (6 x 4 m), never typed: Wall 1 faces north
    // across the 4 m depth, so the long wall it shows is 6.0 m.
    expect(card.querySelector('[data-wall-badge="n"]')?.textContent).toMatch(/^Wall 1\s*·/);
    expect(card.textContent).toMatch(/Wall 1\s*·\s*\d+(\.\d+)?\s*m/);
    expect(within(card).queryByText('Move')).toBeNull();
    expect(within(card).queryByText('Replace')).toBeNull();
    expect(within(card).queryByText('Remove')).toBeNull();
  });

  it('has the two icon buttons, named for their wall', async () => {
    await mounted();
    expect(screen.getByRole('button', { name: 'Replace the photo for Wall 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove the photo for Wall 1' })).toBeTruthy();
    expect(screen.getByLabelText('Choose a different photo for Wall 1').className).toContain('sr-only');
  });

  it('says Looks good once the photo is scored, in a pill', async () => {
    await mounted();
    const pills = await screen.findAllByText(/Looks good/);
    expect(screen.queryByText(/A bit blurry/)).toBeNull();
    expect(pills[0].closest('.capture-status')?.getAttribute('data-tone')).toBe('good');
  });

  it('says what needs attention in the warn tone, with the flag\'s own help as its title', async () => {
    scored.flag = 'blurry';
    await mounted();
    const blurry = (await screen.findAllByText(/A bit blurry/))[0];
    const pill = blurry.closest('.capture-status')!;
    expect(pill.getAttribute('data-tone')).toBe('warn');
    expect(pill.getAttribute('title')).toBe(flagHelp('blurry'));
  });

  it('swaps with a filled wall from the Wall list, which says so', async () => {
    await mounted();
    fireEvent.click(screen.getByRole('combobox', { name: 'Wall for the Wall 1 photo' }));
    expect(screen.getByRole('option', { name: /Wall 2 \(swap\)/ })).toBeTruthy();
    // An empty wall is a plain move, so it carries no suffix.
    expect(screen.getByRole('option', { name: 'Wall 3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Wall 2 \(swap\)/ }));
    await waitFor(async () => {
      const caps = await roomStore.loadCaptures(ROOM_ID);
      const bySlot = Object.fromEntries(caps.map((c) => [c.slot, c.takenAt]));
      expect(bySlot).toEqual({ n: 2, e: 1 });
    });
    expect(await screen.findByText('Swapped Wall 1 and Wall 2.')).toBeTruthy();
  });

  it('moves to an empty wall', async () => {
    await mounted();
    fireEvent.click(screen.getByRole('combobox', { name: 'Wall for the Wall 1 photo' }));
    fireEvent.click(screen.getByRole('option', { name: 'Wall 3' }));
    await waitFor(async () => {
      const caps = await roomStore.loadCaptures(ROOM_ID);
      expect(caps.map((c) => c.slot).sort()).toEqual(['e', 's']);
    });
  });
});

describe('the plan shimmers the wall whose name is pointed at', () => {
  it('on the badge', async () => {
    const { container } = await mounted();
    expect(container.querySelectorAll('[data-shimmer]')).toHaveLength(0);
    const badge = cardOf('Your photo of Wall 2').querySelector('[data-wall-badge="e"]')!;
    fireEvent.mouseEnter(badge);
    expect(planWall(container, 2).getAttribute('data-shimmer')).toBe('on');
    expect(container.querySelectorAll('[data-shimmer]')).toHaveLength(1);
    fireEvent.mouseLeave(badge);
    expect(container.querySelectorAll('[data-shimmer]')).toHaveLength(0);
  });

  it('on the Wall control, and on the option the open list highlights', async () => {
    const { container } = await mounted();
    const trigger = screen.getByRole('combobox', { name: 'Wall for the Wall 1 photo' });
    fireEvent.focus(trigger);
    expect(planWall(container, 1).getAttribute('data-shimmer')).toBe('on');
    fireEvent.click(trigger);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Wall 4' }));
    expect(planWall(container, 4).getAttribute('data-shimmer')).toBe('on');
    expect(container.querySelectorAll('[data-shimmer]')).toHaveLength(1);
    // Closing hands it back to the card's own wall while focus is still there.
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(planWall(container, 1).getAttribute('data-shimmer')).toBe('on');
    fireEvent.blur(trigger);
    expect(container.querySelectorAll('[data-shimmer]')).toHaveLength(0);
    // With focus gone, a list opened and closed again leaves nothing lit.
    fireEvent.click(trigger);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Wall 4' }));
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(container.querySelectorAll('[data-shimmer]')).toHaveLength(0);
  });
});

describe('why a photo is on its wall', () => {
  it('says so in quiet text, in a "Placed by" phrase', async () => {
    await mounted();
    // A photo read back from storage has no moment to describe, so no reason is shown.
    expect(screen.queryByText(/^Placed by/)).toBeNull();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'wall.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose a different photo for Wall 1'), { target: { files: [file] } });
    expect(await screen.findByText('Placed by you')).toBeTruthy();
    expect(screen.getByText('Placed by you').className).toContain('capture-foot__reason');
  });
});
