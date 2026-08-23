import { describe, expect, it } from 'vitest';
import { fileSlug } from '@/lib/exports';
import { sceneFileName } from '@/lib/scene-file';

// Two things are deliberately NOT tested here, because they are not here:
//
//   · The furniture CSV, retired in `9a75a42` — non-negotiable 6 forbids reinstating
//     the carpenter spec, and a parts list minus the prices is what that was.
//   · Applying the user's transforms, which `lib/transforms.ts` owns and
//     `tests/room-scene.test.ts` both tests and guards against being re-copied.
//
// What is left is the naming convention the three surviving downloads share.

describe('fileSlug', () => {
  it('makes a filename-safe slug', () => {
    expect(fileSlug('  Living Room!  ')).toBe('living-room');
  });

  it('never returns an empty string', () => {
    // An all-punctuation name would otherwise produce a file called `.danmu.json`,
    // which is a hidden file on macOS and Linux.
    expect(fileSlug('***')).toBe('room');
    expect(fileSlug('')).toBe('room');
    expect(fileSlug('   ')).toBe('room');
  });

  it('caps the length, so the OS cannot refuse to write the file', () => {
    expect(fileSlug('a'.repeat(200))).toHaveLength(60);
  });

  it('does not leave a trailing separator when the cap cuts mid-word', () => {
    // `front-room-` reads as a filename truncated by accident. The cut lands on a
    // separator here: 'ab ' × 40 puts a hyphen at index 60 exactly.
    expect(fileSlug('ab '.repeat(40))).not.toMatch(/-$/);
  });

  it('still answers when the cap would leave nothing but separators', () => {
    // A name whose first 60 characters are all punctuation slugs to '-'.repeat(n),
    // and trimming that empties the string — which would name the file `.danmu.json`.
    expect(fileSlug(`${'! '.repeat(60)}room`)).toBe('room');
  });
});

describe('the scene file and the slug agree', () => {
  it('names itself with fileSlug plus the extension', () => {
    // `scene-file.ts` carried a byte-identical copy of this slug. Two functions that
    // must agree and are written twice are two functions that will stop agreeing.
    expect(sceneFileName('My Front Room!')).toBe(`${fileSlug('My Front Room!')}.danmu.json`);
  });

  it('carries the cap through, rather than capping the name plus extension', () => {
    // The 60 is a budget for the NAME. Applying it after the extension would eat
    // `.danmu.json` and produce a file the app could no longer recognise as its own.
    const name = sceneFileName('a'.repeat(200));
    expect(name).toBe(`${'a'.repeat(60)}.danmu.json`);
    expect(name.endsWith('.danmu.json')).toBe(true);
  });
});
