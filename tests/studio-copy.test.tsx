// @vitest-environment jsdom
//
// The two `docs/visual-check.md` items that are pure COPY: "Three signposts and no sign:
// the Library" and "Copy that names a feature the app does not have". Both were the
// user's own finds, both are already fixed in code, and neither had a gate — so the fix
// was one merge away from being undone by a rename with every test still green.
//
// Copy is the one thing in a UI a test can settle completely. There is nothing to look
// at: either the word is on the screen or it is not.
//
// Two forms are used here and the difference is deliberate. Where a component mounts
// cheaply the assertion reads RENDERED text, which is the real question. Where the
// string sits behind a store condition or inside a menu descriptor, the assertion reads
// the source with comments stripped — weaker, and marked as such, because a source
// assertion cannot tell a live string from a dead one. It can at least tell a string
// from a paragraph about that string, which is the mistake this repo has already made
// once: `tests/toolchain.test.ts`'s `console.log` check was satisfied by the commentary
// discussing `console.log` rather than by any call.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { stripComments } from './helpers/source';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
// `StudioHelp` renders TWO different cards and picks by route, and `vi.mock` is hoisted
// to the top of a FILE — so a test file can only ever be on one of them. This one is
// mocked to `/model` and pins the 3D card; the plan card is pinned by
// `help-two-lists-plan-tab.test.tsx`, which is a separate file for exactly that reason
// and not because the claim is a different claim.
//
// The difference is worth naming, because the first version of the assertion below was
// written against the plan card and its red read as the copy having been DELETED rather
// than as being on the other tab. That misreading is also what left § G.3 open: the
// plan card genuinely lacked the group, and every test that could have seen it was on
// this route. The group is one shared component now, rendered by both.
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('test-room', 'model'));

const { StudioHelp } = await import('@/components/studio/StudioHelp');

/** Source with every comment removed and every string KEPT, so an assertion about a
 *  user-facing string cannot be satisfied by a comment discussing it.
 *
 *  `stripComments` is a shared character scanner, not the regex pair this file used to
 *  carry. That pair ran the block-comment regex first and globally, so an opening
 *  slash-star inside a LINE comment paired with the next real closing one and deleted
 *  everything between: in `app/onboarding/capture/page.tsx` that was fifty lines of
 *  live code, and a forbidden string planted inside the window kept this file green
 *  while the identical string four lines past it went red. Two tests had two copies of
 *  the same wrong idea, which is the reason the scanner lives in one place now. */
function code(rel: string): string {
  return stripComments(readFileSync(join(ROOT, rel), 'utf8'));
}

describe('the comment stripper this file depends on', () => {
  // Written in the same hour as the assertions that use it, which `CLAUDE.md` names as
  // the most likely thing in a change to be decoration. So it is exercised in both
  // directions before anything trusts it.
  it('does not let a slash-star inside a line comment eat the code below it', () => {
    // The defect the regex pair had, as a fixture. Block-comments-first pairs the
    // opener in the line comment with the closer three lines down and deletes the
    // declaration between them — silently, and the sweep then reports green over a
    // file it never read.
    const src = [
      '// an allowlist, not image/* — that also matched SVG',
      'const live = "FINDME";',
      '/** a docblock */',
      'const after = 1;',
    ].join(String.fromCharCode(10));
    expect(code0(src), 'the line between the two must survive').toContain('FINDME');
    expect(code0(src)).toContain('const after');
  });

  it('and is not fooled by a slash-star inside a string either', () => {
    const src = ['const a = "/*";', 'const b = "KEEPME";', 'const c = "*/";'].join(String.fromCharCode(10));
    expect(code0(src)).toContain('KEEPME');
  });

  it('removes both comment forms and keeps the strings', () => {
    const src = ['const a = "keep me";', '// drop this line', 'const b = 1; // drop the tail', '/* drop', 'this too */', 'const c = "keep";'].join(
      '\n',
    );
    const out = code0(src);
    expect(out).toContain('keep me');
    expect(out).toContain('const c = "keep"');
    expect(out).not.toContain('drop this line');
    expect(out).not.toContain('drop the tail');
    expect(out).not.toContain('drop');
  });

  it('and it is the same function the assertions below use', () => {
    // Otherwise the test above proves something about a copy. `code` is `code0` plus a
    // file read, and this pins that: the phrase is present in the file and absent from
    // the stripped source, so the stripping really did happen on the real path.
    const raw = readFileSync(join(ROOT, 'components/studio/CatalogPanel.tsx'), 'utf8');
    expect(raw).toContain('The heading read "Add pieces"');
    expect(code('components/studio/CatalogPanel.tsx')).not.toContain('The heading read');
  });
});

/** Every `.tsx` under a UI directory, derived from disk. Module scope because TWO
 *  sweeps read it now, and the second one exists precisely because a sweep that names
 *  its own subjects cannot see the file nobody added to the list. */
function surfaces(rel: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const next = `${rel}/${entry.name}`;
    if (entry.isDirectory()) surfaces(next, out);
    else if (entry.name.endsWith('.tsx')) out.push(next);
  }
  return out;
}

/** The stripper this file depends on, named locally so the tests above can drive it
 *  and so a reader can see WHICH one they are driving. */
const code0 = stripComments;

describe('the Library has a sign on it', () => {
  // The user's report was three words: "Library isn't on there." Three strings in the
  // studio already used the word and the panel they pointed at was headed "Add pieces"
  // — named for what you do with the list rather than for what it holds.
  it('heads its own panel with the word', () => {
    const src = code('components/studio/CatalogPanel.tsx');
    expect(src).toContain('>Library</span>');
    // The name it must not go back to. Asserted on stripped source because the file's
    // own comments quote the old heading at length, explaining exactly this.
    expect(src).not.toContain('Add pieces');
  });

  it('is named, not merely pointed at, by all three signposts', () => {
    // Each of these is a different surface, and the point of the item is that they
    // agreed with each other and disagreed with the screen. The word — not a direction
    // — is what is asserted, because a direction is the thing that went stale.
    expect(code('components/studio/PartTree.tsx')).toContain('from the Library');
    expect(code('components/studio/SceneContextMenu.tsx')).toContain('Add from the Library');
    // The third is the help card, and it renders below rather than being grepped.
  });

  // The assertion above names two files by hand, which is the defect this repo keeps
  // finding: a sweep that lists its own subjects cannot see the file nobody added to
  // the list. It passed while THREE more live strings said "library" in lower case —
  // two of them the search box INSIDE the Library panel, sitting directly under the
  // heading the first test in this file pins, and the third a toast. `PartTree.tsx`
  // carried one of each, so the positive assertion above was satisfied by a different
  // line in the very file it was failing to police.
  //
  // Derived from disk, comments stripped, so a paragraph ABOUT the old lowercase
  // spelling cannot fail this. `RoomShell.tsx` has a real lowercase one ("no CSG
  // library") and it stays legal by being a comment rather than by being excepted.
  it('and no live string anywhere else says it in lower case', () => {
    // A genuine software library named in USER-FACING copy would go here with its
    // reason. Empty is a decision rather than an oversight: an exception list is how
    // the next lowercase one gets in.
    const ALLOWED: Array<[string, RegExp]> = [];

    const files = [...surfaces('app'), ...surfaces('components')];
    expect(files.length, 'no surfaces found, so this sweep proves nothing').toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      const lines = code(file).split(String.fromCharCode(10));
      for (let n = 0; n < lines.length; n++) {
        const line = lines[n];
        if (!/\blibrary\b/.test(line)) continue;
        if (ALLOWED.some(([f, re]) => f === file && re.test(line))) continue;
        offenders.push(file + ":" + (n + 1) + ": " + line.trim());
      }
    }
    expect(offenders, 'the Library is a proper noun — docs/history/PlanUX.md §3b-0').toEqual([]);

    // ── The positive half, and it took two goes to make it measure its own subject.
    //
    // It began as `files containing /\bLibrary\b/ > 2`, which was decoration: a
    // stripper that blanked every STRING still leaves 3 such files, because `Library`
    // also appears as JSX text and in identifiers. It passed by one against exactly
    // the mutation its own comment named. So the count is of the word inside QUOTED
    // strings — the thing the sweep above is actually reading — and the bound has
    // margin against the measured value rather than sitting one under it.
    const inStrings = files.flatMap((f) => code(f).match(/["'`][^"'`]*\bLibrary\b[^"'`]*["'`]/g) ?? []);
    expect(inStrings.length, 'the proper noun must survive the strip AS COPY').toBeGreaterThan(4);

    // And a floor on what the strip kept at all. `files.length` measures the directory
    // walk; nothing measured the strip, and a strip that returned `""` for every file
    // makes the offender list empty for the worst possible reason.
    const kept = files.reduce((sum, f) => sum + code(f).length, 0);
    expect(kept, 'the strip kept almost nothing — the sweep ran over air').toBeGreaterThan(400_000);

    // Printed on every green run, the way tests/detect-pipeline.test.ts prints its
    // table: these three numbers moving is how a stripper regression shows up, and
    // none of them is in the pass/fail verdict.
    console.log(
      `[library sweep] files=${files.length} keptChars=${kept} namedInStrings=${inStrings.length} offenders=${offenders.length}`,
    );
  });
});

describe('the help card says which list is where, and does not say a side', () => {
  it('names the two lists in its heading instead of a side', () => {
    cleanup();
    render(<StudioHelp />);
    // The card is a disclosure: the trigger is all that renders until it is pressed,
    // which is itself worth knowing — the first version of this test asserted against
    // a document holding one button and read as the copy being absent.
    fireEvent.click(screen.getByRole('button', { name: 'How this works' }));
    expect(screen.getByText('The two lists')).toBeTruthy();
    // "The lists on the left" was true of both until the Library moved to the right
    // edge of the canvas. A help card is the one place a stale direction costs most.
    expect(screen.queryByText(/lists on the left/)).toBeNull();
  });

  it('and the line itself carries both places', () => {
    cleanup();
    render(<StudioHelp />);
    // The card is a disclosure: the trigger is all that renders until it is pressed,
    // which is itself worth knowing — the first version of this test asserted against
    // a document holding one button and read as the copy being absent.
    fireEvent.click(screen.getByRole('button', { name: 'How this works' }));
    // Split across `<b>` elements, so the text is matched against the container's own
    // textContent rather than a single text node.
    const line = screen
      .getAllByText(/is what you can add/)
      .map((n) => n.textContent ?? '')
      .join(' ');
    expect(line).toContain('in the left rail');
    expect(line).toContain('on the right of');
  });

  // THE CONTROL, and it was owed the moment the group became shared code. The two
  // assertions above are about a group BOTH cards now render, so they no longer say
  // anything about which card this is — collapsing the route branch so that `/model` is
  // served the plan card left this whole describe green while breaking the 3D tab.
  // Measured, not reasoned: that mutation survived until this test existed, and the
  // mirror of it in `help-two-lists-plan-tab.test.tsx` was already killing the other
  // direction. A shared component needs a control on each side of the branch or it
  // quietly turns two gates into one.
  it('while still being the 3D card and not the plan one', () => {
    cleanup();
    render(<StudioHelp />);
    fireEvent.click(screen.getByRole('button', { name: 'How this works' }));
    // Orbiting and a wall colour are 3D gestures; a lasso and a page rotation are not.
    expect(screen.getByText('Walls and the room')).toBeTruthy();
    expect(screen.getByText(/Left-drag to orbit/)).toBeTruthy();
    expect(screen.queryByText('Choosing pieces')).toBeNull();
    expect(screen.queryByText(/turn the page/)).toBeNull();
  });
});

describe('no copy offers a feature this app deleted', () => {
  // Non-negotiable 1: the photoreal / describe-a-piece-in-words pipeline is gone, and
  // two tooltips went on advertising it for a while after — rule 1 wearing a tooltip.
  // A sweep is the only gate that can catch the next one, because a string nobody
  // renders in a test is invisible to every other kind.
  const FORBIDDEN = [
    /describe (?:it|a piece|the piece|this piece) in words/i,
    /describe[- ]it tab/i,
    /generate an image/i,
    /photoreal/i,
    /\bAI render/i,
    /render it for you/i,
  ];

  // Derived from disk, never typed here. The first version of this sweep named seven
  // studio files, which carries the exact defect the `include` gate one directory over
  // exists to prevent: a panel added later — or renamed — is simply not swept, and the
  // sweep stays green while the string ships. It also missed `RoomTools.tsx`, `PlanView`
  // and the whole of `app/`, which are user-facing too. Rule 1 is about every string a
  // user can read, so the subject is every `.tsx` under `app/` and `components/`.

  it('on any .tsx surface under app/ or components/', () => {
    const files = [...surfaces('app'), ...surfaces('components')];
    // The count first. An empty list — a walk that quietly returns nothing, a directory
    // renamed — would make the loop below vacuously true, which is the same shape as a
    // `.tsx` test file that is never collected.
    expect(
      files.length,
      'no .tsx surfaces found, so the sweep below proves nothing',
    ).toBeGreaterThan(50);
    for (const file of files) {
      const src = code(file);
      for (const re of FORBIDDEN) {
        expect(re.test(src), `${file} matches ${re}`).toBe(false);
      }
    }
  });

  it('and the piece list points at Add by name rather than by direction', () => {
    // The other half of the same item. `Add` has not been above that list since it
    // moved to the right rail, and on a stacked layout it is not even on the same side.
    const src = code('components/studio/PartTree.tsx');
    expect(src).toContain('Press Add to put the first piece in');
    expect(src).not.toMatch(/Add a piece above/);
  });
});
