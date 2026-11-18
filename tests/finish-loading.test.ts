// The "laying the new floor…" state (`lib/finish-loading.ts`). Its one subtle rule is
// the one tested hardest: a slow build that finishes AFTER a newer choice was made must
// not clear the newer one's spinner, or the panel says "done" while the room is still
// on the old floor.

import { describe, expect, it } from 'vitest';
import { clearPending, markPending, pendingFinish, stagedView } from '@/lib/finish-loading';
import { finishMaps, peekFinishMaps, plasterFields } from '@/lib/textures';

describe('which finish is being prepared', () => {
  it('marks and clears', () => {
    markPending('floor', 'tile:300:dark');
    expect(pendingFinish('floor')).toBe('tile:300:dark');
    clearPending('floor', 'tile:300:dark');
    expect(pendingFinish('floor')).toBeNull();
  });

  it('a stale clear does not clear a newer choice', () => {
    markPending('floor', 'stone:600:match');
    markPending('floor', 'tile:300:dark');
    clearPending('floor', 'stone:600:match');
    expect(pendingFinish('floor')).toBe('tile:300:dark');
    clearPending('floor', 'tile:300:dark');
  });

  it('floor and walls are separate', () => {
    markPending('wall', 'brick:match');
    expect(pendingFinish('floor')).toBeNull();
    clearPending('wall', 'brick:match');
    expect(pendingFinish('wall')).toBeNull();
  });
});

// The renderer's rule for what is on screen while a finish is prepared, pure so it can
// be held here: `useStagedFinish` in RoomShell is a thin hook around it.
describe('what the room shows while a finish is laid', () => {
  type C = { colour: string };
  const shown = { key: 'planks', choice: { colour: 'oak' } as C, maps: 'planks-maps' };
  const miss = () => null;

  it('the chosen finish, live, when its maps are on screen — a recolour is instant', () => {
    const r = stagedView(shown, 'planks', { colour: 'walnut' }, miss);
    expect(r).toEqual({ view: { key: 'planks', choice: { colour: 'walnut' }, maps: 'planks-maps' }, ready: true, adopt: null });
  });

  it('the WHOLE old finish while a new one builds, never new colour over old boards', () => {
    const r = stagedView(shown, 'stone', { colour: 'marble' }, miss);
    expect(r.ready).toBe(false);
    expect(r.view).toBe(shown);
  });

  it('a cached finish is used at once and adopted as what is on screen', () => {
    const r = stagedView(shown, 'tile', { colour: 'white' }, () => 'tile-maps');
    expect(r.ready).toBe(true);
    expect(r.view.maps).toBe('tile-maps');
    expect(r.adopt).toEqual(r.view);
  });

  it('A → built B → cached A → new C keeps A on screen, not B', () => {
    // The sequence the hook runs: B was built and is shown; A comes back from the cache.
    const b = { key: 'B', choice: { colour: 'b' }, maps: 'B-maps' };
    const backToA = stagedView(b, 'A', { colour: 'a' }, () => 'A-maps');
    const onScreen = backToA.adopt!;
    const whileC = stagedView(onScreen, 'C', { colour: 'c' }, miss);
    expect(whileC.ready).toBe(false);
    expect(whileC.view.maps).toBe('A-maps');
    expect(whileC.view.choice).toEqual({ colour: 'a' });
  });
});

describe('the finish cache never drops what is on screen', () => {
  it('a finish gone back to survives the next build', () => {
    const small = () => plasterFields();
    const ch = 'test-channel';
    for (const k of ['A', 'B', 'C']) finishMaps(ch, k, small);
    // Back to A, from the cache — the renderer puts it on screen at once.
    const a = peekFinishMaps(ch, 'A');
    expect(a).not.toBeNull();
    // A new finish is built while A is drawn; A must still be there afterwards.
    finishMaps(ch, 'D', small);
    expect(peekFinishMaps(ch, 'A')).toBe(a);
  });
});
