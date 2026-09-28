/** What a drop onto a photo card means.
 *
 *  A capture tile is the target of two completely different gestures that arrive
 *  through the same `onDrop`: a **file** dragged in from the desktop, which
 *  replaces that wall's photo, and **another tile** dragged across the gallery,
 *  which reorders the set. The card has to tell them apart, and the obvious
 *  discriminator is the wrong one.
 *
 *  `PhotoCard` used to ask `e.dataTransfer.files?.length` first and fall through
 *  to the reorder. But the drag source is an `<img draggable>`, and a dragged
 *  image is offered to the drop target AS A FILE — the browser fills
 *  `dataTransfer` with the image itself. So an internal reorder satisfied the
 *  file test, took the replace branch, and `return`ed before the swap could run:
 *  dropping tile A onto tile B **overwrote B with A** instead of exchanging them,
 *  and repeating it across the gallery left every card showing the one photo that
 *  had been dragged. The reorder path was unreachable by mouse, and because each
 *  step was a legitimate `replacePhoto` the store agreed, so nothing threw,
 *  nothing was announced as wrong, and the photos of the other three walls were
 *  gone.
 *
 *  The fix is that `draggingFrom` is **positive proof** and `files.length` is
 *  merely consistent with either gesture, so the proof is asked first. That
 *  ordering is the whole decision, which is why it lives here rather than inside
 *  a JSX handler: a branch that only a real browser drag can reach is a branch no
 *  test can see. Same reason `lib/drag-click.ts` sits outside its component.
 *
 *  `draggingFrom` is page-level state set by the source card's `onDragStart`, so
 *  it is non-null only while one of this gallery's own tiles is in flight. A drag
 *  that began outside the page cannot set it, which is what makes it proof rather
 *  than a hint. */
export type PhotoDrop<S> =
  /** Put these files on the target wall, replacing whatever is there. */
  | { kind: 'replace' }
  /** Exchange the target wall with `from`. */
  | { kind: 'reorder'; from: S }
  /** Neither — a tile dropped on itself, or a drag carrying nothing we want. */
  | { kind: 'ignore' };

export function photoDropIntent<S>(args: {
  /** The slot being dropped ON. */
  slot: S;
  /** The slot the drag STARTED from, if it started in this gallery. */
  draggingFrom: S | null;
  /** Whether `dataTransfer` carries files. True for an internal image drag too,
   *  which is exactly why it cannot be asked first. */
  hasFiles: boolean;
}): PhotoDrop<S> {
  const { slot, draggingFrom, hasFiles } = args;

  // Proof of an internal drag, asked BEFORE the ambiguous file test.
  if (draggingFrom !== null) {
    // A tile dropped back on itself is not a move. Returning 'ignore' rather
    // than falling through to 'replace' matters: the dragged image is in
    // `dataTransfer`, so a fall-through would re-encode the photo and write it
    // back over itself — a no-op that costs a full IndexedDB round trip and
    // relabels the slot's `by` signal to 'manual'.
    if (draggingFrom === slot) return { kind: 'ignore' };
    return { kind: 'reorder', from: draggingFrom };
  }

  return hasFiles ? { kind: 'replace' } : { kind: 'ignore' };
}

/** What a drop ANYWHERE ELSE on the capture screen means — the add tile, or the page
 *  around the gallery. There is no wall there to replace, so files are ADDED to the
 *  next free walls. Except while one of the gallery's own tiles is in flight: its
 *  image rides in `dataTransfer` as a file (see above), so a tile let go beside the
 *  gallery, or over the add tile, came back as a second copy of the photo it already
 *  is. The same proof, asked first, for the same reason.
 *
 *  The page catches these at all because a file dropped where nothing accepts it is
 *  OPENED by the browser, in place of the app: capping the gallery at the page
 *  measure left a 400px margin either side of it at 1920 that did exactly that. */
export function looseDropIntent<S>(args: {
  /** The slot the drag STARTED from, if it started in this gallery. */
  draggingFrom: S | null;
  hasFiles: boolean;
}): { kind: 'add' } | { kind: 'ignore' } {
  if (args.draggingFrom !== null) return { kind: 'ignore' };
  return args.hasFiles ? { kind: 'add' } : { kind: 'ignore' };
}
