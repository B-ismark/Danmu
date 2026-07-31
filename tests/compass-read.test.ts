// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readCompass } from '@/lib/compass';

// The event plumbing, exercised for real. `tests/compass.test.ts` covers the
// arithmetic; this covers the two things that arithmetic cannot see and that a phone
// would have to be in hand to catch:
//
//   · alpha runs COUNTER-clockwise from north, so a heading is `360 - alpha`. Get
//     this backwards and the room is mirrored — invisible at 0° and 180°.
//   · a `deviceorientation` event without `absolute` is not a compass, and must be
//     refused rather than believed.
//
// jsdom has no DeviceOrientationEvent, so one is stood up here. That is also what
// makes the test honest about the branch it is on: no `requestPermission` on the
// constructor means the non-iOS path, which is the one with the alpha conversion in
// it.

/** A short window — nothing here waits on a sensor. */
const WINDOW = 40;

class FakeOrientationEvent extends Event {
  alpha: number | null = null;
  beta: number | null = null;
  gamma: number | null = null;
  absolute = false;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

function fire(type: string, props: Partial<FakeOrientationEvent>) {
  const e = new FakeOrientationEvent(type);
  Object.assign(e, props);
  window.dispatchEvent(e);
}

beforeEach(() => {
  (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = FakeOrientationEvent;
});

afterEach(() => {
  delete (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
});

describe('readCompass', () => {
  it('turns counter-clockwise alpha into a clockwise bearing', async () => {
    const p = readCompass(WINDOW);
    // alpha 90 in the earth frame means the device's top points 90° COUNTER-clockwise
    // from north, i.e. west, i.e. a bearing of 270.
    for (const alpha of [90, 90, 90]) fire('deviceorientationabsolute', { alpha, absolute: true });
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bearingDeg).toBe(270);
      expect(r.samples).toBe(3);
      expect(r.spreadDeg).toBe(0);
    }
  });

  it('prefers iOS’s own true-north heading, which needs no conversion', async () => {
    const p = readCompass(WINDOW);
    // A heading of 215 IS the bearing. If this came back 145 (= 360 - 215), the iOS
    // branch would be running the alpha conversion over a value already converted.
    for (let i = 0; i < 3; i++) {
      fire('deviceorientation', { webkitCompassHeading: 215, webkitCompassAccuracy: 10, alpha: 12 });
    }
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bearingDeg).toBe(215);
      expect(r.accuracyDeg).toBe(10);
    }
  });

  it('refuses a relative reading rather than pointing the room at nothing', async () => {
    const p = readCompass(WINDOW);
    // Orientation without a compass reference: `absolute` false and no iOS heading.
    for (let i = 0; i < 3; i++) fire('deviceorientation', { alpha: 42, beta: 1, gamma: 2 });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe('relative');
  });

  it('reports no sensor when nothing arrives, and not merely no direction', async () => {
    const r = await readCompass(WINDOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe('unsupported');
  });

  it('reports no sensor when events arrive with every angle null', async () => {
    // A desktop with no hardware can still fire the event with nothing in it. Telling
    // that user their machine "reports tilt but not direction" is wrong twice.
    const p = readCompass(WINDOW);
    for (let i = 0; i < 3; i++) fire('deviceorientation', { alpha: null, beta: null, gamma: null });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe('unsupported');
  });

  it('listens to both event types, so an advertised-but-silent one costs nothing', async () => {
    // The browser exposes `ondeviceorientationabsolute` yet only ever fires the plain
    // event with `absolute: true`. Selecting one type up front lost this device.
    const p = readCompass(WINDOW);
    for (let i = 0; i < 3; i++) fire('deviceorientation', { alpha: 0, absolute: true });
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bearingDeg).toBe(0);
  });

  it('rejects a needle that never settled', async () => {
    const p = readCompass(WINDOW);
    for (const alpha of [0, 90, 180, 270]) fire('deviceorientationabsolute', { alpha, absolute: true });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe('unstable');
  });

  it('averages a jittering needle instead of taking the last sample', async () => {
    const p = readCompass(WINDOW);
    // Straddling north: a mean that went through south would come back near 180.
    for (const alpha of [2, 358, 4, 356]) fire('deviceorientationabsolute', { alpha, absolute: true });
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bearingDeg).toBe(0);
  });

  it('stops listening once it has answered', async () => {
    const p = readCompass(WINDOW);
    for (let i = 0; i < 3; i++) fire('deviceorientationabsolute', { alpha: 90, absolute: true });
    const first = await p;
    // A late event must not be able to change a settled answer.
    fire('deviceorientationabsolute', { alpha: 180, absolute: true });
    expect(first.ok && first.bearingDeg).toBe(270);
  });
});
