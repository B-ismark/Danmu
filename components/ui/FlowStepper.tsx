// Where you are in making a room from photos: Shape, Photos, Furniture, Room.
//
// Shown only on the photo route. The footprint page's other way on goes straight
// to the studio, so a four-step tracker there would promise a sequence that most
// people who pick a shape never walk — the reason the old "02 / 04" counter went.
//
// The steps behind you are marked done, not linked. Going back a step on this
// route is not a page you return to: the shape page MAKES a room, so a link to it
// from the photos would start a second one. Back in the bar is the way back.

import { Fragment } from 'react';
import { Icon } from './Icon';

export const FLOW_STEPS = ['Shape', 'Photos', 'Furniture', 'Room'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export function FlowStepper({ current }: { current: FlowStep }) {
  const at = FLOW_STEPS.indexOf(current);
  return (
    <ol className="flow-stepper" aria-label="Steps to your room">
      {FLOW_STEPS.map((label, i) => {
        const state = i < at ? 'done' : i === at ? 'on' : 'next';
        return (
          <Fragment key={label}>
            {i > 0 && <li className="flow-stepper__rule" aria-hidden="true" />}
            <li className="flow-stepper__step" data-state={state} aria-current={state === 'on' ? 'step' : undefined}>
              <span className="flow-stepper__dot" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span className="flow-stepper__label">{label}</span>
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
