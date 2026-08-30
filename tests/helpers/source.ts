/** Source-text helpers for the sweeps that have to regex over `lib/`.
 *
 *  A test-only module, so it lives here rather than in `lib/` — a module only tests
 *  import does not belong where it reads as shipped code. `vitest`'s `include` is
 *  `tests/ ** / *.test.ts`, so nothing here is collected as a suite.
 */

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
 *  **Known limit, stated rather than papered over:** a regex literal containing a quote or
 *  a slash-star is read as a string start and can swallow the rest of
 *  the line. That is why every consumer pairs this with a positive assertion that the
 *  stripped text still contains what it is looking for — if this function ever eats code,
 *  that check fails loudly instead of the sweep silently passing over nothing.
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
