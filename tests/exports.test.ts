import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileSlug, snapshotFileName } from '@/lib/exports';
import { planFileName } from '@/lib/plan-export';
import { stripComments } from './helpers/source';
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
  // an assertion about the code.
  //
  // The stripper is IMPORTED, not copied. This file used to carry its own byte
  // identical regex pair under a comment saying "same stripper as
  // studio-copy.test.tsx" — a claim nothing enforced, so fixing one would have left
  // the other. Both copies had the same defect.
  const code = stripComments;

  const room = code(readSrc('components', 'three', 'Room.tsx'));
  const menu = code(readSrc('components', 'studio', 'ExportMenu.tsx'));

  it('names the capture for the room, read off the request', () => {
    expect(room).toContain('snapshotFileName(');
    // Quote-agnostic on purpose: a re-quoted or template-literal copy of the
    // fixed name would sail past a quoted assertion while shipping the defect.
    expect(room).not.toContain('room-snapshot.png');
  });

  it('and reads that name WITH the token, not inside the encode callback', () => {
    // `request` writes token and name in one `set`, so they are one fact. The first
    // version read the name inside `toBlob`, tens of milliseconds later: a rename
    // and a second press inside that window gave the FIRST capture the SECOND name.
    // What this pins is that the store is consulted ONCE, where the token is taken.
    expect(room).toContain('const { token: want, name } = useSnapshot.getState();');
    // …and that the callback uses the closed-over name rather than re-reading. A
    // second `getState()` anywhere in the capture is the defect coming back.
    expect(room).toContain('snapshotFileName(name)');
    const reads = room.match(/useSnapshot\.getState\(\)/g)?.length ?? 0;
    expect(reads, 'the capture must consult the store once per frame, not twice').toBe(2);
  });

  it('has the menu carry a name, rather than calling request bare', () => {
    expect(menu).toContain('.request(');
    // The 3D item must pass the RESOLVED name through, not merely mention the
    // resolver. `.then(() => request(roomName))` type-checks, keeps every count in
    // this file intact, and silently reverts the fix to the mount-loaded name.
    expect(menu).toContain('.then((n) => useSnapshot.getState().request(n))');
  });

  it('and the channel requires a name, so a bare request cannot be written', () => {
    // This used to be `expect(menu).not.toMatch(/request\(\)/)` — decoration, because
    // `request` takes a required string and a bare call is a TYPE error, so no change
    // that passes typecheck could redden it. What it was really guarding is the
    // SIGNATURE: revert that to `name?` and the old bug is back, silently, with the
    // menu untouched. Nothing tested lib/snapshot.ts at all — no test imports it, and
    // it is a .ts file so the .tsx copy sweep never saw it either.
    const snap = stripComments(readSrc('lib', 'snapshot.ts'));
    expect(snap).toContain('request: (name: string) => void');
    expect(snap, 'an optional name reinstates the previous room\'s filename').not.toContain('name?: string');
    expect(snap, 'and the unreachable default with it').not.toContain('?? s.name');
  });

  it('and both PNG items take the name from the one fresh read', () => {
    // The plan was the stale one: it took the mount-loaded name for the filename
    // AND the title drawn on the sheet. The count is the declaration plus TWO
    // callers.
    //
    // Pinned WITH the item count, because on its own this number fails in only one
    // direction — the direction where someone does the right thing. A fourth export
    // item added WITHOUT a fresh read leaves this at 3 and ships the stale-name
    // defect green, which is precisely what the assertion is for. Adding an item now
    // reddens the pair and forces the decision.
    expect(menu.match(/freshRoomName\(\)/g)?.length).toBe(3);
    expect(menu.match(/\blabel: '/g)?.length, 'a new export item must decide about the fresh read').toBe(3);
  });
});

describe('the floor plan is named like the other two', () => {
  // `planFileName` was private and nothing imported it, so reverting its body to a
  // fixed `return 'floor-plan.png'` — the pre-fix defect, three rooms leaving three
  // files the browser numbers `(1)` and `(2)` — kept the ENTIRE suite green. The
  // header of lib/exports.ts claims all three downloads agree; two of the three were
  // gated and this is the third.
  it('slugs the room name and adds its own artefact suffix', () => {
    expect(planFileName('My Front Room!')).toBe(`${fileSlug('My Front Room!')}-floor-plan.png`);
    expect(planFileName('Front Room')).toBe('front-room-floor-plan.png');
  });

  it('and has no fixed-name escape hatch left', () => {
    // There was a `slug === 'floor-plan'` branch guarding an unreachable parameter
    // default. It compared in the wrong space: a room the user genuinely named
    // "Floor Plan" slugged to the sentinel and exported as the fixed name.
    expect(planFileName('Floor plan')).toBe('floor-plan-floor-plan.png');
    expect(planFileName('FLOOR PLAN!')).toBe('floor-plan-floor-plan.png');
  });

  it('and all three downloads agree on the slug and the cap', () => {
    // The claim in lib/exports.ts's header, as an assertion rather than a sentence.
    const long = 'A'.repeat(300);
    const slug = fileSlug(long);
    expect(slug.length).toBe(60);
    expect(snapshotFileName(long)).toBe(`${slug}-snapshot.png`);
    expect(planFileName(long)).toBe(`${slug}-floor-plan.png`);
    expect(sceneFileName(long)).toBe(`${slug}.danmu.json`);
  });
});
