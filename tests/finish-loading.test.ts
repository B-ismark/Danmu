// The "laying the new floor…" state (`lib/finish-loading.ts`). Its one subtle rule is
// the one tested hardest: a slow build that finishes AFTER a newer choice was made must
// not clear the newer one's spinner, or the panel says "done" while the room is still
// on the old floor.

import { describe, expect, it } from 'vitest';
import { clearPending, markPending, pendingFinish } from '@/lib/finish-loading';

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
