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
import { stripComments } from './helpers/source';

const Y = new Vector3(0, 1, 0);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** What three-stdlib's ring does to the object in world space, then what the
 *  `onObjectChange` in `Draggable` does after it. */
function ring(start: number, turn: number) {
  const o = new Object3D();
  o.rotation.y = start;
  const q0 = o.quaternion.clone();
  o.quaternion.copy(new Quaternion().setFromAxisAngle(Y, turn)).multiply(q0).normalize();
  const raw = o.rotation.y;
  const turned = o.quaternion.clone();
  o.rotation.set(0, yawOf(o.quaternion), 0);
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
    expect(Math.abs(wrap(o.rotation.y - (start + turn)))).toBeLessThan(1e-9);
    expect(o.rotation.x).toBe(0);
    expect(o.rotation.z).toBe(0);
    // The same orientation the ring left, not merely the same number.
    expect(o.quaternion.angleTo(turned)).toBeLessThan(1e-7);
  });
});

describe('yawOf', () => {
  it('reads a pure turn across the whole circle, in (−π, π]', () => {
    for (let a = -Math.PI + 1e-3; a <= Math.PI; a += 0.05) {
      expect(yawOf(new Quaternion().setFromAxisAngle(Y, a))).toBeCloseTo(a, 9);
    }
    expect(yawOf(new Quaternion().setFromAxisAngle(Y, Math.PI))).toBeCloseTo(Math.PI, 9);
    expect(yawOf(new Quaternion())).toBe(0);
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
  it('in onObjectChange, from the quaternion', () => {
    const at = src.indexOf('onObjectChange={() => {');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, src.indexOf('}}', at))).toMatch(/\.rotation\.set\(0, yawOf\(g\.quaternion\), 0\)/);
    expect(src.indexOf('onObjectChange=')).toBeGreaterThan(src.indexOf('<TransformControls'));
  });
});
