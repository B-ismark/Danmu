// No invisible bytes in the text files this repo keeps.
//
// Two ways a file here can be damaged with every other gate still green. A file edited
// through a script takes on bytes nobody typed: `'\b'` in a Python string is a backspace
// and `'\0'` a NUL, and neither shows in an editor or a diff. And Windows PowerShell
// 5.1's `Get-Content` → `Set-Content` round trip (CLAUDE.md, Environment gotchas) turns
// every em dash into mojibake and prepends a byte-order mark, with `pnpm typecheck`
// still passing. So every tracked text file is read as BYTES and must be valid UTF-8,
// with no BOM, no control character but tab, newline and carriage return, and none of the
// mojibake that round trip makes of any character that is not ASCII.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
// What is NOT text, rather than what is: a list of text suffixes left out `.svg`,
// `.gitignore` and `LICENSE`, and would leave out the next kind of file too. None of
// these is tracked today; the list is for the day one is.
const BINARY = /\.(png|jpe?g|gif|webp|avif|heic|ico|woff2?|ttf|otf|onnx|glb|wasm|pdf|zip|gz|bin|mp4|webm)$/i;

// No pathspec, so there are no glob semantics to get wrong (tests/permissions-policy.test.ts
// says what one of those cost). A file deleted from the working tree and not yet from the
// index is listed and cannot be read, and is not this test's business.
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !BINARY.test(f) && existsSync(join(ROOT, f)));

// Read once, for every check below: eight megabytes of text, and each check read all of
// it again.
const read = files.map((f) => {
  const bytes = readFileSync(join(ROOT, f));
  return { f, bytes, text: bytes.toString('utf8') };
});

/** Offsets of the bytes no hand-kept text file should hold. */
function strayBytes(bytes: Buffer): number[] {
  const out: number[] = [];
  bytes.forEach((b, i) => {
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) out.push(i);
  });
  return out;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Characters that are valid UTF-8 and show as nothing: a zero-width space, the
 *  direction marks and overrides that make code read differently from how it runs, a
 *  byte-order mark anywhere, and the noncharacters (U+FDD0 to U+FDEF, and the last two of
 *  every plane). Not the zero-width joiners, which emoji and some scripts are made of. */
const INVISIBLE = new RegExp(
  `[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufdd0-\ufdef${Array.from(
    { length: 17 },
    (_, plane) => `\\u{${plane.toString(16)}fffe}\\u{${plane.toString(16)}ffff}`,
  ).join('')}]`,
  'u',
);

/** A character Windows-1252 decodes a UTF-8 continuation byte (0x80 to 0xBF) to. */
const CONT = '[\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178\u0081\u008d\u008f\u0090\u009d\u00a0-\u00bf]';
/** A lead byte read as Windows-1252, then as many continuations as that lead promises. The
 *  two-byte leads are the ones this repo's own characters have: Latin-1 (`Â`, `Ã`), a
 *  combining accent (`Ì`), Greek (`Î`, `Ï`) and Cyrillic (`Ð`, `Ñ`). The rest of that range
 *  are letters and signs (`×` is one) that sit before a dash in ordinary prose, and a file
 *  that brings in a character with another lead fails the sweep below until it is added. */
const MOJIBAKE = new RegExp(
  `[\u00c2\u00c3\u00cc\u00ce\u00cf\u00d0\u00d1]${CONT}|[\u00e0-\u00ef]${CONT}{2}|[\u00f0-\u00f4]${CONT}{3}`,
);

describe('tracked text files', () => {
  it('include the files this is about', () => {
    // Named files rather than a count: a floor of N passes a listing that has lost the
    // one directory that matters.
    for (const f of [
      'CLAUDE.md',
      'Design.md',
      'lib/storage.ts',
      'app/globals.css',
      'components/studio/RoomSync.tsx',
      '.gitignore',
      'LICENSE',
    ]) {
      expect(files).toContain(f);
    }
  });

  it('hold no control byte but tab, newline and carriage return', () => {
    const bad = read.flatMap(({ f, bytes }) => {
      const at = strayBytes(bytes);
      return at.length ? [`${f} @ ${at.slice(0, 3).join(', ')}`] : [];
    });
    expect(bad).toEqual([]);
  });

  it('hold no C1 control character either', () => {
    // U+0080 to U+009F are valid UTF-8 and invisible, and the round trip below makes them:
    // Windows-1252 leaves five bytes undefined, and a right curly quote's last byte is one.
    const bad = read.filter(({ text }) => /[\u0080-\u009f]/.test(text)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });

  it('hold no invisible character', () => {
    // Valid UTF-8, so the decode below passes them, and none shows in an editor or a diff.
    // A byte-order mark past the start is a file pasted into another; a noncharacter is
    // what a string bound written `'\uffff'` becomes when it is typed raw instead.
    const bad = read.filter(({ text }) => INVISIBLE.test(text)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });

  it('are UTF-8 with no byte-order mark', () => {
    const bad = read
      .filter(({ bytes }) => {
        if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return true;
        try {
          utf8.decode(bytes);
          return false;
        } catch {
          return true;
        }
      })
      .map(({ f }) => f);
    expect(bad).toEqual([]);
  });

  it('hold none of the mojibake a CP1252 round trip makes', () => {
    const bad = read.filter(({ text }) => MOJIBAKE.test(text)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });

  it('would know that mojibake', () => {
    // The pattern is the round trip's own output: each character's UTF-8 bytes read as
    // Windows-1252. One of every length of UTF-8 sequence, and the characters this repo
    // actually writes. Written as escapes, or this file would fail itself.
    const cp1252 = new TextDecoder('windows-1252');
    const samples = ['\u2014', '\u2013', '\u00b7', '\u00d7', '\u2248', '\u2264', '\u2192', '\u00e9', '\u201c', '\u201d', '\u2026', '\u00b0', '\u2019', '\u2713', '\u{1f642}'];
    for (const ch of samples) {
      expect(MOJIBAKE.test(ch), ch).toBe(false);
      expect(MOJIBAKE.test(cp1252.decode(Buffer.from(ch, 'utf8'))), ch).toBe(true);
    }
    // And not the text it sits beside: a zoom range written `0.4\u00d7\u20134\u00d7` is a
    // times sign and an en dash, which is what a looser pattern once took for mojibake.
    expect(MOJIBAKE.test('0.4\u00d7\u20134\u00d7')).toBe(false);
  });

  it('would know the mojibake of every character the tracked files write', () => {
    // The list above is chosen, and choosing is how the Greek was missed: `ψ` and `Δ` are
    // written in 33 files and their round trip starts with a lead the pattern did not have.
    // So every character that is actually here is asked about as well.
    const cp1252 = new TextDecoder('windows-1252');
    const written = new Set(read.flatMap(({ text }) => text.match(/[^\x00-\x7f]/gu) ?? []));
    expect(written.size).toBeGreaterThan(100);
    const missed = [...written].filter((ch) => !MOJIBAKE.test(cp1252.decode(Buffer.from(ch, 'utf8'))));
    expect(missed).toEqual([]);
  });

  it('would know an invisible character, and not the joiners', () => {
    for (const ch of ['\u200b', '\u202e', '\u2066', '\ufeff', '\ufdd0', '\uffff', '\u{1fffe}', '\u{10ffff}']) {
      expect(INVISIBLE.test(`a${ch}b`), ch.codePointAt(0)!.toString(16)).toBe(true);
    }
    for (const ok of ['\u200d', '\u200c', '\u00a0', '\ufffd', '\u{1f642}', '\u{1fffd}']) {
      expect(INVISIBLE.test(`a${ok}b`), ok.codePointAt(0)!.toString(16)).toBe(false);
    }
  });

  it('catch the bytes they are meant to', () => {
    expect(strayBytes(Buffer.from('a\tb\nc\r\n'))).toEqual([]);
    expect(strayBytes(Buffer.from('word\bs'))).toEqual([4]);
    expect(strayBytes(Buffer.from('a\0b\x1b[0m\x7f'))).toEqual([1, 3, 7]);
  });
});
