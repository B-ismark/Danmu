// "Open the left rail AT this section": a request left by a collapsed rail's icon or
// the empty Inspector, and taken once by whichever shell is showing the Room panel.
import { beforeEach, describe, expect, it } from 'vitest';
import { useRailIntent } from '@/lib/rail-intent';

beforeEach(() => useRailIntent.setState({ left: null }));

describe('useRailIntent', () => {
  it('takeLeft hands the request over once and clears it', () => {
    useRailIntent.getState().askLeft('style');
    expect(useRailIntent.getState().takeLeft()).toBe('style');
    // Taken, so a second reader (a remount, the other shell) does not act on it again.
    expect(useRailIntent.getState().left).toBeNull();
    expect(useRailIntent.getState().takeLeft()).toBeNull();
  });

  it('a later ask replaces one nobody took', () => {
    useRailIntent.getState().askLeft('style');
    useRailIntent.getState().askLeft('room');
    expect(useRailIntent.getState().takeLeft()).toBe('room');
  });
});
