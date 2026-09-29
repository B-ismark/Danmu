// § 47 — the note a leaving page writes for the one save it cannot finish (`lib/leave-note.ts`).
// The storage is handed in, so this runs in node against a plain map; the page-leave suite
// drives it through `RoomSync` against jsdom's own localStorage.
import { describe, expect, it } from 'vitest';
import {
  clearLeaveNote,
  dropLeaveNote,
  leaveNoteKey,
  leaveNoteRooms,
  readLeaveNote,
  savedSince,
  writeLeaveNote,
  type LeaveNote,
} from '@/lib/leave-note';

function memory(opts: { full?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.full) throw new DOMException('full', 'QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const SHELL = { width: 4.5, depth: 5, height: 2.6, layoutId: 'rect', footprint: [[-2.25, -2.5], [2.25, -2.5], [2.25, 2.5], [-2.25, 2.5]], wallColors: { 0: '#abcdef' } };
const NOTE: LeaveNote = {
  at: 1_000,
  shell: SHELL,
  pin: [{ id: 'sofa-1' }],
  transforms: { positions: { 'sofa-1': [1, 0, 1] }, rotations: {}, dims: {} },
  parts: [{ id: 'sofa-1' }],
};

describe('the leave note', () => {
  it('reads back what was written, per room', () => {
    const s = memory();
    expect(writeLeaveNote('a', NOTE, s)).toBe(true);
    expect(readLeaveNote('a', s)).toEqual(NOTE);
    expect(readLeaveNote('b', s)).toBeNull();
    expect([...s.m.keys()]).toEqual([leaveNoteKey('a')]);
  });

  it('is cleared by the save it stands in for, and not by an earlier one', () => {
    const s = memory();
    writeLeaveNote('a', NOTE, s);
    clearLeaveNote('a', 999, s);
    expect(readLeaveNote('a', s)).toEqual(NOTE);
    clearLeaveNote('a', 1_000, s);
    expect(readLeaveNote('a', s)).toBeNull();
  });

  it('is dropped whatever it says when its room is deleted', () => {
    const s = memory();
    writeLeaveNote('a', NOTE, s);
    dropLeaveNote('a', s);
    expect(s.m.size).toBe(0);
  });

  it.each([
    ['not JSON', '{'],
    ['no time', JSON.stringify({ ...NOTE, at: undefined })],
    ['a time that is not a number', JSON.stringify({ ...NOTE, at: '1000' })],
    ['no shell', JSON.stringify({ ...NOTE, shell: undefined })],
    ['a width of nothing', JSON.stringify({ ...NOTE, shell: { ...SHELL, width: 0 } })],
    ['a height that is not a number', JSON.stringify({ ...NOTE, shell: { ...SHELL, height: null } })],
    ['a depth past any number', JSON.stringify({ ...NOTE, shell: { ...SHELL, depth: '1e400' } })],
    ['transforms with no positions', JSON.stringify({ ...NOTE, transforms: { rotations: {} } })],
    ['parts that are not a list', JSON.stringify({ ...NOTE, parts: { id: 'sofa-1' } })],
    ['a pin that is not a list', JSON.stringify({ ...NOTE, pin: 'sofa-1' })],
  ])('refuses one with %s, whole, and removes it', (_, raw) => {
    const s = memory();
    s.m.set(leaveNoteKey('a'), raw);
    expect(readLeaveNote('a', s)).toBeNull();
    expect(s.m.size).toBe(0);
  });

  it('says so when it cannot be written, and writes nothing', () => {
    const full = memory({ full: true });
    expect(writeLeaveNote('a', NOTE, full)).toBe(false);
    expect(full.m.size).toBe(0);
    const circular: Record<string, unknown> = { id: 'x' };
    circular.self = circular;
    const s = memory();
    expect(writeLeaveNote('a', { ...NOTE, parts: [circular] }, s)).toBe(false);
    expect(s.m.size).toBe(0);
  });

  it('lists the rooms that have one, and nothing else in the storage', () => {
    const s = memory();
    writeLeaveNote('a', NOTE, s);
    writeLeaveNote('b', NOTE, s);
    s.setItem('danmu-settings', '{}');
    expect(leaveNoteRooms(s).sort()).toEqual(['a', 'b']);
  });

  it('is done with once the room is saved later than it, and not in the same millisecond', () => {
    expect(savedSince(1_001, 1_000)).toBe(true);
    expect(savedSince(1_000, 1_000)).toBe(false);
    expect(savedSince(999, 1_000)).toBe(false);
    // A room saved before `touched` existed has never been saved since anything.
    expect(savedSince(undefined, 1_000)).toBe(false);
  });

  it('does nothing, and throws nothing, with no storage at all', () => {
    // `undefined` is "use the default", which in node is none: the same as blocked site data.
    expect(writeLeaveNote('a', NOTE, undefined)).toBe(false);
    expect(readLeaveNote('a', undefined)).toBeNull();
    expect(() => clearLeaveNote('a', 1_000, undefined)).not.toThrow();
    expect(() => dropLeaveNote('a', undefined)).not.toThrow();
    expect(leaveNoteRooms(undefined)).toEqual([]);
  });
});
