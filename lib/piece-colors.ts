// The colour a found piece wears on the scan review: its box on the photo, its label
// and the swatch on its row in the list are one hue, so the two read as one object.
// The eight tokens are `--piece-1..8` in globals.css; this only says which is whose.

export const PIECE_COLOR_COUNT = 8;

/** The token for the piece at `index` in the review's list. Cycles past eight, so the
 *  first eight pieces are all distinct and a ninth shares with the first. */
export function pieceColor(index: number): string {
  const n = ((Math.trunc(index) % PIECE_COLOR_COUNT) + PIECE_COLOR_COUNT) % PIECE_COLOR_COUNT;
  return `var(--piece-${n + 1})`;
}
