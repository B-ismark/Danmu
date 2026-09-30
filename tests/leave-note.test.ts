// § 47 — the note a leaving page writes for the one save it cannot finish (`lib/leave-note.ts`).
// The storage is handed in, so this runs in node against a plain map; the page-leave suite
// drives it through `RoomSync` against jsdom's own localStorage.
import { describe, expect, it } from 'vitest';
import {
  clearLeaveNote,
  dropLeaveNote,
  leaveNoteKey,
  leaveNoteOf,
  leaveNoteRooms,
  noteOwed,
  pendingOf,
  readLeaveNote,
  stillOwed,
  writeLeaveNote,
  type LeaveNote,
} from '@/lib/leave-note';
import type { RoomData } from '@/lib/storage';

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
    ['a depth given as words', JSON.stringify({ ...NOTE, shell: { ...SHELL, depth: '5' } })],
    // JSON has no Infinity to write, but reads `1e400` as one.
    ['a depth past any number', JSON.stringify({ ...NOTE, shell: { ...SHELL, depth: 5 } }).replace('"depth":5', '"depth":1e400')],
    ['a time past any number', JSON.stringify(NOTE).replace('"at":1000', '"at":1e400')],
    ['a corner past any number', JSON.stringify(NOTE).replace('[-2.25,-2.5]', '[-1e400,-2.5]')],
    ['a position past any number', JSON.stringify(NOTE).replace('[1,0,1]', '[1,0,-1e400]')],
    ['transforms with no positions', JSON.stringify({ ...NOTE, transforms: { rotations: {} } })],
    ['parts that are not a list', JSON.stringify({ ...NOTE, parts: { id: 'sofa-1' } })],
    ['a pin that is not a list', JSON.stringify({ ...NOTE, pin: 'sofa-1' })],
  ])('refuses one with %s, whole, and removes it', (_, raw) => {
    const s = memory();
    s.m.set(leaveNoteKey('a'), raw);
    expect(readLeaveNote('a', s)).toBeNull();
    expect(s.m.size).toBe(0);
  });

  it('is not written with a number JSON would turn into nothing', () => {
    const s = memory();
    // A corner of NaN would come back `null`, and reach the room as a vertex of nothing.
    const corner = { ...NOTE, shell: { ...SHELL, footprint: [[Number.NaN, -2.5], [2.25, -2.5], [2.25, 2.5]] } };
    expect(writeLeaveNote('a', corner, s)).toBe(false);
    expect(writeLeaveNote('a', { ...NOTE, transforms: { positions: { x: [Infinity, 0, 0] }, rotations: {}, dims: {} } }, s)).toBe(false);
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

  // Each part of the save is owed until that part is written at or after the note's time:
  // the save the note stands in for stamps exactly its time, so equal is that save landing.
  const ALL = { room: true, transforms: true, parts: true, pin: true };
  it.each([
    ['nothing written since', {}, { room: true, transforms: true, parts: true, pin: true }],
    ['every part written earlier', { room: 999, transforms: 999, scene: 999 }, { room: true, transforms: true, parts: true, pin: true }],
    ['the save itself landed', { room: 1_000, transforms: 1_000, scene: 1_000 }, { room: false, transforms: false, parts: false, pin: false }],
    ['only the room written since', { room: 1_001 }, { room: false, transforms: true, parts: true, pin: false }],
    ['only the positions written since', { transforms: 1_001 }, { room: true, transforms: false, parts: true, pin: true }],
    // A re-scan: the arrangement dropped after the leave, the shell not.
    ['the scene and the positions written since', { transforms: 1_001, scene: 1_001 }, { room: true, transforms: false, parts: false, pin: false }],
    ['a stamp that is not a time', { room: '2000', scene: null }, { room: true, transforms: true, parts: true, pin: true }],
  ])('with %s, owes what is left', (_, written, owed) => {
    expect(stillOwed(1_000, ALL, written)).toEqual(owed);
  });

  it('owes only what the save had in it', () => {
    const none = { room: false, transforms: false, parts: false, pin: false };
    expect(stillOwed(1_000, none, {})).toEqual(none);
    expect(stillOwed(1_000, { ...none, pin: true }, {})).toEqual(none);
  });

  it('is done with once every part it carries has been written since, and not before', () => {
    expect(noteOwed(NOTE, { room: 1_000, transforms: 1_000, scene: 1_000 })).toBe(false);
    expect(noteOwed(NOTE, { room: 1_000, transforms: 1_000 })).toBe(true);
    // A note with no positions and no parts is done when its room is: the pin is the
    // room's, stored with it or rightly not at all (a photographed room is never pinned).
    const shellOnly: LeaveNote = { at: 1_000, shell: SHELL, pin: [{ id: 'sofa-1' }] };
    expect(noteOwed(shellOnly, { room: 1_000 })).toBe(false);
    expect(noteOwed(shellOnly, { room: 999, scene: 2_000 })).toBe(true);
  });

  it('carries the save there and back, and one copy of the furniture', () => {
    const w = { transforms: NOTE.transforms, parts: NOTE.parts, pin: [{ id: 'older' }] };
    const note = leaveNoteOf(1_000, SHELL, w);
    // The part list is stored over the pin, so the pin does not ride along with it.
    expect(note).toEqual({ at: 1_000, shell: SHELL, transforms: w.transforms, parts: w.parts, pin: undefined });
    expect(leaveNoteOf(1_000, SHELL, { pin: w.pin }).pin).toEqual(w.pin);

    const s = memory();
    writeLeaveNote('a', note, s);
    const back = pendingOf(readLeaveNote('a', s)!, (stored, shell) => ({ ...stored, ...(shell as object) }));
    expect(back).toMatchObject({ at: 1_000, unlessSavedSince: 1_000, transforms: w.transforms, parts: w.parts });
    expect(back.room?.pin).toBeUndefined();
    const stored = { id: 'a', name: 'Kept', width: 9 } as unknown as RoomData;
    expect(back.room?.edit(stored)).toMatchObject({ id: 'a', name: 'Kept', width: 4.5, depth: 5 });
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
