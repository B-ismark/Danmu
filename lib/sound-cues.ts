// Which sound a change to the room deserves — decided in one place.
//
// The studio's sounds used to be called from the gesture that caused them, which
// covered exactly the gestures someone remembered: a piece dragged in 3D knocked
// on the floor, the same piece moved by an arrow key, a Suggest, the plan, a
// context-menu turn or an undo said nothing. A change reaches the room four or
// five ways and the sound should not depend on which, so this listens to the
// STATE instead — the same shape of fix as `drag-resolve.ts` being one resolve for
// both tabs. A new way to delete a piece gets its sound for free.
//
// Pure: it takes the before and after of the few things it listens to and returns
// at most ONE cue. One, because a single action routinely changes several things
// at once — adding a piece also selects it, a theme recolours every wall and moves
// the clock — and three sounds for one press is a clatter. `PRIORITY` decides
// which one speaks. Those changes arrive as separate store writes, so the caller
// (`SoundCues`) collects a whole action's writes and asks once; asked per write,
// this played "place" and then "select" for one Add.
//
// Three things are deliberately silent:
//   · **Opening a room.** Every part "arrives" when a room loads; that is not
//     twenty pieces being placed. Nothing sounds unless the same room was on
//     screen before and after.
//   · **An undo's contents.** An undo restores everything at once; it gets its own
//     sound from the button or key that asked for it, and the diff it causes is
//     ignored (`restoring`).
//   · **A drag's own writes.** A drag is heard as its pick-up, its glide and its
//     set-down, which the gesture owns (`Draggable`, `PlanView`, `SunArc`). What a
//     drag writes along the way — every frame's position, the commit at the end —
//     would otherwise be heard a second time as a nudge.

import { formatClock, isDaytime, sunAt } from './lighting-moods';
import type { SoundName, SoundOptions } from './sound';

type Vec3 = readonly [number, number, number];

/** The slice of the stores a cue can depend on. Structural, so tests can build
 *  one without zustand. */
export type CueWorld = {
  /** The room on screen (`useScene.hydratedRoomId`); null while one is loading. */
  room: string | null;
  parts: ReadonlyArray<{
    id: string;
    dimMM: Vec3;
    color?: string;
    finish?: string;
    decor?: unknown;
    groupId?: string;
  }>;
  wallColors: Readonly<Record<number, string>>;
  /** The outline, by reference: a new array is a room that changed shape. */
  footprint: unknown;
  roomSize: { width: number; depth: number; height: number };
  bearingDeg: number | undefined;
  positions: Readonly<Record<string, Vec3>>;
  rotations: Readonly<Record<string, number>>;
  dims: Readonly<Record<string, Vec3>>;
  lighting: string;
  hour: number;
  selectedPartId: string | null;
  hidden: Readonly<Record<string, boolean>>;
  pinned: Readonly<Record<string, boolean>>;
  dragging: string | null;
  /** An undo or redo is being applied. */
  restoring: boolean;
};

export type Cue = { name: SoundName; opts?: SoundOptions };

/** Most important first. When one change is several things, the earliest speaks. */
export const PRIORITY: readonly SoundName[] = [
  'place',
  'remove',
  'chime',
  'shuffle',
  'brush',
  'cloud',
  'dawn',
  'dusk',
  'snap',
  'stretch',
  'turn',
  'tick',
  'nudge',
  'toggle',
  'select',
];

/** The detent a turn clicks on: every 15°, the same step rotate-snap uses. */
const TURN_DETENT = Math.PI / 12;
/** And a resize: every 50 mm of the piece's longest side. */
const SIZE_DETENT_MM = 50;
/** A clock change this big is a jump to somewhere (a named time, a theme), not a
 *  scrub through the hours in between. */
const JUMP_H = 1.5;

/** Size, 0–1, for a piece: its longest side against a 2.5 m sofa. */
export const sizeOf = (dim: Vec3 | undefined) => (dim ? Math.min(1, Math.max(...dim) / 2500) : 0.4);

/** The signed shortest way round the clock from `a` to `b`, in hours. */
export function hourDelta(a: number, b: number): number {
  let d = (((b - a) % 24) + 24) % 24;
  if (d > 12) d -= 24;
  return d;
}

const differs = (a: unknown, b: unknown) => a !== b && JSON.stringify(a) !== JSON.stringify(b);

/** The clock's own cue, from any source — the arc, the track, a stop, a key. */
function clockCue(prev: CueWorld, next: CueWorld): Cue | null {
  if (next.lighting !== 'daylight') return null;
  const dh = hourDelta(prev.hour, next.hour);
  if (Math.abs(dh) < 1e-9) return null;
  if (Math.abs(dh) >= JUMP_H && next.dragging === null) return { name: 'chime' };
  const wasDay = isDaytime(prev.hour);
  const isDay = isDaytime(next.hour);
  if (!wasDay && isDay) return { name: 'dawn' };
  if (wasDay && !isDay) return { name: 'dusk' };
  // One detent per whole hour passed, brighter the higher the sun.
  if (formatClock(prev.hour).slice(0, 2) !== formatClock(next.hour).slice(0, 2)) {
    return { name: 'tick', opts: { brightness: isDay ? sunAt(next.hour).elevationDeg / 60 : 0 } };
  }
  return null;
}

export function cueFor(prev: CueWorld, next: CueWorld, opts: { afterDrag?: boolean } = {}): Cue | null {
  if (next.room === null || prev.room !== next.room) return null;
  if (next.restoring || prev.restoring) return null;

  const found: Cue[] = [];
  const dragging = next.dragging;
  // Positions and commits a drag writes are the drag's to sound, not ours.
  const quietMoves = dragging !== null || prev.dragging !== null || !!opts.afterDrag;

  // ── Pieces arriving and leaving ──
  const before = new Map(prev.parts.map((p) => [p.id, p]));
  const after = new Map(next.parts.map((p) => [p.id, p]));
  const added = next.parts.filter((p) => !before.has(p.id));
  const removed = prev.parts.filter((p) => !after.has(p.id));
  if (added.length > 0) found.push({ name: 'place', opts: { size: sizeOf(added[0].dimMM) } });
  if (removed.length > 0) found.push({ name: 'remove' });

  // ── A piece restyled ──
  let restyled = 0;
  for (const p of next.parts) {
    const q = before.get(p.id);
    if (!q) continue;
    if (q.color !== p.color || q.finish !== p.finish) restyled++;
    else if (differs(q.decor, p.decor)) found.push({ name: 'place', opts: { size: 0.05 } });
    if (q.groupId !== p.groupId) found.push({ name: 'snap' });
  }
  // A theme recolours everything at once; that is a re-arrangement of the look,
  // and it gets the one "brush" rather than a swish per piece.
  if (restyled > 0 || differs(prev.wallColors, next.wallColors)) found.push({ name: 'brush' });

  // ── The light ──
  // A lighting switch made BY a gesture — grabbing the sun in an overcast room
  // brings the daylight back — is that gesture's, and it already made its pick.
  if (prev.lighting !== next.lighting) {
    if (next.dragging === null) found.push({ name: next.lighting === 'overcast' ? 'cloud' : 'chime' });
  }
  else {
    const c = clockCue(prev, next);
    if (c) found.push(c);
  }
  if (prev.bearingDeg !== next.bearingDeg) found.push({ name: 'turn' });

  // ── Pieces moved, turned, resized, outside a drag ──
  if (!quietMoves) {
    const moved = next.parts.filter((p) => {
      const a = prev.positions[p.id];
      const b = next.positions[p.id];
      return before.has(p.id) && a !== b && differs(a, b);
    });
    if (moved.length > 2) found.push({ name: 'shuffle' });
    else if (moved.length > 0) found.push({ name: 'nudge', opts: { size: sizeOf(moved[0].dimMM) } });
  }
  for (const p of next.parts) {
    if (!before.has(p.id)) continue;
    const a = prev.rotations[p.id];
    const b = next.rotations[p.id];
    if (a === b) continue;
    // Mid-drag (a twist in the plan), one click per detent crossed, like a
    // ratchet; outside one, every turn is one click.
    if (dragging !== null) {
      if (Math.round((a ?? 0) / TURN_DETENT) !== Math.round((b ?? 0) / TURN_DETENT)) found.push({ name: 'turn' });
    } else if (!quietMoves) found.push({ name: 'turn' });
    break;
  }
  for (const p of next.parts) {
    if (!before.has(p.id)) continue;
    const a = prev.dims[p.id];
    const b = next.dims[p.id];
    if (a === b || !differs(a, b)) continue;
    const la = Math.max(...(a ?? p.dimMM));
    const lb = Math.max(...(b ?? p.dimMM));
    const grew = lb >= la;
    if (dragging !== null) {
      if (Math.round(la / SIZE_DETENT_MM) !== Math.round(lb / SIZE_DETENT_MM)) {
        found.push({ name: 'stretch', opts: { brightness: grew ? 1 : 0 } });
      }
    } else if (!quietMoves) found.push({ name: 'stretch', opts: { brightness: grew ? 1 : 0 } });
    break;
  }

  // ── The room itself resized from its fields (a dragged wall glides instead) ──
  if (!quietMoves && (prev.footprint !== next.footprint || differs(prev.roomSize, next.roomSize))) {
    const area = (r: CueWorld['roomSize']) => r.width * r.depth;
    found.push({ name: 'stretch', opts: { brightness: area(next.roomSize) >= area(prev.roomSize) ? 1 : 0 } });
  }

  // ── Small state ──
  for (const [map, key] of [
    ['hidden', 'hidden'],
    ['pinned', 'pinned'],
  ] as const) {
    const a = prev[map];
    const b = next[map];
    if (a === b) continue;
    const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const id of ids) {
      if (!!a[id] !== !!b[id]) {
        // Hiding is "off"; pinning is "on".
        const on = key === 'pinned' ? !!b[id] : !b[id];
        found.push({ name: 'toggle', opts: { brightness: on ? 1 : 0 } });
        break;
      }
    }
  }
  if (next.selectedPartId !== null && next.selectedPartId !== prev.selectedPartId && dragging === null) {
    found.push({ name: 'select' });
  }

  if (found.length === 0) return null;
  found.sort((x, y) => PRIORITY.indexOf(x.name) - PRIORITY.indexOf(y.name));
  return found[0];
}

/** Metres a second from two samples of a moving thing. `dt` in milliseconds.
 *  Zero for a sample that arrived with no time between it and the last, which a
 *  burst of pointer events does. */
export function speedOf(dist: number, dtMs: number): number {
  if (!(dtMs > 0) || !Number.isFinite(dist)) return 0;
  return Math.abs(dist) / (dtMs / 1000);
}
