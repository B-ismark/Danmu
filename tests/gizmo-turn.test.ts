// The 3D ring writes a piece's QUATERNION, and three reads that back as an XYZ Euler
// whose `y` stays inside ±90°. Everything in `Draggable` reads `rotation.y`, so a piece
// turned past it was stored at its mirror: 150° read as 30°, and a piece facing the back
// wall that was merely pressed on the ring was stored facing the front. The plan, the
// collision test and the room report all used the stored number; the 3D view hid it
// only because the object kept x = z = 180° until it was next mounted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { yawOf } from '@/lib/geometry';
import { ringHeading } from '@/lib/drag-resolve';
import { turnBetween } from '@/lib/item-snap';
import { stripComments } from './helpers/source';

const Y = new Vector3(0, 1, 0);

/** What three-stdlib's ring does to the object in WORLD space — the only space the
 *  ring here uses, which the wiring test below holds — then what the
 *  `onObjectChange` in `Draggable` does after it. */
function ring(start: number, turn: number) {
  const o = new Object3D();
  o.rotation.y = start;
  const q0 = o.quaternion.clone();
  o.quaternion.copy(new Quaternion().setFromAxisAngle(Y, turn)).multiply(q0).normalize();
  const raw = o.rotation.y;
  const turned = o.quaternion.clone();
  o.rotation.set(0, ringHeading(o.quaternion, start), 0);
  return { raw, o, turned };
}

describe('a turn on the 3D ring', () => {
  it('is folded by three’s own Euler, which is the defect', () => {
    // Pinned so the reason for `yawOf` stays visible: if three ever stops folding,
    // this fails and the comment in `Draggable` can go.
    expect(ring(2.5, 0.1).raw).toBeCloseTo(Math.PI - 2.6, 9);
    expect(ring(Math.PI, 0).raw).toBeCloseTo(0, 9);
  });

  const starts = Array.from({ length: 25 }, (_, i) => -Math.PI + (i * 2 * Math.PI) / 24);
  const turns = [-2, -0.7, -0.1, 0, 0.1, 0.7, 2];
  it.each(starts.flatMap((s) => turns.map((t) => [s, t])))('from %f by %f reads the heading it shows', (start, turn) => {
    const { o, turned } = ring(start, turn);
    expect(turnBetween(o.rotation.y, start + turn)).toBeLessThan(1e-9);
    expect(o.rotation.x).toBe(0);
    expect(o.rotation.z).toBe(0);
    // The same orientation the ring left, not merely the same number.
    expect(o.quaternion.angleTo(turned)).toBeLessThan(1e-7);
  });

  it('stores EXACTLY the heading it began at when the press turned nothing', () => {
    // Read back off the quaternion, a third of these come out a few ULPs off and every
    // one past ±π comes out 2π off; downstream compares with `===`, so either is a turn.
    let off = 0;
    for (let i = 0; i < 2000; i++) {
      const start = -3 * Math.PI + (i * 6 * Math.PI) / 1999;
      if (yawOf(ring(start, 0).turned) !== start) off++;
      expect(ring(start, 0).o.rotation.y).toBe(start);
    }
    // The defect is real on this fixture, or the assertion above proves nothing.
    expect(off).toBeGreaterThan(1000);
  });

  it('keeps the winding the turn began in', () => {
    // The wheel and the twist wind past ±π; the ring must not unwind it.
    expect(ring(3.49, 0.2).o.rotation.y).toBeCloseTo(3.69, 9);
    expect(ring(-4.712, -0.3).o.rotation.y).toBeCloseTo(-5.012, 9);
    // A half turn lands half a turn from where it began, whichever way round.
    const half = ring(0.4, Math.PI).o.rotation.y;
    expect(turnBetween(half, 0.4 + Math.PI)).toBeLessThan(1e-9);
    expect(Math.abs(half - 0.4)).toBeLessThan(Math.PI + 1e-9);
  });
});

describe('yawOf', () => {
  it('reads a pure turn across the whole circle, in [−π, π]', () => {
    for (let a = -Math.PI + 1e-3; a <= Math.PI; a += 0.05) {
      expect(yawOf(new Quaternion().setFromAxisAngle(Y, a))).toBeCloseTo(a, 9);
    }
    expect(yawOf(new Quaternion().setFromAxisAngle(Y, Math.PI))).toBeCloseTo(Math.PI, 9);
    expect(yawOf(new Quaternion())).toBe(0);
    // Both ends: a turn to −π reads −π, which the docblock promises.
    expect(yawOf(new Quaternion().setFromAxisAngle(Y, -Math.PI))).toBeCloseTo(-Math.PI, 9);
  });

  it('is three’s own YXZ yaw, so a tilted orientation reads the same as three reads it', () => {
    // The ring only turns about the vertical, but the helper is the general answer and
    // is pinned as one, rather than as whatever a pure turn happens not to exercise.
    for (let i = 0; i < 40; i++) {
      const e = new Euler(Math.sin(i) * 0.6, -Math.PI + i * 0.157, Math.cos(i * 1.3) * 0.6, 'YXZ');
      const q = new Quaternion().setFromEuler(e);
      expect(yawOf(q)).toBeCloseTo(new Euler().setFromQuaternion(q, 'YXZ').y, 9);
    }
  });
});

describe('Draggable puts the group back to a pure turn on every ring change', () => {
  const src = stripComments(readFileSync(join(__dirname, '..', 'components/three/Draggable.tsx'), 'utf8'));
  const open = src.indexOf('<TransformControls');
  const close = src.indexOf('\n        />', open);
  const ringEl = src.slice(open, close);
  const handler = (() => {
    const at = ringEl.indexOf('onObjectChange={() => {');
    return at < 0 ? '' : ringEl.slice(at, ringEl.indexOf('}}', at));
  })();

  it('as a prop of the ring itself, which turns in world space', () => {
    expect(open).toBeGreaterThan(-1);
    expect(close - open).toBeGreaterThan(0);
    expect(close - open).toBeLessThan(6000);
    expect(src.indexOf('<TransformControls', open + 1)).toBe(-1);
    expect(handler).not.toBe('');
    // The `ring()` emulation above is three-stdlib's world-space branch; local space
    // snaps and multiplies differently, and the sweep could not see it.
    expect(ringEl).not.toMatch(/\bspace=/);
  });

  it('from the quaternion, in the winding the gesture began in', () => {
    expect(handler).toMatch(/ringHeading\(g\.quaternion, start\)/);
    expect(handler).toMatch(/const start = dragStartRot\.current;/);
  });

  it('held at the start once Escape has cancelled the turn', () => {
    expect(handler).toMatch(/cancelled\.current \? start : ringHeading/);
  });

  it('and set down without grid or magnet, as a turn in place', () => {
    expect(src).toMatch(/snapMode: stretch\.current \|\| gizmoActive\.current \? 'off' : snapMode,/);
  });
});
