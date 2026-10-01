import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/source';
import { returnLabel, safeReturnPath, settingsHref, wayBack } from '@/lib/settings-return';

// Settings used to have one way out, the breadcrumb's "Rooms", so opening it from a
// room or mid-scan lost your place. These are the rules for the way back.

describe('safeReturnPath', () => {
  it('keeps a path inside the app', () => {
    expect(safeReturnPath('/room/abc/model')).toBe('/room/abc/model');
    expect(safeReturnPath('/onboarding/detect')).toBe('/onboarding/detect');
    expect(safeReturnPath('/')).toBe('/');
  });

  it('refuses anything a browser would read as another site', () => {
    // `/<tab>/host` and `/<newline>/host` are the spellings a character test misses:
    // URL parsing deletes tabs and newlines, so they arrive as `//host`.
    const sneaky = ['/\t/evil.example', '/\n/evil.example', '/\r\n/evil.example', '/\t\\evil.example'];
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '', null, undefined, ...sneaky]) {
      expect(safeReturnPath(bad), String(bad)).toBeNull();
    }
  });

  it('refuses Settings itself, so Back is never a button to the same page', () => {
    for (const self of ['/settings', '/settings?from=/', '/settings/', '/settings#key']) {
      expect(safeReturnPath(self), self).toBeNull();
    }
    expect(safeReturnPath('/settingsish')).toBe('/settingsish');
  });

  it('returns the path it checked, query and all', () => {
    expect(safeReturnPath('/room/abc/model?x=1#y')).toBe('/room/abc/model?x=1#y');
  });
});

describe('settingsHref', () => {
  it('carries the page it was opened from', () => {
    expect(settingsHref('/room/abc/plan')).toBe('/settings?from=%2Froom%2Fabc%2Fplan');
    expect(settingsHref('/onboarding/detect')).toBe('/settings?from=%2Fonboarding%2Fdetect');
  });

  it('carries nothing from the rooms page, or from a path it would refuse', () => {
    expect(settingsHref('/')).toBe('/settings');
    expect(settingsHref('//evil.example')).toBe('/settings');
    expect(settingsHref(null)).toBe('/settings');
  });

  it('round-trips through the query string', () => {
    const from = new URL(settingsHref('/room/a b/model?x=1'), 'https://x.test').searchParams.get('from');
    expect(safeReturnPath(from)).toBe(safeReturnPath('/room/a b/model?x=1'));
    expect(safeReturnPath(from)).toBe('/room/a%20b/model?x=1');
  });
});

describe('returnLabel', () => {
  const room = { id: 'abc', name: 'Living room' };

  it('names the room only when the path is that room', () => {
    expect(returnLabel('/room/abc/model', room)).toBe('Back to “Living room”');
    expect(returnLabel('/room/abc/plan', room)).toBe('Back to “Living room”');
    // The open room is a persisted id; Settings may have been opened from another.
    expect(returnLabel('/room/abcd/model', room)).toBe('Back to your room');
    expect(returnLabel('/room/xyz/model', null)).toBe('Back to your room');
  });

  it('names the scan, the one entry outside a room', () => {
    expect(returnLabel('/onboarding/detect', room)).toBe('Back to the scan');
  });

  it('falls back to a plain Back', () => {
    expect(returnLabel('/somewhere', room)).toBe('Back');
  });
});

describe('wayBack', () => {
  it('goes back through history when the app routed here', () => {
    expect(wayBack('/room/abc/model')).toBe('history');
    expect(wayBack('/')).toBe('history');
    expect(wayBack('/onboarding/detect')).toBe('history');
  });

  it('goes by address when this tab was opened on Settings', () => {
    // A fresh tab, a bookmark, or a link from another site: the entry behind it is
    // not this app, so history would leave it.
    expect(wayBack('/settings')).toBe('address');
    expect(wayBack('/settings/')).toBe('address');
    expect(wayBack(null)).toBe('address');
    expect(wayBack(undefined)).toBe('address');
  });
});

// The rule is only as good as its callers. Every way into Settings except the rooms
// page (whose breadcrumb already is the way back) must say where it was opened from,
// so a bare '/settings' anywhere else is a way in that forgets its place — which is
// what Cmd/Ctrl+, and the scan screen's "Set up a key" would silently become if
// either reverted. Swept rather than listed, so a new entry is held to it too.
describe('every way into Settings', () => {
  const ROOT = process.cwd();
  const files = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  const sources = [...files('app'), ...files('components')].map((f) => ({
    f,
    src: stripComments(readFileSync(join(ROOT, f), 'utf8')),
  }));

  it('carries its own page, except the rooms page', () => {
    const bare = sources
      .filter(({ f }) => f !== join('app', 'page.tsx'))
      .filter(({ src }) => /['"`]\/settings['"`?]/.test(src))
      .map(({ f }) => f);
    expect(bare).toEqual([]);
  });

  it('reaches the three entry points it names', () => {
    const callers = sources.filter(({ src }) => /settingsHref\(/.test(src)).map(({ f }) => f).sort();
    expect(callers).toEqual(
      [
        join('app', 'onboarding', 'detect', 'page.tsx'),
        join('components', 'studio', 'KeyboardShortcuts.tsx'),
        join('components', 'studio', 'ViewMenu.tsx'),
      ].sort(),
    );
    // The scan screen names itself; the studio's two pass the live path.
    const detect = sources.find(({ f }) => f.endsWith(join('detect', 'page.tsx')))!.src;
    expect(detect).toContain("settingsHref('/onboarding/detect')");
  });
});
