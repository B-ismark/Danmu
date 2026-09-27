// @vitest-environment jsdom
// The info button that replaced the standing hint under the sun dial. It has to
// open under a finger, which is the one thing `Tooltip` deliberately cannot do
// (it latches closed on press), so the gesture sequences are the assertions.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { InfoTip } from '@/components/ui/Tooltip';

afterEach(cleanup);

const bubble = () => document.body.querySelector('[role="tooltip"]');

function mount() {
  const r = render(<InfoTip label="About sun direction">Point N at north.</InfoTip>);
  return r.getByRole('button', { name: 'About sun direction' });
}

describe('InfoTip', () => {
  it('a tap opens it and a second tap closes it', () => {
    const btn = mount();
    // What a touch screen dispatches: enter, focus, click, leave.
    fireEvent.pointerEnter(btn, { pointerType: 'touch' });
    fireEvent.focus(btn);
    fireEvent.click(btn);
    fireEvent.pointerLeave(btn, { pointerType: 'touch' });
    expect(bubble()?.textContent).toBe('Point N at north.');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-describedby')).toBe(bubble()?.id);

    fireEvent.click(btn);
    expect(bubble()).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on mouse hover and closes when the mouse leaves', () => {
    const btn = mount();
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' });
    expect(bubble()).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerLeave(btn, { pointerType: 'mouse' });
    expect(bubble()).toBeNull();
  });

  it('Escape and a press elsewhere both close a pinned bubble', () => {
    const btn = mount();
    fireEvent.click(btn);
    expect(bubble()).not.toBeNull();
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(bubble()).toBeNull();

    fireEvent.click(btn);
    expect(bubble()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(bubble()).toBeNull();
  });

  it('is real content, not decoration', () => {
    const btn = mount();
    fireEvent.click(btn);
    expect(bubble()?.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('the sun dial explains itself behind an info button', () => {
  const SRC = readFileSync('components/studio/NorthDial.tsx', 'utf8');
  it('is labelled Sun direction, with the explanation in an InfoTip', () => {
    expect(SRC).toMatch(/>Sun direction</);
    expect(SRC).not.toMatch(/>Facing</);
    expect(SRC).toMatch(/<InfoTip label="About sun direction">\{about\}<\/InfoTip>/);
  });
  it('has no standing hint under the dial', () => {
    // The section component, not `Dial` below it, whose own t-micro is the
    // bearing readout.
    const section = SRC.slice(SRC.indexOf('export function NorthDial'), SRC.indexOf('function Dial('));
    expect(section.length).toBeGreaterThan(200);
    expect(section).not.toMatch(/\{hint\}/);
    expect(section).not.toMatch(/className="t-micro"/);
  });
});
