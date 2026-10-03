// @vitest-environment jsdom
//
// The photo route's steps. The New room page only ever shows the first, so the
// states behind you are pinned here: what a screen reader hears for each step, and
// which one is current.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FLOW_STEPS, FlowStepper } from '@/components/ui/FlowStepper';

afterEach(cleanup);

describe('FlowStepper', () => {
  it('marks the steps behind as done, the one you are on as current, and the rest as ahead', () => {
    render(<FlowStepper current="Furniture" />);
    const list = screen.getByRole('list', { name: 'Steps to your room' });
    // The rules between steps are decoration: four steps, not seven items.
    const steps = [...list.querySelectorAll('li:not([aria-hidden])')];
    // The dot is aria-hidden; what is read is the label and the "(done)".
    const heard = (s: Element) => [...s.children].filter((c) => !c.matches('[aria-hidden]')).map((c) => c.textContent).join('');
    expect(steps.map(heard)).toEqual(['Shape (done)', 'Photos (done)', 'Furniture', 'Room']);
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'done', 'on', 'next']);
    expect(steps.map((s) => s.getAttribute('aria-current'))).toEqual([null, null, 'step', null]);
  });

  it('first step: nothing done, and the number in its dot', () => {
    render(<FlowStepper current="Shape" />);
    expect(screen.queryByText(/\(done\)/)).toBeNull();
    expect(document.querySelector('[aria-current="step"] .flow-stepper__dot')?.textContent).toBe('1');
    expect(document.querySelectorAll('.flow-stepper__rule')).toHaveLength(FLOW_STEPS.length - 1);
  });
});
