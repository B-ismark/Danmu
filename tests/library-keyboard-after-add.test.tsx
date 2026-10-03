// @vitest-environment jsdom
//
// "When I try to delete a dragged-in model by hitting Backspace or Delete it doesn't
// work, it only does a weird highlighting of the row in the library panel."
//
// The cause: a press on a Library row focuses the row (a drag starts with that same
// press), and the studio's Delete/Backspace is armed only while the ROOM has focus
// (`studioSurfaceFocused`, WCAG 2.1.4 — single keys must not fire from inside a
// control). So the dropped piece was selected, focus sat on the row, the key did
// nothing to the piece, and the keypress lit the row's focus ring instead.
//
// The fix hands focus to the room when a piece arrives by pointer — a drop either tab
// took, or a click — and leaves it where it is for a keyboard user who added one with
// Enter, who is working down the list.
//
// Mounted as the real studio layout around the real 2D plan page, for the reason
// `library-click-through.test.tsx` gives: the layout owns the focusable room and the
// keyboard handler, the page owns the panel, and a harness would re-implement exactly
// the wiring under test. Only the shared 3D canvas host is stubbed, because it pulls
// R3F; the 3D page cannot mount here for the same reason, so its half — the same
// `LibraryBody`, given `ghostDrag` — is held by source below and by the browser walk.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { STUDIO_SURFACE_ID } from '@/components/studio/KeyboardShortcuts';
import { LibraryPicker } from '@/components/studio/LibraryPicker';
import { dropCarry } from '@/lib/drop-carry';

const ROOT = join(__dirname, '..');

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('keyboard-after-add-room'));
vi.mock('@/components/three/RoomHost', () => ({ RoomHostProvider: () => null, RoomSlot: () => null, useRoomHost: () => null }));

const { default: PlanPageAlone } = await import('@/app/room/[roomId]/plan/page');
const { default: StudioLayout } = await import('@/app/room/[roomId]/layout');
function PlanPage() {
  return (
    <StudioLayout>
      <PlanPageAlone />
    </StudioLayout>
  );
}

beforeEach(() => {
  cleanup();
  useStudio.setState({ catalogOpen: true, selection: [], selectedPartId: null });
});

function stoolRow(): HTMLElement {
  const row = screen.getAllByRole('button').find((b) => b.classList.contains('pick-row') && b.textContent?.trim() === 'Stool');
  expect(row).toBeTruthy();
  return row!;
}

const surface = () => document.getElementById(STUDIO_SURFACE_ID);
const pressDelete = (key: 'Delete' | 'Backspace') => fireEvent.keyDown(document.activeElement ?? document.body, { key });

describe('after a piece arrives from the Library, Delete deletes it', () => {
  it('has a room to give focus to, or nothing below is a test', () => {
    render(<PlanPage />);
    expect(surface()).toBeTruthy();
  });

  it('a CLICK-add hands focus to the room, and Delete then removes the new piece', () => {
    render(<PlanPage />);
    const row = stoolRow();
    row.focus();
    const before = useScene.getState().parts.length;
    // `detail: 1` is what a mouse click carries; the keyboard's is 0.
    fireEvent.click(row, { detail: 1 });
    const added = useStudio.getState().selectedPartId;
    expect(useScene.getState().parts).toHaveLength(before + 1);
    expect(added).toMatch(/^chair-|^stool-|^table-|^ottoman-/);
    expect(document.activeElement).toBe(surface());
    pressDelete('Delete');
    expect(useScene.getState().parts.find((p) => p.id === added)).toBeUndefined();
    expect(useScene.getState().parts).toHaveLength(before);
  });

  it('Backspace does the same', () => {
    render(<PlanPage />);
    fireEvent.click(stoolRow(), { detail: 1 });
    const added = useStudio.getState().selectedPartId;
    pressDelete('Backspace');
    expect(useScene.getState().parts.find((p) => p.id === added)).toBeUndefined();
  });

  it('a row activated from the KEYBOARD keeps focus in the list', () => {
    render(<PlanPage />);
    const row = stoolRow();
    row.focus();
    fireEvent.click(row, { detail: 0 });
    expect(useStudio.getState().selectedPartId).not.toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('a DROP hands focus to the room; a drag nothing took leaves it alone', () => {
    render(<PlanPage />);
    const row = stoolRow();
    row.focus();
    fireEvent.dragEnd(row, { dataTransfer: { dropEffect: 'none' } });
    expect(document.activeElement).toBe(row);
    fireEvent.dragEnd(row, { dataTransfer: { dropEffect: 'copy' } });
    expect(document.activeElement).toBe(surface());
  });

  it('Backspace in the Library search still edits the search, and deletes nothing', () => {
    render(<PlanPage />);
    fireEvent.click(stoolRow(), { detail: 1 });
    const added = useStudio.getState().selectedPartId;
    const search = screen.getByRole('textbox', { name: 'Search the Library' });
    search.focus();
    pressDelete('Backspace');
    expect(useScene.getState().parts.find((p) => p.id === added)).toBeTruthy();
  });
});

describe('the row\'s drag picture', () => {
  function dragStart(ghostedDrag: boolean) {
    const setDragImage = vi.fn();
    render(<LibraryPicker onPick={() => {}} draggable ghostedDrag={ghostedDrag} />);
    fireEvent.dragStart(stoolRow(), { dataTransfer: { setData: () => {}, setDragImage, effectAllowed: 'all' } });
    dropCarry.end();
    return setDragImage;
  }

  it('is blanked where the room draws a ghost, so no name follows the cursor', () => {
    const set = dragStart(true);
    expect(set).toHaveBeenCalledTimes(1);
    const [img] = set.mock.calls[0];
    expect(img).toBeInstanceOf(HTMLImageElement);
    expect((img as HTMLImageElement).width).toBe(1);
  });

  it('is the row\'s own where nothing draws one (the 2D plan)', () => {
    cleanup();
    expect(dragStart(false)).not.toHaveBeenCalled();
  });

  it('is asked for by the 3D page and not by the plan', () => {
    const model = readFileSync(join(ROOT, 'app/room/[roomId]/model/page.tsx'), 'utf8');
    const plan = readFileSync(join(ROOT, 'app/room/[roomId]/plan/page.tsx'), 'utf8');
    expect(model).toMatch(/<CatalogPanel[^>]*\bghostDrag\b/);
    expect(plan).toMatch(/<CatalogPanel[^>]*\bcanDrag\b/);
    expect(plan).not.toMatch(/ghostDrag/);
  });
});
