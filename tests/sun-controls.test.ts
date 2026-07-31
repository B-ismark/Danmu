// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SunControls } from '@/components/studio/SunControls';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';

// Does the panel actually render? Every other test here is over pure `lib/` logic,
// and pure logic cannot catch a panel that throws on mount — a missing icon name, a
// hook order, a `path.alt[…]` indexed off the end at a latitude where the sun never
// rises.
//
// A real client render rather than `renderToStaticMarkup`, and the reason is worth
// keeping: zustand hands React `getInitialState` as its SERVER snapshot, so anything
// rendered on the server shows the store's defaults no matter what a test has set.
// The first version of this file passed store state in and asserted against markup
// that could not contain it.
//
// Effects run, which is fine and deliberate: the only effect here is the unmount
// guard. Neither device sensor is touched without a press, and permission prompts
// belong to a real phone rather than to this file.

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

/** Render (or re-render) the panel and hand back its HTML. */
function render(): string {
  act(() => {
    root.render(createElement(SunControls));
  });
  return container.innerHTML;
}

/** A store change made while the panel is mounted. Inside `act`, because a zustand
 *  set is a render trigger like any other and React says so on stderr otherwise. */
function change(mutate: () => void): void {
  act(mutate);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useStudio.setState({ sunMinutes: 15 * 60, sunDayOfYear: 80, sunLive: false });
  useScene.getState().setSite({ lat: 51.5, lon: -0.1, bearingDeg: 0 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the sun panel renders', () => {
  it('draws the reading line, the day graph and the month row', () => {
    const html = render();
    expect(html).toContain('15:00');
    expect(html).toContain('<svg');
    expect(html).toContain('type="range"');
    expect(html).toContain('Time of day');
    expect(html).toContain('aria-label="Jan"');
    expect(html).toContain('aria-label="Dec"');
    // London on 21 March, mid-afternoon: up, and to the west of south.
    expect(html).toContain('up, in the south-west');
  });

  it('offers the three device controls, and says what the compass gesture is', () => {
    const html = render();
    expect(html).toContain('Now');
    expect(html).toContain('Use my location');
    expect(html).toContain('Compass');
    // The gesture has to be legible BEFORE anything is pressed, or the reading gets
    // taken while the phone is pointing at the ceiling.
    expect(html).toContain('top edge');
  });

  it('shows the Now chip pinned or not, in its label rather than only its colour', () => {
    expect(render()).toContain('Show the sun as it is right now');
    change(() => useStudio.setState({ sunLive: true }));
    expect(render()).toContain('Following your device clock');
  });

  it('reads the bearing out as what it is — the way the plan’s top edge faces', () => {
    useScene.getState().setSite({ lat: 51.5, lon: -0.1, bearingDeg: 215 });
    expect(render()).toContain('The top of the plan faces 215 degrees, south-west');
  });

  it('survives the polar cases, where there is no sunrise to draw', () => {
    // Svalbard at midwinter: the sun never comes up, so there are no horizon
    // crossings, no daylight fill, and the preset row has to say so rather than
    // offer a "Sunrise" chip that means nothing.
    useScene.getState().setSite({ lat: 78, lon: 15, bearingDeg: 0 });
    useStudio.setState({ sunDayOfYear: 1, sunMinutes: 12 * 60 });
    const dark = render();
    expect(dark).toContain('never rises');
    expect(dark).not.toContain('>Sunrise<');

    // …and midsummer, where it never goes down.
    change(() => useStudio.setState({ sunDayOfYear: 172 }));
    expect(render()).toContain('never sets');
  });

  it('renders with no site at all — the default is on screen, not hidden', () => {
    useScene.setState((s) => ({ room: { ...s.room, site: undefined } }));
    const html = render();
    // DEFAULT_SITE's latitude, in an editable field rather than a blank.
    expect(html).toContain('Latitude');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Latitude"]')?.value).toBe('40');
  });

  it('steps the coordinate fields at the resolution the device writes them', () => {
    render();
    // 0.1°, matching lib/geolocate's coarsening. A 0.5 step here made the browser's
    // own Up/Down snap to a different lattice than the field's chevrons.
    for (const label of ['Latitude', 'Longitude']) {
      const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      expect(input?.getAttribute('step')).toBe('0.1');
    }
  });
});
