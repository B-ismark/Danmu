// @vitest-environment jsdom
//
// The scan review's photo, mounted: what a keyboard reaches on it, and in what order.
//
// The layout of a tag is `tests/photo-tag.test.ts` and, in a real browser,
// `scripts/photo-tag-probe.mjs`. This file is for what neither of those can see: the
// order the controls come in, which is the order Tab visits them. The tags used to be
// rendered after every box, so that no box's press area lay over another piece's X —
// and that put every keep toggle first and every Remove after them, so a keyboard went
// through all the boxes and then back to the first piece to remove anything.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PhotoEditor, type PhotoEditorItem } from '@/components/studio/PhotoEditor';
import type { Detection } from '@/lib/detection';

afterEach(cleanup);

const piece = (index: number, label: string, box: Detection['box']): PhotoEditorItem => ({
  index,
  locked: index % 2 === 0,
  d: { label, conf: 0.9, box, category: 'chair', slot: 'n' },
});

const ITEMS = [
  piece(0, 'armchair', [0.1, 0.5, 0.2, 0.3]),
  piece(1, 'floor lamp', [0.5, 0.4, 0.1, 0.4]),
  piece(2, 'picture', [0.7, 0, 0.2, 0.2]),
];

function mount(mode: 'select' | 'add', onDelete: (i: number) => void = () => {}) {
  render(
    <PhotoEditor
      imageUrl="data:image/gif;base64,R0lGODlhAQABAAAAACw="
      items={ITEMS}
      mode={mode}
      onToggleLock={() => {}}
      onDelete={onDelete}
      onAddBox={() => {}}
    />,
  );
  return screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')!.split(',')[0]);
}

describe('the scan photo, by keyboard', () => {
  it("reaches one piece at a time: its keep toggle, then its Remove", () => {
    expect(mount('select')).toEqual([
      'armchair',
      'Remove armchair',
      'floor lamp',
      'Remove floor lamp',
      'picture',
      'Remove picture',
    ]);
  });

  it('keeps each Remove while a piece is being added by hand, and steps the boxes aside', () => {
    const onDelete = vi.fn();
    mount('add', onDelete);
    for (const b of screen.getAllByRole('button'))
      expect(b.hasAttribute('disabled'), b.getAttribute('aria-label')!).toBe(!b.getAttribute('aria-label')!.startsWith('Remove'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove floor lamp' }));
    expect(onDelete).toHaveBeenCalledWith(1);
    // The body of the tag lets a press through to start a box; the X takes its own.
    const x = screen.getByRole('button', { name: 'Remove floor lamp' });
    expect(x.parentElement!.style.pointerEvents).toBe('none');
    expect(x.style.pointerEvents).toBe('auto');
  });
});
