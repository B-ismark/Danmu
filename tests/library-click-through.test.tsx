// @vitest-environment jsdom
//
// The half of `docs/visual-check.md`'s Library item that the copy tests could not
// reach: **pressing a signpost actually opens the panel.** `tests/studio-copy.test.tsx`
// settles that every signpost says the word; a signpost that reads correctly and leads
// nowhere is a different defect, and until now nothing in this repo mounted a trigger
// and its panel together.
//
// The subject is the **real 2D plan page**, not a harness. That distinction is the
// whole value of the file. A test that renders `<AddPiecesButton />` beside
// `{open && <CatalogPanel />}` re-implements the page's own gate, so a page that later
// forgot to render the panel would leave every assertion green — the second-source
// defect this repo keeps finding. `app/room/[roomId]/plan/page.tsx` owns that
// condition, so the page is what mounts.
//
// **Only the plan page.** `app/room/[roomId]/model/page.tsx` carries the same
// `{catalogOpen && <CatalogPanel …/>}` gate one line apart, and cannot be mounted here:
// it pulls `components/three/Room` and with it R3F, three, drei and postprocessing.
// So the 3D tab's copy of this gate stays a browser item, and this file must not be
// read as covering it.
//
// What it does NOT prove: no layout, no overflow, no z-order, no focus ring. The panel
// being in the document is not the panel being visible on a 1024px screen.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useStudio } from '@/lib/store';

const ROOT = join(__dirname, '..');

// The route is mocked rather than wrapped in a router: the page reads `roomId` to load
// a saved room, and which room it is is not what is under test.
vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('click-through-room'));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');
const { openSceneMenu } = await import('@/components/studio/SceneContextMenu');

beforeEach(() => {
  cleanup();
  // The flag is persisted, so a previous test's open panel would satisfy the next
  // test's assertion without anything being pressed.
  useStudio.setState({ catalogOpen: false });
});

/** The rail's trigger, found by the accessible name a user would look for rather than
 *  by a test id. `AddPiecesButton` labels itself "Add" with `title="Add a piece to the
 *  room"`; `CatalogToggle` on the canvas is the 3D tab's and is not on this page. */
function addButton(): HTMLElement {
  return screen.getByTitle('Add a piece to the room');
}

describe('the Library opens when a signpost is pressed', () => {
  it('is shut to begin with, or nothing below is a press', () => {
    render(<PlanPage />);
    // The panel's own heading. If this were present already, every assertion in this
    // file would pass against a panel nobody opened — the same shape as a test that
    // iterates over whatever it happens to find.
    expect(screen.queryByText('Library')).toBeNull();
    // And the trigger says what pressing it does, not what state it is in.
    expect(addButton().textContent).toContain('Add');
    expect(addButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on the rail button, and the panel that arrives is the Library', () => {
    render(<PlanPage />);
    fireEvent.click(addButton());
    // Two assertions, because the heading alone would pass on an empty panel: the
    // heading names it, and `LibraryPicker` inside it has actually rendered pieces.
    expect(screen.getByText('Library')).toBeTruthy();
    expect(screen.getAllByTitle(/drag into the room/).length).toBeGreaterThan(10);
    // The trigger tells assistive tech what it just did.
    expect(addButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('and the same button closes it, so the pair is one control', () => {
    render(<PlanPage />);
    fireEvent.click(addButton());
    expect(screen.getByText('Library')).toBeTruthy();
    fireEvent.click(addButton());
    expect(screen.queryByText('Library')).toBeNull();
  });

  it('closes on the panel’s own X, which names what it closes', () => {
    render(<PlanPage />);
    fireEvent.click(addButton());
    // "Close" alone tells a screen-reader user nothing about what is closing, which is
    // why the panel's own control is named for its subject.
    fireEvent.click(screen.getByRole('button', { name: 'Close the Library' }));
    expect(screen.queryByText('Library')).toBeNull();
  });

  it('opens from the context menu’s row, which is a second surface and a second signpost', () => {
    render(<PlanPage />);
    // `openSceneMenu` is the exported helper both canvases call — `PlanView` raises it
    // from its own right-click at `PlanView.tsx:1385`. Calling it directly rather than
    // synthesising a contextmenu event on an SVG keeps this test about the menu row and
    // the panel, not about hit-testing.
    // Wrapped in `act`: this is a window event rather than a React handler, so the
    // state update it causes is outside React's own dispatch and does not flush
    // before the assertion. Same trap as `.click()` versus `fireEvent`, one layer out —
    // and it fails identically to the menu row not existing.
    act(() => {
      openSceneMenu(40, 40, null);
    });
    const row = screen.getByText('Add from the Library…');
    fireEvent.click(row);
    expect(screen.getByText('Library')).toBeTruthy();
  });
});

describe('the third signpost is not a control, and that is worth writing down', () => {
  it('the sun note names the Library in prose with nothing to press', () => {
    // `docs/visual-check.md` says "press each of the three". Only two of the three are
    // pressable: `PartTree`'s sun note is a `<p>`, so the honest form of the item is two
    // presses and one read. Asserted rather than left as a comment, because the next
    // person to widen this file will otherwise go looking for a button that has never
    // existed.
    const src = readFileSync(join(ROOT, 'components/studio/PartTree.tsx'), 'utf8');
    const i = src.indexOf('from the Library');
    expect(i).toBeGreaterThan(-1);
    // The 400 characters around it hold the element that carries the sentence.
    const around = src.slice(Math.max(0, i - 400), i + 200);
    expect(around).toContain('<p');
    expect(around).not.toContain('<button');
    expect(around).not.toContain('onClick');
  });
});
