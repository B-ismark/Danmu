// "Is this still the room the solve was asked about?"
//
// A solve used to run on the main thread, so nothing could change underneath it:
// the window was frozen until the answer was written. Off the thread, the user can
// drag a chair, lock a piece or delete one while the search runs — and the answer
// is index-aligned to the parts it was handed, written over the transform maps as
// they stood at the press. Applying it anyway would silently undo the drag, or
// move the wrong piece if one was removed.
//
// So a press takes a stamp, and the answer is applied only if the stamp still
// matches. It is REFERENCE equality over the store slices a solve reads, which is
// both cheap and exact here: every store write replaces the slice it changes, and
// nothing a solve does not read (selection, hover, the camera) is in the stamp, so
// orbiting while it thinks does not throw the answer away.

export type SolveInputs = {
  parts: unknown;
  room: unknown;
  positions: unknown;
  rotations: unknown;
  dims: unknown;
  parentIds: unknown;
  pinned: unknown;
};

export type SolveStamp = readonly unknown[];

/** The slices, in a fixed order. Named in a type so a new input the solve starts
 *  reading has somewhere to go that the compiler will point at. */
export function stampOf(inputs: SolveInputs): SolveStamp {
  return [inputs.parts, inputs.room, inputs.positions, inputs.rotations, inputs.dims, inputs.parentIds, inputs.pinned];
}

export function sameStamp(a: SolveStamp, b: SolveStamp): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}
