import { describe, it, expect } from 'vitest';
import { PRIORITY, cueFor, hourDelta, sizeOf, speedOf, type CueWorld } from '@/lib/sound-cues';
import { SOUND_NAMES } from '@/lib/sound';

// What the room says when it changes (lib/sound-cues.ts). The sound is chosen from
// the STATE, not from the gesture, so these build a before and an after and ask
// what one press of anything that produces that change would sound like.

const FP: [number, number][] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
const sofa = { id: 'sofa-1', dimMM: [2200, 900, 850] as [number, number, number] };
const vase = { id: 'vase-1', dimMM: [150, 150, 300] as [number, number, number] };

function world(over: Partial<CueWorld> = {}): CueWorld {
  return {
    room: 'r1',
    parts: [sofa, vase],
    wallColors: {},
    footprint: FP,
    roomSize: { width: 4, depth: 4, height: 2.6 },
    bearingDeg: 0,
    positions: {},
    rotations: {},
    dims: {},
    lighting: 'daylight',
    hour: 12.8,
    selectedPartId: null,
    hidden: {},
    pinned: {},
    dragging: null,
    restoring: false,
    ...over,
  };
}
const cue = (a: Partial<CueWorld>, b: Partial<CueWorld>, afterDrag = false) =>
  cueFor(world(a), world(b), { afterDrag })?.name ?? null;

describe('silence where nothing was done', () => {
  it('says nothing when nothing changed', () => {
    expect(cue({}, {})).toBeNull();
  });

  it('says nothing while a room opens, however much arrives', () => {
    // Twenty pieces "added", every wall painted, the clock moved: that is a load.
    const loaded = { parts: [sofa, vase, { id: 'bed-1', dimMM: [2000, 1600, 500] as [number, number, number] }], wallColors: { 0: '#aabbcc' }, hour: 22 };
    expect(cue({ room: null, parts: [] }, { ...loaded })).toBeNull();
    expect(cue({ room: 'r0' }, loaded)).toBeNull();
  });

  it('leaves an undo to its own sound', () => {
    expect(cue({}, { parts: [sofa], restoring: true })).toBeNull();
  });

  it('does not hear a drag a second time as a nudge', () => {
    const moved = { positions: { 'sofa-1': [1, 0, 0] as [number, number, number] } };
    expect(cue({ dragging: 'sofa-1' }, { dragging: 'sofa-1', ...moved })).toBeNull();
    // …nor the commit that lands just after release.
    expect(cue({}, moved, true)).toBeNull();
    // Outside a drag it is a nudge.
    expect(cue({}, moved)).toBe('nudge');
  });
});

describe('what each change sounds like', () => {
  it('places, removes and restyles', () => {
    expect(cue({ parts: [sofa] }, { parts: [sofa, vase] })).toBe('place');
    expect(cue({}, { parts: [sofa] })).toBe('remove');
    expect(cue({}, { parts: [{ ...sofa, color: '#123456' }, vase] })).toBe('brush');
    expect(cue({}, { parts: [{ ...sofa, finish: 'gloss' }, vase] })).toBe('brush');
    expect(cue({}, { wallColors: { 2: '#ffeedd' } })).toBe('brush');
    expect(cue({}, { parts: [sofa, { ...vase, decor: [{ kind: 'book' }] }] })).toBe('place');
    expect(cue({}, { parts: [{ ...sofa, groupId: 'g' }, { ...vase, groupId: 'g' }] })).toBe('snap');
  });

  it('places a bigger piece lower', () => {
    const big = cueFor(world({ parts: [vase] }), world({ parts: [vase, sofa] }));
    const small = cueFor(world({ parts: [sofa] }), world({ parts: [sofa, vase] }));
    expect(big!.opts!.size!).toBeGreaterThan(small!.opts!.size!);
  });

  it('turns, stretches, nudges and shuffles', () => {
    expect(cue({}, { rotations: { 'sofa-1': Math.PI / 2 } })).toBe('turn');
    expect(cue({}, { dims: { 'sofa-1': [2400, 900, 850] } })).toBe('stretch');
    expect(cueFor(world(), world({ dims: { 'sofa-1': [2400, 900, 850] } }))!.opts!.brightness).toBe(1);
    expect(cueFor(world(), world({ dims: { 'sofa-1': [1800, 900, 850] } }))!.opts!.brightness).toBe(0);
    const three = { id: 'c', dimMM: [500, 500, 900] as [number, number, number] };
    const all = { parts: [sofa, vase, three] };
    expect(
      cue(all, { ...all, positions: { 'sofa-1': [1, 0, 0], 'vase-1': [0, 0, 1], c: [1, 0, 1] } }),
    ).toBe('shuffle');
    expect(cue({}, { roomSize: { width: 5, depth: 4, height: 2.6 } })).toBe('stretch');
  });

  it('clicks a twist once per 15° detent, not once per frame', () => {
    const d = { dragging: 'sofa-1' };
    expect(cue({ ...d, rotations: { 'sofa-1': 0.01 } }, { ...d, rotations: { 'sofa-1': 0.05 } })).toBeNull();
    expect(cue({ ...d, rotations: { 'sofa-1': 0.1 } }, { ...d, rotations: { 'sofa-1': 0.2 } })).toBe('turn');
  });

  it('toggles up for on and down for off', () => {
    const b = (a: Partial<CueWorld>, c: Partial<CueWorld>) => cueFor(world(a), world(c))!.opts!.brightness;
    expect(cue({}, { hidden: { 'sofa-1': true } })).toBe('toggle');
    expect(b({}, { hidden: { 'sofa-1': true } })).toBe(0);
    expect(b({ hidden: { 'sofa-1': true } }, { hidden: { 'sofa-1': false } })).toBe(1);
    expect(b({}, { pinned: { 'sofa-1': true } })).toBe(1);
  });

  it('selects quietly, and a new piece is placed rather than selected', () => {
    expect(cue({}, { selectedPartId: 'sofa-1' })).toBe('select');
    expect(cue({}, { selectedPartId: null })).toBeNull();
    expect(cue({ parts: [sofa] }, { parts: [sofa, vase], selectedPartId: 'vase-1' })).toBe('place');
    // A press that starts a drag is the drag's.
    expect(cue({}, { selectedPartId: 'sofa-1', dragging: 'sofa-1' })).toBeNull();
  });

  it('removes before it deselects, and deletes before anything', () => {
    expect(cue({ selectedPartId: 'vase-1' }, { parts: [sofa], selectedPartId: null })).toBe('remove');
  });
});

describe('the day', () => {
  it('ticks once per hour passed, and not between', () => {
    expect(cue({ hour: 14.1 }, { hour: 14.2 })).toBeNull();
    expect(cue({ hour: 14.95 }, { hour: 15.05 })).toBe('tick');
    // Midnight is an hour like any other.
    expect(cue({ hour: 23.95 }, { hour: 0.05 })).toBe('tick');
  });

  it('greets the sunrise and sees off the sunset', () => {
    expect(cue({ hour: 5.9 }, { hour: 6.1 })).toBe('dawn');
    expect(cue({ hour: 19.4 }, { hour: 19.6 })).toBe('dusk');
  });

  it('chimes a jump to another time, but not while the sun is being carried', () => {
    expect(cue({ hour: 12.8 }, { hour: 22.2 })).toBe('chime');
    expect(cue({ hour: 12.8, dragging: '__sun__' }, { hour: 15, dragging: '__sun__' })).toBe('tick');
  });

  it('rolls the clouds in, and brings the sun back', () => {
    expect(cue({}, { lighting: 'overcast' })).toBe('cloud');
    expect(cue({ lighting: 'overcast' }, {})).toBe('chime');
    // Overcast has no clock to tick.
    expect(cue({ lighting: 'overcast', hour: 9.9 }, { lighting: 'overcast', hour: 10.1 })).toBeNull();
  });

  it('ticks brighter the higher the sun', () => {
    const at = (h: number) => cueFor(world({ hour: h - 0.05 }), world({ hour: h + 0.05 }))!.opts!.brightness!;
    expect(at(13)).toBeGreaterThan(at(8));
    expect(at(23)).toBe(0);
  });

  it('turns the room with a click', () => {
    expect(cue({ bearingDeg: 0 }, { bearingDeg: 45 })).toBe('turn');
  });
});

describe('the bookkeeping', () => {
  it('ranks only real sounds, each once', () => {
    for (const n of PRIORITY) expect(SOUND_NAMES).toContain(n);
    expect(new Set(PRIORITY).size).toBe(PRIORITY.length);
  });

  it('goes the short way round the clock', () => {
    expect(hourDelta(23, 1)).toBe(2);
    expect(hourDelta(1, 23)).toBe(-2);
    expect(hourDelta(6, 18)).toBe(12);
  });

  it('measures speed, and a burst with no time between is not infinitely fast', () => {
    expect(speedOf(0.5, 500)).toBe(1);
    expect(speedOf(0.5, 0)).toBe(0);
    expect(sizeOf([2500, 100, 100])).toBe(1);
    expect(sizeOf(undefined)).toBe(0.4);
  });
});

describe('a lighting switch a gesture made', () => {
  it('is the gesture’s, not a chime of its own', () => {
    // Grabbing the sun in an overcast room brings the daylight back; the grab has
    // already been heard as a pick.
    expect(cue({ lighting: 'overcast', dragging: '__sun__' }, { lighting: 'daylight', dragging: '__sun__' })).toBeNull();
    // The same switch from a button is a chime.
    expect(cue({ lighting: 'overcast' }, { lighting: 'daylight' })).toBe('chime');
  });
});
