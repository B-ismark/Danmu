// @vitest-environment jsdom
//
// `ColorPicker` keeps its own copy of the colour — HSV, so a hue survives at zero
// saturation, and the hex text being typed — and both must follow when the colour
// changes from outside it (an undo, another swatch, a different piece selected). That
// re-sync runs during render, against the hex last seen (it used to be an effect, which
// painted the old colour for a frame); this holds that it happens at all, which nothing
// did.
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ColorPicker } from '@/components/ui/ColorPicker';

afterEach(() => cleanup());

const noop = () => {};
const hex = () => (screen.getByLabelText('Hex color') as HTMLInputElement).value;
const hue = () => Number(screen.getByRole('slider', { name: 'Hue' }).getAttribute('aria-valuenow'));

describe('the picker follows a colour changed from outside', () => {
  it('re-syncs the hex text and the hue', () => {
    const { rerender } = render(<ColorPicker value="#ff0000" onChange={noop} />);
    expect(hex()).toBe('#FF0000');
    expect(hue()).toBe(0);

    rerender(<ColorPicker value="#00ff00" onChange={noop} />);
    expect(hex(), 'the hex field kept the old colour').toBe('#00FF00');
    expect(hue(), 'the hue slider kept the old colour').toBe(120);
  });
});
