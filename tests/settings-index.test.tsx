// @vitest-environment jsdom
//
// The index beside Settings' cards. Each entry is an anchor, so a wrong id is a link
// that goes nowhere and says nothing: every one is held to a card that exists, is
// labelled by its own heading, and carries the index's words.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null, { router }));

const { default: SettingsPage } = await import('@/app/settings/page');

afterEach(cleanup);

describe('the Settings index', () => {
  it('links every card, in page order, by its own title', () => {
    render(<SettingsPage />);
    const links = within(screen.getByRole('navigation', { name: 'Settings sections' })).getAllByRole('link');
    const cards = [...document.querySelectorAll('section.settings-section')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(cards.map((c) => `#${c.id}`));
    for (const [i, a] of links.entries()) {
      const card = cards[i];
      expect(screen.getByRole('region', { name: a.textContent! })).toBe(card);
    }
  });

  it('marks the first card as the one being read on arrival', () => {
    render(<SettingsPage />);
    const current = document.querySelectorAll('.settings-index [aria-current]');
    expect([...current].map((a) => a.textContent)).toEqual(['Furniture detection']);
  });

  it('follows the card whose top has crossed the upper third once scrolled', () => {
    render(<SettingsPage />);
    const tops: Record<string, number> = { detection: -900, units: -300, downloads: 100, rooms: 700 };
    for (const [id, top] of Object.entries(tops)) {
      document.getElementById(id)!.getBoundingClientRect = () => ({ top }) as DOMRect;
    }
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1200 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    const current = () => [...document.querySelectorAll('.settings-index [aria-current]')].map((a) => a.textContent);
    expect(current()).toEqual(['Downloads']);
    // At the foot of the page the last card wins even though it never reached the line.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 4100 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(current()).toEqual(['Your rooms']);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  // Downloads is short and near the end, so its jump ends at the foot of the page,
  // where the position alone would mark Your rooms.
  const atFoot = () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1100 });
  };
  const current = () => [...document.querySelectorAll('.settings-index [aria-current]')].map((a) => a.textContent);
  afterEach(() => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    window.history.replaceState(null, '', '/');
  });

  it('keeps a pressed card marked through the jump, until the reader scrolls', () => {
    render(<SettingsPage />);
    act(() => {
      screen.getByRole('link', { name: 'Downloads' }).click();
    });
    atFoot();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(current()).toEqual(['Downloads']);
    act(() => {
      window.dispatchEvent(new Event('wheel'));
      window.dispatchEvent(new Event('scroll'));
    });
    expect(current()).toEqual(['Your rooms']);
  });

  it('follows Back to the card the address names, even after a press marked another', () => {
    render(<SettingsPage />);
    act(() => {
      screen.getByRole('link', { name: 'Your rooms' }).click();
    });
    expect(current()).toEqual(['Your rooms']);
    window.history.replaceState(null, '', '/settings#units');
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(current()).toEqual(['Units']);
  });

  it('marks the card an address names on arrival', () => {
    window.history.replaceState(null, '', '/settings#downloads');
    atFoot();
    render(<SettingsPage />);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(current()).toEqual(['Downloads']);
  });
});
