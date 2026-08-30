// Source-text helpers for the sweeps that have to regex over `lib/`.
//
// A test-only module, so it lives here rather than in `lib/` — a module only tests
// import does not belong where it reads as shipped code. `vitest`'s `include` is
// `tests/**/*.test.ts`, so nothing here is collected as a suite.
//
// A `//` header, not a `/** */` one, and that is the gate working rather than a style
// choice: `tests/docblock-adjacency.test.ts` fails on two doc comments in a row, which
// is the orphan pattern it exists to catch — a file-level docblock immediately above a
// function docblock is indistinguishable from a docblock separated from its subject.
// It caught this file on the merge, which is exactly where it should have.

/** Blank out every comment and every string/template literal, leaving code.
 *
 *  A scanner rather than a pair of regexes, because BOTH orders of the regex version are
 *  wrong and each was measured wrong:
 *
 *  · **Comments first** — a block-comment regex runs from any opening slash-star to the
 *    next closing one, and it cannot tell that the opener was inside a STRING. It then
 *    swallows whatever real code sits between them. Measured: planting a string holding
 *    an opening slash-star above a second `const CEILING_PAD = 0.02;` left the
 *    pad-declaration ban GREEN with the duplicate constant sitting in the file.
 *  · **Strings first** — an apostrophe in a comment (`// a door's canonical height`) opens
 *    a literal that runs to the next quote and eats whatever is between. This codebase's
 *    comments are full of them.
 *
 *  So neither ordering is safe and the honest answer is one pass that knows which state it
 *  is in. Literals collapse to `''` rather than vanishing, so `const x = 'a';` stays a
 *  syntactically recognisable declaration.
 *
 *  **Known limit, stated rather than papered over:** a regex literal containing a quote
 *  or a slash-star is read as a string start and can swallow the rest of the line.
 *
 *  Consumers pair this with a positive assertion that the stripped text still contains
 *  what the sweep is looking for. **That pairing is a floor, not the mitigation, and it
 *  is worth being exact about which.** It catches "the strip ate EVERYTHING"; it does
 *  not catch "the strip ate the OFFENDER". Measured by danmu-bc against a real 7324-
 *  character module: a targeted attack — a string holding an opener, the offending line,
 *  a string holding a closer — removes four lines, and a length check and a
 *  content-presence check both still pass while the offender is invisible. So this
 *  scanner is doing all of the real work, and the paired check only stops the sweep
 *  from silently running over nothing at all.
 */
export function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      out += "''";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
