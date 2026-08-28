import { describe, expect, it } from 'vitest';
import { photoDropIntent } from '@/lib/photo-drop';
import { SLOT_ORDER } from '@/lib/capture-slots';

/** The bug this file exists for, stated as the assertion that catches it.
 *
 *  A dragged `<img>` is offered to the drop target as a FILE, so `hasFiles` is
 *  true during an internal reorder as well as during a desktop file drop. The
 *  card used to branch on `hasFiles` first, which made every reorder a replace:
 *  dropping wall A onto wall B overwrote B with A's photo, and doing it across
 *  the gallery left one photo on every wall and destroyed the other three.
 *
 *  So the load-bearing case is `hasFiles: true` WITH a `draggingFrom` — the
 *  combination the old ordering got wrong and a naive test would never think to
 *  pass. Every case below therefore runs at BOTH values of `hasFiles`. */
describe('photoDropIntent', () => {
  it('reorders when the drag started in the gallery, even though it carries a file', () => {
    for (const hasFiles of [true, false]) {
      expect(photoDropIntent({ slot: 's', draggingFrom: 'n', hasFiles })).toEqual({
        kind: 'reorder',
        from: 'n',
      });
    }
  });

  it('replaces only when nothing in the gallery is in flight', () => {
    expect(photoDropIntent({ slot: 's', draggingFrom: null, hasFiles: true })).toEqual({
      kind: 'replace',
    });
  });

  it('ignores a drag carrying nothing', () => {
    expect(photoDropIntent({ slot: 's', draggingFrom: null, hasFiles: false })).toEqual({
      kind: 'ignore',
    });
  });

  it('ignores a tile dropped back on itself rather than rewriting it', () => {
    // Not 'replace'. A fall-through here would re-encode the photo over itself
    // and relabel the slot's `by` signal to 'manual' for a gesture that moved
    // nothing.
    for (const hasFiles of [true, false]) {
      expect(photoDropIntent({ slot: 'n', draggingFrom: 'n', hasFiles })).toEqual({ kind: 'ignore' });
    }
  });

  /** The sweep, rather than the four slots someone thought to type. Every
   *  ordered pair of real slots, at both `hasFiles` values: a same-slot pair is
   *  'ignore' and every other pair is a reorder naming the source. This is what
   *  makes "the file branch wins" impossible to reintroduce for one wall
   *  combination only. */
  it('never replaces while a gallery tile is in flight, for any pair of walls', () => {
    let reorders = 0;
    let ignores = 0;
    for (const from of SLOT_ORDER) {
      for (const slot of SLOT_ORDER) {
        for (const hasFiles of [true, false]) {
          const got = photoDropIntent({ slot, draggingFrom: from, hasFiles });
          expect(got.kind).not.toBe('replace');
          if (from === slot) {
            expect(got).toEqual({ kind: 'ignore' });
            ignores++;
          } else {
            expect(got).toEqual({ kind: 'reorder', from });
            reorders++;
          }
        }
      }
    }
    // Assert the COUNT, or the loops above pass over an empty SLOT_ORDER.
    expect(SLOT_ORDER.length).toBe(4);
    expect(ignores).toBe(4 * 2);
    expect(reorders).toBe(4 * 3 * 2);
  });
});
