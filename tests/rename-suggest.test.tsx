// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditableText } from '@/components/ui/primitives';

afterEach(cleanup);

const MODELS = [
  { key: 'fridge', label: 'Fridge model' },
  { key: 'wardrobe', label: 'Wardrobe model', hint: 'not the size the camera measured' },
];

function setup() {
  const onCommit = vi.fn();
  const onPick = vi.fn();
  const suggest = vi.fn((draft: string) => (draft.toLowerCase().startsWith('fr') ? MODELS : []));
  render(<EditableText value="Bed" label="Piece name" onCommit={onCommit} suggest={suggest} onPick={onPick} />);
  fireEvent.click(screen.getByRole('button'));
  const input = screen.getByRole('textbox');
  return { input, onCommit, onPick };
}

describe('EditableText suggestions', () => {
  it('lists the models a typed name matches, and none for an unchanged one', () => {
    const { input } = setup();
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(input, { target: { value: 'Fri' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Fridge model', 'Wardrobe modelnot the size the camera measured']);
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('true');
  });

  it('a picked model is the answer: onPick, and the half-typed word is not committed over it', () => {
    const { input, onCommit, onPick } = setup();
    fireEvent.change(input, { target: { value: 'Fri' } });
    fireEvent.mouseDown(screen.getAllByRole('option')[0]);
    expect(onPick).toHaveBeenCalledWith('fridge');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('the arrows walk the list, Enter picks, and Enter on the typed text is a plain rename', () => {
    const a = setup();
    fireEvent.change(a.input, { target: { value: 'Fri' } });
    fireEvent.keyDown(a.input, { key: 'ArrowDown' });
    fireEvent.keyDown(a.input, { key: 'ArrowDown' });
    fireEvent.keyDown(a.input, { key: 'Enter' });
    expect(a.onPick).toHaveBeenCalledWith('wardrobe');
    cleanup();
    const b = setup();
    fireEvent.change(b.input, { target: { value: 'Fri' } });
    fireEvent.keyDown(b.input, { key: 'Enter' });
    expect(b.onCommit).toHaveBeenCalledWith('Fri');
    expect(b.onPick).not.toHaveBeenCalled();
  });
});

describe('EditableText suggestions keep the field', () => {
  it('does not swap the input out when the list appears, so focus stays mid-word', () => {
    const { input } = setup();
    input.focus();
    fireEvent.change(input, { target: { value: 'Fri' } });
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});
