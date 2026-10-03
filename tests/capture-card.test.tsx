// @vitest-environment jsdom
//
// The capture screen's photo cards, mounted: the dark wall badge, the two round
// buttons, the Wall dropdown that moves or swaps, and the plan wall that lights when a card is
// pointed at, and the card that lifts when its wall is.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('leaves the set-wide turn-round pair out: each card moves its own photo', async () => {
    await mounted();
    expect(screen.queryByRole('button', { name: /Back one/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /On one/ })).toBeNull();
    expect(screen.getByText(/pick the right (one|wall) under it/i)).toBeTruthy();
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

const lit = (c: HTMLElement) => c.querySelectorAll('[data-wall-state]');
const stateOf = (c: HTMLElement, n: number) => planWall(c, n).getAttribute('data-wall-state');

describe('the plan lights the wall of the card that is pointed at', () => {
  it('anywhere on the card, not only the badge', async () => {
    const { container } = await mounted();
    expect(lit(container)).toHaveLength(0);
    const card = cardOf('Your photo of Wall 2');
    for (const part of [card, screen.getByAltText('Your photo of Wall 2'), card.querySelector('[data-wall-badge="e"]')!]) {
      fireEvent.mouseEnter(part);
      expect(stateOf(container, 2)).toBe('hover');
      expect(lit(container)).toHaveLength(1);
      fireEvent.mouseLeave(card);
      expect(lit(container)).toHaveLength(0);
    }
  });

  it('with the keyboard: focus in the card lights it, focus leaving the card clears it', async () => {
    const { container } = await mounted();
    const trigger = screen.getByRole('combobox', { name: 'Wall for the Wall 1 photo' });
    fireEvent.focus(trigger);
    expect(stateOf(container, 1)).toBe('hover');
    // The pointer leaving does not drop it while focus is still inside.
    fireEvent.mouseEnter(cardOf('Your photo of Wall 1'));
    fireEvent.mouseLeave(cardOf('Your photo of Wall 1'));
    expect(stateOf(container, 1)).toBe('hover');
    fireEvent.blur(trigger);
    expect(lit(container)).toHaveLength(0);
  });
});

describe('an open Wall list: the current wall and the previewed one are two states', () => {
  it('shows both at once, distinct, and clears both afterwards', async () => {
    const { container } = await mounted();
    const trigger = screen.getByRole('combobox', { name: 'Wall for the Wall 1 photo' });
    fireEvent.mouseEnter(cardOf('Your photo of Wall 1'));
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Wall 3' }));
    expect(stateOf(container, 1)).toBe('current');
    expect(stateOf(container, 3)).toBe('preview');
    expect(lit(container)).toHaveLength(2);
    // The dashed arrow joins them, and only while a DIFFERENT wall is previewed.
    expect(container.querySelectorAll('.capture-plan__arrow')).toHaveLength(1);
    // Highlighting the card's own wall previews nothing: it is simply current.
    fireEvent.mouseEnter(screen.getByRole('option', { name: /Wall 1/ }));
    expect(stateOf(container, 1)).toBe('current');
    expect(lit(container)).toHaveLength(1);
    expect(container.querySelectorAll('.capture-plan__arrow')).toHaveLength(0);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Wall 4' }));
    expect(stateOf(container, 4)).toBe('preview');
    expect(stateOf(container, 3)).toBeNull();
    // Closing drops the preview and the current mark; the focused card still glows.
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(stateOf(container, 1)).toBe('hover');
    expect(lit(container)).toHaveLength(1);
    fireEvent.blur(trigger);
    fireEvent.mouseLeave(cardOf('Your photo of Wall 1'));
    expect(lit(container)).toHaveLength(0);
    expect(container.querySelectorAll('.capture-plan__arrow')).toHaveLength(0);
  });

  it('with nothing holding the card, a list opened and closed leaves nothing lit', async () => {
    const { container } = await mounted();
    const trigger = screen.getByRole('combobox', { name: 'Wall for the Wall 1 photo' });
    fireEvent.click(trigger);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Wall 4' }));
    expect(lit(container)).toHaveLength(2);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(lit(container)).toHaveLength(0);
  });

  it("marks the card's own wall in the list in words, not only with the highlight", async () => {
    await mounted();
    fireEvent.click(screen.getByRole('combobox', { name: 'Wall for the Wall 1 photo' }));
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Wall 3' }));
    expect(screen.getByRole('option', { name: /Wall 1/ }).textContent).toContain('Current');
    expect(screen.getByRole('option', { name: 'Wall 3' }).textContent).not.toContain('Current');
    expect(screen.getByRole('option', { name: /Wall 2/ }).textContent).not.toContain('Current');
  });
});

describe('a photo moved to an empty wall', () => {
  it('leaves no wall lit behind it', async () => {
    // Its card unmounts (cards are keyed by wall) with the pointer still on it, so
    // neither a leave nor a blur ever arrives.
    const { container } = await mounted();
    const trigger = screen.getByRole('combobox', { name: 'Wall for the Wall 1 photo' });
    fireEvent.mouseEnter(cardOf('Your photo of Wall 1'));
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Wall 3' }));
    fireEvent.click(screen.getByRole('option', { name: 'Wall 3' }));
    await waitFor(() => expect(screen.queryByAltText('Your photo of Wall 1')).toBeNull());
    // Passive unmount effects run after the commit that removed the card, so wait.
    await waitFor(() => expect(lit(container)).toHaveLength(0));
  });
});

describe('the plan answers back: a wall pointed at lifts its card', () => {
  it('rings the card whose wall it is, and only that one, and lets go', async () => {
    const { container } = await mounted();
    const hitOf = (n: number) => planWall(container, n).querySelector('.capture-plan__hit')!;
    const ringed = () => container.querySelectorAll('[data-photo-card][data-plan-hover="on"]');
    expect(ringed()).toHaveLength(0);
    fireEvent.mouseEnter(hitOf(2));
    expect(ringed()).toHaveLength(1);
    expect(cardOf('Your photo of Wall 2').getAttribute('data-plan-hover')).toBe('on');
    expect(cardOf('Your photo of Wall 1').getAttribute('data-plan-hover')).toBeNull();
    fireEvent.mouseLeave(planWall(container, 2));
    expect(ringed()).toHaveLength(0);
  });

  it('does nothing for a wall with no photo, and every wall has a generous hit line', async () => {
    const { container } = await mounted();
    fireEvent.mouseEnter(planWall(container, 3));
    expect(container.querySelectorAll('[data-plan-hover]')).toHaveLength(0);
    expect(container.querySelectorAll('.capture-plan__hit')).toHaveLength(4);
  });

  it('is only a style: the lift is tokenised and switched off for reduced motion', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const rule = css.match(/\.capture-photo\s*\{[^}]*\}/)![0];
    expect(rule).toMatch(/var\(--dur-base\)/);
    expect(rule).toMatch(/var\(--ease-out\)/);
    const at = css.indexOf('.capture-photo[data-plan-hover] { transform: none');
    expect(css.lastIndexOf('@media', at)).toBeGreaterThan(css.indexOf('.capture-photo {'));
    const reduced = css.slice(css.lastIndexOf('@media', at), at + 80);
    expect(reduced).toMatch(/prefers-reduced-motion/);
    expect(reduced).toMatch(/\.capture-photo\[data-plan-hover\]\s*\{\s*transform:\s*none/);
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
