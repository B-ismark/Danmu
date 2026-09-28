// @vitest-environment jsdom
//
// A Select with nothing chosen yet: the ideas gallery's "Keep a piece where it is…",
// whose every choice DOES something (it keeps that piece). It used to show its first
// option when its value was not one of them, so the prompt read "Sofa" as if the
// sofa were already kept, and a closed trigger stepped by arrow or letter chose for
// the person. With nothing chosen, both open the list instead, on the match.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Select } from '@/components/ui/Select';

afterEach(cleanup);

const OPTIONS = [
  { value: 'arm', label: 'Armchair' },
  { value: 'lamp', label: 'Lamp' },
  { value: 'sofa', label: 'Sofa' },
];

function mount(value: string) {
  const onChange = vi.fn();
  render(<Select options={OPTIONS} value={value} onChange={onChange} placeholder="Keep a piece…" ariaLabel="Keep a piece" />);
  return { onChange, trigger: screen.getByRole('combobox', { name: 'Keep a piece' }) };
}

const activeLabel = (trigger: HTMLElement) =>
  document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')?.textContent;

describe('a Select with nothing chosen', () => {
  it('shows its placeholder, not its first option', () => {
    const { trigger } = mount('');
    expect(trigger.textContent).toContain('Keep a piece…');
    expect(trigger.textContent).not.toContain('Armchair');
  });

  it('an arrow opens the list rather than choosing', () => {
    const { trigger, onChange } = mount('');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('a letter opens the list on its match rather than choosing it', () => {
    const { trigger, onChange } = mount('');
    fireEvent.keyDown(trigger, { key: 's' });
    expect(onChange).not.toHaveBeenCalled();
    expect(activeLabel(trigger)).toBe('Sofa');
  });

  it('a letter matching the FIRST option finds it before a later one', () => {
    // Two that start with S, the first one first: the search starts before the
    // first option, where a chosen value would have it start after itself.
    const onChange = vi.fn();
    render(
      <Select
        options={[{ value: 'sofa', label: 'Sofa' }, { value: 'stool', label: 'Stool' }]}
        value=""
        onChange={onChange}
        ariaLabel="Keep"
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Keep' });
    fireEvent.keyDown(trigger, { key: 's' });
    expect(activeLabel(trigger)).toBe('Sofa');
  });

  it('with a value chosen, an arrow still steps it, as a closed select does', () => {
    const { trigger, onChange } = mount('arm');
    expect(trigger.textContent).toContain('Armchair');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('lamp');
  });
});
