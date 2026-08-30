import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two `/** … *\/` blocks in a row is always a mistake, and it is a silent one.
 *
 * The first block cannot be attached to anything — TypeScript and every editor take
 * the nearest preceding comment, so the second wins and the first goes invisible in
 * every tooltip while still reading, in source, as though it documents whatever
 * follows it. Typecheck and ESLint are both structurally incapable of seeing it.
 *
 * It arrives one of two ways and this repo produced three instances of both in a
 * single diff:
 *
 *   · **A new function is inserted between a docblock and its subject.**
 *     `relationDistance` and `inRelationBand` went in above `relationCost`, which
 *     left `relationCost` with no docblock at all and moved its measured history —
 *     *"chairs at 8°, 15°, 98°, −113°, and one at 203°, facing away from its own
 *     table"* — onto a function that has no orientation term in it.
 *   · **A constant is re-documented on export** and the old block is left in place.
 *     `TURN_EPSILON` and `MOVE_EPSILON` both kept a block explaining the value and
 *     gained one explaining the export; in both, the block that lost was the one
 *     saying *why the number is that number*.
 *
 * This is a scan of source text rather than of imported data, which is normally the
 * sign that the data is in the wrong place. The exception is named on purpose: the
 * property is about the *layout of the source file itself*, so the source text is
 * the subject and not a transcript of it. There is nothing to import.
 *
 * ── WHAT A GREEN HERE DOES NOT MEAN ──────────────────────────────────────────
 *
 * **It does not mean there are no orphaned docblocks.** This catches exactly one
 * shape: a docblock immediately followed by another. A block separated from its
 * subject by a declaration that carries *no* docblock of its own is the identical
 * defect and is invisible here, because there is no adjacency to see — and so is a
 * block whose subject was genuinely deleted, which leaves it attached to whatever
 * happens to follow. Both need a reader, and this file is not one.
 *
 * The narrow shape is worth gating anyway because it is the one that recurs: seven
 * instances across five files, every one an insertion between a block and its
 * subject where **the inserted declaration brought its own block**, so nothing ever
 * looked wrong at the insertion point.
 *
 * ── AND ON DECIDING WHOSE BLOCK IT IS ────────────────────────────────────────
 *
 * That stays a judgement, and it has already gone wrong once in the commit that
 * added this file. `isLightFixture`'s block was read as documentation for deleted
 * code and nearly dropped, on the strength of a grep for `isFixture|FIXTURE|fixtures`
 * returning zero — none of which matches `isLightFixture`. The function is live with
 * five readers, including the `Inspector` gate that the block's "and nothing else"
 * is describing.
 *
 * The general form: **a grep for the words in a comment is not a search for what the
 * comment is about**, and an orphaned block is precisely the case where it cannot be,
 * because if the subject's identifiers appeared in the prose the block would not read
 * as orphaned. Three vocabularies for one idea here — "fixtures" in the block,
 * `isLightFixture` in the code, `LIGHT_BY_SHAPE` in the table it reads. So: assume a
 * subject exists and move the block to it; drop one only after a search for its
 * plausible identifiers, not its wording, comes back empty.
 */
const ROOTS = ['lib', 'components', 'app', 'tests'];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Line numbers (1-based) where a doc comment closes and the next thing with any
 *  content on it opens another one. Deliberately ignores blank lines between the
 *  two: a gap does not re-attach the first block, it just makes the orphan harder
 *  to see. */
function adjacentDocblocks(src: string): number[] {
  const lines = src.split(/\r?\n/);
  const hits: number[] = [];
  let inDoc = false;
  let closedAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!inDoc) {
      if (t.startsWith('/**')) {
        // A single-line `/** … */` opens and closes on the same line.
        if (closedAt >= 0) hits.push(closedAt + 1);
        if (t.includes('*/')) closedAt = i;
        else inDoc = true;
        continue;
      }
      // Anything with content that is not a docblock breaks the adjacency.
      if (t !== '') closedAt = -1;
      continue;
    }
    if (t.includes('*/')) {
      inDoc = false;
      closedAt = i;
    }
  }
  return hits;
}

describe('a docblock documents the thing under it', () => {
  const files = ROOTS.flatMap(tsFiles);

  // Delete the subject and a sweep passes over an empty list. This is the count that
  // stops that, and it is a floor rather than a pin so adding a file is not a red.
  it('is sweeping a real tree', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it('finds no two doc comments in a row anywhere in first-party source', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const line of adjacentDocblocks(readFileSync(f, 'utf8'))) {
        offenders.push(`${f.replace(/\\/g, '/')}:${line}`);
      }
    }
    expect(offenders, `a docblock here is followed by another, so it documents nothing`).toEqual([]);
    // An explicit timeout because this reads every first-party source file — ~400 of
    // them — and vitest's 5 s default is not a budget anyone chose for a filesystem
    // sweep. It runs in ~0.4 s alone and blew the default under a full-suite run on
    // Windows, which reads as a failure of the thing being gated rather than of the
    // clock. A generous ceiling is honest here: this test has no timing claim to make.
  }, 120_000);

  // The detector itself, against the two shapes that actually occurred and the three
  // that must NOT be reported. Without this the sweep above could return [] because
  // it cannot see anything, which is the failure it exists to prevent.
  it('detects both shapes and neither false positive', () => {
    expect(adjacentDocblocks('/** a */\n/** b */\nexport const x = 1;\n')).toEqual([1]);
    expect(adjacentDocblocks('/** a\n *  more\n */\n/** b */\nconst x = 1;\n')).toEqual([3]);
    expect(adjacentDocblocks('/** a */\n\n\n/** b */\nconst x = 1;\n')).toEqual([1]);
    // One block, then code, then another block: the ordinary case.
    expect(adjacentDocblocks('/** a */\nconst x = 1;\n/** b */\nconst y = 2;\n')).toEqual([]);
    // A plain block comment or a line comment is not a doc comment and does not count.
    expect(adjacentDocblocks('/* eslint-disable */\n/** b */\nconst x = 1;\n')).toEqual([]);
    expect(adjacentDocblocks('// note\n/** b */\nconst x = 1;\n')).toEqual([]);
    // A `*/` inside a string is not a close we can see, and we do not pretend to
    // parse — but the opener must still be a real docblock start, so this is inert.
    expect(adjacentDocblocks('const s = "/** not a doc */";\n')).toEqual([]);
  });
});
