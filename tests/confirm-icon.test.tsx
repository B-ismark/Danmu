// @vitest-environment jsdom
//
// The confirm button's glyph. A danger confirm wore the bin whatever it confirmed,
// so "Start over" — which puts the room back rather than throwing anything away —
// read as a delete. A request can name its own glyph now; the bin stays the default.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { ConfirmHost, useConfirm, type ConfirmRequest } from '@/components/ui/Confirm';

afterEach(cleanup);

function Ask({ req }: { req: ConfirmRequest }) {
  const confirm = useConfirm();
  useEffect(() => {
    void confirm(req);
  }, [confirm, req]);
  return null;
}

/** The classes of the glyph inside the dialog's confirm button. */
async function glyph(req: ConfirmRequest) {
  await act(async () => {
    render(
      <>
        <ConfirmHost />
        <Ask req={req} />
      </>,
    );
  });
  const button = screen.getByRole('button', { name: req.confirmLabel ?? 'Confirm' });
  return button.querySelector('svg')?.getAttribute('class') ?? '';
}

describe('the confirm button glyph', () => {
  it('is the one a request names', async () => {
    const cls = await glyph({ title: 'Start over?', confirmLabel: 'Start over', danger: true, icon: 'rotate-ccw' });
    expect(cls).toContain('rotate-ccw');
    expect(cls).not.toContain('trash');
  });

  it('is still the bin for a danger confirm that names none', async () => {
    expect(await glyph({ title: 'Delete?', confirmLabel: 'Delete', danger: true })).toContain('trash');
  });
});
