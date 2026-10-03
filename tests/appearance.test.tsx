// @vitest-environment jsdom
//
// Night mode: the setting, the script that applies it before first paint, and the
// two controls that change it. The palettes themselves are held to their contrast
// promises in `color-tokens.test.ts`; this file is about WHICH palette applies, and
// when.
//
// jsdom because the setting persists through zustand's `persist` (localStorage) and
// because the boot script's whole job is a write to `document.documentElement`.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  APPEARANCE_BOOT,
  APPEARANCES,
  SETTINGS_STORAGE_KEY,
  applyAppearance,
  applyThemeColor,
  parseAppearance,
  themeAttribute,
} from '@/lib/appearance';
import { useSettings } from '@/lib/store';
import { stripComments } from './helpers/source';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('night-room', 'model'));

const { ViewMenu } = await import('@/components/studio/ViewMenu');
const { AppearanceSync } = await import('@/components/AppearanceSync');

const root = () => document.documentElement;

/** Run the inline script exactly as the browser would: a bare string of code. */
const boot = () => new Function(APPEARANCE_BOOT)();

/** A settings record in the shape `persist` writes. */
const record = (state: Record<string, unknown>) =>
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ state, version: 0 }));

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute('data-theme');
  root().removeAttribute('data-theme-switching');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => useSettings.getState().setAppearance('system'));
});

describe('the boot script, which runs before first paint', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
  ] as const)('pins %s by writing data-theme', (stored, attr) => {
    record({ appearance: stored, dimUnit: 'm' });
    boot();
    expect(root().getAttribute('data-theme')).toBe(attr);
  });

  it('leaves System to the media query: no attribute at all', () => {
    record({ appearance: 'system' });
    boot();
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it.each([
    ['an unknown answer', { appearance: 'sepia' }],
    ['a record from before the setting existed', { dimUnit: 'ft' }],
    ['a non-string', { appearance: { dark: true } }],
  ])('treats %s as System', (_label, state) => {
    record(state);
    boot();
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('never throws — not on a corrupt record, not when storage itself refuses', () => {
    // A private window or blocked site data makes `localStorage` THROW, and an
    // exception here would happen before any bundle, in the document head.
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    expect(boot).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(boot).not.toThrow();
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('reads the record the store actually writes', () => {
    // Not a hand-built fixture: the store persists, the script reads. If either
    // side renames the key or nests the field differently, this is where it shows.
    act(() => useSettings.getState().setAppearance('dark'));
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toContain('"appearance":"dark"');
    boot();
    expect(root().getAttribute('data-theme')).toBe('dark');
  });

  it('is plain ES5, because it runs before anything is transpiled or polyfilled', () => {
    expect(APPEARANCE_BOOT).not.toMatch(/=>|\blet\b|\bconst\b|`|\.\.\./);
  });

  it('is what the root layout puts in the head, inline', () => {
    const layout = stripComments(readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8'));
    expect(layout).toMatch(/<head>[^<]*<script dangerouslySetInnerHTML=\{\{ __html: APPEARANCE_BOOT \}\} \/>[^<]*<\/head>/);
    // The boot script writes an attribute React did not render; without this the
    // first hydration logs a mismatch on <html> for every pinned user.
    expect(layout).toMatch(/<html[^>]*suppressHydrationWarning/);
  });

  it('is allowed by the CSP the app serves', () => {
    // No hash, no nonce: inline script is already permitted for Next's own
    // bootstrap. If that tightens, this test is what says the boot script needs one.
    const config = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');
    const scriptSrc = /`script-src 'self'[^\n]*/.exec(config)?.[0] ?? '';
    expect(scriptSrc).toContain("'unsafe-inline'");
  });
});

describe('the setting', () => {
  it('defaults to System', () => {
    expect(useSettings.getInitialState().appearance).toBe('system');
  });

  it('refuses an answer it does not have', () => {
    act(() => useSettings.getState().setAppearance('sepia' as never));
    expect(useSettings.getState().appearance).toBe('system');
    for (const a of APPEARANCES) expect(parseAppearance(a)).toBe(a);
    expect(parseAppearance(undefined)).toBe('system');
  });

  it('reads a stored record through the vocabulary, keeping the rest of it', async () => {
    record({ appearance: 'midnight', dimUnit: 'ft' });
    await act(() => useSettings.persist.rehydrate());
    expect(useSettings.getState().appearance).toBe('system');
    expect(useSettings.getState().dimUnit).toBe('ft');

    record({ appearance: 'dark', dimUnit: 'cm' });
    await act(() => useSettings.persist.rehydrate());
    expect(useSettings.getState().appearance).toBe('dark');
    expect(useSettings.getState().dimUnit).toBe('cm');
  });

  it('maps to the attribute the stylesheet keys on', () => {
    expect(themeAttribute('system')).toBeNull();
    expect(themeAttribute('dark')).toBe('dark');
    expect(themeAttribute('light')).toBe('light');
  });
});

describe('switching without a colour-transition storm', () => {
  const frames: Array<() => void> = [];
  const flush = () => {
    while (frames.length) frames.shift()!();
  };
  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => frames.push(f));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('blanks transitions for the frame the colours change in, then gives them back', () => {
    applyAppearance(root(), 'dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(root().hasAttribute('data-theme-switching')).toBe(true);
    flush();
    expect(root().hasAttribute('data-theme-switching')).toBe(false);

    applyAppearance(root(), 'system');
    expect(root().hasAttribute('data-theme')).toBe(false);
    flush();
  });

  it('does nothing at all when nothing changes — the first effect after the boot script', () => {
    root().setAttribute('data-theme', 'dark');
    applyAppearance(root(), 'dark');
    expect(root().hasAttribute('data-theme-switching')).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('is a rule the stylesheet actually has', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/:root\[data-theme-switching\] \*,[^{]*\{ transition: none !important; \}/);
  });
});

describe("the browser chrome's colour", () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F4EFE4">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#17150F">';
  });
  const media = () =>
    Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => [m.getAttribute('content'), m.getAttribute('media')]);

  it('follows a pinned choice rather than the device, and goes back for System', () => {
    applyThemeColor(document, 'dark');
    expect(media()).toEqual([['#F4EFE4', 'not all'], ['#17150F', 'all']]);
    applyThemeColor(document, 'light');
    expect(media()).toEqual([['#F4EFE4', 'all'], ['#17150F', 'not all']]);
    applyThemeColor(document, 'system');
    expect(media()).toEqual([
      ['#F4EFE4', '(prefers-color-scheme: light)'],
      ['#17150F', '(prefers-color-scheme: dark)'],
    ]);
  });

  it('survives Next rewriting the tags on a client-side navigation', async () => {
    // Found in the browser, not by reasoning: the studio route re-rendered the head
    // and a pinned Dark fell back to the device's cream status bar.
    act(() => useSettings.getState().setAppearance('dark'));
    render(<AppearanceSync />);
    expect(media()[1][1]).toBe('all');
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F4EFE4">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#17150F">';
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(media()).toEqual([['#F4EFE4', 'not all'], ['#17150F', 'all']]);
  });
});

describe('the controls', () => {
  it("the studio's View menu switches the whole app, and the page follows", () => {
    render(
      <>
        <ViewMenu />
        <AppearanceSync />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    const group = screen.getByRole('group', { name: 'View settings' });
    expect(group.textContent).toContain('Night mode');
    const dark = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === 'Dark')!;
    expect(dark, 'no Dark option in the View menu').toBeTruthy();
    fireEvent.click(dark);
    expect(useSettings.getState().appearance).toBe('dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(dark.getAttribute('aria-pressed')).toBe('true');
  });

  it('Settings carries the same control, from the same list of answers', () => {
    const src = stripComments(readFileSync(join(process.cwd(), 'app', 'settings', 'page.tsx'), 'utf8'));
    expect(src).toMatch(/ariaLabel="Night mode"[\s\S]{0,200}options=\{\[\.\.\.APPEARANCE_OPTIONS\]\}/);
    expect(src).toContain("{ id: 'appearance', label: 'Appearance' }");
  });
});
