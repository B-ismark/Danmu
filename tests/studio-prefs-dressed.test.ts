// @vitest-environment jsdom
//
// Decor (auto set-dressing) is off until asked for. `dressed` is a persisted
// preference, so every browser that ran an older build holds the old default `true`
// it never chose; the persist version migrates it once and keeps everything else.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'danmu-studio-prefs';

describe('decor is off by default', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('on a fresh browser', async () => {
    const { useStudio } = await import('@/lib/store');
    expect(useStudio.getState().dressed).toBe(false);
  });

  it('and the old default is migrated once, keeping the other prefs', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { dressed: true, quality: 'low', showGrid: false, snapMode: 'off' }, version: 0 }),
    );
    const { useStudio } = await import('@/lib/store');
    const s = useStudio.getState();
    expect(s.dressed).toBe(false);
    expect(s.quality).toBe('low');
    expect(s.showGrid).toBe(false);
    expect(s.snapMode).toBe('off');
  });

  it('but a choice made after the migration is kept', async () => {
    const { STUDIO_PREFS_VERSION } = await import('@/lib/store');
    localStorage.setItem(KEY, JSON.stringify({ state: { dressed: true }, version: STUDIO_PREFS_VERSION }));
    vi.resetModules();
    const again = await import('@/lib/store');
    expect(again.useStudio.getState().dressed).toBe(true);
  });
});
