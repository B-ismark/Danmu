// Where a piece's name tag sits on the scan screen's photo, and how much of its box is
// drawn there.
//
// Each box carries a tag — the piece's name, how sure the finder was, and the X that
// removes it. It used to hang off the box's top-left corner whatever the box was, so on
// a phone a box at the right ran its tag up to 92 px past the photo (the whole review
// scrolled sideways), and a box touching the top lifted its tag clean above the frame,
// where the scroll box cut it off. The tag holds the X, so a tag off the photo was a
// piece you could not remove there.
//
// So the tag stays on the photo, and stays with its box:
//
//   · ACROSS, it starts at the box's left side, as it always did, and SLIDES left only
//     by as much as it would otherwise run past the photo's right edge. Flipping it to
//     the box's other side instead would guarantee the fit too, and was tried: it grows
//     a mirrored pair's tags toward each other (two bedside lamps, two chairs), so it
//     made collisions that anchoring left never had. A slid tag still spans its box's
//     left side, because it only moved as far as the edge.
//   · It is never wider than the photo, so a long name ellipsises before the X moves.
//   · DOWN, it sits just above the box; where there is no room above, just below it;
//     and only where there is room for neither — a box as tall as the photo — inside its
//     top. Dropping inside was the first answer here, and it covered a small box at the
//     top (a pendant, a picture) completely, hiding the outline and the press that keeps
//     it.
//
// The tag is laid out in the PHOTO's own space, not inside the box: a percentage there
// is a share of the photo, exact, while one inside the box resolves against the box's
// padding box — its 1.5 px border comes off first — which capped a thin box's name at
// half the room it had. Across needs no measuring: the slide is a flex spacer that
// shrinks (`PhotoEditor`). Down does, because "is there room above" is a length in
// pixels and the box's top is a share of a height the page decides, so the photo's
// rendered height comes in as `photoH`. Until it is known the tag sits above, held on
// the photo.
//
// A box can run past the frame — the on-device finder keeps `x` and `w` in 0..1 but not
// their sum, and the cloud path's boxes are not clamped at all — so nothing here trusts a
// box to be on the photo. The CSS holds the tag there on every side instead, and that
// hold is needed for boxes that ARE on it too (a tag above a box at the very top, below
// one at the very bottom), so clamping the box as well would be a second copy of it.
//
// Pure, so the rule can be swept across the whole photo without a browser.

/** The tag's height: the X's 24 px (the WCAG 2.5.8 floor) and 2 px of padding each side. */
export const TAG_HEIGHT_PX = 28;
/** How far the tag overlaps its box's border, so it reads as attached. */
export const TAG_OVERLAP_PX = 2;

export type TagSpot = {
  /** Where the tag starts when it fits: the box's left side, as a share of the photo's
   *  width (percent), so the tag's left edge carries on the line of the box's border.
   *  Not held here: `tagCss` holds it at the photo's left edge. */
  startPct: number;
  /** Which side of the box the tag sits on. */
  place: 'above' | 'below' | 'inside';
  /** The tag's top as `topPct`% of the photo's height plus `topPx`, held on the photo:
   *  at its top, and a tag's height up from its bottom. */
  topPct: number;
  topPx: number;
};

// A row read back from storage is not validated here, and NaN would reach the CSS.
const num = (n: number) => (Number.isFinite(n) ? n : 0);

/** `box` is `[x, y, w, h]` in the photo's normalised 0..1 space, as detections are;
 *  `photoH` is the photo's rendered height in px, or 0 while it is not known. */
export function tagSpot(box: readonly number[], photoH: number): TagSpot {
  // Across, only the box's left side matters: the slide does the rest.
  const [x, y, , h] = box;
  const x0 = num(x);
  const y0 = num(y);
  // A height that is not a number makes the box a line at its top, never one above it.
  const y1 = Math.max(y0, num(y + h));
  const lift = TAG_HEIGHT_PX - TAG_OVERLAP_PX;
  const above: TagSpot = { startPct: x0 * 100, place: 'above', topPct: y0 * 100, topPx: -lift };
  if (!(photoH > 0) || y0 * photoH >= lift) return above;
  if (y1 * photoH + lift <= photoH) return { ...above, place: 'below', topPct: y1 * 100, topPx: -TAG_OVERLAP_PX };
  return { ...above, place: 'inside', topPx: 0 };
}

const pct = (n: number) => `${Number(n.toFixed(4))}%`;

/** The spot as CSS, for `PhotoEditor`: the row the tag rides in (`top`) and the basis
 *  of the spacer ahead of it (`start`), both resolved against the photo. The top is held
 *  at the bottom as well, for a box at the photo's foot: above it, the tag's overlap
 *  would hang the last 2 px past the frame. */
export function tagCss(s: TagSpot): { top: string; start: string } {
  const at = `calc(${pct(s.topPct)} ${s.topPx < 0 ? '-' : '+'} ${Math.abs(s.topPx)}px)`;
  return {
    top: `clamp(0px, ${at}, calc(100% - ${TAG_HEIGHT_PX}px))`,
    start: `max(0px, ${pct(s.startPct)})`,
  };
}

/** The width of a box's outline, each side. */
export const BOX_BORDER_PX = 1.5;

/** A box as the CSS that draws it: only the part of it that is on the photo, as a share
 *  of the photo. That is all anyone sees of it, and a box drawn past the edge scrolled
 *  the whole review sideways — the outline in `PhotoEditor`, and the page's highlight of
 *  the box whose list row is hovered or focused, which drew the same raw box a second
 *  time. Both call this, so the two cannot disagree about where a box is.
 *
 *  `borderPx` is the drawing's own border, each side. A box keeps its two borders when
 *  next to nothing of it is on the photo, so a sliver at the right edge or the foot would
 *  still reach past the frame by their width; its corner is held that far in. An outline
 *  (the highlight's) takes no room, and passes 0. */
export function boxCss(
  box: readonly number[],
  borderPx: number,
): { left: string; top: string; width: string; height: string } {
  const [x0, y0, x1, y1] = [box[0], box[1], box[0] + box[2], box[1] + box[3]].map((n) =>
    Math.min(1, Math.max(0, num(n))),
  );
  const held = (share: number) =>
    borderPx > 0 ? `min(${pct(share * 100)}, calc(100% - ${2 * borderPx}px))` : pct(share * 100);
  return {
    left: held(x0),
    top: held(y0),
    width: pct(Math.max(0, x1 - x0) * 100),
    height: pct(Math.max(0, y1 - y0) * 100),
  };
}
