// @vitest-environment jsdom
//
// § B.14's other unwatchable turn: the plan's rotate handle, driven from the keyboard.
//
// **This file exists because of the lesson the last cycle cost.** `turnNudge` is gated
// as a function in `tests/refusal.test.ts`, and `tests/spin-selection.test.tsx` gates
// the context-menu path — and neither of those can see whether *this* caller passes the
// piece's pre-turn position, or calls it at all. The argument list between a component
// and a lib is where a feature goes missing, and last time three review lenses found
// one that seventy-five assertions on the builder could not.
//
// So this drives the handle the way someone with a keyboard drives it, and reads the
// sentence off the `announce` channel rather than reading the arguments.
//
// The pointer paths are deliberately NOT expected to say it: a slide you can watch
// happen under your hand is not a silent nudge. The refusal sentence is spoken here and
// only drawn in colour on the pointer path for exactly the same reason, and that
// precedent is `turnByKey`'s own docblock.

import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { ANNOUNCE_EVENT } from '@/lib/announce';
import type { ScenePart } from '@/lib/scene-spec';

// See tests/library-click-through.test.tsx for why these shims are needed.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }),
});
Element.prototype.scrollIntoView = function scrollIntoView() {};

vi.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'turn-nudge-room' }),
  usePathname: () => '/room/turn-nudge-room/plan',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

const DESK = 'desk-1';

// An arrow key turns by ONE SNAP STEP, not a quarter — `snapSteps('fine').rotate` is
// 15 degrees. The first version of this file assumed 90 and asserted a slide four
// times too big, which is the sort of number worth deriving rather than copying back
// out of a failure message.
const SPIN = Math.PI / 12;
const W = 1.4;
const D = 0.7;
/** The desk's half-extent along z once turned, worked out here from the rotated
 *  bounding box rather than taken from the app — an assertion that reuses the code it
 *  is measuring only checks that the code equals itself. */
const HALF_DEPTH = (W * Math.sin(SPIN) + D * Math.cos(SPIN)) / 2;
/** Flush against the north wall of a 4 m room at rot 0 (half-depth 0.35). */
const START_Z = -1.65;
/** How far the containment clamp must pull it back south, in metres. */
const SLIDE = Math.abs(-2 + HALF_DEPTH - START_Z);

/** 1400 x 700. Against the north wall of a 4 x 4 room it fits at rot 0 and cannot at a
 *  quarter turn, so the containment clamp has to slide it — which is the whole subject.
 *  `pos[1]` is 0 because a desk is floor-anchored. */
function desk(z: number): ScenePart {
  return {
    id: DESK, name: 'Desk', category: 'desk', shape: 'desk-standard', locked: false,
    dimMM: [1400, 700, 750], pos: [0, 0, z], rot: 0, wallMounted: false,
  } as ScenePart;
}

function setUp(parts: ScenePart[]) {
  cleanup();
  useScene.setState({
    parts,
    room: { ...useScene.getState().room, width: 4, depth: 4, height: 2.6, footprint: footprintForLayout('rect', 4, 4), layoutId: 'rect' },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, parentIds: {}, hidden: {}, selection: [DESK], selectedPartId: DESK, snapMode: 'fine' });
  useSettings.setState({ dimUnit: 'm' });
}

/** Everything spoken during this test, joined.
 *
 *  Read off the `announce` CHANNEL rather than out of a `role="status"` node, because
 *  `StudioAnnouncer` is mounted by the room LAYOUT and this test mounts the page —
 *  the first version asserted against the two status nodes the Inspector renders and
 *  got "On floorStanding on the floor", which is a different live region entirely.
 *  What is being gated here is that this caller SAYS the right sentence; that the
 *  announcer renders what it is handed is `StudioAnnouncer`'s own business. */
let spoken: string[] = [];
const listen = (e: Event) => spoken.push((e as CustomEvent<string>).detail);
function liveText(): string {
  return spoken.join(' ');
}

function turnHandle() {
  return screen.getByRole('button', { name: /^Turn Desk\./ });
}

beforeEach(() => {
  cleanup();
  spoken = [];
  window.addEventListener(ANNOUNCE_EVENT, listen);
});
afterEach(() => window.removeEventListener(ANNOUNCE_EVENT, listen));

describe('the plan rotate handle says when a turn had to slide the piece', () => {
  it('says it, and says how far', () => {
    setUp([desk(START_Z)]);
    render(<PlanPage />);
    fireEvent.keyDown(turnHandle(), { key: 'ArrowRight' });
    const said = liveText();
    // The angle it ACCEPTED, which is the sentence `turnByKey` already owned.
    expect(said).toContain(`Desk turned to ${Math.round((SPIN * 180) / Math.PI)} degrees.`);
    expect(said).toContain('to stay in the room');
    expect(said).toContain(`${SLIDE.toFixed(2)} m`);
  });

  it('speaks the unit the user set, not always metres', () => {
    // § B.12's rule, which landed one cycle ago: a sentence carrying a length reads in
    // the unit the user chose. Derived from the same slide, so this cannot pass by
    // agreeing with a hand-typed number that is itself wrong.
    setUp([desk(START_Z)]);
    useSettings.setState({ dimUnit: 'cm' });
    render(<PlanPage />);
    fireEvent.keyDown(turnHandle(), { key: 'ArrowRight' });
    expect(liveText()).toContain(`${(SLIDE * 100).toFixed(1)} cm`);
  });

  it('says nothing of the sort when the turn happened where it stood', () => {
    // Middle of the room: 1.4 m long turned any way is still clear of every wall.
    setUp([desk(0)]);
    render(<PlanPage />);
    fireEvent.keyDown(turnHandle(), { key: 'ArrowRight' });
    const said = liveText();
    expect(said).toContain('Desk turned to');
    expect(said).not.toContain('to stay in the room');
  });
});
