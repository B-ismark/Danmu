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
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
// `StudioHelp` renders TWO different cards and picks by route: the full one on
// `/model`, a shorter one everywhere else. Mocked to the model route because that is
// where the group under test lives — and the difference is worth naming, because the
// first version of this test asserted against the plan card and read as the copy being
// missing rather than as being on the other tab. Whether the 2D plan should also carry
// the Catalog-vs-Library line is a product question rather than a bug; it is recorded in
// `docs/what-is-still-open.md` § G.3.
vi.mock('next/navigation', () => ({
  usePathname: () => '/room/test-room/model',
  useParams: () => ({ roomId: 'test-room' }),
}));

const { StudioHelp } = await import('@/components/studio/StudioHelp');

/** Source with `//` and block comments removed, so an assertion about a user-facing
 *  string cannot be satisfied by a comment discussing it. Not a parser: a `//` inside a
 *  string literal would be treated as a comment. None of the files read here contains
 *  one, and the alternative is a TypeScript parse for four string checks. */
function code(rel: string): string {
  return code0(readFileSync(join(ROOT, rel), 'utf8'));
}

describe('the comment stripper this file depends on', () => {
  // Written in the same hour as the assertions that use it, which `CLAUDE.md` names as
  // the most likely thing in a change to be decoration. So it is exercised in both
  // directions before anything trusts it.
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

/** The stripper, separated from the file read so the test above can drive it. */
function code0(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

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
    expect(code('components/studio/SceneContextMenu.tsx')).toContain('Add from library');
    // The third is the help card, and it renders below rather than being grepped.
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
  function surfaces(rel: string, out: string[] = []): string[] {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) surfaces(next, out);
      else if (entry.name.endsWith('.tsx')) out.push(next);
    }
    return out;
  }

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
