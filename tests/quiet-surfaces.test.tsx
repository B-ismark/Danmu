// @vitest-environment jsdom
//
// Two surfaces asked to say less. The scan's waiting card shows its picture and its
// Stop button and nothing else — its title stays as the dialog's NAME, for screen
// readers, but is not drawn — and it never adds a "still working" line later. And
// "Change the model" opens on an empty search, so someone can start typing the piece
// they want rather than first deleting the one they have.

import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, act } from '@testing-library/react';
import { vi } from 'vitest';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { stripComments } from './helpers/source';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the scan waiting card', () => {
  it('keeps its title as the dialog name only, and never adds a slow line', () => {
    vi.useFakeTimers();
    const { getByRole, container } = render(
      <LoadingOverlay title="Finding your furniture" onCancel={() => {}} cancelLabel="Stop and add by hand" />,
    );
    expect(getByRole('dialog', { name: 'Finding your furniture' })).toBeTruthy();
    expect(container.ownerDocument.getElementById('loading-overlay-title')!.className).toMatch(/\bsr-only\b/);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(container.ownerDocument.body.textContent).not.toMatch(/still working/i);
  });
});

describe('Change the model', () => {
  it('opens the Library search empty', () => {
    const src = stripComments(readFileSync(join(__dirname, '../components/studio/RegenerateModal.tsx'), 'utf8'));
    expect(src).toMatch(/<LibraryPicker\b/);
    expect(src).not.toMatch(/initialQuery/);
  });
});
