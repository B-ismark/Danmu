import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileSlug, snapshotFileName } from '@/lib/exports';
import { sceneFileName } from '@/lib/scene-file';

const ROOT = join(__dirname, '..');
const readSrc = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

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

describe('the 3D snapshot joins the same agreement', () => {
  it('names itself with fileSlug plus the artefact suffix', () => {
    // It was the last fixed-name download: every room's 3D PNG arrived as
    // `room-snapshot.png`, and exporting three rooms left three files the
    // browser silently numbered `(1)` and `(2)`.
    expect(snapshotFileName('My Front Room!')).toBe(`${fileSlug('My Front Room!')}-snapshot.png`);
  });

  it('keeps the old fixed name for an unnamed room', () => {
    // `room-snapshot.png` was the only name this download ever had; an unnamed
    // room slugs to `room`, so the fallback lands on the same bytes it always did.
    expect(snapshotFileName('')).toBe('room-snapshot.png');
  });
});

describe('the snapshot filename wiring, not just the helper', () => {
  // A gate on `snapshotFileName` alone is green with every caller deleted — the
  // exact shape studio-copy.test.tsx's header warns about, a fix one merge away
  // from being undone with every test still passing. The defect being guarded is
  // a fixed filename at the capture site, so the gate reads the capture site —
  // with comments stripped, because prose about the old name must not satisfy
  // an assertion about the code. Same stripper as studio-copy.test.tsx.
  function code(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  const room = code(readSrc('components', 'three', 'Room.tsx'));
  const menu = code(readSrc('components', 'studio', 'ExportMenu.tsx'));

  it('names the capture for the room, read off the request', () => {
    expect(room).toContain('snapshotFileName(');
    expect(room).toContain('useSnapshot.getState().name');
    // Quote-agnostic on purpose: a re-quoted or template-literal copy of the
    // fixed name would sail past a quoted assertion while shipping the defect.
    expect(room).not.toContain('room-snapshot.png');
  });

  it('has the menu carry a name, rather than calling request bare', () => {
    // A bare `request()` leaves `name` at whatever it last was — on a fresh
    // session the empty fallback, which silently reverts the fix for real users
    // while every gate above stays green.
    expect(menu).toContain('.request(');
    expect(menu).not.toMatch(/request\(\)/);
  });

  it('and both PNG items take the name from the one fresh read', () => {
    // The plan was the stale one: it took the mount-loaded name for the
    // filename AND the title drawn on the sheet. The count is the declaration
    // plus TWO callers — a third export item added to this menu grows its own
    // fresh read or fails here, which is a decision arriving as a gate rather
    // than as a diff nobody reads.
    expect(menu.match(/freshRoomName\(\)/g)?.length).toBe(3);
  });
});
