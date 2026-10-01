import { describe, expect, it } from 'vitest';
import { returnLabel, safeReturnPath, settingsHref } from '@/lib/settings-return';

// Settings used to have one way out, the breadcrumb's "Rooms", so opening it from a
// room or mid-scan lost your place. These are the rules for the way back.

describe('safeReturnPath', () => {
  it('keeps a path inside the app', () => {
    expect(safeReturnPath('/room/abc/model')).toBe('/room/abc/model');
    expect(safeReturnPath('/onboarding/detect')).toBe('/onboarding/detect');
    expect(safeReturnPath('/')).toBe('/');
  });

  it('refuses anything a browser would read as another site', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '', null, undefined]) {
      expect(safeReturnPath(bad), String(bad)).toBeNull();
    }
  });

  it('refuses Settings itself, so Back is never a button to the same page', () => {
    for (const self of ['/settings', '/settings?from=/', '/settings/', '/settings#key']) {
      expect(safeReturnPath(self), self).toBeNull();
    }
    expect(safeReturnPath('/settingsish')).toBe('/settingsish');
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
    const from = new URL(settingsHref('/room/a b/model'), 'https://x.test').searchParams.get('from');
    expect(safeReturnPath(from)).toBe('/room/a b/model');
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

  it('names the step of a scan', () => {
    expect(returnLabel('/onboarding/detect', room)).toBe('Back to the scan');
    expect(returnLabel('/onboarding/capture', room)).toBe('Back to your photos');
    expect(returnLabel('/onboarding/layout-pick', room)).toBe('Back to the room shape');
  });

  it('falls back to a plain Back', () => {
    expect(returnLabel('/somewhere', room)).toBe('Back');
  });
});
