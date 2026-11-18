// How far a press may travel and still be a click rather than a gesture.
//
// R3F hands an object its click whenever the press began and ended on it, however
// far the pointer went between — so an orbit that starts and ends on the floor
// would select the floor, and every look around the room would open its panel. The
// room shell's surfaces and the eyedropper's pick on a piece both ask this one
// question, so they share one answer.

/** Two CSS pixels: R3F's own line for a click on nothing (`onPointerMissed`). */
export const STILL_PX = 2;
/** The same line for a finger or a pen, which wobble on a tap where a mouse does not.
 *  At 2 px a tap on a wall or the floor failed often enough to read as a dead
 *  surface on a phone; an orbit by finger travels far further than this. */
export const STILL_TOUCH_PX = 10;

/** Did the press that produced this click travel too far to be one? `delta` is R3F's
 *  distance in CSS pixels between pointerdown and the click. */
export function travelledPastClick(e: { delta: number; nativeEvent: unknown }): boolean {
  const kind = (e.nativeEvent as Partial<PointerEvent>).pointerType;
  return e.delta > (kind === 'touch' || kind === 'pen' ? STILL_TOUCH_PX : STILL_PX);
}
